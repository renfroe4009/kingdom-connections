// =============================================================================
// reportQuery.js — builds and runs a safe, parameterized SQL query from a
// report definition (module + columns + filters + sort), for the Report
// Builder feature.
//
// Safety model: every table/column/join fragment comes from reportRegistry.js
// (a fixed allow-list authored by us), never from the request. Only filter
// *values* and pagination numbers flow from user input, and those always go
// through named placeholders — never string-concatenated into the SQL.
// =============================================================================
const { db } = require('../db');
const { getModule } = require('./reportRegistry');

const MAX_ROWS = 5000; // hard ceiling regardless of requested limit

function buildFilterClause(mod, filter, params, idx) {
  const col = mod.columns[filter.field];
  if (!col) throw Object.assign(new Error(`Unknown field: ${filter.field}`), { status: 400 });
  const key = `f${idx}`;
  const sql = col.sql;

  switch (filter.operator) {
    case 'equals':        params[key] = filter.value; return `${sql} = :${key}`;
    case 'not_equals':    params[key] = filter.value; return `${sql} != :${key}`;
    case 'contains':      params[key] = `%${filter.value}%`; return `${sql} LIKE :${key}`;
    case 'not_contains':  params[key] = `%${filter.value}%`; return `${sql} NOT LIKE :${key}`;
    case 'greater_than':  params[key] = filter.value; return `${sql} > :${key}`;
    case 'less_than':     params[key] = filter.value; return `${sql} < :${key}`;
    case 'after':         params[key] = filter.value; return `${sql} > :${key}`;
    case 'before':        params[key] = filter.value; return `${sql} < :${key}`;
    case 'between': {
      const fromKey = `${key}_from`, toKey = `${key}_to`;
      params[fromKey] = filter.value?.[0];
      params[toKey]   = filter.value?.[1];
      return `${sql} BETWEEN :${fromKey} AND :${toKey}`;
    }
    case 'is_empty':      return `(${sql} IS NULL OR ${sql} = '')`;
    case 'is_not_empty':  return `(${sql} IS NOT NULL AND ${sql} != '')`;
    default:
      throw Object.assign(new Error(`Unknown filter operator: ${filter.operator}`), { status: 400 });
  }
}

// definition = { module, columns: [key,...], filters: [{field,operator,value}], sort: {field,dir}, limit, offset }
async function runReport(definition, user, { format } = {}) {
  const mod = getModule(definition.module);
  const columns = (definition.columns?.length ? definition.columns : mod.defaultColumns)
    .filter((key) => mod.columns[key]);
  if (!columns.length) throw Object.assign(new Error('No valid columns selected'), { status: 400 });

  const selectSql = columns.map((key) => `${mod.columns[key].sql} AS \`${key}\``).join(', ');
  const joinSql = (mod.joins || []).map((j) => `LEFT JOIN ${j.table} ${j.alias} ON ${j.on}`).join(' ');

  const params = {};
  const where = [];

  const { resolveOwnerScope } = require('./scope');
  const scopeIds = await resolveOwnerScope(user);
  const scopeClause = mod.scope(scopeIds);
  if (scopeClause) where.push(scopeClause);

  (definition.filters || []).forEach((filter, idx) => {
    where.push(buildFilterClause(mod, filter, params, idx));
  });

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortField = definition.sort?.field && mod.columns[definition.sort.field]
    ? definition.sort.field
    : mod.defaultSort.field;
  const sortDir = definition.sort?.dir === 'asc' ? 'ASC' : 'DESC';
  const sortSql = `ORDER BY ${mod.columns[sortField].sql} ${sortDir}`;

  params.limit  = format === 'csv'
    ? MAX_ROWS
    : Math.min(Number(definition.limit) || 100, 500);
  params.offset = Math.max(Number(definition.offset) || 0, 0);

  const [rows] = await db.query(
    `SELECT ${selectSql} FROM ${mod.table} ${mod.alias} ${joinSql} ${whereSql} ${sortSql} LIMIT :limit OFFSET :offset`,
    params,
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM ${mod.table} ${mod.alias} ${joinSql} ${whereSql}`,
    params,
  );

  return { rows, total: Number(total), columns };
}

module.exports = { runReport };
