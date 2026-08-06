// =============================================================================
// /api/tasks
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { resolveOwnerScope, taskClause } = require('../services/scope');
const { createTaskEvent, updateTaskEvent, deleteTaskEvent } = require('../services/google');

router.use(requireAuth);

router.get('/', requirePermission('tasks.read'), async (req, res, next) => {
  try {
    const { status, assigned_to, entity_type, entity_id, due } = req.query;
    const where = ['1=1']; const params = {};

    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = taskClause(scopeIds);
    if (scopeClause) where.push(scopeClause);

    if (status)      { where.push('t.status = :status'); params.status = status; }
    if (assigned_to) { where.push('t.assigned_to = :aid'); params.aid = assigned_to; }
    if (entity_type) { where.push('t.entity_type = :et');  params.et = entity_type; }
    if (entity_id)   { where.push('t.entity_id = :eid');   params.eid = entity_id; }
    if (due === 'today')      where.push('DATE(t.due_date) = CURDATE()');
    if (due === 'overdue')    where.push('t.due_date < NOW() AND t.status != "completed"');
    if (due === 'this_week')  where.push('YEARWEEK(t.due_date, 1) = YEARWEEK(CURDATE(), 1)');

    const [rows] = await db.query(
      `SELECT t.*, CONCAT_WS(' ', u.first_name, u.last_name) AS assignee_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
        WHERE ${where.join(' AND ')}
        ORDER BY t.created_at DESC, t.due_date ASC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  title:            z.string().min(1),
  description:      z.string().optional().nullable(),
  due_date:         z.string().optional().nullable(),
  priority:         z.enum(['low','normal','high','urgent']).optional(),
  status:           z.enum(['open','in_progress','completed','cancelled']).optional(),
  assigned_to:      z.number().int().nullable().optional(),
  entity_type:      z.enum(['contact','organization','deal']).nullable().optional(),
  entity_id:        z.number().int().nullable().optional(),
  sync_to_calendar: z.boolean().optional(),
});

router.post('/', requirePermission('tasks.write'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO tasks (title, description, due_date, priority, status, assigned_to, created_by,
                          entity_type, entity_id, sync_to_calendar)
       VALUES (:title, :description, :due_date, :priority, :status, :assigned_to, :created_by,
               :entity_type, :entity_id, :sync_to_calendar)`,
      {
        title:            d.title,
        description:      d.description ?? null,
        due_date:         d.due_date ?? null,
        priority:         d.priority ?? 'normal',
        status:           d.status   ?? 'open',
        assigned_to:      d.assigned_to ?? null,
        created_by:       req.user.id,
        entity_type:      d.entity_type ?? null,
        entity_id:        d.entity_id ?? null,
        sync_to_calendar: d.sync_to_calendar ? 1 : 0,
      }
    );
    const taskId = ins.insertId;

    // Fire-and-forget calendar sync — never fail the task save on Google errors.
    if (d.sync_to_calendar && d.due_date) {
      createTaskEvent(req.user.id, { title: d.title, description: d.description, due_date: d.due_date, status: 'open' })
        .then((eventId) => db.query(
          'UPDATE tasks SET google_calendar_event_id = :eid, google_calendar_user_id = :uid WHERE id = :id',
          { eid: eventId, uid: req.user.id, id: taskId }
        ))
        .catch((e) => console.error('[calendar] create failed:', e.message));
    }

    res.status(201).json({ id: taskId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('tasks.write'), async (req, res, next) => {
  try {
    const d  = saveSchema.partial().parse(req.body);
    const id = Number(req.params.id);
    const cols = Object.keys(d).filter((k) => k !== 'sync_to_calendar');

    // Fetch current task for calendar state.
    const [[current]] = await db.query(
      'SELECT title, description, due_date, status, sync_to_calendar, google_calendar_event_id, google_calendar_user_id FROM tasks WHERE id = :id',
      { id }
    );

    // Build and run the main UPDATE.
    const allCols = [...cols];
    if ('sync_to_calendar' in d) allCols.push('sync_to_calendar');
    if (allCols.length) {
      const set = allCols.map((k) => `${k} = :${k}`).join(', ');
      await db.query(`UPDATE tasks SET ${set} WHERE id = :id`, { ...d, id });
    }
    if (d.status === 'completed') {
      await db.query('UPDATE tasks SET completed_at = NOW() WHERE id = :id AND completed_at IS NULL', { id });
      await logActivity({ userId: req.user.id, entityType: 'task', entityId: id,
        action: 'completed', description: 'Task completed' });
    }

    // Calendar sync (fire-and-forget).
    const newSync    = 'sync_to_calendar' in d ? d.sync_to_calendar : !!current?.sync_to_calendar;
    const eventId    = current?.google_calendar_event_id;
    const calUserId  = current?.google_calendar_user_id;
    const merged     = { title: d.title ?? current?.title, description: d.description ?? current?.description,
                         due_date: d.due_date ?? current?.due_date, status: d.status ?? current?.status };

    if (newSync) {
      if (eventId && calUserId) {
        updateTaskEvent(calUserId, eventId, merged).catch((e) => console.error('[calendar] update failed:', e.message));
      } else {
        // Newly toggled on — create event.
        const uid = req.user.id;
        createTaskEvent(uid, merged)
          .then((eid) => db.query(
            'UPDATE tasks SET google_calendar_event_id = :eid, google_calendar_user_id = :uid WHERE id = :id',
            { eid, uid, id }
          ))
          .catch((e) => console.error('[calendar] create failed:', e.message));
      }
    } else if (!newSync && eventId && calUserId) {
      // Toggled off — remove from calendar.
      deleteTaskEvent(calUserId, eventId).catch((e) => console.error('[calendar] delete failed:', e.message));
      db.query('UPDATE tasks SET google_calendar_event_id = NULL, google_calendar_user_id = NULL WHERE id = :id', { id })
        .catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('tasks.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[task]] = await db.query(
      'SELECT google_calendar_event_id, google_calendar_user_id FROM tasks WHERE id = :id', { id }
    );
    if (task?.google_calendar_event_id && task?.google_calendar_user_id) {
      deleteTaskEvent(task.google_calendar_user_id, task.google_calendar_event_id)
        .catch((e) => console.error('[calendar] delete failed:', e.message));
    }
    await db.query('DELETE FROM tasks WHERE id = :id', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
