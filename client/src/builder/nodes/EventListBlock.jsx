// Event listing — pulls live upcoming events from the calendar and renders
// them with the site's own .card styling, matching ProductList's split
// (this block only ever links out to /events/:slug for the actual
// ticket-type picker + add-to-cart, since an event can have an arbitrary
// number of ticket types — unlike a product's single price, there's no
// sensible inline "add to cart" affordance on a grid card).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNode } from '@craftjs/core';
import api from '../../api/client.js';
import { FieldGroup, NumberField, TextField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

function formatDateRange(startAt, endAt) {
  const start = new Date(startAt);
  const opts = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  if (!endAt) return startStr;
  const end = new Date(endAt);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) return startStr;
  return `${startStr} – ${end.toLocaleDateString('en-US', opts)}`;
}

export default function EventListBlock({ limit, columns, showDates, showLocation, emptyText }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('events');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get('/events/public/events')
      .then(({ data }) => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const visible = limit ? events.slice(0, limit) : events;

  return (
    <div
      ref={ref}
      id={domId}
      className={cx('events-grid', customClass)}
      style={{ '--card-cols': columns }}
    >
      {loading && <div className="bx-editor-note">Loading events…</div>}
      {!loading && !visible.length && <div className="bx-editor-note">{emptyText}</div>}
      {visible.map((event) => {
        // Inside the canvas a react-router <Link> would try to navigate the
        // iframe, so render a plain element while editing.
        const Wrap = editing ? 'div' : Link;
        const wrapProps = editing ? {} : { to: `/events/${event.slug}` };
        return (
          <Wrap {...wrapProps} key={event.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            {showDates && <span className="card__tag">{formatDateRange(event.start_at, event.end_at)}</span>}
            <h3>{event.name}</h3>
            {showLocation && event.location && <p>{event.location}</p>}
            {event.description && <p>{event.description}</p>}
            <span className="btn btn--outline-dark btn--sm" style={{ marginTop: 'var(--space-3)' }}>
              View &amp; Register
            </span>
          </Wrap>
        );
      })}
    </div>
  );
}

function EventListSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Events">
        <NumberField label="Maximum to show" value={props.limit} onChange={p('limit')} min={0} hint="0 shows every upcoming event." />
        <TextField label="Empty message" value={props.emptyText} onChange={p('emptyText')} />
      </FieldGroup>
      <FieldGroup title="Layout">
        <NumberField label="Columns" value={props.columns} onChange={p('columns')} min={1} max={4} />
        <ToggleField label="Show dates" value={props.showDates} onChange={p('showDates')} />
        <ToggleField label="Show location" value={props.showLocation} onChange={p('showLocation')} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

EventListBlock.craft = {
  displayName: 'Event Listing',
  props: {
    ...IDENTITY_DEFAULTS,
    limit: 6,
    columns: 3,
    showDates: true,
    showLocation: true,
    emptyText: 'No upcoming events right now — check back soon.',
  },
  related: { settings: EventListSettings },
};
