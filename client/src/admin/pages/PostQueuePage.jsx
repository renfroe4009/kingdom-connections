import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const PLATFORMS = [
  { value: 'facebook',  label: 'Facebook',  icon: 'logos:facebook' },
  { value: 'instagram', label: 'Instagram', icon: 'skill-icons:instagram' },
  { value: 'linkedin',  label: 'LinkedIn',  icon: 'logos:linkedin-icon' },
];

const STATUS_META = {
  draft:     { label: 'Draft',     badge: 'secondary' },
  scheduled: { label: 'Scheduled', badge: 'primary' },
  published: { label: 'Published', badge: 'success' },
  failed:    { label: 'Failed',    badge: 'danger' },
};

function PlatformIcon({ platform }) {
  const p = PLATFORMS.find((x) => x.value === platform);
  if (!p) return null;
  return <iconify-icon icon={p.icon} title={p.label} style={{ fontSize: '1.2rem' }}></iconify-icon>;
}

export default function PostQueuePage() {
  const nav = useNavigate();

  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(false);
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [publishing, setPublishing] = useState(null);
  const [deleting, setDeleting]     = useState(null);
  const [toast, setToast]           = useState('');

  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, pageSize };
      if (filterStatus)   params.status   = filterStatus;
      if (filterPlatform) params.platform  = filterPlatform;
      const { data } = await api.get('/social/posts', { params });
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }, [page, pageSize, filterStatus, filterPlatform]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [filterStatus, filterPlatform]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function publishNow(id) {
    setPublishing(id);
    try {
      await api.post(`/social/posts/${id}/publish`);
      showToast('Post marked as published.');
      load();
    } catch (e) {
      showToast(e.response?.data?.error || 'Publish failed');
    } finally { setPublishing(null); }
  }

  async function deletePost(id) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.delete(`/social/posts/${id}`);
      showToast('Post deleted.');
      load();
    } catch (e) {
      showToast(e.response?.data?.error || 'Delete failed');
    } finally { setDeleting(null); }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <PageHeader
        title="Post Queue"
        subtitle="All social media posts — draft, scheduled, and published"
        actions={(
          <Link to="/admin/marketing/social-composer" className="btn btn-primary">
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
            New Post
          </Link>
        )}
      />

      {/* Toast */}
      {toast && (
        <div className="alert alert-info alert-dismissible py-2" role="alert">
          {toast}
          <button type="button" className="btn-close py-2" onClick={() => setToast('')} />
        </div>
      )}

      {/* Filter bar */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2 align-items-center">
            <div className="col-auto">
              <select className="form-select form-select-sm" value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value)}>
                <option value="">All platforms</option>
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="col-auto">
              <select className="form-select form-select-sm" value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                {Object.entries(STATUS_META).map(([v, m]) => (
                  <option key={v} value={v}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="col-auto ms-auto text-muted small">
              {total} post{total !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th style={{ width: 40 }}>Platform</th>
                <th>Content</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 160 }}>Scheduled At</th>
                <th style={{ width: 160 }}>Published At</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-4">Loading…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-4">
                    No posts found.{' '}
                    <Link to="/admin/marketing/social-composer">Create your first post</Link>
                  </td>
                </tr>
              )}
              {!loading && rows.map((row) => {
                const sm = STATUS_META[row.status] || { label: row.status, badge: 'secondary' };
                const contentPreview = row.content?.length > 120
                  ? `${row.content.slice(0, 120)}…`
                  : row.content;

                return (
                  <tr key={row.id}>
                    <td className="text-center">
                      <PlatformIcon platform={row.platform} />
                    </td>
                    <td>
                      <div className="small">{contentPreview}</div>
                      {row.account_name && (
                        <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                          {row.account_name}{row.page_name ? ` / ${row.page_name}` : ''}
                        </div>
                      )}
                      {Array.isArray(row.media_urls) && row.media_urls.length > 0 && (
                        <span className="badge bg-light text-dark border small">
                          <iconify-icon icon="solar:gallery-line-duotone"></iconify-icon>
                          {' '}{row.media_urls.length} image{row.media_urls.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {row.error_msg && (
                        <div className="text-danger" style={{ fontSize: '0.75rem' }} title={row.error_msg}>
                          <iconify-icon icon="solar:danger-triangle-line-duotone"></iconify-icon>
                          {' '}{row.error_msg.slice(0, 80)}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge bg-${sm.badge}`}>{sm.label}</span>
                    </td>
                    <td className="small text-muted">
                      {row.scheduled_at
                        ? new Date(row.scheduled_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="small text-muted">
                      {row.published_at
                        ? new Date(row.published_at).toLocaleString()
                        : '—'}
                    </td>
                    <td>
                      <div className="d-flex gap-1 flex-wrap">
                        {['draft', 'scheduled'].includes(row.status) && (
                          <Link
                            to={`/admin/marketing/social-composer?edit=${row.id}`}
                            className="btn btn-sm btn-light"
                            title="Edit"
                          >
                            <iconify-icon icon="solar:pen-line-duotone"></iconify-icon>
                          </Link>
                        )}
                        {['draft', 'scheduled', 'failed'].includes(row.status) && (
                          <button
                            className="btn btn-sm btn-success"
                            title="Publish Now"
                            disabled={publishing === row.id}
                            onClick={() => publishNow(row.id)}
                          >
                            {publishing === row.id
                              ? <span className="spinner-border spinner-border-sm"></span>
                              : <iconify-icon icon="solar:send-line-duotone"></iconify-icon>}
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-outline-danger"
                          title="Delete"
                          disabled={deleting === row.id}
                          onClick={() => deletePost(row.id)}
                        >
                          {deleting === row.id
                            ? <span className="spinner-border spinner-border-sm"></span>
                            : <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="card-footer d-flex justify-content-between align-items-center">
            <small className="text-muted">
              Page {page} of {totalPages} · {total} total
            </small>
            <div className="btn-group btn-group-sm">
              <button className="btn btn-light" disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}>
                <iconify-icon icon="solar:arrow-left-line-duotone"></iconify-icon> Prev
              </button>
              <button className="btn btn-light" disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}>
                Next <iconify-icon icon="solar:arrow-right-line-duotone"></iconify-icon>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
