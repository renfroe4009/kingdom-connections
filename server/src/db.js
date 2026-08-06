// =============================================================================
// MySQL connection pool
// =============================================================================
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'localcrm',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  dateStrings: true,
  timezone: 'Z',
  // Force utf8mb4 for all connections so special characters (em dash, curly
  // quotes, etc.) are stored and read correctly without mojibake (â€").
  charset: 'utf8mb4',
});

async function pingDb() {
  const [rows] = await db.query('SELECT 1 AS ok');
  return rows?.[0]?.ok === 1;
}

module.exports = { db, pingDb };
