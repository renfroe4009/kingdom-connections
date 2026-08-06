import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import ComposeMessageModal from '../components/ComposeMessageModal.jsx';

const CHANNELS = [
  { key: '',      label: 'All' },
  { key: 'email', label: 'Email' },
  { key: 'sms',   label: 'SMS' },
];
const STATUSES = ['', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received'];

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
}

function entityLink(item) {
  if (!item.entity_type || !item.entity_id) return null;
  const path = {
    contact: '/contacts/',
    organization: '/organizations/',
    deal: '/deals/',
  }[item.entity_type];
  if (!path) return null;
  return <Link to={`${path}${item.entity_id}`} className="text-primary">{item.entity_type} #{item.entity_id}</Link>;
}

function statusBadge(s) {
  const tone = {
    queued:      'bg-warning-subtle text-warning',
    sending:     'bg-warning-subtle text-warning',
    sent:        'bg-success-subtle text-success',
    delivered:   'bg-success-subtle text-success',
    received:    'bg-info-subtle text-info',
    undelivered: 'bg-danger-subtle text-danger',
    failed:      'bg-danger-subtle text-danger',
  }[s] || 'bg-light text-muted';
  return <span className={`badge ${tone}`}>{s}</span>;
}

export default function CommsInboxPage() {
  const [channel, setChannel] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus]   = useState('');
  const [q, setQ]             = useState('');
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [items, setItems]     = useState([]);
  const [totals, setTotals]   = useState({ email: 0, sms: 0, total: 0 });
  const [selected, setSelected] = useState(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDefaults, setComposeDefaults] = useState({});

  async function load() {
    const params = {};
    if (channel)   params.channel = channel;
    if (direction) params.direction = direction;
    if (status)    params.status = status;
    if (q)         params.q = q;
    if (from)      params.from = from;
    if (to)        params.to   = to;
    const { data } = await api.get('/comms/inbox', { params });
    setItems(data.items || []);
    setTotals(data.totals || { email: 0, sms: 0, total: 0 });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channel, direction, status, from, to]);

  function preset(days) {
    const today = new Date();
    const end   = today.toISOString().slice(0, 10);
    const start = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
    setFrom(start); setTo(end);
  }

  const headerActions = useMemo(() => (
    <>
      <button className="btn btn-light" onClick={load}>
        <iconify-icon icon="solar:refresh-line-duotone" class="me-1"></iconify-icon> Refresh
      </button>
      <button className="btn btn-primary" onClick={() => { setComposeDefaults({}); setComposeOpen(true); }}>
        <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> New Message
      </button>
    </>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), []);

  return (
    <div>
      <PageHeader title="Communication Center" subtitle="Unified inbox for email and SMS" actions={headerActions} />

      <div className="row g-2 mb-3">
        <div className="col-md-4">
          <div className="card mb-0"><div className="card-body py-3">
            <small className="text-muted">All messages</small>
            <h4 className="mb-0 fw-bolder">{totals.total}</h4>
          </div></div>
        </div>
        <div className="col-md-4">
          <div className="card mb-0" style={{ background: '#EAF4FF' }}><div className="card-body py-3">
            <small className="text-muted">📧 Email</small>
            <h4 className="mb-0 fw-bolder text-primary">{totals.email}</h4>
          </div></div>
        </div>
        <div className="col-md-4">
          <div className="card mb-0" style={{ background: '#F4ECFF' }}><div className="card-body py-3">
            <small className="text-muted">📱 SMS</small>
            <h4 className="mb-0 fw-bolder" style={{ color: '#7C3AED' }}>{totals.sms}</h4>
          </div></div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-6 col-md-2">
              <label className="form-label small mb-1">Channel</label>
              <select className="form-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small mb-1">Direction</label>
              <select className="form-select" value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="">Any</option>
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small mb-1">Status</label>
              <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s || 'any'} value={s}>{s || 'Any'}</option>)}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small mb-1">From</label>
              <input type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small mb-1">To</label>
              <input type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="col-6 col-md-2 d-flex gap-1">
              <button className="btn btn-light btn-sm" onClick={() => preset(7)}>7d</button>
              <button className="btn btn-light btn-sm" onClick={() => preset(30)}>30d</button>
              <button className="btn btn-light btn-sm" onClick={() => { setFrom(''); setTo(''); }}>Clear</button>
            </div>
            <div className="col-12">
              <div className="input-group">
                <input className="form-control" placeholder="Search subject, body, recipient…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
                <button className="btn btn-primary" onClick={load}>
                  <iconify-icon icon="solar:magnifer-line-duotone"></iconify-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr>
                <th>Channel</th><th>When</th><th>To / From</th><th>Subject / Preview</th><th>Linked</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {items.map((m) => (
                  <tr key={`${m.channel}-${m.id}`} style={{ cursor: 'pointer' }} onClick={() => setSelected(m)}>
                    <td>
                      {m.channel === 'email'
                        ? <span className="badge" style={{ background: '#EAF4FF', color: '#1F6FD0' }}>📧 email</span>
                        : <span className="badge" style={{ background: '#F4ECFF', color: '#7C3AED' }}>📱 sms · {m.direction}</span>}
                    </td>
                    <td className="text-muted small">{fmtDate(m.created_at)}</td>
                    <td><code>{m.counterpart}</code></td>
                    <td>
                      {m.subject && <div className="fw-semibold">{m.subject}</div>}
                      <div className="text-muted small text-truncate" style={{ maxWidth: 'min(420px, 100%)' }}>
                        {(m.preview || '').slice(0, 120)}
                      </div>
                    </td>
                    <td>{entityLink(m) || <span className="text-muted">—</span>}</td>
                    <td>{statusBadge(m.status)}</td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-light"
                        onClick={(e) => {
                          e.stopPropagation();
                          setComposeDefaults({
                            channel: m.channel,
                            to: m.counterpart,
                            entity_type: m.entity_type,
                            entity_id: m.entity_id,
                          });
                          setComposeOpen(true);
                        }}>
                        Reply
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan="7"><div className="empty-state">No messages match your filters.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={!!selected} onClose={() => setSelected(null)} size="lg"
        title={selected ? (selected.channel === 'email' ? `📧 ${selected.subject || '(no subject)'}` : `📱 SMS · ${selected.direction}`) : ''}
        footer={<>
          <button className="btn btn-light" onClick={() => setSelected(null)}>Close</button>
          {selected && (
            <button className="btn btn-primary" onClick={() => {
              setComposeDefaults({
                channel: selected.channel,
                to: selected.counterpart,
                entity_type: selected.entity_type,
                entity_id: selected.entity_id,
              });
              setSelected(null);
              setComposeOpen(true);
            }}>Reply</button>
          )}
        </>}>
        {selected && (
          <div className="row g-2">
            <div className="col-md-6"><small className="text-muted">When</small><div>{fmtDate(selected.created_at)}</div></div>
            <div className="col-md-6"><small className="text-muted">Status</small><div>{statusBadge(selected.status)}</div></div>
            <div className="col-md-6"><small className="text-muted">{selected.direction === 'inbound' ? 'From' : 'To'}</small><div><code>{selected.counterpart}</code></div></div>
            <div className="col-md-6"><small className="text-muted">Linked</small><div>{entityLink(selected) || '—'}</div></div>
            <div className="col-12"><hr /></div>
            <div className="col-12">
              <small className="text-muted">Body</small>
              <div className="border rounded p-3" style={{ background: '#FAFAFA', whiteSpace: 'pre-wrap' }}>
                {selected.preview || '(empty)'}
              </div>
            </div>
            {selected.error && (
              <div className="col-12">
                <div className="alert alert-danger mb-0">
                  {selected.error_code && <strong>Error {selected.error_code}: </strong>}
                  {selected.error}
                  {selected.error_code === '21610' && <div className="mt-1 small">This number has opted out. Remove from your list.</div>}
                  {(selected.error_code === '21614' || selected.error_code === '21217') && <div className="mt-1 small">Toll-free number not verified for SMS. Complete Twilio toll-free verification in the Twilio console.</div>}
                  {selected.error_code === '21608' && <div className="mt-1 small">Trial account — recipient number must be verified in the Twilio console first.</div>}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ComposeMessageModal
        show={composeOpen}
        onClose={() => setComposeOpen(false)}
        defaults={composeDefaults}
        onSent={() => { setComposeOpen(false); load(); }}
      />
    </div>
  );
}
