'use strict';
/*
 * Small input-validation helpers shared by the routes. Request bodies are
 * untrusted JSON, so a field that is supposed to be a string can arrive as an
 * object or array. These helpers coerce or reject so that only plain scalars
 * ever reach a query or a log entry.
 */

/** Trimmed string, or null when absent/blank. Returns undefined when invalid. */
function optText(value, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? undefined : s;
}

/** YYYY-MM-DD (or full ISO date-time) string, null when blank, undefined when invalid. */
function optDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return undefined;
  const t = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(t.getTime())) return undefined;
  // MySQL DATETIME cannot take the 'Z'/offset forms directly; normalise.
  return s.length === 10 ? s : t.toISOString().slice(0, 19).replace('T', ' ');
}

/** Positive integer from a route parameter or body field, else null. */
function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const isEmail = s => typeof s === 'string' && s.length <= 120 && EMAIL_RE.test(s);

/**
 * bcrypt only uses the first 72 bytes, and hashing very long input is wasted
 * CPU an attacker can trigger, so cap passwords there.
 */
const PASSWORD_MAX_BYTES = 72;
const passwordTooLong = s => Buffer.byteLength(String(s), 'utf8') > PASSWORD_MAX_BYTES;

module.exports = { optText, optDate, id, isEmail, passwordTooLong, PASSWORD_MAX_BYTES };
