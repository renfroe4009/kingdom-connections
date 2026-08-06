import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

export default function FormsPage() {
  const navigate = useNavigate();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/forms');
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(row) {
    setToggling(row.id);
    try {
      await api.put(`/forms/${row.id}`, { is_active: !row.is_active });
      load();
    } finally {
      setToggling(null);
    }
  }

  async function doDelete(id) {
    if (!(await confirm('Delete this form and all its submissions? This cannot be undone.'))) return;
    setDeleting(id);
    try {
      await api.delete(`/forms/${id}`);
      load();
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Build and manage embeddable contact forms"
        actions={
          <Link to="/admin/forms/new" className="btn btn-primary d-flex align-items-center gap-2">
            <iconify-icon icon="solar:add-circle-line-duotone" class="fs-5"></iconify-icon>
            New Form
          </Link>
        }
      />

      {loading ? (
        <div className="text-center py-5 text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-5">
            <iconify-icon icon="solar:document-add-line-duotone" style={{ fontSize: 48, opacity: 0.3 }}></iconify-icon>
            <p className="text-muted mt-3 mb-1">No forms yet.</p>
            <Link to="/admin/forms/new" className="btn btn-primary mt-2">Create your first form</Link>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th className="text-center">Active</th>
                  <th className="text-center">Submissions</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="fw-semibold">{row.name}</td>
                    <td>
                      <code className="text-muted small">{row.slug}</code>
                    </td>
                    <td className="text-center">
                      <div className="form-check form-switch d-inline-block m-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!row.is_active}
                          disabled={toggling === row.id}
                          onChange={() => toggleActive(row)}
                          title={row.is_active ? 'Deactivate' : 'Activate'}
                        />
                      </div>
                    </td>
                    <td className="text-center">
                      <span className="badge bg-secondary-subtle text-secondary">
                        {row.submission_count}
                      </span>
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-1 justify-content-end">
                        <button
                          className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                          onClick={() => navigate(`/admin/forms/${row.id}/edit`)}
                          title="Edit form"
                        >
                          <iconify-icon icon="solar:pen-2-line-duotone" class="fs-6"></iconify-icon>
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
                          onClick={() => navigate(`/admin/forms/${row.id}/submissions`)}
                          title="View submissions"
                        >
                          <iconify-icon icon="solar:inbox-line-line-duotone" class="fs-6"></iconify-icon>
                          Submissions
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1"
                          onClick={() => doDelete(row.id)}
                          disabled={deleting === row.id}
                          title="Delete form"
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
      )}

      {confirmDialog}
    </>
  );
}
