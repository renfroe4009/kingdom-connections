import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';

const WRITE_PERM = {
  contact: 'contacts.write',
  organization: 'organizations.write',
  deal: 'deals.write',
  volunteer_compliance_item: 'volunteers.write',
};

function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Number(bytes), i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function AttachmentsPanel({ entityType, entityId }) {
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const writable = can(WRITE_PERM[entityType]);

  async function load() {
    if (!entityId) return;
    const { data } = await api.get('/attachments', { params: { entity_type: entityType, entity_id: entityId } });
    setRows(data);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [entityType, entityId]);

  async function onPick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(''); setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('entity_type', entityType);
      fd.append('entity_id', String(entityId));
      await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(a) {
    if (!(await confirm(`Delete "${a.file_name}"?`))) return;
    try {
      await api.delete(`/attachments/${a.id}`);
      load();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    }
  }

  function download(a) {
    // Backend redirects to signed URL when driver=s3, streams when local.
    // Use a direct navigation so auth header is preserved via session cookie?
    // We use axios to fetch as blob so the JWT header is sent.
    api.get(`/attachments/${a.id}/download`, { responseType: 'blob' }).then((r) => {
      const url = URL.createObjectURL(r.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }).catch((ex) => setErr(ex.response?.data?.error || ex.message));
  }

  return (
    <div className="card mt-3">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="fw-bold text-uppercase small text-muted mb-0">Attachments</h6>
          {writable && (
            <div>
              <input ref={fileRef} type="file" hidden onChange={onPick} />
              <button className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <iconify-icon icon="solar:upload-minimalistic-line-duotone" class="me-1"></iconify-icon>
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
            </div>
          )}
        </div>
        {err && <div className="alert alert-danger py-2 mb-2">{err}</div>}
        {rows.length === 0 && <div className="text-muted small py-2">No files yet.</div>}
        {rows.length > 0 && (
          <ul className="list-unstyled mb-0">
            {rows.map((a) => (
              <li key={a.id} className="py-2 border-top d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <iconify-icon icon="solar:document-line-duotone" style={{ fontSize: 22, color: '#F05523' }}></iconify-icon>
                  <div>
                    <button className="btn btn-link p-0 text-decoration-none fw-semibold text-start" onClick={() => download(a)}>{a.file_name}</button>
                    <div><small className="text-muted">
                      {humanSize(a.size_bytes)} · {a.content_type || 'file'} · {new Date(a.created_at).toLocaleString()}
                      {a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}
                      {a.storage_driver === 's3' ? ' · S3' : ''}
                    </small></div>
                  </div>
                </div>
                {writable && (
                  <button className="btn btn-sm btn-light text-danger" onClick={() => remove(a)} title="Delete">
                    <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
