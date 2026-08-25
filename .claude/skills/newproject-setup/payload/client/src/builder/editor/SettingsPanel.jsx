// Renders the selected node's own settings component (`node.related.settings`).
// Nodes describe their own controls, so this panel never needs to know what
// exists — adding a component adds its settings automatically.

import { useEditor } from '@craftjs/core';

export default function SettingsPanel() {
  const { selected, actions } = useEditor((state, query) => {
    const [id] = state.events.selected;
    if (!id || !state.nodes[id]) return {};
    const node = state.nodes[id];

    // The ancestor path, outermost first. Nested layout is the norm here
    // (Section › Row › Column › widget) and children cover their parents
    // completely, so without an explicit path there is no way to click your
    // way back out to the Row or Column.
    // `ancestors(true)` — the shallow form stops short, so the Section and the
    // page root would be missing from the path.
    const trail = query
      .node(id)
      .ancestors(true)
      .map((ancestorId) => state.nodes[ancestorId])
      .filter(Boolean)
      .map((ancestor) => ({
        id: ancestor.id,
        name: ancestor.data.custom?.displayName || ancestor.data.displayName,
      }))
      .reverse();

    return {
      selected: {
        id,
        name: node.data.custom?.displayName || node.data.displayName,
        settings: node.related && node.related.settings,
        isDeletable: query.node(id).isDeletable(),
        trail,
      },
    };
  });

  if (!selected) {
    return (
      <div className="bx-panel__empty">
        <i className="fa-solid fa-arrow-pointer" />
        <p>Select something on the page to edit it.</p>
      </div>
    );
  }

  const Settings = selected.settings;

  return (
    <div className="bx-settings">
      <header className="bx-settings__head">
        <span>{selected.name}</span>
        {selected.isDeletable && (
          <button type="button" title="Delete" onClick={() => actions.delete(selected.id)}>
            <i className="fa-solid fa-trash" />
          </button>
        )}
      </header>

      {selected.trail.length > 0 && (
        <nav className="bx-crumbs" aria-label="Selected block location">
          {selected.trail.map((ancestor) => (
            <button
              key={ancestor.id}
              type="button"
              className="bx-crumbs__link"
              title={`Select the ${ancestor.name}`}
              onClick={() => actions.selectNode(ancestor.id)}
            >
              {ancestor.name}
            </button>
          ))}
          <span className="bx-crumbs__current">{selected.name}</span>
        </nav>
      )}

      <div className="bx-settings__body">
        {Settings ? <Settings /> : <p className="bx-panel__empty">This block has no settings.</p>}
      </div>
    </div>
  );
}
