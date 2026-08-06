import { useEffect, useState } from 'react';
import api from '../../api/client.js';

const MIME_LABELS = {
  'application/vnd.google-apps.folder':       'Folder',
  'application/vnd.google-apps.document':     'Doc',
  'application/vnd.google-apps.spreadsheet':  'Sheet',
  'application/vnd.google-apps.presentation': 'Slides',
  'application/vnd.google-apps.form':         'Form',
  'application/pdf':                           'PDF',
  'image/jpeg':                                'Image',
  'image/png':                                 'Image',
  'image/gif':                                 'Image',
};

function mimeLabel(mimeType) {
  return MIME_LABELS[mimeType] || mimeType?.split('/').pop() || '—';
}

function humanSize(bytes) {
  if (!bytes) return null;
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DriveTab({ entityType, entityId }) {
  const [folderId, setFolderId]     = useState(null);
  const [files, setFiles]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState('');

  // browser state
  const [browsing, setBrowsing]     = useState(false);
  const [drives, setDrives]         = useState([]);
  const [drivesLoading, setDrivesLoading] = useState(false);
  const [selectedDrive, setSelectedDrive] = useState(null);
  const [folders, setFolders]       = useState([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [linking, setLinking]       = useState(false);

  async function loadFiles() {
    setLoading(true);
    setErr('');
    try {
      const { data } = await api.get(`/google/drive/${entityType}/${entityId}/files`);
      setFolderId(data.folder_id || null);
      setFiles(data.files || []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Failed to load Drive files.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (entityId) loadFiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function openBrowser() {
    setBrowsing(true);
    setSelectedDrive(null);
    setFolders([]);
    setDrivesLoading(true);
    setErr('');
    try {
      const { data } = await api.get('/google/drive/shared-drives');
      setDrives(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load Shared Drives.');
      setBrowsing(false);
    } finally {
      setDrivesLoading(false);
    }
  }

  async function selectDrive(drive) {
    setSelectedDrive(drive);
    setFolders([]);
    setFoldersLoading(true);
    setErr('');
    try {
      const { data } = await api.get(`/google/drive/shared-drives/${drive.id}/folders`);
      setFolders(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load folders.');
    } finally {
      setFoldersLoading(false);
    }
  }

  async function linkFolder(folder) {
    setLinking(true);
    setErr('');
    try {
      await api.put(`/google/drive/${entityType}/${entityId}`, { folder_url: folder.id });
      setBrowsing(false);
      setSelectedDrive(null);
      setFolders([]);
      await loadFiles();
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to link folder.');
    } finally {
      setLinking(false);
    }
  }

  async function unlinkFolder() {
    if (!window.confirm('Remove the linked Google Drive folder? Files will remain in Drive.')) return;
    setErr('');
    try {
      await api.delete(`/google/drive/${entityType}/${entityId}`);
      setFolderId(null);
      setFiles([]);
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to unlink folder.');
    }
  }

  return (
    <div className="card mt-3">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h6 className="fw-bold text-uppercase small text-muted mb-0">
            <iconify-icon icon="logos:google-drive" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}></iconify-icon>
            Google Drive
          </h6>
          <div className="d-flex gap-2 flex-wrap">
            {folderId && !browsing && (
              <>
                <button className="btn btn-sm btn-outline-secondary" onClick={loadFiles} title="Refresh">
                  <iconify-icon icon="mdi:refresh"></iconify-icon>
                </button>
                <button className="btn btn-sm btn-outline-danger" onClick={unlinkFolder}>Unlink</button>
              </>
            )}
            {!browsing && (
              <button className="btn btn-sm btn-outline-primary" onClick={openBrowser}>
                {folderId ? 'Change folder' : 'Browse Drive'}
              </button>
            )}
            {browsing && (
              <button className="btn btn-sm btn-light" onClick={() => { setBrowsing(false); setSelectedDrive(null); setFolders([]); setErr(''); }}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {err && (
          <div className="alert alert-warning py-2 small mb-2">
            {err.includes('not connected')
              ? <><strong>Google account not connected.</strong> <a href="/admin/settings?tab=google">Connect in Settings → Google Workspace</a>.</>
              : err.includes('permission') || err.includes('do not have')
              ? <><strong>No access.</strong> Your Google account doesn&apos;t have permission to view this Drive folder. Ask the folder owner to share it with you.</>
              : err.includes('not found') || err.includes('deleted')
              ? <><strong>Folder not found.</strong> This Drive folder may have been deleted or moved. <button className="btn btn-sm btn-link p-0" onClick={unlinkFolder}>Unlink it</button> and choose a new one.</>
              : err}
          </div>
        )}

        {/* ── Two-step folder browser ── */}
        {browsing && (
          <div className="border rounded p-3 mb-3 bg-light">

            {/* Step 1 — pick a Shared Drive */}
            {!selectedDrive && (
              <>
                <div className="fw-semibold small mb-2">Select a Shared Drive</div>
                {drivesLoading && <div className="text-muted small">Loading drives…</div>}
                {!drivesLoading && drives.length === 0 && (
                  <div className="text-muted small">No Shared Drives found.</div>
                )}
                <div className="list-group list-group-flush">
                  {drives.map((d) => (
                    <button
                      key={d.id}
                      className="list-group-item list-group-item-action d-flex align-items-center gap-2 py-2"
                      onClick={() => selectDrive(d)}
                    >
                      <iconify-icon icon="logos:google-drive" style={{ fontSize: 18, flexShrink: 0 }}></iconify-icon>
                      <span>{d.name}</span>
                      <iconify-icon icon="mdi:chevron-right" className="ms-auto text-muted"></iconify-icon>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Step 2 — pick a folder inside the drive */}
            {selectedDrive && (
              <>
                <div className="d-flex align-items-center gap-2 mb-2">
                  <button className="btn btn-sm btn-link p-0 text-muted" onClick={() => { setSelectedDrive(null); setFolders([]); }}>
                    <iconify-icon icon="mdi:chevron-left"></iconify-icon> Drives
                  </button>
                  <span className="text-muted small">/</span>
                  <span className="fw-semibold small">{selectedDrive.name}</span>
                </div>
                {foldersLoading && <div className="text-muted small">Loading folders…</div>}
                {!foldersLoading && folders.length === 0 && (
                  <div className="text-muted small">No folders found in this drive.</div>
                )}
                <div className="list-group list-group-flush">
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      className="list-group-item list-group-item-action d-flex align-items-center gap-2 py-2"
                      onClick={() => !linking && linkFolder(f)}
                      disabled={linking}
                    >
                      <iconify-icon icon="mdi:folder" style={{ fontSize: 18, color: '#fbbf24', flexShrink: 0 }}></iconify-icon>
                      <span>{f.name}</span>
                      <span className="ms-auto badge bg-primary">{linking ? '…' : 'Select'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Linked folder view ── */}
        {!browsing && loading && <div className="text-muted small py-2">Loading…</div>}

        {!browsing && !loading && !folderId && (
          <p className="text-muted small mb-0">
            No folder linked. Click <strong>Browse Drive</strong> to pick a customer folder.
          </p>
        )}

        {!browsing && !loading && folderId && (
          <>
            <div className="small text-muted mb-2">
              <a href={`https://drive.google.com/drive/folders/${folderId}`} target="_blank" rel="noreferrer">
                Open folder in Drive ↗
              </a>
            </div>
            {files.length === 0 ? (
              <p className="text-muted small mb-0">No files found in this folder.</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Modified</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id}>
                        <td>
                          {f.iconLink && (
                            <img src={f.iconLink} alt="" width={16} height={16} className="me-1" style={{ verticalAlign: 'middle' }} />
                          )}
                          {f.webViewLink
                            ? <a href={f.webViewLink} target="_blank" rel="noreferrer">{f.name}</a>
                            : f.name}
                        </td>
                        <td className="text-muted small">{mimeLabel(f.mimeType)}</td>
                        <td className="text-muted small text-nowrap">
                          {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}
                        </td>
                        <td className="text-muted small">{humanSize(f.size) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
