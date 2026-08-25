// Site-wide theme, edited from inside the builder.
//
// Block-level colour and padding already preview instantly — they're React
// props on Craft nodes. Site-wide values didn't: they live in Web Settings on
// another screen, and the canvas held whatever snapshot it fetched on mount.
// So changing a brand colour meant leaving the builder, saving, coming back and
// hoping.
//
// Every change here is pushed straight at the canvas via `onPreview` before
// anything is written to the database. CanvasFrame re-runs `applyBrandVars` and
// re-injects the site stylesheet whenever those props change, so the preview
// updates as the colour picker moves. Closing without saving reverts it.

import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { invalidateSiteSettings } from '../../frontend/theme/siteTheme.js';
import CodeEditor from '../code/CodeEditor.jsx';
import { ColorField, Field, FieldGroup, SelectField, TextField } from '../fields/index.jsx';
import { Drawer } from './PageSettingsDrawer.jsx';

// Only these are written back. The settings table holds far more (nav links,
// footer columns, social); touching a key we didn't render would blank it.
const THEME_KEYS = [
  'primary_color', 'secondary_color', 'button_color', 'icon_color',
  'text_on_dark', 'text_on_light', 'font_heading', 'font_body',
  'layout_width', 'site_custom_css',
];

const pick = (source) => Object.fromEntries(THEME_KEYS.map((key) => [key, source?.[key] ?? '']));

export default function ThemeDrawer({ settings, onPreview, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => pick(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  // Held in a ref so the unmount cleanup doesn't re-run on every keystroke.
  const saved = useRef(false);

  // The resolved settings the canvas was given merge Business Profile over Web
  // Settings, so a colour can appear set while its stored value is empty.
  // Reading the stored row first means "save" writes what the user sees rather
  // than silently persisting a fallback they never chose.
  useEffect(() => {
    let alive = true;
    api.get('/website/settings')
      .then(({ data }) => {
        if (!alive) return;
        setDraft((current) => {
          const stored = pick(data);
          const next = { ...current };
          for (const key of THEME_KEYS) if (stored[key]) next[key] = stored[key];
          return next;
        });
      })
      .catch(() => { /* fall back to the resolved values already in state */ });
    return () => { alive = false; };
  }, []);

  // Discard the live preview if the drawer closes without saving.
  useEffect(() => () => { if (!saved.current) onPreview(null); }, [onPreview]);

  const set = (key) => (value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setDirty(true);
    onPreview({ ...settings, ...next });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put('/website/settings', draft);
      // The module-level cache would otherwise hand the old palette to the next
      // surface that asks for it — the public site included.
      invalidateSiteSettings();
      saved.current = true;
      onSaved({ ...settings, ...draft });
      setDirty(false);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save the theme.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer title="Theme" onClose={onClose}>
      <FieldGroup title="Brand colours">
        <ColorField label="Primary" value={draft.primary_color} onChange={set('primary_color')} />
        <ColorField label="Secondary" value={draft.secondary_color} onChange={set('secondary_color')} />
        <ColorField label="Buttons" value={draft.button_color} onChange={set('button_color')}
          hint="Leave empty to use the primary colour." />
        <ColorField label="Icons" value={draft.icon_color} onChange={set('icon_color')}
          hint="Leave empty to use the primary colour." />
      </FieldGroup>

      <FieldGroup title="Text on backgrounds">
        <ColorField label="On dark backgrounds" value={draft.text_on_dark} onChange={set('text_on_dark')} />
        <ColorField label="On light backgrounds" value={draft.text_on_light} onChange={set('text_on_light')} />
      </FieldGroup>

      <FieldGroup title="Typography" defaultOpen={false}>
        <TextField label="Headings" value={draft.font_heading} onChange={set('font_heading')}
          placeholder="Playfair Display, serif"
          hint="A CSS font stack. The font itself must be loaded by the site stylesheet." />
        <TextField label="Body" value={draft.font_body} onChange={set('font_body')}
          placeholder="Inter, system-ui, sans-serif" />
      </FieldGroup>

      <FieldGroup title="Layout" defaultOpen={false}>
        <SelectField
          label="Content width"
          value={draft.layout_width}
          onChange={set('layout_width')}
          options={[
            { value: '1120px', label: 'Narrow — 1120px' },
            { value: '1200px', label: 'Standard — 1200px' },
            { value: '1320px', label: 'Wide — 1320px' },
            { value: '100%', label: 'Full width' },
          ]}
        />
      </FieldGroup>

      <FieldGroup title="Site CSS" defaultOpen={false}>
        <Field hint="Applies to every page, and to this canvas as you type. Page-specific rules belong in Page settings instead.">
          <CodeEditor language="css" value={draft.site_custom_css} onChange={set('site_custom_css')} height="300px" />
        </Field>
      </FieldGroup>

      {error && <div className="alert alert-danger py-2 px-3 mb-2">{error}</div>}

      <div className="d-flex align-items-center gap-2 mt-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save theme'}
        </button>
        {dirty && <span className="text-muted small">Previewing — not saved yet</span>}
      </div>
    </Drawer>
  );
}
