import { useState, useEffect, useRef } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const isImage = mime => mime?.startsWith('image/');
const fmtSize = b => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const SERVER_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const resolveUrl = url => {
  if (!url || !SERVER_BASE) return url;
  if (url.startsWith('/uploads/') || url.startsWith('/api/')) return `${SERVER_BASE}${url}`;
  return url;
};

const PURPLE = '#4a2d82';
const LIGHT  = '#f3eeff';

/* ── Folder sidebar ─────────────────────────────────────────────────────────── */
function FolderSidebar({ folders, activeFolder, onSelect, onCreateFolder, onDeleteFolder }) {
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');

  async function create() {
    const name = newName.trim();
    if (!name) return;
    await onCreateFolder(name);
    setNewName(''); setCreating(false);
  }

  const item = (label, key, icon = '📁') => (
    <div
      key={key}
      onClick={() => onSelect(key)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.83rem',
        fontWeight: activeFolder === key ? 700 : 400,
        background: activeFolder === key ? LIGHT : 'transparent',
        color: activeFolder === key ? PURPLE : '#333',
      }}
      onMouseEnter={e => { if (activeFolder !== key) e.currentTarget.style.background = '#f8f8f8'; }}
      onMouseLeave={e => { if (activeFolder !== key) e.currentTarget.style.background = 'transparent'; }}
    >
      <span>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );

  return (
    <div style={{ width: 210, flexShrink: 0, borderRight: '1px solid #e8e8e8', paddingRight: 12, marginRight: 20 }}>
      <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#999', marginBottom: 8, paddingLeft: 12 }}>
        Folders
      </div>

      {item('All Files', '', '🗂️')}
      {item('Uncategorised', 'root', '📂')}

      {folders.map(f => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ flex: 1 }}>{item(f.name, f.id, '📁')}</div>
          <button
            onClick={e => { e.stopPropagation(); onDeleteFolder(f); }}
            title="Delete folder"
            style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 13, padding: '2px 4px', borderRadius: 4, flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#cc1122'}
            onMouseLeave={e => e.currentTarget.style.color = '#ccc'}
          >✕</button>
        </div>
      ))}

      <div style={{ marginTop: 8, paddingLeft: 12 }}>
        {creating ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
              placeholder="Folder name"
              style={{ flex: 1, fontSize: '0.78rem', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }}
            />
            <button onClick={create} style={{ background: PURPLE, border: 'none', color: '#fff', borderRadius: 4, padding: '4px 8px', fontSize: '0.75rem', cursor: 'pointer' }}>+</button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            style={{ background: 'none', border: '1px dashed #ccc', color: '#888', borderRadius: 6, padding: '5px 10px', fontSize: '0.78rem', cursor: 'pointer', width: '100%' }}
          >
            + New Folder
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────── */
export default function MediaLibraryPage() {
  const [files,       setFiles]       = useState([]);
  const [folders,     setFolders]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState('');
  const [activeFolder,setActiveFolder]= useState(''); // '' = all, 'root' = uncategorised, number = folder id
  const [uploading,   setUploading]   = useState(false);
  const [dragOver,    setDragOver]    = useState(false);
  const [detail,      setDetail]      = useState(null);
  const [altText,     setAltText]     = useState('');
  const [movingId,    setMovingId]    = useState(null);
  const inputRef = useRef();
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => { loadFolders(); }, []);
  useEffect(() => { load(); }, [activeFolder, typeFilter]);

  async function loadFolders() {
    try { const { data } = await api.get('/website/media/folders'); setFolders(data); } catch {}
  }

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)       params.set('search', search);
      if (typeFilter)   params.set('type',   typeFilter);
      if (activeFolder) params.set('folder_id', activeFolder);
      const { data } = await api.get(`/website/media?${params}`);
      setFiles(data);
    } catch {}
    setLoading(false);
  }

  async function uploadFiles(fileList) {
    if (!fileList.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of fileList) fd.append('files', f);
      if (activeFolder && activeFolder !== 'root') fd.append('folder_id', activeFolder);
      const { data } = await api.post('/website/media/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFiles(prev => [...data, ...prev]);
      loadFolders(); // refresh counts
    } catch (e) {
      toast(parseApiError(e, 'Upload failed'), 'error');
    }
    setUploading(false);
  }

  async function createFolder(name) {
    try {
      const { data } = await api.post('/website/media/folders', { name });
      setFolders(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      toast(parseApiError(e, 'Could not create folder'), 'error');
    }
  }

  async function deleteFolder(f) {
    if (!(await confirm(`Delete folder "${f.name}"? Files inside will move to Uncategorised.`))) return;
    try {
      await api.delete(`/website/media/folders/${f.id}`);
      setFolders(prev => prev.filter(x => x.id !== f.id));
      if (activeFolder === f.id) setActiveFolder('');
      load();
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  async function moveFile(fileId, folderId) {
    try {
      await api.patch(`/website/media/${fileId}`, { folder_id: folderId || null });
      setFiles(prev => prev.filter(f => f.id !== fileId));
      if (detail?.id === fileId) setDetail(null);
      loadFolders();
    } catch (e) {
      toast(parseApiError(e, 'Move failed'), 'error');
    }
  }

  async function saveAlt() {
    if (!detail) return;
    try {
      await api.patch(`/website/media/${detail.id}`, { alt_text: altText });
      setFiles(prev => prev.map(f => f.id === detail.id ? { ...f, alt_text: altText } : f));
      setDetail(prev => ({ ...prev, alt_text: altText }));
    } catch (e) {
      toast(parseApiError(e, 'Save failed'), 'error');
    }
  }

  async function deleteFile(id) {
    if (!(await confirm('Delete this file permanently?'))) return;
    try {
      await api.delete(`/website/media/${id}`);
      setFiles(prev => prev.filter(f => f.id !== id));
      if (detail?.id === id) setDetail(null);
      loadFolders();
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  function openDetail(file) { setDetail(file); setAltText(file.alt_text || ''); setMovingId(null); }

  const activeFolderName = activeFolder === ''     ? 'All Files'
                         : activeFolder === 'root' ? 'Uncategorised'
                         : folders.find(f => f.id === activeFolder)?.name || '';

  return (
    <div className="p-4">
      <PageHeader
        title="Media Library"
        subtitle="Images, documents, and files for your website"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '+ Upload Files'}
          </button>
        }
      />
      <input ref={inputRef} type="file" multiple accept="image/*,video/mp4,application/pdf"
        style={{ display: 'none' }}
        onChange={e => { uploadFiles(Array.from(e.target.files)); e.target.value = ''; }} />

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* Folder sidebar */}
        <FolderSidebar
          folders={folders}
          activeFolder={activeFolder}
          onSelect={setActiveFolder}
          onCreateFolder={createFolder}
          onDeleteFolder={deleteFolder}
        />

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(Array.from(e.dataTransfer.files)); }}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? PURPLE : '#ced4da'}`,
              borderRadius: 8, padding: '1rem', textAlign: 'center',
              color: '#888', fontSize: '0.83rem', marginBottom: '1rem',
              background: dragOver ? LIGHT : '#fafafa', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {uploading
              ? <><span className="spinner-border spinner-border-sm me-2" />Optimizing & uploading…</>
              : `📁 Drop files here or click to upload${activeFolderName ? ` → ${activeFolderName}` : ''} (auto-optimized to WebP)`}
          </div>

          {/* Search + filter bar */}
          <div className="d-flex gap-2 mb-3 flex-wrap align-items-center">
            <input
              className="form-control form-control-sm" style={{ maxWidth: 260 }}
              placeholder="Search by filename…" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
            />
            <select className="form-select form-select-sm" style={{ maxWidth: 140 }}
              value={typeFilter} onChange={e => { setTypeFilter(e.target.value); }}>
              <option value="">All types</option>
              <option value="image">Images</option>
              <option value="video">Video</option>
              <option value="doc">Documents</option>
            </select>
            <button className="btn btn-outline-secondary btn-sm" onClick={load}>Search</button>
            <span className="ms-auto text-muted small">{files.length} file{files.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Grid + detail */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {loading ? (
                <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
              ) : !files.length ? (
                <div className="text-center text-muted py-5">
                  <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>🖼️</div>
                  <p>No files here yet. Upload something above.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.65rem' }}>
                  {files.map(file => (
                    <div
                      key={file.id}
                      onClick={() => openDetail(file)}
                      style={{
                        border: detail?.id === file.id ? `2px solid ${PURPLE}` : '1px solid #dee2e6',
                        borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                        background: '#f8f9fa', transition: 'box-shadow 0.15s',
                      }}
                      onMouseOver={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)'}
                      onMouseOut={e => e.currentTarget.style.boxShadow = 'none'}
                    >
                      <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f3f5', overflow: 'hidden' }}>
                        {isImage(file.mime_type)
                          ? <img src={resolveUrl(file.file_url)} alt={file.alt_text || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: '2.8rem' }}>
                              {file.mime_type === 'application/pdf' ? '📄' : file.mime_type?.startsWith('video/') ? '🎬' : '📁'}
                            </span>}
                      </div>
                      <div style={{ padding: '0.35rem 0.55rem' }}>
                        <div style={{ fontSize: '0.71rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#333' }}>
                          {file.original_name}
                        </div>
                        <div style={{ fontSize: '0.66rem', color: '#aaa' }}>{fmtSize(file.file_size)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Detail panel */}
            {detail && (
              <div style={{ width: 280, flexShrink: 0 }}>
                <div className="card" style={{ position: 'sticky', top: '1rem' }}>
                  <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f3f5', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
                    {isImage(detail.mime_type)
                      ? <img src={resolveUrl(detail.file_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      : <span style={{ fontSize: '4rem' }}>{detail.mime_type === 'application/pdf' ? '📄' : '🎬'}</span>}
                  </div>

                  <div className="card-body" style={{ fontSize: '0.8rem', padding: '0.85rem' }}>
                    <div className="fw-bold mb-1" style={{ wordBreak: 'break-all', fontSize: '0.82rem' }}>{detail.original_name}</div>
                    <div className="text-muted mb-1">{fmtSize(detail.file_size)} · {detail.mime_type}</div>
                    {detail.width && <div className="text-muted mb-1">{detail.width} × {detail.height}px</div>}
                    <div className="text-muted mb-3" style={{ fontSize: '0.73rem' }}>{new Date(detail.created_at).toLocaleString()}</div>

                    {/* Move to folder */}
                    <label className="form-label form-label-sm fw-semibold">Move to Folder</label>
                    <div className="input-group input-group-sm mb-3">
                      <select
                        className="form-select"
                        value={movingId === null ? (detail.folder_id ?? '') : movingId}
                        onChange={e => setMovingId(e.target.value)}
                        style={{ fontSize: '0.78rem' }}
                      >
                        <option value="">— Uncategorised —</option>
                        {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <button
                        className="btn btn-outline-secondary"
                        onClick={() => moveFile(detail.id, movingId !== null ? movingId : detail.folder_id)}
                      >Move</button>
                    </div>

                    {/* URL copy */}
                    <label className="form-label form-label-sm fw-semibold">File URL</label>
                    <div className="input-group input-group-sm mb-3">
                      <input className="form-control font-monospace" readOnly value={detail.file_url} style={{ fontSize: '0.7rem' }} />
                      <button className="btn btn-outline-secondary" onClick={() => navigator.clipboard.writeText(detail.file_url)}>Copy</button>
                    </div>

                    {/* Alt text */}
                    <label className="form-label form-label-sm fw-semibold">Alt Text</label>
                    <div className="input-group input-group-sm mb-3">
                      <input className="form-control" value={altText} onChange={e => setAltText(e.target.value)} placeholder="Describe the image…" />
                      <button className="btn btn-outline-primary" onClick={saveAlt}>Save</button>
                    </div>

                    <div className="d-flex gap-2">
                      <a href={detail.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-secondary flex-fill">Open ↗</a>
                      <button className="btn btn-sm btn-outline-danger flex-fill" onClick={() => deleteFile(detail.id)}>Delete</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}
