/**
 * Building a store for each engine.
 *
 * Two four-line functions. They exist so a host writes
 * `mysqlStore({ db })` rather than assembling a dialect, a table set and a
 * generic factory by hand — and so the pairing of schema to dialect is made
 * in one place rather than by whoever is wiring it up. Crossing them (the
 * MySQL tables with the Postgres dialect) compiles perfectly and fails at
 * the first upsert.
 */
import { drizzleStore, type LmsTables } from './drizzle.js';
import { mysqlDialect, postgresDialect } from './dialect.js';
import * as pg from '../schema/pg.js';
import * as mysql from '../schema/mysql.js';
import type { Store } from '../store.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const pgTables: LmsTables = {
  cohorts: pg.cohorts,
  cohortMembers: pg.cohortMembers,
  courses: pg.courses,
  cohortCourses: pg.cohortCourses,
  modules: pg.modules,
  lessons: pg.lessons,
  lessonAttachments: pg.lessonAttachments,
  lessonProgress: pg.lessonProgress,
  quizzes: pg.quizzes,
  quizQuestions: pg.quizQuestions,
  quizOptions: pg.quizOptions,
  quizAttempts: pg.quizAttempts,
};

const mysqlTables: LmsTables = {
  cohorts: mysql.cohorts,
  cohortMembers: mysql.cohortMembers,
  courses: mysql.courses,
  cohortCourses: mysql.cohortCourses,
  modules: mysql.modules,
  lessons: mysql.lessons,
  lessonAttachments: mysql.lessonAttachments,
  lessonProgress: mysql.lessonProgress,
  quizzes: mysql.quizzes,
  quizQuestions: mysql.quizQuestions,
  quizOptions: mysql.quizOptions,
  quizAttempts: mysql.quizAttempts,
};

/** A store over a Drizzle **PostgreSQL** handle. */
export function postgresStore(input: { db: any; newId?: () => string }): Store {
  return drizzleStore({ db: input.db, tables: pgTables, dialect: postgresDialect, newId: input.newId });
}

/**
 * A store over a Drizzle **MySQL** handle.
 *
 * The connection must be in UTC — `timezone: 'Z'` for mysql2. MySQL's
 * `TIMESTAMP` converts to and from the session's zone, so a connection in
 * any other zone reads back a different instant than it wrote, and a course
 * release date would open hours early or late with nothing to show why.
 */
export function mysqlStore(input: { db: any; newId?: () => string }): Store {
  return drizzleStore({ db: input.db, tables: mysqlTables, dialect: mysqlDialect, newId: input.newId });
}
