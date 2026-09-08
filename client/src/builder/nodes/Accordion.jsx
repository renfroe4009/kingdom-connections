// Accordion / FAQ. Interactive on the live site; in the editor every panel is
// forced open so users can see and edit all the copy at once.

import { useState } from 'react';
import { useNode } from '@craftjs/core';
import { FieldGroup, RepeaterField, TextField, TextareaField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';

export default function Accordion({ items, allowMultiple, openFirst }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('faq');
  const list = Array.isArray(items) ? items : [];
  const [open, setOpen] = useState(() => (openFirst ? [0] : []));

  const isOpen = (index) => editing || open.includes(index);
  const toggle = (index) => {
    if (editing) return;
    setOpen((current) => {
      if (current.includes(index)) return current.filter((i) => i !== index);
      return allowMultiple ? [...current, index] : [index];
    });
  };

  return (
    <div ref={ref} id={domId} className={cx('bx-accordion', customClass)}>
      {list.map((item, index) => (
        <div className="bx-accordion__item" key={index}>
          <button
            type="button"
            className="bx-accordion__head"
            aria-expanded={isOpen(index)}
            onClick={() => toggle(index)}
          >
            <span>{item.question}</span>
            <i className={`fa-solid fa-chevron-${isOpen(index) ? 'up' : 'down'}`} />
          </button>
          {isOpen(index) && (
            <div className="bx-accordion__body bx-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.answer || '') }} />
          )}
        </div>
      ))}
      {!list.length && <div className="bx-editor-note">Add questions in the settings panel</div>}
    </div>
  );
}

function AccordionSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Questions">
        <RepeaterField
          value={props.items}
          onChange={p('items')}
          addLabel="Add question"
          itemLabel={(item) => item.question}
          newItem={{ question: 'New question', answer: '<p>Answer goes here.</p>' }}
          renderItem={(item, patch) => (
            <>
              <TextField label="Question" value={item.question} onChange={(v) => patch({ question: v })} />
              <TextareaField label="Answer" value={item.answer} onChange={(v) => patch({ answer: v })} rows={4} />
            </>
          )}
        />
      </FieldGroup>
      <FieldGroup title="Behaviour">
        <ToggleField label="Allow several open at once" value={props.allowMultiple} onChange={p('allowMultiple')} />
        <ToggleField label="Open the first item by default" value={props.openFirst} onChange={p('openFirst')} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Accordion.craft = {
  displayName: 'Accordion / FAQ',
  props: {
    ...IDENTITY_DEFAULTS,
    items: [
      { question: 'First question', answer: '<p>Replace this with the answer.</p>' },
      { question: 'Second question', answer: '<p>Replace this with the answer.</p>' },
    ],
    allowMultiple: false,
    openFirst: true,
  },
  related: { settings: AccordionSettings },
};
