/*
 * Applies the migrations for one engine, in name order, then exits.
 *
 *   ENGINE=mysql DATABASE_URL=mysql://... npm run db:migrate
 *   ENGINE=postgres DATABASE_URL=postgres://... npm run db:migrate
 *
 * A host with its own migration tooling should use that instead and point it
 * at `migrations/<engine>/`. This exists so the module can be stood up in one
 * command, and so the MySQL statement-splitting is done correctly somewhere
 * rather than reinvented by whoever integrates it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSqlStatements } from './split-sql.js';

const engine = process.env.ENGINE === 'mysql' ? 'mysql' : 'postgres';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const dir = join(import.meta.dirname, '..', 'migrations', engine);
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

async function run(): Promise<void> {
  if (engine === 'mysql') {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({ uri: url, timezone: 'Z' });
    try {
      for (const file of files) {
        process.stdout.write(`applying mysql/${file} ... `);
        for (const statement of splitSqlStatements(readFileSync(join(dir, file), 'utf8'))) {
          await connection.query(statement);
        }
        console.log('ok');
      }
    } finally {
      await connection.end();
    }
    return;
  }

  // `pg` is CommonJS: under ESM the named export is not bound.
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: url });
  try {
    for (const file of files) {
      process.stdout.write(`applying postgres/${file} ... `);
      await pool.query(readFileSync(join(dir, file), 'utf8'));
      console.log('ok');
    }
  } finally {
    await pool.end();
  }
}

try {
  await run();
  console.log(`\n${files.length} migration file(s) applied to ${engine}.`);
} catch (error) {
  console.error('\nfailed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
