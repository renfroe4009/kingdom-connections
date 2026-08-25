// Wraps every node on the canvas with its selection state and floating
// toolbar. Passed to <Editor onRender>, so one implementation serves all nodes.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, useNode } from '@craftjs/core';

export default function RenderNode({ render }) {
  const { id } = useNode();
  const { actions, query, isActive } = useEditor((state, editorQuery) => ({
    isActive: editorQuery.getEvent('selected').contains(id),
  }));

  const {
    isHovered,
    dom,
    name,
    moveable,
    deletable,
    connectors: { drag },
    parent,
  } = useNode((node) => ({
    isHovered: node.events.hovered,
    dom: node.dom,
    name: node.data.custom?.displayName || node.data.displayName,
    moveable: query.node(node.id).isDraggable(),
    deletable: query.node(node.id).isDeletable(),
    parent: node.data.parent,
  }));

  // The outline is a data attribute rather than an inline style so the canvas
  // stylesheet owns the look, and so it never fights a component's own styles.
  useEffect(() => {
    if (!dom) return;
    dom.dataset.bxSelected = isActive ? 'true' : 'false';
    dom.dataset.bxHovered = isHovered ? 'true' : 'false';
  }, [dom, isActive, isHovered]);

  const showToolbar = isActive && dom;

  return (
    <>
      {showToolbar &&
        createPortal(
          <NodeToolbar
            dom={dom}
            name={name}
            canDrag={moveable}
            canDelete={deletable}
            dragRef={drag}
            onSelectParent={() => parent && actions.selectNode(parent)}
            onDuplicate={() => {
              const parentId = query.node(id).get().data.parent;
              if (!parentId) return;
              const index = query.node(parentId).get().data.nodes.indexOf(id);
              const copy = cloneTree(query, query.node(id).toNodeTree());
              // Land the copy directly after the original, which is where
              // people expect a duplicate to appear.
              actions.addNodeTree(copy, parentId, index + 1);
            }}
            onDelete={() => actions.delete(id)}
          />,
          dom.ownerDocument.body,
        )}
      {render}
    </>
  );
}

/**
 * Deep-copy a node tree with fresh ids. Craft's `query.node().toNodeTree()`
 * keeps the original ids, and re-adding those would collide with the node
 * already on the canvas.
 */
function cloneTree(query, tree) {
  const nodes = {};

  // parseFreshNode mints the id, so Craft stays the authority on id format and
  // uniqueness rather than us inventing one.
  const build = (oldId, parentId) => {
    const source = tree.nodes[oldId];
    const node = query
      .parseFreshNode({ data: { ...source.data, parent: parentId, nodes: [], linkedNodes: {} } })
      .toNode();
    nodes[node.id] = node;
    node.data.nodes = (source.data.nodes || []).map((child) => build(child, node.id));
    node.data.linkedNodes = Object.fromEntries(
      Object.entries(source.data.linkedNodes || {}).map(([key, child]) => [key, build(child, node.id)]),
    );
    return node.id;
  };

  return { rootNodeId: build(tree.rootNodeId, null), nodes };
}

/**
 * A fixed-position toolbar tracking the node's box. It's portaled into the
 * canvas document's body so no ancestor's overflow can clip it.
 */
function NodeToolbar({ dom, name, canDrag, canDelete, dragRef, onSelectParent, onDuplicate, onDelete }) {
  const [box, setBox] = useState(null);
  const frame = useRef(0);

  const measure = useCallback(() => {
    if (!dom) return;
    const rect = dom.getBoundingClientRect();
    setBox({ top: rect.top, left: rect.left, width: rect.width });
  }, [dom]);

  useLayoutEffect(() => {
    measure();
    const doc = dom?.ownerDocument;
    const win = doc?.defaultView;
    if (!win) return undefined;

    const schedule = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    win.addEventListener('scroll', schedule, true);
    win.addEventListener('resize', schedule);
    const observer = new win.ResizeObserver(schedule);
    observer.observe(dom);
    return () => {
      cancelAnimationFrame(frame.current);
      win.removeEventListener('scroll', schedule, true);
      win.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [dom, measure]);

  if (!box) return null;

  // Sit above the block, unless it's at the very top of the viewport — then
  // drop inside it so the toolbar never scrolls out of reach.
  const above = box.top > 34;

  return (
    <div
      className="bx-node-toolbar"
      style={{
        position: 'fixed',
        top: above ? box.top - 30 : box.top + 2,
        left: Math.max(4, box.left),
        zIndex: 100000,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="bx-node-toolbar__name">{name}</span>
      {canDrag && (
        <button type="button" ref={dragRef} title="Drag to move" className="bx-node-toolbar__btn">
          <i className="fa-solid fa-up-down-left-right" />
        </button>
      )}
      <button type="button" title="Select parent" className="bx-node-toolbar__btn" onClick={onSelectParent}>
        <i className="fa-solid fa-turn-up" />
      </button>
      <button type="button" title="Duplicate" className="bx-node-toolbar__btn" onClick={onDuplicate}>
        <i className="fa-solid fa-clone" />
      </button>
      {canDelete && (
        <button type="button" title="Delete" className="bx-node-toolbar__btn bx-node-toolbar__btn--danger" onClick={onDelete}>
          <i className="fa-solid fa-trash" />
        </button>
      )}
    </div>
  );
}
