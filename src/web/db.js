/**
 * PostgreSQL Database Connection
 * Uses DATABASE_URL from environment (provided by Railway).
 * Falls back to JSON files when DATABASE_URL is not set (local dev).
 */

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000
  });

  pool.on('error', (err) => {
    console.error('[DB] Pool error:', err.message);
  });

  return pool;
}

/**
 * Run a query. Returns { rows, rowCount }.
 */
async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not configured');
  return p.query(text, params);
}

/**
 * Check if database is available and tables exist.
 */
async function isReady() {
  try {
    const p = getPool();
    if (!p) return false;
    const result = await p.query("SELECT to_regclass('public.projects') AS t");
    return result.rows[0].t !== null;
  } catch {
    return false;
  }
}

module.exports = { getPool, query, isReady };
