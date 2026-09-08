import { useState } from 'react';
import { useNode } from '@craftjs/core';
import { FieldGroup, RepeaterField, TextField, TextareaField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useNodeRef } from './nodeUtils.js';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';

export default function Tabs({ items }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('tabs');
  const list = Array.isArray(items) ? items : [];
  const [active, setActive] = useState(0);
  const current = list[Math.min(active, list.length - 1)];

  return (
    <div ref={ref} id={domId} className={cx('bx-tabs', customClass)}>
      <div className="bx-tabs__list" role="tablist">
        {list.map((item, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            className="bx-tabs__tab"
            aria-selected={index === Math.min(active, list.length - 1)}
            onClick={() => setActive(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {current ? (
        <div className="bx-tabs__panel bx-text" role="tabpanel" dangerouslySetInnerHTML={{ __html: sanitizeHtml(current.content || '') }} />
      ) : (
        <div className="bx-editor-note">Add tabs in the settings panel</div>
      )}
    </div>
  );
}

function TabsSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Tabs">
        <RepeaterField
          value={props.items}
          onChange={p('items')}
          addLabel="Add tab"
          itemLabel={(item) => item.label}
          newItem={{ label: 'New tab', content: '<p>Tab content.</p>' }}
          renderItem={(item, patch) => (
            <>
              <TextField label="Label" value={item.label} onChange={(v) => patch({ label: v })} />
              <TextareaField label="Content" value={item.content} onChange={(v) => patch({ content: v })} rows={5} />
            </>
          )}
        />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Tabs.craft = {
  displayName: 'Tabs',
  props: {
    ...IDENTITY_DEFAULTS,
    items: [
      { label: 'First tab', content: '<p>Replace this with your content.</p>' },
      { label: 'Second tab', content: '<p>Replace this with your content.</p>' },
    ],
  },
  related: { settings: TabsSettings },
};
