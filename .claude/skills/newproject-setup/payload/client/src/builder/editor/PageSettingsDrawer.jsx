import { Field, FieldGroup, ImageField, SelectField, TextField, TextareaField } from '../fields/index.jsx';
import CodeEditor from '../code/CodeEditor.jsx';

export default function PageSettingsDrawer({ page, onChange, onClose }) {
  const set = (key) => (value) => onChange({ ...page, [key]: value });

  return (
    <Drawer title="Page settings" onClose={onClose}>
      <FieldGroup title="Basics">
        <TextField label="Title" value={page.title} onChange={set('title')} />
        <TextField
          label="Slug"
          value={page.slug}
          onChange={(v) => set('slug')(v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''))}
          hint={`Public address: /${page.slug || ''}`}
        />
        <SelectField
          label="Status"
          value={page.status}
          onChange={set('status')}
          options={[
            { value: 'draft', label: 'Draft — only visible to you' },
            { value: 'published', label: 'Published — live on the site' },
          ]}
        />
      </FieldGroup>

      <FieldGroup title="Search engines and sharing">
        <TextField label="Meta title" value={page.meta_title} onChange={set('meta_title')} hint="Falls back to the page title." />
        <TextareaField label="Meta description" value={page.meta_desc} onChange={set('meta_desc')} rows={3} />
        <TextField label="Keywords" value={page.meta_keywords} onChange={set('meta_keywords')} />
        <ImageField label="Share image" value={page.og_image} onChange={set('og_image')} hint="Shown when the page is linked on social media." />
      </FieldGroup>

      <FieldGroup title="Custom CSS" defaultOpen={false}>
        <Field hint="Applies to this page only, on the live site and in the builder. Target a section by its Custom ID, e.g. #services { … }">
          <CodeEditor language="css" value={page.custom_css} onChange={set('custom_css')} height="220px" />
        </Field>
      </FieldGroup>

      <FieldGroup title="Custom JavaScript" defaultOpen={false}>
        <Field hint="Runs on the live page only — never inside the builder.">
          <CodeEditor language="javascript" value={page.custom_js} onChange={set('custom_js')} height="220px" />
        </Field>
      </FieldGroup>
    </Drawer>
  );
}

export function Drawer({ title, onClose, children, wide = false }) {
  return (
    <>
      <div className="bx-drawer__scrim" onClick={onClose} />
      <aside className={`bx-drawer ${wide ? 'bx-drawer--wide' : ''}`} role="dialog" aria-label={title}>
        <header className="bx-drawer__head">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} title="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </header>
        <div className="bx-drawer__body">{children}</div>
      </aside>
    </>
  );
}
