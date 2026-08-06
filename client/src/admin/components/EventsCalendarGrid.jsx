// Shared month-grid calendar — used by the dedicated Events Calendar page
// and could be reused anywhere else a month view of events is useful.
// Pure/presentational: the parent owns the visible month and the events for
// it (see EventsCalendar.jsx for the data-fetching side).
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_PER_DAY = 3;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Cells for a full 6-row grid (42 days) starting on the Sunday on/before the
// 1st of the month and ending on the Saturday on/after the last day — the
// standard "always 6 rows" month-grid layout so the grid height never jumps
// between months.
function buildGridDays(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function EventsCalendarGrid({ year, month, events, onDayClick, onEventClick }) {
  const days = buildGridDays(year, month);
  const today = new Date();

  const eventsByDay = days.map((day) =>
    events.filter((e) => {
      const s = new Date(e.start_at);
      const en = e.end_at ? new Date(e.end_at) : s;
      // Day falls within [start, end] inclusive, compared at the date level.
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const sDate = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const enDate = new Date(en.getFullYear(), en.getMonth(), en.getDate());
      return dayStart >= sDate && dayStart <= enDate;
    })
  );

  return (
    <div className="border rounded overflow-hidden">
      <div className="d-grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center small fw-semibold text-muted py-2 border-bottom bg-light">{w}</div>
        ))}
      </div>
      <div className="d-grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {days.map((day, i) => {
          const inMonth = day.getMonth() === month;
          const isToday = sameDay(day, today);
          const dayEvents = eventsByDay[i];
          return (
            <div
              key={i}
              onClick={() => onDayClick?.(day)}
              style={{ minHeight: 96, cursor: 'pointer', opacity: inMonth ? 1 : 0.45 }}
              className={`border-end border-bottom p-1 ${isToday ? 'bg-warning-subtle' : ''}`}
            >
              <div className={`small text-end ${isToday ? 'fw-bold' : 'text-muted'}`}>{day.getDate()}</div>
              {dayEvents.slice(0, MAX_VISIBLE_PER_DAY).map((e) => (
                <div
                  key={e.id}
                  onClick={(ev) => { ev.stopPropagation(); onEventClick?.(e); }}
                  className="small text-truncate rounded px-1 mb-1"
                  style={{ background: 'var(--secondary, #C9A227)', color: '#fff', cursor: 'pointer' }}
                  title={e.name}
                >
                  {e.name}
                </div>
              ))}
              {dayEvents.length > MAX_VISIBLE_PER_DAY && (
                <div className="small text-muted">+{dayEvents.length - MAX_VISIBLE_PER_DAY} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
