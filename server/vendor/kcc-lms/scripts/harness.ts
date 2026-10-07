/**
 * Shared probe plumbing, for either engine.
 *
 * `ENGINE=postgres` or `ENGINE=mysql` picks which. **The same probes run
 * against both**, and that is the whole reason the module can claim to
 * support two databases rather than to have been written for one and
 * adapted. Two schemas and two upsert spellings that drift apart fail here.
 *
 * `hostUsers` is a stand-in for the host application's own user table — the
 * one thing the module references and does not own. Creating it here rather
 * than importing one is also the check that the module really does need
 * nothing from it but an id.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { splitSqlStatements } from './split-sql.js';
import { lmsContext, type LmsContext } from '../src/context.js';
import { mysqlStore, postgresStore } from '../src/stores/index.js';
import type { Store } from '../src/store.js';
import type { LmsPorts, LmsRole, Viewer } from '../src/ports.js';

export const ENGINE: 'postgres' | 'mysql' = process.env.ENGINE === 'mysql' ? 'mysql' : 'postgres';

export let failures = 0;

export function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/** Asserts a call is refused, and refused for the right reason. */
export async function refuses(
  label: string,
  run: () => Promise<unknown>,
  expected: string = 'LmsForbidden',
): Promise<void> {
  try {
    await run();
    check(label, false, 'it was allowed');
  } catch (error) {
    const name = error instanceof Error ? error.name : String(error);
    check(label, name === expected, `threw ${name}, wanted ${expected}`);
  }
}

export function finish(name: string): never {
  console.log(
    failures === 0 ? `\nAll ${name} checks passed on ${ENGINE}.` : `\n${name} on ${ENGINE}: ${failures} FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required. See scripts/README.md.');
  process.exit(1);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let database: any;
let closeConnection: () => Promise<void>;
export let store: Store;

if (ENGINE === 'mysql') {
  const mysql2 = await import('mysql2/promise');
  const { drizzle } = await import('drizzle-orm/mysql2');
  /*
   * `timezone: 'Z'` is not optional. MySQL's TIMESTAMP converts to and from
   * the session zone, so without it every instant this probe writes comes
   * back shifted by the container's offset and the release-date checks fail
   * for a reason that looks nothing like a time zone.
   */
  const pool = mysql2.createPool({ uri: url, timezone: 'Z', supportBigNumbers: true, multipleStatements: true });
  database = drizzle(pool);
  closeConnection = () => pool.end();
  store = mysqlStore({ db: database });
} else {
  const pgModule = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new pgModule.default.Pool({ connectionString: url });
  database = drizzle(pool);
  closeConnection = () => pool.end();
  store = postgresStore({ db: database });
}

export const db = database;
export const close = closeConnection;

/** Raw rows: node-postgres wraps them in a result object, mysql2 does not. */
export async function rows<T>(statement: any): Promise<T[]> {
  const result = await db.execute(statement);
  if (Array.isArray(result)) {
    // mysql2 returns [rows, fields]; the rows are themselves an array.
    const first = (result as unknown[])[0];
    return Array.isArray(first) ? (first as T[]) : (result as T[]);
  }
  const wrapped = (result as { rows?: T[] }).rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

/**
 * Creates the host's user table and applies the module's migration.
 *
 * The host table comes first because the module's foreign keys point at it,
 * which is itself worth knowing: applying 0001 to a database with no `users`
 * table fails loudly rather than creating something half-wired.
 */
export async function setUp(): Promise<void> {
  if (ENGINE === 'mysql') {
    await db.execute(
      sql.raw(`create table if not exists users (
        id char(36) not null primary key,
        email varchar(191) not null,
        name varchar(191)
      ) engine = innodb default charset = utf8mb4`),
    );
  } else {
    await db.execute(sql.raw('create extension if not exists "pgcrypto"'));
    await db.execute(
      sql.raw(`create table if not exists users (
        id uuid primary key default gen_random_uuid(),
        email text not null,
        name text
      )`),
    );
  }

  const file = join(import.meta.dirname, '..', 'migrations', ENGINE, '0001_lms.sql');
  const migration = readFileSync(file, 'utf8');

  if (ENGINE === 'mysql') {
    // One statement at a time: see `./split-sql.ts` for why the naive split
    // this replaces silently skipped the first table.
    for (const statement of splitSqlStatements(migration)) {
      await db.execute(sql.raw(statement));
    }
  } else {
    await db.execute(sql.raw(migration));
  }
}

/** Deletes everything this probe made, by tag. Called before and after. */
export async function reset(tag: string): Promise<void> {
  const like = `${tag}-%`;
  await db.execute(sql`delete from lms_cohorts where slug like ${like}`);
  await db.execute(sql`delete from lms_courses where slug like ${like}`);
  await db.execute(sql`delete from users where email like ${like}`);
}

export async function makeUser(tag: string, label: string): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into users (id, email, name) values (${id}, ${`${tag}-${label}@example.test`}, ${label})`);
  return id;
}

/**
 * A JSON column read back from a raw query.
 *
 * Postgres's driver parses `jsonb` into an object; MySQL hands back a string
 * when the column is `longtext` underneath, which is how MariaDB spells
 * `json`. The module's own store already tolerates both — see `asRecord` in
 * `src/stores/drizzle.ts` — and a probe reading raw rows has to as well, or
 * it reports a difference between the engines that does not exist.
 */
export function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function viewerFor(id: string, role: LmsRole): Viewer {
  return { id, role };
}

export function contextFor(id: string, role: LmsRole, ports: LmsPorts = {}): LmsContext {
  return lmsContext({ store, viewer: viewerFor(id, role), ports });
}

/** A clock a probe can move, for the rules that depend on a date. */
export function fixedClock(at: Date) {
  let now = at;
  return {
    port: { now: () => now },
    set(next: Date) {
      now = next;
    },
  };
}

export { sql, randomUUID };
