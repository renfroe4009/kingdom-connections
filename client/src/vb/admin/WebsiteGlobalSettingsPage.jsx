import { useState, useEffect } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

// Layout only — colors stay owned by Business Settings' theme (primary_color/
// secondary_color, already wired site-wide via ThemeContext). This page
// controls the one thing that isn't covered anywhere else: how wide page
// content renders relative to the header, and on what font, at each
// breakpoint. Middle breakpoints (tablet/small-desktop) intentionally aren't
// exposed — they stay pinned to the header's real Bootstrap tiers so
// "matches the header" holds by default without any admin input.
const DESKTOP_WIDTH_OPTIONS = [
  { value: '', label: 'Default (1320px)' },
  { value: '1140px', label: 'Narrow (1140px)' },
  { value: '1320px', label: 'Standard (1320px)' },
  { value: '1440px', label: 'Wide (1440px)' },
];

const MOBILE_WIDTH_OPTIONS = [
  { value: '', label: 'Default (edge-to-edge with gutters)' },
  { value: '92vw', label: '92% of screen width' },
  { value: '100%', label: 'Full width (gutters only)' },
];

const MOBILE_MODE_OPTIONS = [
  { value: 'match-header', label: 'Match header (recommended)' },
  { value: 'fixed', label: 'Fixed width' },
  { value: 'fluid', label: 'Fluid / full-bleed' },
];

const FONT_OPTIONS = [
  { value: 'inter', label: 'Inter (default, sans-serif)' },
  { value: 'playfair', label: 'Playfair Display (serif)' },
  { value: 'system', label: 'System default' },
];

const KEYS = ['layout_desktop_max_width', 'layout_mobile_max_width', 'layout_mobile_mode', 'layout_font_family'];

export default function WebsiteGlobalSettingsPage() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/website/settings')
      .then(r => setValues(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set(key, val) {
    setValues(v => ({ ...v, [key]: val }));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const payload = {};
      KEYS.forEach(k => { payload[k] = values[k] ?? ''; });
      await api.put('/website/settings', payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      toast(parseApiError(e, 'Save failed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading…</span></div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 720 }}>
      <PageHeader title="Global Website Settings" subtitle="Layout defaults for public site pages — container width, mobile behavior, and font" />

      <div className="card border-0 shadow-sm">
        <div className="card-body p-4">
          <div className="mb-4">
            <label className="form-label fw-semibold small">Desktop Content Width</label>
            <select className="form-select" value={values.layout_desktop_max_width || ''} onChange={e => set('layout_desktop_max_width', e.target.value)}>
              {DESKTOP_WIDTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="form-text">How wide page content can grow on large desktop screens (≥1400px). Below that, content already matches the header's responsive width automatically.</div>
          </div>

          <div className="mb-4">
            <label className="form-label fw-semibold small">Mobile Content Width</label>
            <select className="form-select" value={values.layout_mobile_max_width || ''} onChange={e => set('layout_mobile_max_width', e.target.value)}>
              {MOBILE_WIDTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="mb-4">
            <label className="form-label fw-semibold small">Mobile Layout Mode</label>
            <select className="form-select" value={values.layout_mobile_mode || 'match-header'} onChange={e => set('layout_mobile_mode', e.target.value)}>
              {MOBILE_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="mb-4">
            <label className="form-label fw-semibold small">Font Family</label>
            <select className="form-select" value={values.layout_font_family || 'inter'} onChange={e => set('layout_font_family', e.target.value)}>
              {FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="d-flex align-items-center gap-3 mt-2 pt-3 border-top">
            <button className="btn btn-primary px-4" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            {saved && <span className="text-success fw-semibold small" role="status">✓ Saved — refresh the public site to see changes</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 p-3 rounded" style={{ background: '#f8f9fa', fontSize: '0.85rem', color: '#6c757d' }}>
        Individual blocks in the page builder can override these defaults for a specific page — this only sets what happens when a block hasn't been given its own width.
      </div>
    </div>
  );
}
