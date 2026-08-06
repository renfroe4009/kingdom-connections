import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import MediaPickerModal from '../../components/MediaPickerModal.jsx';

// Relative /api/... image URLs are same-origin only in local dev (Vite
// proxies /api) — a split Vercel/Railway deploy needs the API origin prefixed.
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

// Decode HTML entities in plain text fields (e.g. &nbsp; &rsquo; etc.)
function decodeHtml(str) {
  if (!str) return str;
  try {
    const doc = new DOMParser().parseFromString(str, 'text/html');
    return doc.documentElement.textContent;
  } catch {
    return str
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
function EditorToolbar({ editor, onInsertImage, onInsertGallery, onInsertProduct }) {
  if (!editor) return null;

  const btn = (onClick, active, icon, title) => (
    <button
      type="button"
      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-light'} me-1`}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
    >
      <iconify-icon icon={icon} />
    </button>
  );

  return (
    <div className="border-bottom p-2 d-flex flex-wrap gap-1 align-items-center">
      {btn(() => editor.chain().focus().toggleBold().run(),
        editor.isActive('bold'), 'solar:text-bold-line-duotone', 'Bold')}
      {btn(() => editor.chain().focus().toggleItalic().run(),
        editor.isActive('italic'), 'solar:text-italic-line-duotone', 'Italic')}
      <span className="border-start mx-1" style={{ height: 24 }} />
      {btn(() => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        editor.isActive('heading', { level: 2 }), 'solar:text-size-line-duotone', 'Heading 2')}
      {btn(() => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        editor.isActive('heading', { level: 3 }), 'solar:text-size-line-duotone', 'Heading 3')}
      <span className="border-start mx-1" style={{ height: 24 }} />
      {btn(() => editor.chain().focus().toggleBulletList().run(),
        editor.isActive('bulletList'), 'solar:list-line-duotone', 'Bullet List')}
      {btn(() => editor.chain().focus().toggleOrderedList().run(),
        editor.isActive('orderedList'), 'solar:list-check-line-duotone', 'Ordered List')}
      {btn(() => editor.chain().focus().toggleBlockquote().run(),
        editor.isActive('blockquote'), 'solar:quote-down-line-duotone', 'Blockquote')}
      <span className="border-start mx-1" style={{ height: 24 }} />
      <button
        type="button"
        className={`btn btn-sm ${editor.isActive('link') ? 'btn-primary' : 'btn-light'} me-1`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
          } else {
            const url = window.prompt('Enter URL:');
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }
        }}
        title="Link"
      >
        <iconify-icon icon="solar:link-line-duotone" />
      </button>
      <span className="border-start mx-1" style={{ height: 24 }} />
      <button
        type="button"
        className="btn btn-sm btn-light me-1"
        onMouseDown={(e) => { e.preventDefault(); onInsertImage(); }}
        title="Insert Image"
      >
        <iconify-icon icon="solar:gallery-add-line-duotone" />
      </button>
      <button
        type="button"
        className="btn btn-sm btn-light me-1"
        onMouseDown={(e) => { e.preventDefault(); onInsertGallery(); }}
        title="Insert Gallery Grid"
      >
        <iconify-icon icon="solar:gallery-minimalistic-line-duotone" />
      </button>
      <button
        type="button"
        className="btn btn-sm btn-light me-1"
        onMouseDown={(e) => { e.preventDefault(); onInsertProduct(); }}
        title="Insert Product Card"
      >
        <iconify-icon icon="solar:tag-price-line-duotone" />
      </button>
      <span className="border-start mx-1" style={{ height: 24 }} />
      {btn(() => editor.chain().focus().undo().run(),
        false, 'solar:undo-left-line-duotone', 'Undo')}
      {btn(() => editor.chain().focus().redo().run(),
        false, 'solar:undo-right-line-duotone', 'Redo')}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Featured image uploader — uses media library picker
// ---------------------------------------------------------------------------
function FeaturedImageUploader({ value, onChange }) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div>
      {value && (
        <div className="mb-2 position-relative">
          <img
            src={value}
            alt="Featured"
            className="img-fluid rounded border"
            style={{ maxHeight: 160, width: '100%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <button
            type="button"
            className="btn btn-sm btn-danger position-absolute top-0 end-0 m-1"
            onClick={() => onChange('')}
            title="Remove image"
          >
            <iconify-icon icon="solar:trash-bin-trash-line-duotone" />
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary w-100"
        onClick={() => setShowPicker(true)}
      >
        <iconify-icon icon="solar:gallery-add-line-duotone" className="me-1" />
        {value ? 'Change Image' : 'Choose from Media Library'}
      </button>
      <input
        type="text"
        className="form-control form-control-sm mt-2"
        placeholder="…or paste an image URL"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <MediaPickerModal
        show={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(file) => { onChange(file.file_url); setShowPicker(false); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Replace-image popover — shows when an image is selected in the editor
// ---------------------------------------------------------------------------
function ImageToolbar({ editor, onReplace }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { selection } = editor.state;
      const node = editor.state.doc.nodeAt(selection.from);
      if (node?.type.name === 'image') {
        // Position toolbar near the selected image DOM node
        const domNode = editor.view.nodeDOM(selection.from);
        if (domNode) {
          const rect = domNode.getBoundingClientRect();
          const editorRect = editor.view.dom.closest('.card')?.getBoundingClientRect() || { top: 0, left: 0 };
          setPos({ top: rect.top - editorRect.top - 44, left: rect.left - editorRect.left });
        }
      } else {
        setPos(null);
      }
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
  }, [editor]);

  if (!pos) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        zIndex: 10,
        display: 'flex',
        gap: 4,
        background: '#fff',
        border: '1px solid #dee2e6',
        borderRadius: 6,
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <button
        type="button"
        className="btn btn-sm btn-outline-primary py-0 px-2"
        onMouseDown={(e) => { e.preventDefault(); onReplace(); }}
        title="Replace image"
      >
        <iconify-icon icon="solar:gallery-edit-line-duotone" style={{ fontSize: 14 }} /> Replace
      </button>
      <button
        type="button"
        className="btn btn-sm btn-outline-danger py-0 px-2"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteSelection().run(); }}
        title="Delete image"
      >
        <iconify-icon icon="solar:trash-bin-trash-line-duotone" style={{ fontSize: 14 }} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery insert modal — pick from media library or paste URLs → responsive grid
// ---------------------------------------------------------------------------
function GalleryModal({ onInsert, onClose }) {
  const [images,      setImages]      = useState([]);
  const [url,         setUrl]         = useState('');
  const [cols,        setCols]        = useState('2');
  const [showPicker,  setShowPicker]  = useState(false);
  const [err,         setErr]         = useState('');

  function addUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setImages((prev) => [...prev, trimmed]);
    setUrl('');
  }

  function removeImage(i) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleInsert() {
    if (!images.length) { setErr('Add at least one image.'); return; }
    onInsert(images, Number(cols));
  }

  return (
    <>
      <div
        className="modal d-block"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="modal-dialog modal-lg modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Insert Gallery</h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body d-flex flex-column gap-3">
              {/* Media library picker */}
              <div>
                <label className="form-label fw-semibold">Select images</label>
                <button
                  type="button"
                  className="btn btn-outline-primary d-block"
                  onClick={() => setShowPicker(true)}
                >
                  <iconify-icon icon="solar:gallery-add-line-duotone" className="me-1" />
                  Choose from Media Library
                </button>
                <span className="text-muted small mt-1 d-block">Select multiple images at once</span>
              </div>
              {/* URL input */}
              <div>
                <label className="form-label fw-semibold">Or add image URL</label>
                <div className="input-group">
                  <input
                    type="url"
                    className="form-control"
                    placeholder="https://…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }}
                  />
                  <button className="btn btn-outline-secondary" type="button" onClick={addUrl}>Add</button>
                </div>
              </div>
              {/* Thumbnail strip */}
              {images.length > 0 && (
                <div>
                  <label className="form-label fw-semibold">Gallery images ({images.length})</label>
                  <div className="d-flex flex-wrap gap-2">
                    {images.map((src, i) => (
                      <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                        <img
                          src={src}
                          alt=""
                          style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid #dee2e6' }}
                          onError={(e) => { e.target.style.opacity = 0.3; }}
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          style={{
                            position: 'absolute', top: -6, right: -6,
                            background: '#dc3545', border: 'none', color: '#fff',
                            borderRadius: '50%', width: 18, height: 18,
                            fontSize: 11, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Columns */}
              <div style={{ maxWidth: 200 }}>
                <label className="form-label fw-semibold">Columns</label>
                <select className="form-select form-select-sm" value={cols} onChange={(e) => setCols(e.target.value)}>
                  <option value="1">1 — Full width</option>
                  <option value="2">2 columns</option>
                  <option value="3">3 columns</option>
                </select>
              </div>
              {err && <p className="text-danger small mb-0">{err}</p>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleInsert} disabled={!images.length}>
                <iconify-icon icon="solar:gallery-add-line-duotone" className="me-1" />
                Insert Gallery ({images.length})
              </button>
            </div>
          </div>
        </div>
      </div>
      <MediaPickerModal
        show={showPicker}
        multi
        onClose={() => setShowPicker(false)}
        onSelect={(files) => {
          setImages((prev) => [...prev, ...files.map((f) => f.file_url)]);
          setShowPicker(false);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Product card modal — search & insert a product card into blog body
// ---------------------------------------------------------------------------
function ProductCardModal({ onInsert, onClose }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState(null);
  const [style,    setStyle]    = useState('card');

  const search = useCallback(async (q) => {
    setLoading(true);
    try {
      const { data } = await api.get('/products', { params: { search: q, limit: 20, is_active: 1 } });
      setResults(data.products || data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { search(''); }, [search]);

  function handleSearch(e) {
    const q = e.target.value;
    setQuery(q);
    search(q);
  }

  function buildCardHtml(p) {
    const price = parseFloat(p.price || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const compare = p.compare_price ? parseFloat(p.compare_price).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '';
    const imgTag = p.images?.[0]
      ? `<img src="${p.images[0]}" alt="${p.name}" style="width:100%;height:200px;object-fit:cover;border-radius:8px 8px 0 0;display:block;" />`
      : '';

    if (style === 'inline') {
      return `<div class="blog-product-card blog-product-inline">
  ${p.images?.[0] ? `<img src="${p.images[0]}" alt="${p.name}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;flex-shrink:0;" />` : ''}
  <div class="blog-product-info">
    <strong style="font-size:1rem;">${p.name}</strong>
    ${p.short_desc ? `<p style="color:#666;font-size:0.875rem;margin:4px 0 8px;">${p.short_desc}</p>` : ''}
    <div style="font-size:1.1rem;font-weight:700;color:#0d6efd;">${price}${compare ? ` <del style="color:#999;font-size:0.85rem;font-weight:400;">${compare}</del>` : ''}</div>
    <a href="/shop/${p.slug || p.id}" style="margin-top:8px;display:inline-block;background:#0d6efd;color:#fff;padding:6px 16px;border-radius:4px;text-decoration:none;font-size:0.875rem;">View Product</a>
  </div>
</div><p></p>`;
    }

    return `<div class="blog-product-card">
  ${imgTag}
  <div style="padding:1rem;">
    <strong style="font-size:1.05rem;display:block;margin-bottom:6px;">${p.name}</strong>
    ${p.short_desc ? `<p style="color:#666;font-size:0.875rem;margin:0 0 12px;">${p.short_desc}</p>` : ''}
    <div style="font-size:1.2rem;font-weight:700;color:#0d6efd;">${price}${compare ? ` <del style="color:#999;font-size:0.875rem;font-weight:400;margin-left:6px;">${compare}</del>` : ''}</div>
    <a href="/shop/${p.slug || p.id}" style="margin-top:12px;display:block;text-align:center;background:#0d6efd;color:#fff;padding:8px;border-radius:6px;text-decoration:none;font-weight:600;">View Product</a>
  </div>
</div><p></p>`;
  }

  return (
    <div
      className="modal d-block"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-dialog modal-lg modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Insert Product Card</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <div className="d-flex gap-2 mb-3">
              <input
                type="search"
                className="form-control"
                placeholder="Search products…"
                value={query}
                onChange={handleSearch}
                autoFocus
              />
              <select className="form-select" style={{ maxWidth: 160 }} value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="card">Card (vertical)</option>
                <option value="inline">Inline (horizontal)</option>
              </select>
            </div>
            {loading && <div className="text-center py-3"><span className="spinner-border text-primary spinner-border-sm" /></div>}
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {!loading && results.length === 0 && <p className="text-muted text-center py-3">No products found.</p>}
              {results.map((p) => (
                <div
                  key={p.id}
                  className={`d-flex align-items-center gap-3 p-2 rounded mb-1 border ${selected?.id === p.id ? 'border-primary bg-primary bg-opacity-10' : 'border-transparent'}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(p)}
                >
                  {p.images?.[0]
                    ? <img src={resolveUrl(p.images[0])} alt="" style={{ width: 52, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} onError={(e) => { e.target.style.display = 'none'; }} />
                    : <div style={{ width: 52, height: 40, background: '#e9ecef', borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><iconify-icon icon="solar:box-minimalistic-line-duotone" style={{ fontSize: 20, color: '#aaa' }} /></div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fw-semibold text-truncate">{p.name}</div>
                    <div className="text-muted small">{p.sku} · ${parseFloat(p.price || 0).toFixed(2)}</div>
                  </div>
                  {selected?.id === p.id && <iconify-icon icon="solar:check-circle-bold" style={{ fontSize: 20, color: '#0d6efd' }} />}
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selected}
              onClick={() => selected && onInsert(buildCardHtml(selected))}
            >
              <iconify-icon icon="solar:tag-price-line-duotone" className="me-1" />
              Insert Card
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insert-image modal — media library picker + URL paste fallback
// ---------------------------------------------------------------------------
function InsertImageModal({ onInsert, onClose, title = 'Insert Image' }) {
  const [showPicker, setShowPicker] = useState(true);
  const [url,        setUrl]        = useState('');

  function handleInsertUrl() {
    if (!url.trim()) return;
    onInsert(url.trim());
  }

  // Open the media picker immediately; if user closes it without selecting,
  // fall back to showing a URL input.
  if (showPicker) {
    return (
      <MediaPickerModal
        show
        onClose={() => setShowPicker(false)}
        onSelect={(file) => { onInsert(file.file_url); onClose(); }}
      />
    );
  }

  // Fallback: URL paste
  return (
    <div
      className="modal d-block"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{title}</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body d-flex flex-column gap-3">
            <button type="button" className="btn btn-outline-primary" onClick={() => setShowPicker(true)}>
              <iconify-icon icon="solar:gallery-add-line-duotone" className="me-1" />
              Open Media Library
            </button>
            <hr className="my-1" />
            <div>
              <label className="form-label fw-semibold">Or paste an image URL</label>
              <div className="input-group">
                <input
                  type="url"
                  className="form-control"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleInsertUrl(); }}
                  autoFocus
                />
                <button className="btn btn-primary" type="button" onClick={handleInsertUrl}>
                  Insert
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blog Post Editor
// ---------------------------------------------------------------------------
const EMPTY_FORM = {
  title:        '',
  slug:         '',
  status:       'draft',
  excerpt:      '',
  og_image:     '',
  meta_title:   '',
  meta_desc:    '',
  published_at: '',
};

function toSlug(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function BlogPostEditor() {
  const { id } = useParams();
  const isNew   = !id;
  const navigate = useNavigate();

  const [form,           setForm]           = useState(EMPTY_FORM);
  const [saving,         setSaving]         = useState(false);
  const [loading,        setLoading]        = useState(!isNew);
  const [msg,            setMsg]            = useState('');
  const [showImgModal,      setShowImgModal]      = useState(false);
  const [showGalleryModal,  setShowGalleryModal]  = useState(false);
  const [showProductModal,  setShowProductModal]  = useState(false);
  const [replacingImage,    setReplacingImage]    = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: '',
    editorProps: {
      attributes: { spellcheck: 'true' },
    },
  });

  // Load existing post
  useEffect(() => {
    if (isNew || !editor) return;
    (async () => {
      try {
        const { data } = await api.get(`/cms/blog/${id}`);
        setForm({
          title:        decodeHtml(data.title        || ''),
          slug:         data.slug         || '',
          status:       data.status       || 'draft',
          excerpt:      decodeHtml(data.excerpt      || ''),
          og_image:     data.og_image     || '',
          meta_title:   decodeHtml(data.meta_title   || ''),
          meta_desc:    decodeHtml(data.meta_desc    || ''),
          published_at: data.published_at
            ? new Date(data.published_at).toISOString().slice(0, 16)
            : '',
        });
        if (data.body_json) {
          try { editor.commands.setContent(JSON.parse(data.body_json)); }
          catch { editor.commands.setContent(data.body_html || ''); }
        } else if (data.body_html) {
          editor.commands.setContent(data.body_html);
        }
      } catch {
        setMsg('Failed to load post.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, editor, isNew]);

  function handleTitleChange(title) {
    setForm((f) => ({ ...f, title, slug: f.slug || toSlug(title) }));
  }

  function insertImage(url) {
    if (replacingImage) {
      // Replace the currently selected image node
      editor.chain().focus().deleteSelection().setImage({ src: url }).run();
      setReplacingImage(false);
    } else {
      editor.chain().focus().setImage({ src: url }).run();
    }
    setShowImgModal(false);
  }

  function openReplaceModal() {
    setReplacingImage(true);
    setShowImgModal(true);
  }

  function insertGallery(urls, cols) {
    const imgTags = urls.map((src) => `<img src="${src}" alt="" />`).join('');
    const html = `<div class="blog-gallery blog-gallery-${cols}">${imgTags}</div><p></p>`;
    editor.chain().focus().insertContent(html).run();
    setShowGalleryModal(false);
  }

  function insertProductCard(html) {
    editor.chain().focus().insertContent(html).run();
    setShowProductModal(false);
  }

  async function save() {
    if (!form.title.trim()) { setMsg('Title is required.'); return; }
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        ...form,
        body_html:    editor.getHTML(),
        body_json:    JSON.stringify(editor.getJSON()),
        published_at: form.published_at || null,
      };
      if (isNew) {
        const { data } = await api.post('/cms/blog', payload);
        navigate(`/admin/blog-posts/${data.id}/edit`, { replace: true });
      } else {
        await api.put(`/cms/blog/${id}`, payload);
        setMsg('Saved.');
      }
    } catch (e) {
      setMsg(e.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-center py-5"><span className="spinner-border text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader
        title={isNew ? 'New Blog Post' : 'Edit Blog Post'}
        actions={
          <button className="btn btn-light" onClick={() => navigate('/admin/blog-posts')}>
            ← Back to Blog Posts
          </button>
        }
      />

      {msg && (
        <div className={`alert ${msg === 'Saved.' ? 'alert-success' : 'alert-danger'} py-2`}>
          {msg}
        </div>
      )}

      <div className="row g-3">
        <div className="col-12">
          <input
            type="text"
            className="form-control form-control-lg"
            placeholder="Post title…"
            value={form.title}
            onChange={(e) => handleTitleChange(e.target.value)}
          />
        </div>

        {/* Editor — left 2/3 */}
        <div className="col-lg-8">
          <div className="card mb-3" style={{ position: 'relative' }}>
            <EditorToolbar
            editor={editor}
            onInsertImage={() => { setReplacingImage(false); setShowImgModal(true); }}
            onInsertGallery={() => setShowGalleryModal(true)}
            onInsertProduct={() => setShowProductModal(true)}
          />
            <ImageToolbar editor={editor} onReplace={openReplaceModal} />
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
            <div
              className="card-body p-0"
              onClick={() => editor && !editor.isFocused && editor.commands.focus('end')}
            >
              <EditorContent editor={editor} className="tiptap-editor" />
            </div>
          </div>

          <div className="card">
            <div className="card-header fw-semibold">Excerpt</div>
            <div className="card-body">
              <textarea
                className="form-control"
                rows={3}
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                placeholder="Short summary shown in post listings…"
              />
            </div>
          </div>
        </div>

        {/* Sidebar — right 1/3 */}
        <div className="col-lg-4">
          <div className="card mb-3">
            <div className="card-header fw-semibold">Post Settings</div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>

              {form.status === 'published' && (
                <div>
                  <label className="form-label">Published Date</label>
                  <input
                    type="datetime-local"
                    className="form-control"
                    value={form.published_at}
                    onChange={(e) => setForm({ ...form, published_at: e.target.value })}
                  />
                </div>
              )}

              <div>
                <label className="form-label">Slug</label>
                <div className="input-group">
                  <span className="input-group-text text-muted">/blog/</span>
                  <input
                    type="text"
                    className="form-control font-monospace"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="post-slug"
                  />
                </div>
              </div>

              <div className="d-grid">
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving
                    ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
                    : isNew ? 'Create Post' : 'Save Changes'
                  }
                </button>
              </div>
            </div>
          </div>

          {/* Featured image */}
          <div className="card mb-3">
            <div className="card-header fw-semibold">Featured Image</div>
            <div className="card-body">
              <FeaturedImageUploader
                value={form.og_image}
                onChange={(url) => setForm({ ...form, og_image: url })}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-header fw-semibold">SEO</div>
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <label className="form-label">Meta Title</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.meta_title}
                  onChange={(e) => setForm({ ...form, meta_title: e.target.value })}
                  placeholder="Override title for search engines"
                />
              </div>
              <div>
                <label className="form-label">Meta Description</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={form.meta_desc}
                  onChange={(e) => setForm({ ...form, meta_desc: e.target.value })}
                  placeholder="Short description for search results"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {showImgModal && (
        <InsertImageModal
          onInsert={insertImage}
          onClose={() => { setShowImgModal(false); setReplacingImage(false); }}
          title={replacingImage ? 'Replace Image' : 'Insert Image'}
        />
      )}

      {showGalleryModal && (
        <GalleryModal
          onInsert={insertGallery}
          onClose={() => setShowGalleryModal(false)}
        />
      )}

      {showProductModal && (
        <ProductCardModal
          onInsert={insertProductCard}
          onClose={() => setShowProductModal(false)}
        />
      )}

      {/* TipTap image styles */}
      <style>{`
        .tiptap-editor img { max-width: 100%; border-radius: 4px; margin: 0.5rem 0; cursor: pointer; }
        .tiptap-editor img.ProseMirror-selectednode { outline: 3px solid #0d6efd; }
      `}</style>
    </div>
  );
}
