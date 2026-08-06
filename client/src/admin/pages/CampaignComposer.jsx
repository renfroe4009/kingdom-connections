import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

/**
 * CampaignComposer — the unified create/edit form.
 *
 * One page covers both new and existing campaigns; the route component
 * detects edit mode via the :id route param. We deliberately keep this a
 * full page (rather than a modal) because campaigns have several
 * inter-dependent fields (type ↔ schedule shape, audience ↔ recipient
 * count) that benefit from breathing room.
 *
 * Phase 1a surfaces blast + recurring. Drip / triggered are reachable via
 * the API but the type radios hide them — they need a step-list editor
 * (1b) to be usable.
 *
 * Single-step model: each campaign in 1a sends ONE template. The schema
 * supports multi-step drips (steps[]) and we store steps as an array under
 * the hood, but the form pretends there's just `template_id`. Adding the
 * step editor in 1b is an additive UI change, not a data-model change.
 */

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'UTC',
];

const CRON_PRESETS = [
  { label: 'Every Monday 9:00 AM', value: '0 9 * * MON' },
  { label: 'Every weekday 9:00 AM', value: '0 9 * * MON-FRI' },
  { label: 'First of every month 9:00 AM', value: '0 9 1 * *' },
  { label: 'Every Friday 4:00 PM', value: '0 16 * * FRI' },
  { label: 'Every hour on the hour', value: '0 * * * *' },
];

const guessTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Convert a Date or ISO string into the value an <input type="datetime-local"> wants.
function toLocalInput(s) {
  if (!s) return '';
  const d = typeof s === 'string' ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

const emptyForm = {
  name: '',
  description: '',
  type: 'blast',
  audience_type: 'list',
  audience_list_id: '',
  audience_contact_ids: [],
  schedule_send_at: '',     // datetime-local
  schedule_cron: '0 9 * * MON',
  schedule_timezone: guessTimezone(),
  template_id: '',
};

export default function CampaignComposer() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();

  const [form, setForm] = useState(emptyForm);
  const [templates, setTemplates] = useState([]);
  const [lists, setLists] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [contactQuery, setContactQuery] = useState('');
  const [previewCount, setPreviewCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(!editing);

  // Look-ups: templates, lists, and (in edit mode) the campaign itself.
  useEffect(() => {
    api.get('/templates', { params: { channel: 'email' } })
      .then(({ data }) => setTemplates((data || []).filter((t) => t.channel === 'email' && t.is_active)))
      .catch(() => {});
    api.get('/lists').then(({ data }) => setLists(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) return;
    api.get(`/campaigns/${id}`).then(({ data }) => {
      const step0 = (data.steps || [])[0] || {};
      setForm({
        name:                 data.name || '',
        description:          data.description || '',
        type:                 data.type || 'blast',
        audience_type:        data.audience_type || 'list',
        audience_list_id:     data.audience_config?.list_id || '',
        audience_contact_ids: data.audience_config?.contact_ids || [],
        schedule_send_at:     toLocalInput(data.schedule_config?.send_at),
        schedule_cron:        data.schedule_config?.cron || '0 9 * * MON',
        schedule_timezone:    data.schedule_config?.timezone || guessTimezone(),
        template_id:          step0.template_id || '',
      });
      setLoaded(true);
    }).catch((e) => setErr(e.response?.data?.error || e.message));
  }, [id, editing]);

  // Audience preview — debounced + only when audience config can plausibly resolve.
  // We only call this in edit mode (the campaign exists on the server). In
  // create mode we approximate the count locally for list / specific-contacts.
  useEffect(() => {
    let cancelled = false;
    if (!editing) {
      // Local approximation:
      if (form.audience_type === 'contacts') setPreviewCount(form.audience_contact_ids.length);
      else if (form.audience_type === 'list' && form.audience_list_id) {
        const l = lists.find((x) => String(x.id) === String(form.audience_list_id));
        setPreviewCount(l?.member_count ?? null);
      } else if (form.audience_type === 'all') setPreviewCount('all');
      else setPreviewCount(null);
      return undefined;
    }
    const t = setTimeout(() => {
      api.get(`/campaigns/${id}/preview-audience`)
        .then(({ data }) => { if (!cancelled) setPreviewCount(data.count); })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [editing, id, form.audience_type, form.audience_list_id, form.audience_contact_ids, lists]);

  // Contact search for the "Specific contacts" audience.
  useEffect(() => {
    if (form.audience_type !== 'contacts') return;
    const t = setTimeout(() => {
      const params = { pageSize: 30 };
      if (contactQuery) params.q = contactQuery;
      api.get('/contacts', { params })
        .then(({ data }) => setContacts(data.rows || []))
        .catch(() => setContacts([]));
    }, 200);
    return () => clearTimeout(t);
  }, [contactQuery, form.audience_type]);

  // Build the request payload from the flat form state.
  const payload = useMemo(() => {
    const audience_config = (() => {
      switch (form.audience_type) {
        case 'list':
          return form.audience_list_id ? { list_id: Number(form.audience_list_id) } : {};
        case 'contacts':
          return { contact_ids: form.audience_contact_ids.map(Number) };
        case 'all':
          return {};
        default:
          return {};
      }
    })();

    const schedule_config = (() => {
      if (form.type === 'blast') {
        return {
          send_at:  form.schedule_send_at ? new Date(form.schedule_send_at).toISOString() : null,
          timezone: form.schedule_timezone,
        };
      }
      if (form.type === 'recurring') {
        return { cron: form.schedule_cron, timezone: form.schedule_timezone };
      }
      return {};
    })();

    return {
      name:        form.name.trim(),
      description: form.description?.trim() || null,
      type:        form.type,
      audience_type: form.audience_type,
      audience_config,
      schedule_config,
      steps: form.template_id
        ? [{ template_id: Number(form.template_id), delay_minutes: 0, is_active: true }]
        : [],
    };
  }, [form]);

  function validate() {
    if (!form.name.trim()) return 'Give the campaign a name.';
    if (!form.template_id) return 'Pick an email template.';
    if (form.audience_type === 'list' && !form.audience_list_id) return 'Pick a list to send to.';
    if (form.audience_type === 'contacts' && form.audience_contact_ids.length === 0)
      return 'Add at least one contact.';
    if (form.type === 'blast' && !form.schedule_send_at)
      return 'Pick a send date and time.';
    if (form.type === 'recurring' && !form.schedule_cron.trim())
      return 'Provide a cron schedule expression.';
    return null;
  }

  async function save({ start = false } = {}) {
    setErr('');
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true);
    try {
      const res = editing
        ? await api.put(`/campaigns/${id}`, payload)
        : await api.post('/campaigns', payload);
      const cid = res.data.id || id;
      if (start) await api.post(`/campaigns/${cid}/start`);
      nav(`/admin/comms/campaigns/${cid}`);
    } catch (e) {
      setErr(e.response?.data?.error || e.response?.data?.issues?.[0]?.message || e.message || 'Save failed');
    } finally { setBusy(false); }
  }

  function toggleContact(c) {
    setForm((f) => {
      const exists = f.audience_contact_ids.includes(c.id);
      return {
        ...f,
        audience_contact_ids: exists
          ? f.audience_contact_ids.filter((x) => x !== c.id)
          : [...f.audience_contact_ids, c.id],
      };
    });
  }

  if (!loaded) return <div className="p-3 text-muted">Loading campaign…</div>;

  const audienceCountLabel = previewCount === 'all'
    ? 'all contacts with an email address'
    : previewCount == null ? '—' : `${previewCount} contact${previewCount === 1 ? '' : 's'}`;

  return (
    <div>
      <PageHeader
        title={editing ? 'Edit Campaign' : 'New Campaign'}
        subtitle={editing ? 'Update the schedule, audience, or template' : 'Schedule a one-shot blast or a recurring email send'}
        actions={(
          <Link to="/admin/comms/campaigns" className="btn btn-light">
            <iconify-icon icon="solar:arrow-left-line-duotone" class="me-1"></iconify-icon> Back
          </Link>
        )}
      />

      {err && <div className="alert alert-danger">{err}</div>}

      <div className="row g-3">
        <div className="col-lg-8">
          {/* ---- Basics ---- */}
          <div className="card mb-3">
            <div className="card-body">
              <h5 className="mb-3">Basics</h5>
              <div className="row g-2">
                <div className="col-md-8">
                  <label className="form-label">Campaign name</label>
                  <input className="form-control" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="May newsletter / Q2 product launch / etc." />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Type</label>
                  <select className="form-select" value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option value="blast">One-shot blast</option>
                    <option value="recurring">Recurring</option>
                    <option value="drip" disabled>Drip sequence (phase 1b)</option>
                    <option value="triggered" disabled>Event-triggered (phase 1b)</option>
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label">Description (optional)</label>
                  <textarea className="form-control" rows={2} value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
            </div>
          </div>

          {/* ---- Audience ---- */}
          <div className="card mb-3">
            <div className="card-body">
              <h5 className="mb-3">Who gets this email?</h5>
              <div className="btn-group mb-3" role="group">
                {[
                  { v: 'list',     label: 'Saved list' },
                  { v: 'all',      label: 'All contacts' },
                  { v: 'contacts', label: 'Specific contacts' },
                ].map((o) => (
                  <button key={o.v} type="button"
                    className={`btn btn-${form.audience_type === o.v ? 'primary' : 'light'}`}
                    onClick={() => setForm({ ...form, audience_type: o.v })}>
                    {o.label}
                  </button>
                ))}
              </div>

              {form.audience_type === 'list' && (
                <div>
                  <label className="form-label">List</label>
                  <select className="form-select" value={form.audience_list_id}
                    onChange={(e) => setForm({ ...form, audience_list_id: e.target.value })}>
                    <option value="">— Pick a list —</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} ({l.member_count} member{l.member_count === 1 ? '' : 's'})</option>
                    ))}
                  </select>
                  <small className="text-muted">List membership is resolved fresh each time the campaign sends — adds and removals after scheduling are reflected.</small>
                </div>
              )}

              {form.audience_type === 'all' && (
                <div className="alert alert-warning mb-0">
                  <iconify-icon icon="solar:danger-triangle-line-duotone" class="me-1"></iconify-icon>
                  This will email every contact in the CRM with a non-empty email address. Consider a saved list instead for first sends.
                </div>
              )}

              {form.audience_type === 'contacts' && (
                <div>
                  <label className="form-label">Search contacts</label>
                  <input className="form-control mb-2" placeholder="Type to search…"
                    value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} />
                  <div className="border rounded bg-white" style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {contacts.length === 0
                      ? <div className="p-2 text-muted small">No contacts match.</div>
                      : contacts.map((c) => {
                          const picked = form.audience_contact_ids.includes(c.id);
                          return (
                            <div key={c.id} className="d-flex align-items-center justify-content-between px-2 py-1">
                              <span>
                                <strong>{c.first_name} {c.last_name}</strong>{' '}
                                <span className="text-muted small">{c.email || '—'}</span>
                                {c.organization_name && <span className="text-muted small"> · {c.organization_name}</span>}
                              </span>
                              <button type="button" className={`btn btn-sm ${picked ? 'btn-primary' : 'btn-light'}`}
                                onClick={() => toggleContact(c)} disabled={!c.email}>
                                {picked ? 'Selected' : c.email ? 'Add' : 'No email'}
                              </button>
                            </div>
                          );
                        })}
                  </div>
                  <small className="text-muted">
                    {form.audience_contact_ids.length} selected
                  </small>
                </div>
              )}
            </div>
          </div>

          {/* ---- Schedule ---- */}
          <div className="card mb-3">
            <div className="card-body">
              <h5 className="mb-3">Schedule</h5>

              {form.type === 'blast' && (
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label">Send at</label>
                    <input type="datetime-local" className="form-control"
                      value={form.schedule_send_at}
                      onChange={(e) => setForm({ ...form, schedule_send_at: e.target.value })} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Timezone</label>
                    <select className="form-select" value={form.schedule_timezone}
                      onChange={(e) => setForm({ ...form, schedule_timezone: e.target.value })}>
                      {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                    <small className="text-muted">The datetime above is interpreted in your browser's local time and converted to UTC on save.</small>
                  </div>
                </div>
              )}

              {form.type === 'recurring' && (
                <div className="row g-2">
                  <div className="col-md-12">
                    <label className="form-label">Preset</label>
                    <select className="form-select"
                      value={form.schedule_cron}
                      onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })}>
                      {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      {!CRON_PRESETS.find((p) => p.value === form.schedule_cron) && (
                        <option value={form.schedule_cron}>Custom: {form.schedule_cron}</option>
                      )}
                    </select>
                  </div>
                  <div className="col-md-8">
                    <label className="form-label">Cron expression</label>
                    <input className="form-control font-monospace" value={form.schedule_cron}
                      onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })} />
                    <small className="text-muted">Five fields: <code>min hour day-of-month month day-of-week</code>. Day-of-week may use MON, TUE, etc.</small>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Timezone</label>
                    <select className="form-select" value={form.schedule_timezone}
                      onChange={(e) => setForm({ ...form, schedule_timezone: e.target.value })}>
                      {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ---- Content ---- */}
          <div className="card mb-3">
            <div className="card-body">
              <h5 className="mb-3">Content</h5>
              <label className="form-label">Email template</label>
              <select className="form-select" value={form.template_id}
                onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
                <option value="">— Pick a template —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <small className="text-muted">
                Each recipient gets a per-contact render — <code>{'{{contact.first_name}}'}</code>, <code>{'{{organization.name}}'}</code>, etc. resolve at send time.{' '}
                <Link to="/admin/comms/templates">Manage templates</Link>
              </small>
            </div>
          </div>
        </div>

        {/* ---- Sidebar summary ---- */}
        <div className="col-lg-4">
          <div className="card">
            <div className="card-body">
              <h5 className="mb-3">Summary</h5>
              <dl className="row mb-0 small">
                <dt className="col-5 text-muted">Type</dt>
                <dd className="col-7 text-capitalize">{form.type}</dd>

                <dt className="col-5 text-muted">Audience</dt>
                <dd className="col-7 text-capitalize">{form.audience_type.replace('_', ' ')}</dd>

                <dt className="col-5 text-muted">Estimated recipients</dt>
                <dd className="col-7"><strong>{audienceCountLabel}</strong></dd>

                <dt className="col-5 text-muted">When</dt>
                <dd className="col-7">
                  {form.type === 'blast'
                    ? (form.schedule_send_at || '—')
                    : <code className="small">{form.schedule_cron}</code>}
                </dd>
              </dl>
            </div>
            <div className="card-footer d-grid gap-2">
              <button className="btn btn-primary" disabled={busy} onClick={() => save({ start: true })}>
                {busy ? 'Saving…' : (editing ? 'Save & re-schedule' : 'Save & schedule')}
              </button>
              <button className="btn btn-light" disabled={busy} onClick={() => save({ start: false })}>
                Save as draft
              </button>
            </div>
          </div>

          <div className="alert alert-info mt-3 small mb-0">
            <strong>How sending works:</strong> a single in-process worker drains the queue every minute. Scheduled blasts go out at their <em>send_at</em>; recurring campaigns are evaluated every 5 minutes against their cron expression.
          </div>
        </div>
      </div>
    </div>
  );
}
