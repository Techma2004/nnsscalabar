'use strict';
/*
 * Persistent account lockout and sign-in audit trail.
 *
 * This is a SECOND layer. The in-memory IP limiters in server.js still run first;
 * this layer survives a restart and follows the account, not the address.
 *
 *   - 10 consecutive wrong passwords lock the account for 15 minutes.
 *   - A successful sign-in resets the counter.
 *   - Every attempt is written to login_attempts (best effort: a logging failure
 *     must never break or block sign-in).
 *   - A burst of failures across many accounts (credential stuffing) raises a
 *     SECURITY_ALERT row in activity_log and is shown by GET /api/admin/security-alerts.
 */
const db = require('./db');

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_SECONDS = 15 * 60;
const ALERT_WINDOW_MINUTES = 10;
const ALERT_MIN_FAILURES = 20;       // strictly more than this many failures ...
const ALERT_MIN_ACCOUNTS = 5;        // ... across at least this many distinct accounts
const RETENTION_DAYS = 90;

// True while the lock is still in force. The login query computes is_locked and
// lock_seconds in the database clock, so no JS/DB timezone mismatch can matter.
function isLocked(row) {
  return Boolean(row && Number(row.is_locked) === 1);
}

async function recordAttempt(ip, userCode, success) {
  try {
    await db.query('INSERT INTO login_attempts (ip, user_code, success) VALUES (?, ?, ?)',
      [String(ip || '').slice(0, 45), String(userCode || '').slice(0, 20), success ? 1 : 0]);
  } catch (err) {
    console.error('[loginSecurity/recordAttempt]', err.code || err.message);
  }
}

// Wrong password for a real account. locked_until is assigned BEFORE
// failed_attempts so it sees the old counter in both MySQL and MariaDB.
async function registerFailure(userId) {
  await db.query(
    `UPDATE users
        SET locked_until = IF(failed_attempts + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? SECOND), locked_until),
            failed_attempts = failed_attempts + 1
      WHERE id = ?`,
    [MAX_FAILED_ATTEMPTS, LOCK_SECONDS, userId]);
}

async function registerSuccess(userId) {
  await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = ?', [userId]);
}

// Lock has run out: start a fresh count so the first typo afterwards does not
// immediately re-lock the account.
async function clearExpiredLock(userId) {
  await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ? AND locked_until IS NOT NULL AND locked_until <= NOW()', [userId]);
}

async function stuffingSummary() {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS failures, COUNT(DISTINCT user_code) AS accounts, COUNT(DISTINCT ip) AS addresses
       FROM login_attempts
      WHERE success = 0 AND ts >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`, [ALERT_WINDOW_MINUTES]);
  const failures = Number(row?.failures || 0);
  const accounts = Number(row?.accounts || 0);
  return {
    window_minutes: ALERT_WINDOW_MINUTES,
    failures, accounts, addresses: Number(row?.addresses || 0),
    alert: failures > ALERT_MIN_FAILURES && accounts >= ALERT_MIN_ACCOUNTS
  };
}

// Called after a failed attempt. Writes at most one SECURITY_ALERT per window.
let lastAlertAt = 0;
async function checkStuffing() {
  try {
    const s = await stuffingSummary();
    if (!s.alert) return s;
    const now = Date.now();
    if (now - lastAlertAt < ALERT_WINDOW_MINUTES * 60 * 1000) return s;
    lastAlertAt = now;
    await db.query(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (NULL, ?, ?, NULL, ?)',
      ['SECURITY_ALERT', 'login', JSON.stringify({ kind: 'credential_stuffing_suspected', ...s })]);
    console.warn('[security] possible credential stuffing:', JSON.stringify(s));
    return s;
  } catch (err) {
    console.error('[loginSecurity/checkStuffing]', err.code || err.message);
    return null;
  }
}

async function pruneOld() {
  try { await db.query('DELETE FROM login_attempts WHERE ts < DATE_SUB(NOW(), INTERVAL ? DAY)', [RETENTION_DAYS]); }
  catch (err) { console.error('[loginSecurity/prune]', err.code || err.message); }
}
const pruneTimer = setInterval(pruneOld, 6 * 60 * 60 * 1000);
pruneTimer.unref();

function _resetForTests() { lastAlertAt = 0; }

module.exports = {
  MAX_FAILED_ATTEMPTS, LOCK_SECONDS, ALERT_WINDOW_MINUTES, ALERT_MIN_FAILURES, ALERT_MIN_ACCOUNTS,
  isLocked, recordAttempt, registerFailure, registerSuccess, clearExpiredLock,
  stuffingSummary, checkStuffing, pruneOld, _resetForTests
};
