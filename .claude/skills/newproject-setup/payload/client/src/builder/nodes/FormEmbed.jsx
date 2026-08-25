// Form embed — the user picks one of the forms built in Admin → Forms by slug,
// and it renders live on the page. Submissions land in that form's inbox.

import { useEffect, useState } from 'react';
import { useNode } from '@craftjs/core';
import api from '../../api/client.js';
import PublicFormEmbed from '../../frontend/components/PublicFormEmbed.jsx';
import { ColorField, FieldGroup, SelectField, TextField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

export default function FormEmbed({ formSlug, textColor, maxWidth }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('form');

  return (
    <div ref={ref} id={domId} className={cx('bx-form-embed', customClass)} style={cssVars({ maxWidth })}>
      {!formSlug ? (
        <div className="bx-editor-note">Choose a form in the settings panel</div>
      ) : editing ? (
        // Rendering the real form in the canvas means a stray click could
        // submit a fake entry, so show a labelled stand-in while editing.
        // This is decided from the editor's own state, never by sniffing the URL.
        <div className="bx-editor-note">
          <i className="fa-solid fa-list-check" /> Form <strong>{formSlug}</strong> renders here on the live page.
        </div>
      ) : (
        <PublicFormEmbed formSlug={formSlug} textColor={textColor || undefined} />
      )}
    </div>
  );
}

function FormSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  const [forms, setForms] = useState([]);

  useEffect(() => {
    api.get('/forms').then(({ data }) => setForms(Array.isArray(data) ? data : [])).catch(() => setForms([]));
  }, []);

  return (
    <>
      <FieldGroup title="Form">
        <SelectField
          label="Which form"
          value={props.formSlug}
          onChange={p('formSlug')}
          options={[{ value: '', label: 'Choose a form…' }].concat(
            forms.map((form) => ({ value: form.slug, label: form.name || form.slug })),
          )}
          hint="Build and manage forms in Admin → Forms."
        />
      </FieldGroup>
      <FieldGroup title="Style">
        <ColorField label="Text colour" value={props.textColor} onChange={p('textColor')} />
        <TextField label="Max width" value={props.maxWidth} onChange={p('maxWidth')} placeholder="560px" />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

FormEmbed.craft = {
  displayName: 'Form',
  props: { ...IDENTITY_DEFAULTS, formSlug: '', textColor: '', maxWidth: '' },
  related: { settings: FormSettings },
};
