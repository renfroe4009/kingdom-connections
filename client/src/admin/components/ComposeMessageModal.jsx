import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import RecipientPicker from './RecipientPicker.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { useIntegrations } from '../context/IntegrationsContext.jsx';

/**
 * Reusable compose modal — used by the Inbox header, the Reply buttons, and
 * the per-record Send Message buttons on Contact / Deal / Org details.
 *
 * Props:
 *   show / onClose / onSent — lifecycle
 *   defaults — { channel, to, subject, body, entity_type, entity_id,
 *                contact_id, deal_id, organization_id }
 *
 * Routing rules (applies to email + sms):
 *   • single recipient, no list  → /api/{channel}/send       (entity-bound, 1 row)
 *   • multi recipient OR list_id → /api/{channel}/bulk-send  (server fans out)
 *
 *   Bulk send returns { ok, sent, failed, errors[] } so we surface a
 *   "Sent X of Y" line instead of pretending failures didn't happen.
 *
 *   We intentionally don't try to "smart route" inside bulk — if a list_id is
 *   chosen, we forward it and let the server resolve members; that way the
 *   recipient set is always the freshest version of the list.
 */
export default function ComposeMessageModal({ show, onClose, defaults = {}, onSent }) {
  const { smtp: smtpActive, sms: smsActive } = useIntegrations();
  const [channel, setChannel]   = useState(defaults.channel || 'email');
  const [recipient, setRecipient] = useState({ mode: 'single', to: defaults.to || '', contacts: [], listId: null });
  const [subject, setSubject]   = useState(defaults.subject || '');
  const [body, setBody]         = useState(defaults.body || '');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const [resultMsg, setResultMsg] = useState('');

  // Reset on open with whatever defaults the caller passed in. We intentionally
  // do this on open (not every render) so users typing into the modal don't see
  // their text snap back when the parent re-renders with the same defaults.
  useEffect(() => {
    if (!show) return;
    let initialChannel = defaults.channel || 'email';
    if (initialChannel === 'email' && !smtpActive && smsActive) initialChannel = 'sms';
    else if (initialChannel === 'sms' && !smsActive && smtpActive) initialChannel = 'email';
    setChannel(initialChannel);
    setRecipient({ mode: 'single', to: defaults.to || '', contacts: [], listId: null });
    setSubject(defaults.subject || '');
    setBody(defaults.body || '');
    setTemplateId('');
    setErr('');
    setResultMsg('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    if (!show) return;
    api.get('/templates', { params: { channel, active: 1 } })
      .then(({ data }) => setTemplates(data || []))
      .catch(() => setTemplates([]));
  }, [show, channel]);

  async function applyTemplate(id) {
    setTemplateId(id);
    if (!id) return;
    try {
      const { data } = await api.post('/templates/preview', {
        template_id: Number(id),
        contact_id:      defaults.contact_id      ?? (defaults.entity_type === 'contact'      ? defaults.entity_id : undefined),
        organization_id: defaults.organization_id ?? (defaults.entity_type === 'organization' ? defaults.entity_id : undefined),
        deal_id:         defaults.deal_id         ?? (defaults.entity_type === 'deal'         ? defaults.entity_id : undefined),
      });
      if (data.subject !== undefined) setSubject(data.subject);
      if (data.body !== undefined) setBody(data.body);
    } catch {/* ignore */}
  }

  // Decide whether this submission needs the bulk endpoint.
  function isBulk() {
    return Boolean(recipient.listId) || (recipient.mode === 'multiple' && recipient.contacts.length > 0);
  }

  async function send() {
    setErr('');
    setResultMsg('');

    if (channel === 'email' && !smtpActive) return setErr('Email is not available — SMTP is not configured.');
    if (channel === 'sms' && !smsActive) return setErr('SMS is not available — SMS is not configured.');
    if (!body.trim()) return setErr('Message body required');
    if (channel === 'email' && !subject.trim() && !templateId) {
      return setErr('Subject required for email');
    }

    if (isBulk()) {
      // Recipients[] must have at least an address; contact_id lets the server
      // render per-recipient merge fields. If a list_id is set, recipients[]
      // is ignored server-side — the list resolves to its members at send time.
      const recipients = recipient.contacts
        .map((c) => {
          const addr = channel === 'email' ? c.email : (c.mobile || c.phone);
          return addr ? { to: addr, contact_id: c.id, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || undefined } : null;
        })
        .filter(Boolean);

      if (!recipient.listId && recipients.length === 0) {
        return setErr('Pick at least one contact or a saved list.');
      }
    } else {
      if (!recipient.to.trim()) {
        return setErr(channel === 'email' ? 'Recipient email required' : 'Recipient phone required');
      }
    }

    setBusy(true);
    try {
      if (isBulk()) {
        const recipients = recipient.contacts
          .map((c) => {
            const addr = channel === 'email' ? c.email : (c.mobile || c.phone);
            return addr ? { to: addr, contact_id: c.id, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || undefined } : null;
          })
          .filter(Boolean);

        const payload = {
          recipients: recipient.listId ? undefined : recipients,
          list_id:    recipient.listId || undefined,
          template_id: templateId ? Number(templateId) : undefined,
        };
        if (channel === 'email') {
          payload.subject = subject;
          payload.html    = body;
          payload.text    = body;
        } else {
          payload.body = body;
        }

        const { data } = await api.post(`/${channel}/bulk-send`, payload);
        const total = (data.sent || 0) + (data.failed || 0);
        setResultMsg(`Sent to ${data.sent} of ${total} recipients${data.failed ? ` — ${data.failed} failed` : ''}.`);
        // Surface first few errors so user sees what bounced.
        if (Array.isArray(data.errors) && data.errors.length) {
          const sample = data.errors.slice(0, 3).map((e) => `${e.to}: ${e.error}`).join(' · ');
          setErr(`${data.errors.length} failure${data.errors.length === 1 ? '' : 's'}: ${sample}${data.errors.length > 3 ? ' …' : ''}`);
        }
        // Auto-close on full success; keep open so admins can see partials.
        if (!data.failed) {
          onSent?.(data);
          // small delay so user sees success line
          setTimeout(() => onClose?.(), 600);
        } else {
          onSent?.(data);
        }
      } else {
        if (channel === 'email') {
          await api.post('/email/send', {
            to: recipient.to, subject, html: body, text: body,
            entity_type: defaults.entity_type, entity_id: defaults.entity_id,
          });
        } else {
          await api.post('/sms/send', {
            to: recipient.to, body,
            entity_type: defaults.entity_type, entity_id: defaults.entity_id,
          });
        }
        onSent?.();
      }
    } catch (e) {
      setErr(e.response?.data?.error
        || (Array.isArray(e.response?.data?.issues) ? e.response.data.issues.map((i) => `${i.path?.join('.')}: ${i.message}`).join(' · ') : '')
        || e.message
        || 'Send failed.');
    } finally {
      setBusy(false);
    }
  }

  const bulk = isBulk();
  const sendLabel = busy
    ? 'Sending…'
    : bulk
      ? `Send${recipient.listId
          ? ' to list'
          : recipient.contacts.length ? ` to ${recipient.contacts.length}` : ''}`
      : 'Send';

  return (
    <Modal show={show} onClose={onClose} size="lg"
      title={channel === 'email' ? 'New Email' : 'New SMS'}
      footer={<>
        <button className="btn btn-light" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={send} disabled={busy}>{sendLabel}</button>
      </>}>
      <div className="row g-2">
        {(resultMsg || err) && (
          <div className="col-12">
            {resultMsg && <div className="alert alert-success mb-2">{resultMsg}</div>}
            <FormErrorBanner error={err} />
          </div>
        )}

        <div className="col-md-3">
          <label className="form-label">Channel</label>
          <select className="form-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="email" disabled={!smtpActive}>Email{!smtpActive ? ' (not configured)' : ''}</option>
            <option value="sms" disabled={!smsActive}>SMS{!smsActive ? ' (not configured)' : ''}</option>
          </select>
        </div>
        <div className="col-md-9">
          <label className="form-label">Recipients</label>
          <RecipientPicker channel={channel} value={recipient} onChange={setRecipient} />
        </div>

        <div className="col-12">
          <label className="form-label">Template</label>
          <select className="form-select" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">— No template —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.category ? `[${t.category}] ` : ''}{t.name}
              </option>
            ))}
          </select>
          <small className="text-muted">
            {bulk
              ? 'In bulk mode, merge fields are rendered per-recipient on the server.'
              : 'Selecting a template fills subject/body and resolves merge fields against the linked record.'}
          </small>
        </div>

        {channel === 'email' && (
          <div className="col-12">
            <label className="form-label">Subject</label>
            <input className="form-control" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}

        <div className="col-12">
          <label className="form-label d-flex justify-content-between">
            <span>Body</span>
            {channel === 'sms' && <small className="text-muted">{body.length} chars</small>}
          </label>
          <textarea className="form-control font-monospace" rows={channel === 'email' ? 10 : 5}
            value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        {!bulk && defaults.entity_type && defaults.entity_id && (
          <div className="col-12">
            <small className="text-muted">
              Linked to {defaults.entity_type} #{defaults.entity_id} — appears on its activity timeline.
            </small>
          </div>
        )}

        {bulk && (
          <div className="col-12">
            <small className="text-muted">
              Bulk sends log one row per recipient and link to each contact's timeline. They are not bound to {defaults.entity_type ? `the open ${defaults.entity_type}` : 'an originating record'}.
            </small>
          </div>
        )}
      </div>
    </Modal>
  );
}
