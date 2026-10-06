/**
 * Where PostgreSQL and MySQL actually differ, and nowhere else.
 *
 * Five operations. Everything else in `./drizzle.ts` is written once and
 * works on both, because Drizzle's two query builders agree on the parts this
 * module uses. These five do not agree, and each one is a correctness trap
 * rather than a style difference:
 *
 * 1. **Upsert.** `on conflict do update` against `on duplicate key update`.
 * 2. **Case-insensitive search.** `ilike` against `like` — MySQL's default
 *    collations already fold case, so `ilike` does not exist there.
 * 3. **JSON containment.** `@>` against `json_contains()`.
 * 4. **Unnesting a JSON array.** `jsonb_array_elements_text()` against
 *    `json_table()`.
 * 5. **Counting as an integer.** `count(*)::int` against
 *    `cast(count(*) as signed)`.
 *
 * Deliberately not in here: generating ids, and reading one back after an
 * insert. Postgres could do both in the database and MySQL cannot — MySQL
 * has no `RETURNING` — so rather than two code paths, ids are minted in the
 * application for both. That is why `Store.newId()` exists and why no insert
 * returns anything.
 */
import { ilike, like, sql, type SQL } from 'drizzle-orm';
import type { AnyColumn, Table } from 'drizzle-orm';

export type DialectName = 'postgres' | 'mysql';

export type Dialect = {
  name: DialectName;

  /**
   * A case-insensitive `LIKE`.
   *
   * On MySQL this is a plain `LIKE`, which folds case only because the
   * column's collation does. A host that has set a binary or `_bin`
   * collation gets case-sensitive search, and will wonder why — so it is
   * said here, in the README, and in the MySQL schema.
   */
  caseInsensitiveLike(column: AnyColumn, pattern: string): SQL;

  /** Whether a JSON array column contains this exact string element. */
  jsonArrayContains(column: AnyColumn, value: string): SQL;

  /**
   * Counts how often each element appears across a JSON array column.
   *
   * Returned as a complete statement rather than a fragment because the two
   * dialects unnest in structurally different ways — a lateral set-returning
   * function against a derived table — and pretending otherwise would mean
   * a fragment that only slots into one of them.
   */
  countJsonElements(table: Table, column: AnyColumn, where: SQL): SQL;

  /** `count(*)` as a number rather than a string or a bigint. */
  countInt(): SQL<number>;

  /** `greatest(column, value)`, for a counter that must never go down. */
  greatest(column: AnyColumn, value: number): SQL;
};

const COUNT_PG = sql<number>`count(*)::int`;
const COUNT_MY = sql<number>`cast(count(*) as signed)`;

export const postgresDialect: Dialect = {
  name: 'postgres',
  caseInsensitiveLike: (column, pattern) => ilike(column, pattern) as SQL,
  jsonArrayContains: (column, value) => sql`${column} @> ${JSON.stringify([value])}::jsonb`,
  countJsonElements: (table, column, where) => sql`
    select element as value, ${COUNT_PG} as count
    from ${table}, jsonb_array_elements_text(${column}) as element
    where ${where}
    group by element
    order by count desc, element asc
    limit 40
  `,
  countInt: () => COUNT_PG,
  greatest: (column, value) => sql`greatest(${column}, ${value})`,
};

export const mysqlDialect: Dialect = {
  name: 'mysql',
  caseInsensitiveLike: (column, pattern) => like(column, pattern) as SQL,
  /*
   * The value is passed as a JSON scalar, which is what `json_contains`
   * expects for an element test. Interpolating it bare would compare the
   * array against a string and quietly match nothing.
   */
  jsonArrayContains: (column, value) => sql`json_contains(${column}, ${JSON.stringify(value)})`,
  /*
   * `json_table` needs MySQL 8.0.4+ or MariaDB 10.6+. Older MySQL has no
   * way to unnest a JSON array in SQL at all, so a host on 5.7 has to drop
   * the topic facet rather than work around it — said here because the
   * failure is a syntax error in a filter control, a long way from anything
   * that looks like a version problem.
   */
  countJsonElements: (table, column, where) => sql`
    select j.value as value, ${COUNT_MY} as count
    from ${table}, json_table(${column}, '$[*]' columns (value varchar(191) path '$')) as j
    where ${where}
    group by j.value
    order by count desc, value asc
    limit 40
  `,
  countInt: () => COUNT_MY,
  greatest: (column, value) => sql`greatest(${column}, ${value})`,
};

export function dialectFor(name: DialectName): Dialect {
  return name === 'mysql' ? mysqlDialect : postgresDialect;
}

