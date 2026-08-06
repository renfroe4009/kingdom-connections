import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { toast } from './Toast.jsx';
import { parseApiError } from '../utils/apiError.js';

const isImage = mime => mime?.startsWith('image/');
const fmtSize = bytes => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(0)} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Prefix relative URLs so they resolve to Railway when running on Vercel
const SERVER_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const resolveUrl = url => {
  if (!url || !SERVER_BASE) return url;
  if (url.startsWith('/uploads/') || url.startsWith('/api/')) return `${SERVER_BASE}${url}`;
  return url;
};

export default function MediaPickerModal({ show, onSelect, onClose, multi = false }) {
  const [files,     setFiles]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [typeFilter,setTypeFilter]= useState('');
  const [selected,  setSelected]  = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const inputRef = useRef();
  const { confirm: confirmDelete, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    if (!show) return;
    setSelected([]);
    load();
  }, [show]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)     params.set('search', search);
      if (typeFilter) params.set('type',   typeFilter);
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
      const { data } = await api.post('/website/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFiles(prev => [...data, ...prev]);
    } catch (e) {
      toast(parseApiError(e, 'Upload failed'), 'error');
    }
    setUploading(false);
  }

  function toggleSelect(file) {
    if (multi) {
      setSelected(prev => prev.find(f => f.id === file.id)
        ? prev.filter(f => f.id !== file.id)
        : [...prev, file]);
    } else {
      onSelect(file);
      onClose();
    }
  }

  function confirmMulti() {
    if (selected.length) { onSelect(selected); onClose(); }
  }

  async function deleteFile(id, e) {
    e.stopPropagation();
    if (!(await confirmDelete('Delete this file? This cannot be undone.'))) return;
    try {
      await api.delete(`/website/media/${id}`);
      setFiles(prev => prev.filter(f => f.id !== id));
      setSelected(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      toast(parseApiError(err, 'Delete failed'), 'error');
    }
  }

  if (!show) return null;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={onClose} />

      {/* Modal */}
      <div style={{ position: 'relative', background: '#fff', borderRadius: 10, width: '90vw', maxWidth: 1000, height: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', flex: 1 }}>Media Library</span>

          <input
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Search files…"
            style={{ border: '1px solid #dee2e6', borderRadius: 6, padding: '0.35rem 0.75rem', fontSize: '0.85rem', width: 180 }}
          />

          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); }}
            style={{ border: '1px solid #dee2e6', borderRadius: 6, padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}>
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
            <option value="doc">Documents</option>
          </select>

          <button className="btn btn-sm btn-outline-secondary" onClick={load} style={{ fontSize: '0.8rem' }}>
            Search
          </button>

          {/* Upload button */}
          <button
            className="btn btn-sm btn-primary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            style={{ fontSize: '0.8rem' }}
          >
            {uploading ? 'Uploading…' : '+ Upload'}
          </button>
          <input ref={inputRef} type="file" multiple accept="image/*,video/mp4,application/pdf"
            style={{ display: 'none' }}
            onChange={e => uploadFiles(Array.from(e.target.files))} />

          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
        </div>

        {/* Drop zone hint */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(Array.from(e.dataTransfer.files)); }}
          style={{
            padding: '0.4rem 1.25rem',
            background: dragOver ? '#e8f4ff' : '#f8f9fa',
            borderBottom: '1px solid #eee',
            fontSize: '0.78rem',
            color: '#888',
            textAlign: 'center',
            transition: 'background 0.15s',
          }}
        >
          {dragOver ? 'Drop files here to upload' : 'Drag & drop files here to upload — or click "+ Upload" above'}
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {loading ? (
            <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
          ) : !files.length ? (
            <div className="text-center text-muted py-5">
              <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🖼️</div>
              No files yet. Upload some images or documents above.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
              {files.map(file => {
                const isSel = selected.find(f => f.id === file.id);
                return (
                  <div
                    key={file.id}
                    onClick={() => toggleSelect(file)}
                    style={{
                      border: isSel ? '3px solid #4a2d82' : '2px solid transparent',
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      background: '#f8f9fa',
                      position: 'relative',
                      transition: 'border-color 0.1s, box-shadow 0.1s',
                      boxShadow: isSel ? '0 0 0 2px rgba(74,45,130,0.2)' : 'none',
                    }}
                  >
                    {/* Thumbnail */}
                    <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f3f5', overflow: 'hidden' }}>
                      {isImage(file.mime_type) ? (
                        <img src={resolveUrl(file.file_url)} alt={file.alt_text || file.original_name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: '2.5rem' }}>
                          {file.mime_type === 'application/pdf' ? '📄' : file.mime_type?.startsWith('video/') ? '🎬' : '📁'}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ padding: '0.4rem 0.5rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.original_name}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#999' }}>{fmtSize(file.file_size)}</div>
                    </div>

                    {/* Selected checkmark */}
                    {isSel && (
                      <div style={{ position: 'absolute', top: 6, right: 6, background: '#4a2d82', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700 }}>✓</div>
                    )}

                    {/* Delete */}
                    <button
                      onClick={e => deleteFile(file.id, e)}
                      style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: 4, width: 20, height: 20, fontSize: '0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0 }}
                      onMouseOver={e => e.currentTarget.style.opacity = 1}
                      onMouseOut={e => e.currentTarget.style.opacity = 0}
                    >✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer for multi-select */}
        {multi && (
          <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.85rem', color: '#666' }}>
              {selected.length ? `${selected.length} file(s) selected` : 'Click files to select'}
            </span>
            <button className="btn btn-primary btn-sm" onClick={confirmMulti} disabled={!selected.length}>
              Insert Selected
            </button>
          </div>
        )}
      </div>

      {confirmDialog}
    </div>,
    document.body
  );
}
