// The block palette.
//
// Two ways to add a block, because one is not enough:
//   • drag a tile onto the canvas — Craft's `create` connector, which works
//     into the canvas iframe (its drop targets bind their own dragover
//     handlers, and the commit happens on dragend at the source).
//   • click a tile — inserts next to whatever is selected. HTML5 drag doesn't
//     exist on touch devices at all, and "click to add" is faster than
//     dragging when you already know where the block goes.

import { useMemo, useState } from 'react';
import { useEditor } from '@craftjs/core';
import { TOOLBOX } from '../nodes/index.jsx';

/**
 * Can `parentId` accept this tree? Mirrors the node's own `canMoveIn` rule, so
 * click-insert obeys exactly the same constraints as dropping — a Heading
 * can't land directly in a Row any more than it could by dragging.
 */
function canAccept(query, parentId, tree) {
  try {
    const parent = query.node(parentId).get();
    if (!parent.data.isCanvas) return false;
    const rule = parent.rules?.canMoveIn;
    if (typeof rule !== 'function') return true;
    return rule([tree.nodes[tree.rootNodeId]], parent, { node: (id) => query.node(id) });
  } catch {
    return false;
  }
}

/**
 * Where should a clicked block go? Start at the selection and walk up until we
 * find a container that will take it, falling back to the page root.
 */
function findInsertPoint(query, selectedId, tree) {
  const rootId = query.getState().nodes.ROOT ? 'ROOT' : Object.keys(query.getState().nodes)[0];
  let current = selectedId;

  while (current) {
    const node = query.node(current).get();
    // Drop inside the selected container, at the end.
    if (canAccept(query, current, tree)) {
      return { parentId: current, index: node.data.nodes.length };
    }
    // Otherwise try its parent, placing the new block right after it.
    const parentId = node.data.parent;
    if (parentId && canAccept(query, parentId, tree)) {
      const siblings = query.node(parentId).get().data.nodes;
      return { parentId, index: siblings.indexOf(current) + 1 };
    }
    current = parentId;
  }

  const root = query.node(rootId).get();
  return { parentId: rootId, index: root.data.nodes.length };
}

export default function Toolbox() {
  const { connectors, actions, query, selectedId } = useEditor((state) => ({
    selectedId: state.events.selected.values().next().value,
  }));
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return TOOLBOX;
    return TOOLBOX.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(term)),
    })).filter((group) => group.items.length);
  }, [search]);

  function insert(item) {
    const tree = query.parseReactElement(item.element).toNodeTree();
    const { parentId, index } = findInsertPoint(query, selectedId, tree);
    actions.addNodeTree(tree, parentId, index);
    actions.selectNode(tree.rootNodeId);
  }

  return (
    <div className="bx-toolbox">
      <div className="bx-toolbox__search">
        <i className="fa-solid fa-magnifying-glass" />
        <input value={search} placeholder="Search blocks…" onChange={(e) => setSearch(e.target.value)} />
      </div>

      <p className="bx-toolbox__tip">Drag onto the page, or click to add it below your selection.</p>

      {groups.map((group) => (
        <section className="bx-toolbox__group" key={group.category}>
          <h4>{group.category}</h4>
          <div className="bx-toolbox__grid">
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                ref={(dom) => dom && connectors.create(dom, item.element)}
                className="bx-toolbox__tile"
                title={item.hint || item.label}
                onClick={() => insert(item)}
              >
                <i className={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {!groups.length && <p className="bx-panel__empty">No blocks match “{search}”.</p>}
    </div>
  );
}
