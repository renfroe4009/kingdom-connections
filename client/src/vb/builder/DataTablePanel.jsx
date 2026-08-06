import { useState, useEffect, useRef } from 'react';
import api from '../../api/client.js';

const RED  = '#cc1122';
const DARK = '#1a1a2e';

/* ── Field renderer ─────────────────────────────────────────────────────── */
function FieldInput({ field, value, onChange, recordId, apiBase, hasError }) {
  const errStyle = hasError ? { borderColor: RED } : {};
  const [uploading, setUploading] = useState(false);

  if (field.type === 'image') {
    return (
      <div>
        {value && (
          <img
            src={value}
            alt=""
            style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, marginBottom: 8, display: 'block' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        )}
        {recordId ? (
          <label style={{ cursor: 'pointer', display: 'inline-block' }}>
            <span style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #ccc', fontSize: '0.8rem', background: '#f8f8f8' }}>
              {uploading ? 'Uploading…' : value ? 'Replace Photo' : 'Upload Photo'}
            </span>
            <input
              type="file" accept="image/*" style={{ display: 'none' }}
              disabled={uploading}
              onChange={async e => {
                const file = e.target.files[0];
                if (!file) return;
                setUploading(true);
                try {
                  const fd = new FormData();
                  fd.append('file', file);
                  const { data } = await api.post(`${apiBase}/${recordId}/photo`, fd, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                  });
                  onChange(data.image_url);
                } catch (err) {
                  alert(err?.response?.data?.error || 'Upload failed');
                } finally { setUploading(false); }
              }}
            />
          </label>
        ) : (
          <p style={{ fontSize: '0.75rem', color: '#888', margin: 0 }}>Save first, then upload a photo.</p>
        )}
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <select className="form-select form-select-sm" style={errStyle} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">— Select —</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        className="form-control form-control-sm"
        style={errStyle}
        rows={4}
        value={value || ''}
        placeholder={field.placeholder || ''}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  if (field.type === 'date') {
    return (
      <input
        type="date"
        className="form-control form-control-sm"
        style={errStyle}
        value={value ? value.substring(0, 10) : ''}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        className="form-control form-control-sm"
        style={errStyle}
        value={value ?? ''}
        placeholder={field.placeholder || '0'}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      type="text"
      className="form-control form-control-sm"
      style={errStyle}
      value={value || ''}
      placeholder={field.placeholder || ''}
      onChange={e => onChange(e.target.value)}
    />
  );
}

/* ── Inline edit form (replaces list view) ──────────────────────────────── */
function EditView({ cfg, record, onSave, onBack }) {
  const isNew = !record?.id;
  const [form, setForm] = useState(() => {
    const init = {};
    cfg.fields.forEach(f => { init[f.key] = record?.[f.key] ?? ''; });
    return init;
  });
  const [saving,   setSaving]   = useState(false);
  const [savedId,  setSavedId]  = useState(record?.id || null);
  const [flash,    setFlash]    = useState(null); // 'saving' | 'saved' | 'error'
  const [errMsg,   setErrMsg]   = useState('');
  const [fieldErr, setFieldErr] = useState({}); // { fieldKey: 'message' }

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
    if (fieldErr[key]) setFieldErr(prev => ({ ...prev, [key]: null }));
  }

  function validate() {
    const errors = {};
    cfg.fields.forEach(f => {
      if (f.required && (form[f.key] === '' || form[f.key] == null)) {
        errors[f.key] = `${f.label} is required`;
      }
    });
    setFieldErr(errors);
    return Object.keys(errors).length === 0;
  }

  // Sanitise payload: strip empty optional strings; convert empty numbers to null
  function buildPayload() {
    const payload = {};
    cfg.fields.forEach(f => {
      const val = form[f.key];
      if (f.type === 'number') {
        payload[f.key] = val === '' || val == null ? null : Number(val);
      } else if (!f.required && (val === '' || val == null)) {
        payload[f.key] = null;
      } else {
        payload[f.key] = val;
      }
    });
    return payload;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setFlash('saving');
    try {
      const payload = buildPayload();
      let saved;
      if (isNew && !savedId) {
        const { data } = await api.post(cfg.apiBase, payload);
        setSavedId(data.id);
        saved = data;
      } else {
        const { data } = await api.put(`${cfg.apiBase}/${savedId || record.id}`, payload);
        saved = data;
      }
      setFlash('saved');
      onSave(saved);
      window.dispatchEvent(new CustomEvent('cms-data-refresh'));
      setTimeout(() => { setFlash(null); }, 1800);
    } catch (err) {
      setErrMsg(err?.response?.data?.error || 'Save failed');
      setFlash('error');
    } finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', background: DARK, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 4, padding: '4px 10px', fontSize: '0.8rem', cursor: 'pointer' }}
        >
          ← Back
        </button>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem', flex: 1 }}>
          {isNew ? 'Add Entry' : 'Edit Entry'}
        </span>
        {flash === 'saving' && (
          <span style={{ fontSize: '0.75rem', color: '#adf', display: 'flex', alignItems: 'center', gap: 5 }}>
            <div className="spinner-border spinner-border-sm" style={{ width: 12, height: 12, borderWidth: 2, color: '#adf' }} />
            Saving…
          </span>
        )}
        {flash === 'saved' && (
          <span style={{ fontSize: '0.75rem', color: '#6fcf97', fontWeight: 700 }}>✓ Saved</span>
        )}
        {flash === 'error' && (
          <span style={{ fontSize: '0.72rem', color: '#ff8080' }}>{errMsg}</span>
        )}
      </div>

      {/* Form fields */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
        {cfg.fields.map(field => (
          <div key={field.key} style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: fieldErr[field.key] ? RED : '#444' }}>
              {field.label}{field.required && <span style={{ color: RED }}> *</span>}
            </label>
            <FieldInput
              field={field}
              value={form[field.key]}
              onChange={val => set(field.key, val)}
              recordId={savedId || record?.id}
              apiBase={cfg.apiBase}
              hasError={!!fieldErr[field.key]}
            />
            {fieldErr[field.key] && (
              <div style={{ fontSize: '0.74rem', color: RED, marginTop: 3 }}>{fieldErr[field.key]}</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid #eee', display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, padding: '9px 0', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.88rem',
            background: flash === 'saved' ? '#198754' : RED,
            color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'background 0.3s',
          }}
        >
          {saving ? 'Saving…' : flash === 'saved' ? '✓ Saved' : 'Save'}
        </button>
        <button
          onClick={onBack}
          style={{ padding: '9px 16px', border: '1px solid #ddd', borderRadius: 6, background: '#f5f5f5', cursor: 'pointer', fontSize: '0.88rem' }}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

/* ── Main DataTablePanel ─────────────────────────────────────────────────── */
export default function DataTablePanel({ cfg }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [search, setSearch]   = useState('');
  const [editing, setEditing] = useState(null); // null = list view | 'new' | record object
  const [dragIdx, setDragIdx] = useState(null);
  const overIdx = useRef(null);

  useEffect(() => {
    api.get(cfg.apiBase)
      .then(r => setRows(r.data))
      .catch(err => setLoadErr(err?.response?.data?.error || err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [cfg.apiBase]);

  function handleSaved(saved) {
    // Update the row in the list immediately — editing stays open
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    // Keep editing open; EditView shows ✓ Saved confirmation in header/button
  }

  async function handleDelete(e, row) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${cfg.rowLabel(row)}"?`)) return;
    try {
      await api.delete(`${cfg.apiBase}/${row.id}`);
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) {
      alert(err?.response?.data?.error || 'Delete failed');
    }
  }

  // Drag-to-reorder
  function onDragStart(i) { setDragIdx(i); overIdx.current = i; }
  function onDragOver(e, i) {
    e.preventDefault();
    if (overIdx.current === i || dragIdx === null) return;
    overIdx.current = i;
    const next = [...rows];
    const [item] = next.splice(dragIdx, 1);
    next.splice(i, 0, item);
    setDragIdx(i);
    setRows(next);
  }
  async function onDragEnd() {
    setDragIdx(null);
    overIdx.current = null;
    const order = rows.map((r, i) => ({ id: r.id, sort_order: i }));
    await api.put(`${cfg.apiBase}/reorder/batch`, { order }).catch(() => {});
  }

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner-border spinner-border-sm text-secondary" /></div>;
  }

  if (loadErr) {
    return (
      <div style={{ padding: 16, color: '#cc1122', fontSize: '0.82rem', background: '#fff8f8', borderRadius: 6, margin: 12, border: '1px solid #fcc' }}>
        <strong>Error loading entries:</strong><br />{loadErr}
      </div>
    );
  }

  // Edit / Add view
  if (editing !== null) {
    return (
      <EditView
        cfg={cfg}
        record={editing === 'new' ? null : editing}
        onSave={handleSaved}
        onBack={() => setEditing(null)}
      />
    );
  }

  // List view
  const visible = search
    ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
    : rows;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Toolbar */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #e8e8e8', background: '#fafafa', flexShrink: 0 }}>
        <button
          onClick={() => setEditing('new')}
          style={{ width: '100%', padding: '8px 0', marginBottom: 8, border: 'none', borderRadius: 6, background: RED, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
        >
          + Add Entry
        </button>
        <input
          type="search"
          className="form-control form-control-sm"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#888' }}>
          {visible.length} of {rows.length} entries · drag ⠿ to reorder
        </div>
      </div>

      {/* Row list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {visible.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#aaa', fontSize: '0.85rem' }}>
            {rows.length === 0 ? 'No entries yet.' : 'No results.'}
          </div>
        )}
        {visible.map((row, i) => {
          const imgField = cfg.fields.find(f => f.type === 'image');
          const imgSrc = imgField ? row[imgField.key] : null;
          return (
            <div
              key={row.id}
              onDragOver={e => onDragOver(e, i)}
              onDragEnd={onDragEnd}
              onClick={() => setEditing(row)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px', borderBottom: '1px solid #f0f0f0',
                background: dragIdx === i ? '#fff3f3' : '#fff',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (dragIdx === null) e.currentTarget.style.background = '#f8f8f8'; }}
              onMouseLeave={e => { e.currentTarget.style.background = dragIdx === i ? '#fff3f3' : '#fff'; }}
            >
              <span
                draggable
                onDragStart={e => { e.stopPropagation(); onDragStart(i); }}
                onClick={e => e.stopPropagation()}
                style={{ color: '#bbb', fontSize: 15, flexShrink: 0, cursor: 'grab', userSelect: 'none', padding: '0 2px' }}
              >⠿</span>

              {imgSrc ? (
                <img src={imgSrc} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
              ) : (
                <div style={{ width: 34, height: 34, background: '#eee', borderRadius: 4, flexShrink: 0 }} />
              )}

              <span style={{ flex: 1, fontSize: '0.83rem', fontWeight: 600, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cfg.rowLabel(row)}
              </span>

              <button
                onClick={e => handleDelete(e, row)}
                style={{ background: 'none', border: '1px solid #fcc', borderRadius: 4, padding: '2px 7px', fontSize: '0.72rem', color: RED, cursor: 'pointer', flexShrink: 0 }}
              >✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
