'use strict';
/*
 * Database access for the whole portal: PostgreSQL, everywhere.
 *
 *   Local school PC  ->  DATABASE_URL=postgres://nnss_user:pass@127.0.0.1:5432/nnss_calabar
 *   Supabase online  ->  DATABASE_URL=<Supabase "Transaction pooler" connection string>
 *
 * Nothing else changes between the two: the same code, the same schema
 * (database/postgres/schema.sql). Pick the database by changing DATABASE_URL.
 *
 * The routes were written against mysql2's call shape, so this adapter keeps it:
 *   const [rows]   = await db.query('SELECT ... WHERE id = ?', [id]);
 *   const [result] = await db.query('INSERT ...', [...]);   // result.insertId, result.affectedRows
 *   const conn = await db.getConnection(); await conn.beginTransaction(); ... conn.release();
 * "?" placeholders become $1, $2 ...; an array value expands for IN (?) and
 * an array of arrays expands for bulk "VALUES ?".
 */
require('dotenv').config();
const { Pool, types } = require('pg');

// COUNT()/SUM() come back as bigint; the API has always returned them as numbers.
types.setTypeParser(20, v => (v === null ? null : Number(v)));

const onVercel = !!process.env.VERCEL;

function connectionConfig() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    // Convenience: build the URL from the old-style DB_* settings.
    const { DB_HOST = '127.0.0.1', DB_PORT = '5432', DB_USER, DB_PASSWORD = '', DB_NAME } = process.env;
    if (!DB_USER || !DB_NAME) {
      throw new Error('DATABASE_URL is not set. See CONFIGURATION.md (database section).');
    }
    url = `postgres://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  }

  const u = new URL(url);
  const host = u.hostname;
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|\[::1\]$)/.test(host) || !host.includes('.');

  // SSL: DATABASE_SSL=true|false overrides; otherwise on for any remote host
  // (Supabase) and off for localhost / private network (a school PC).
  const sslEnv = (process.env.DATABASE_SSL || '').toLowerCase();
  const wantSsl = sslEnv ? ['true', '1', 'require', 'verify'].includes(sslEnv) : !isLocal;
  u.searchParams.delete('sslmode');
  u.searchParams.delete('supa');

  const cfg = { connectionString: u.toString() };
  if (wantSsl) {
    cfg.ssl = process.env.DATABASE_SSL_CA
      ? { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
      : { rejectUnauthorized: sslEnv === 'verify' };
  }
  return cfg;
}

const defaultPool = onVercel ? 3 : 10;
const pool = new Pool({
  ...connectionConfig(),
  max: Number(process.env.DB_POOL_SIZE || defaultPool),
  idleTimeoutMillis: onVercel ? 10000 : 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
  application_name: 'nnss-portal'
});
// An idle connection dropped by the server must not crash the process.
pool.on('error', err => console.error('[db] idle client error:', err.message));

// Tables that have no "id" column, so an INSERT must not ask for RETURNING id.
const NO_ID_TABLES = new Set(['teacher_subjects']);

function toParam(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date || Buffer.isBuffer(v)) return v;
  return JSON.stringify(v); // objects are never expanded into SQL
}

/** Convert mysql-style "?" SQL + params into pg "$n" SQL + flat params. */
function prepare(sql, params = []) {
  const out = [];
  const values = [];
  let i = 0;
  let p = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      out.push(sql.slice(i, j + 1));
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? sql.length : j;
      out.push(sql.slice(i, end));
      i = end;
    } else if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j === -1 ? sql.length : j + 2;
      out.push(sql.slice(i, end));
      i = end;
    } else if (c === '?') {
      if (p >= params.length) throw new Error('[db] more "?" placeholders than parameters');
      const v = params[p++];
      if (Array.isArray(v)) {
        if (v.length === 0) {
          out.push('NULL');
        } else if (v.every(Array.isArray)) {
          out.push(v.map(row => '(' + row.map(x => { values.push(toParam(x)); return '$' + values.length; }).join(', ') + ')').join(', '));
        } else {
          out.push(v.map(x => { values.push(toParam(x)); return '$' + values.length; }).join(', '));
        }
      } else {
        values.push(toParam(v));
        out.push('$' + values.length);
      }
      i++;
    } else {
      out.push(c);
      i++;
    }
  }
  if (p !== params.length) throw new Error('[db] more parameters than "?" placeholders');
  return { text: out.join(''), values };
}

function withReturning(text) {
  if (!/^\s*insert\s+into\s/i.test(text) || /\breturning\b/i.test(text)) return { text, returning: false };
  const m = /^\s*insert\s+into\s+("?)([\w.]+)\1/i.exec(text);
  if (!m || NO_ID_TABLES.has(m[2].toLowerCase().replace(/^public\./, ''))) return { text, returning: false };
  return { text: text.replace(/;?\s*$/, '') + ' RETURNING id', returning: true };
}

function mapError(err) {
  if (!err || !err.code) return err;
  const detail = err.detail || err.message;
  if (err.code === '23505') { err.code = 'ER_DUP_ENTRY'; err.errno = 1062; err.sqlMessage = detail; }
  else if (err.code === '23503') {
    const referenced = /is still referenced/i.test(detail || '');
    err.code = referenced ? 'ER_ROW_IS_REFERENCED_2' : 'ER_NO_REFERENCED_ROW_2';
    err.errno = referenced ? 1451 : 1452;
    err.sqlMessage = detail;
  } else if (err.code === '23514') { err.code = 'ER_CHECK_CONSTRAINT_VIOLATED'; err.errno = 3819; err.sqlMessage = detail; }
  return err;
}

async function run(client, sql, params) {
  const prepared = prepare(sql, params);
  const { text, returning } = withReturning(prepared.text);
  let res;
  try {
    res = await client.query(text, prepared.values);
  } catch (err) {
    throw mapError(err);
  }
  if (res.command === 'SELECT' || (res.rows && res.rows.length && !returning && res.command !== 'INSERT')) {
    return [res.rows, res.fields];
  }
  const header = {
    affectedRows: res.rowCount || 0,
    changedRows: res.rowCount || 0,
    insertId: returning && res.rows[0] ? res.rows[0].id : 0,
    warningStatus: 0
  };
  return [header, undefined];
}

function wrap(client, release) {
  return {
    query: (sql, params) => run(client, sql, params),
    execute: (sql, params) => run(client, sql, params),
    beginTransaction: () => client.query('BEGIN'),
    commit: () => client.query('COMMIT'),
    rollback: () => client.query('ROLLBACK'),
    release: release || (() => {})
  };
}

const db = {
  dialect: 'postgres',
  query: (sql, params) => run(pool, sql, params),
  execute: (sql, params) => run(pool, sql, params),
  async getConnection() {
    const client = await pool.connect();
    let released = false;
    return wrap(client, () => { if (!released) { released = true; client.release(); } });
  },
  /** Run fn(conn) inside a transaction; commits on success, rolls back on error. */
  async transaction(fn) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      try { await conn.rollback(); } catch { /* connection already gone */ }
      throw err;
    } finally {
      conn.release();
    }
  },
  end: () => pool.end(),
  pool
};

module.exports = db;
