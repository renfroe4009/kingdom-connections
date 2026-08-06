import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function DataModal({ submission, onClose }) {
  const data = (() => {
    try { return typeof submission.data_json === 'string' ? JSON.parse(submission.data_json) : submission.data_json; }
    catch { return {}; }
  })();
  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }} tabIndex="-1" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Submission — {fmtDate(submission.created_at)}</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {Object.keys(data).length === 0 ? (
              <p className="text-muted">No data recorded.</p>
            ) : (
              <table className="table table-bordered table-sm align-middle">
                <thead className="table-light">
                  <tr><th>Field</th><th>Value</th></tr>
                </thead>
                <tbody>
                  {Object.entries(data).map(([k, v]) => (
                    <tr key={k}>
                      <td className="fw-semibold text-nowrap">{k}</td>
                      <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(v ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="text-muted small">
              <span className="me-3">IP: {submission.ip_address || '—'}</span>
              <span>Submitted: {fmtDate(submission.created_at)}</span>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function summaryText(data_json, maxFields = 3) {
  try {
    const data = typeof data_json === 'string' ? JSON.parse(data_json) : data_json;
    return Object.values(data).slice(0, maxFields).map(String).join(' · ') || '(no data)';
  } catch {
    return '(invalid data)';
  }
}

export default function FormSubmissionsPage() {
  const { id } = useParams();
  const [formName, setFormName] = useState('');
  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const pageSize                = 25;
  const [filter, setFilter]     = useState('all');  // 'all' | 'unread'
  const [loading, setLoading]   = useState(true);
  const [viewing, setViewing]   = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load(pg = page, flt = filter) {
    setLoading(true);
    try {
      const params = { page: pg, pageSize };
      if (flt === 'unread') params.is_read = 0;
      const { data } = await api.get(`/forms/${id}/submissions`, { params });
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }

  // Load form name
  useEffect(() => {
    api.get(`/forms/${id}`).then(({ data }) => setFormName(data.name)).catch(() => {});
  }, [id]);

  useEffect(() => { load(page, filter); /* eslint-disable-next-line */ }, [page, filter]);

  async function markRead(sub) {
    await api.put(`/forms/${id}/submissions/${sub.id}/read`);
    setRows((prev) => prev.map((r) => r.id === sub.id ? { ...r, is_read: 1 } : r));
  }

  async function viewSub(sub) {
    setViewing(sub);
    if (!sub.is_read) {
      await markRead(sub);
    }
  }

  async function doDelete(subId) {
    if (!(await confirm('Delete this submission? This cannot be undone.'))) return;
    setDeleting(subId);
    try {
      await api.delete(`/forms/${id}/submissions/${subId}`);
      load(page, filter);
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    } finally {
      setDeleting(null);
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const unread = rows.filter((r) => !r.is_read);
      await Promise.all(unread.map((r) => api.put(`/forms/${id}/submissions/${r.id}/read`)));
      load(page, filter);
    } finally {
      setMarkingAll(false);
    }
  }

  const totalPages = Math.ceil(total / pageSize);
  const unreadCount = rows.filter((r) => !r.is_read).length;

  return (
    <>
      <PageHeader
        title={`${formName || 'Form'} — Submissions`}
        subtitle={`${total} total submission${total !== 1 ? 's' : ''}`}
        actions={
          <div className="d-flex gap-2">
            {unreadCount > 0 && (
              <button
                className="btn btn-outline-secondary d-flex align-items-center gap-1"
                onClick={markAllRead}
                disabled={markingAll}
              >
                <iconify-icon icon="solar:check-read-line-duotone" class="fs-6"></iconify-icon>
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
            )}
            <Link to="/admin/forms" className="btn btn-outline-primary d-flex align-items-center gap-1">
              <iconify-icon icon="solar:arrow-left-line-duotone" class="fs-6"></iconify-icon>
              Back to Forms
            </Link>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="card mb-3">
        <div className="card-body p-2 d-flex align-items-center gap-2">
          {['all', 'unread'].map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => { setFilter(f); setPage(1); }}
            >
              {f === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-5 text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-5">
            <iconify-icon icon="solar:inbox-line-line-duotone" style={{ fontSize: 48, opacity: 0.3 }}></iconify-icon>
            <p className="text-muted mt-3 mb-0">No submissions found.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="card mb-3">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Summary</th>
                    <th className="text-center">Status</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={!row.is_read ? 'table-primary' : ''}>
                      <td className="text-nowrap small">{fmtDate(row.created_at)}</td>
                      <td className="text-muted small text-truncate" style={{ maxWidth: 320 }}>
                        {summaryText(row.data_json)}
                      </td>
                      <td className="text-center">
                        {row.is_read ? (
                          <span className="badge bg-secondary-subtle text-secondary">Read</span>
                        ) : (
                          <span className="badge bg-primary-subtle text-primary">Unread</span>
                        )}
                      </td>
                      <td className="text-end">
                        <div className="d-flex gap-1 justify-content-end">
                          <button
                            className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                            onClick={() => viewSub(row)}
                            title="View submission"
                          >
                            <iconify-icon icon="solar:eye-line-duotone" class="fs-6"></iconify-icon>
                            View
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => doDelete(row.id)}
                            disabled={deleting === row.id}
                            title="Delete submission"
                          >
                            <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="fs-6"></iconify-icon>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="d-flex justify-content-center">
              <ul className="pagination pagination-sm mb-0">
                <li className={`page-item ${page === 1 ? 'disabled' : ''}`}>
                  <button className="page-link" onClick={() => setPage((p) => p - 1)}>Previous</button>
                </li>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <li key={p} className={`page-item ${p === page ? 'active' : ''}`}>
                    <button className="page-link" onClick={() => setPage(p)}>{p}</button>
                  </li>
                ))}
                <li className={`page-item ${page === totalPages ? 'disabled' : ''}`}>
                  <button className="page-link" onClick={() => setPage((p) => p + 1)}>Next</button>
                </li>
              </ul>
            </nav>
          )}
        </>
      )}

      {/* Detail modal */}
      {viewing && (
        <DataModal submission={viewing} onClose={() => setViewing(null)} />
      )}

      {confirmDialog}
    </>
  );
}
