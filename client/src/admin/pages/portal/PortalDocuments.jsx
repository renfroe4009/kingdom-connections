import { useEffect, useState } from 'react';
import api from '../../../api/client.js';

function fmtSize(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function PortalDocuments() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/portal/documents').then((r) => setRows(r.data.rows || [])).catch(() => {});
  }, []);

  return (
    <div>
      <h3 className="fw-bolder mb-1">Documents</h3>
      <p className="text-muted">Files shared with your account.</p>

      <div className="card">
        <div className="card-body">
          {rows.length === 0 ? (
            <div className="empty-state">No documents shared with you yet.</div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle mb-0">
                <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th></tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td className="fw-semibold">
                        <iconify-icon icon="solar:document-line-duotone" class="me-1"></iconify-icon>
                        {d.file_name}
                      </td>
                      <td className="small text-muted">{d.content_type || '—'}</td>
                      <td>{fmtSize(d.size_bytes)}</td>
                      <td>{d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
