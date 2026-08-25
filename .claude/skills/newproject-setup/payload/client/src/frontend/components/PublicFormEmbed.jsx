import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

// Shared public form renderer.
// Props:
//   formSlug      – form slug from DB (required)
//   textColor     – optional override for label/text color
//   initialValues – optional { fieldKey: value } pre-fills (e.g. { kit_interest: 'Quick-Build Kit' })
//   onSuccess     – optional callback after successful submit
export default function PublicFormEmbed({ formSlug, textColor, initialValues = {}, onSuccess }) {
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!formSlug) return;
    setForm(null); setSubmitted(false); setError(''); setFieldErrors({});
    fetch(`${API_BASE}/forms/public/${formSlug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const defaults = {};
        (data.fields || []).forEach(f => {
          if (f.default_value != null && f.default_value !== '') defaults[f.field_key] = f.default_value;
        });
        setValues({ ...defaults, ...initialValues });
        setForm(data);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formSlug]);

  // When initialValues change externally (e.g. user opens modal for different tier), merge them in
  useEffect(() => {
    if (Object.keys(initialValues).length > 0) {
      setValues(prev => ({ ...prev, ...initialValues }));
    }
  }, [JSON.stringify(initialValues)]); // eslint-disable-line react-hooks/exhaustive-deps

  function isVisible(field, vals) {
    if (!field.show_if_json) return true;
    try {
      const rule = typeof field.show_if_json === 'string' ? JSON.parse(field.show_if_json) : field.show_if_json;
      const v = String(vals[rule.field] ?? '');
      const cmp = String(rule.value ?? '');
      if (rule.operator === '==' || rule.operator === 'equals') return v === cmp;
      if (rule.operator === '!=' || rule.operator === 'not_equals') return v !== cmp;
      if (rule.operator === 'contains') return v.toLowerCase().includes(cmp.toLowerCase());
      if (rule.operator === 'not_empty') return v.trim() !== '';
      if (rule.operator === 'empty') return v.trim() === '';
      return true;
    } catch { return true; }
  }

  function validate(vals) {
    const errors = {};
    const LAYOUT = new Set(['heading', 'divider', 'paragraph', 'hidden']);
    (form.fields || []).forEach(f => {
      if (LAYOUT.has(f.field_type) || !isVisible(f, vals)) return;
      const v = vals[f.field_key];
      if (f.is_required && (v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0))) {
        errors[f.field_key] = `${f.label} is required`;
        return;
      }
      if (!v && v !== 0) return;
      try {
        const vj = typeof f.validation_json === 'string' ? JSON.parse(f.validation_json || '{}') : (f.validation_json || {});
        if (vj.minLength && String(v).length < vj.minLength) errors[f.field_key] = `Minimum ${vj.minLength} characters`;
        if (vj.maxLength && String(v).length > vj.maxLength) errors[f.field_key] = `Maximum ${vj.maxLength} characters`;
        if (vj.min != null && Number(v) < vj.min) errors[f.field_key] = `Minimum value is ${vj.min}`;
        if (vj.max != null && Number(v) > vj.max) errors[f.field_key] = `Maximum value is ${vj.max}`;
      } catch {}
    });
    return errors;
  }

  async function submit(e) {
    e.preventDefault();
    const errors = validate(values);
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setSubmitting(true); setError('');
    try {
      const payload = { ...values };
      if (form.honeypot) payload.__hp = '';
      const res = await fetch(`${API_BASE}/forms/public/${formSlug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Submit failed');
      const data = await res.json();
      if (data.redirect_url) { window.location.href = data.redirect_url; return; }
      setSubmitted(true);
      if (onSuccess) onSuccess();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const baseInput  = { width: '100%', border: '1px solid #ced4da', borderRadius: 6, padding: '0.55rem 0.75rem', fontSize: '0.9rem', marginTop: 4, boxSizing: 'border-box', background: '#fff', color: '#111' };
  const errInput   = { ...baseInput, borderColor: '#dc3545' };
  const labelStyle = { display: 'block', fontWeight: 600, fontSize: '0.85rem', color: textColor || 'inherit' };
  const widthMap   = { full: '100%', half: 'calc(50% - 8px)', third: 'calc(33.33% - 11px)', 'two-thirds': 'calc(66.66% - 5px)' };
  const LAYOUT_TYPES = new Set(['heading', 'divider', 'paragraph', 'hidden']);

  function renderField(field) {
    const ft = field.field_type || 'text';
    const val = values[field.field_key];
    const hasErr = !!fieldErrors[field.field_key];
    const fs = hasErr ? errInput : baseInput;
    const set = v => {
      setValues(prev => ({ ...prev, [field.field_key]: v }));
      if (fieldErrors[field.field_key]) setFieldErrors(prev => ({ ...prev, [field.field_key]: null }));
    };

    if (ft === 'heading')   return <h3 style={{ fontWeight: 700, color: textColor || 'inherit', margin: '0 0 0.25rem', fontSize: '1.25rem' }}>{field.label}</h3>;
    if (ft === 'divider')   return <hr style={{ borderColor: '#dee2e6', margin: '0.25rem 0' }} />;
    if (ft === 'paragraph') return <p style={{ color: textColor || '#555', fontSize: '0.9rem', margin: 0 }}>{field.label}</p>;
    if (ft === 'hidden')    return <input type="hidden" name={field.field_key} value={field.default_value || ''} />;

    const label = (
      <label style={{ ...labelStyle, color: hasErr ? '#dc3545' : (textColor || 'inherit') }}>
        {field.label}{!!field.is_required && <span style={{ color: '#dc3545', marginLeft: 2 }}>*</span>}
      </label>
    );
    const helpEl = field.help_text ? <small style={{ display: 'block', color: '#888', fontSize: '0.78rem', marginTop: 3 }}>{field.help_text}</small> : null;
    const errEl  = hasErr ? <small style={{ display: 'block', color: '#dc3545', fontSize: '0.78rem', marginTop: 3 }}>{fieldErrors[field.field_key]}</small> : null;

    let input;
    if (ft === 'textarea') {
      input = <textarea rows={4} style={fs} placeholder={field.placeholder || ''} value={val || ''} onChange={e => set(e.target.value)} />;
    } else if (ft === 'select') {
      input = (
        <select style={fs} value={val || ''} onChange={e => set(e.target.value)}>
          <option value="">Select…</option>
          {(field.options_json || []).map((o, i) => <option key={i} value={o.value || o}>{o.label || o}</option>)}
        </select>
      );
    } else if (ft === 'radio') {
      input = (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(field.options_json || []).map((o, i) => (
            <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal', fontSize: '0.9rem', color: textColor || 'inherit', cursor: 'pointer' }}>
              <input type="radio" name={field.field_key} value={o.value || o} checked={val === (o.value || o)} onChange={() => set(o.value || o)} />
              {o.label || o}
            </label>
          ))}
        </div>
      );
    } else if (ft === 'checkboxes') {
      const sel = Array.isArray(val) ? val : [];
      input = (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(field.options_json || []).map((o, i) => {
            const ov = o.value || o;
            return (
              <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal', fontSize: '0.9rem', color: textColor || 'inherit', cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(ov)} onChange={() => set(sel.includes(ov) ? sel.filter(v => v !== ov) : [...sel, ov])} />
                {o.label || o}
              </label>
            );
          })}
        </div>
      );
    } else if (ft === 'checkbox' || ft === 'terms') {
      input = (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6, fontWeight: 'normal', fontSize: '0.9rem', color: textColor || 'inherit', cursor: 'pointer' }}>
          <input type="checkbox" style={{ marginTop: 3, flexShrink: 0 }} checked={!!val} onChange={e => set(e.target.checked)} />
          <span>{field.placeholder || (ft === 'terms' ? 'I agree to the terms and conditions' : field.label)}</span>
        </label>
      );
    } else if (ft === 'rating') {
      const cur = Number(val) || 0;
      input = (
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} type="button" onClick={() => set(n)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.6rem', color: n <= cur ? '#f59e0b' : '#ddd', padding: 0, lineHeight: 1 }}>★</button>
          ))}
        </div>
      );
    } else if (ft === 'range') {
      const vj = (() => { try { return typeof field.validation_json === 'string' ? JSON.parse(field.validation_json || '{}') : (field.validation_json || {}); } catch { return {}; } })();
      input = (
        <div style={{ marginTop: 6 }}>
          <input type="range" style={{ width: '100%' }} min={vj.min ?? 0} max={vj.max ?? 100} step={vj.step ?? 1} value={val ?? vj.min ?? 0} onChange={e => set(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#888' }}>
            <span>{vj.min ?? 0}</span><span style={{ fontWeight: 600 }}>{val ?? vj.min ?? 0}</span><span>{vj.max ?? 100}</span>
          </div>
        </div>
      );
    } else {
      const typeMap = { phone: 'tel' };
      const vj = (() => { try { return typeof field.validation_json === 'string' ? JSON.parse(field.validation_json || '{}') : (field.validation_json || {}); } catch { return {}; } })();
      input = (
        <input type={typeMap[ft] || ft} style={fs} placeholder={field.placeholder || ''} value={val || ''}
          {...(vj.minLength ? { minLength: vj.minLength } : {})}
          {...(vj.maxLength ? { maxLength: vj.maxLength } : {})}
          {...(vj.min != null ? { min: vj.min } : {})}
          {...(vj.max != null ? { max: vj.max } : {})}
          onChange={e => set(e.target.value)} />
      );
    }
    return <>{label}{input}{helpEl}{errEl}</>;
  }

  if (!formSlug) return null;
  if (!form) return <div style={{ padding: '1rem', color: '#888', fontSize: '0.9rem' }}>Loading form…</div>;

  if (submitted) return (
    <div style={{ padding: '1.5rem', textAlign: 'center', color: textColor || 'inherit' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✓</div>
      <p style={{ fontWeight: 600, fontSize: '1.05rem' }}>{form.success_msg || 'Thank you! Your message has been sent.'}</p>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
        {(form.fields || []).filter(f => isVisible(f, values)).map(field => {
          const isLayout = LAYOUT_TYPES.has(field.field_type);
          return (
            <div key={field.id} style={{ width: isLayout ? '100%' : (widthMap[field.col_width] || '100%'), minWidth: 0 }}>
              {renderField(field)}
            </div>
          );
        })}
      </div>
      {error && <p style={{ color: '#dc3545', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{error}</p>}
      <div style={{ marginTop: '1.25rem' }}>
        <button type="submit" disabled={submitting}
          style={{ background: 'var(--brand-primary, #cc1122)', color: '#fff', border: 'none', borderRadius: 6, padding: '0.65rem 2rem', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}>
          {submitting ? 'Sending…' : (form.submit_text || 'Submit')}
        </button>
      </div>
    </form>
  );
}
