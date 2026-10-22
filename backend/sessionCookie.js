'use strict';
/*
 * The sign-in cookie, in one place so login and the "keep me signed in while I am
 * working" renewal in middleware/auth.js always agree.
 *
 * A session lasts SESSION_HOURS from the last time the person used the portal, not
 * from the moment they typed their password: any request made while less than half
 * of that time is left quietly issues a fresh cookie. Someone who walks away for
 * longer than SESSION_HOURS is still signed out.
 */
const jwt = require('jsonwebtoken');

const SESSION_HOURS = 8;
const isProduction = process.env.NODE_ENV === 'production';
// Secure cookies require HTTPS. A school running this on its own LAN typically has
// no TLS certificate, so forcing `secure` on whenever NODE_ENV=production would
// silently break login for every device on the network (the browser drops the
// Set-Cookie header entirely over plain HTTP). COOKIE_SECURE lets an operator
// state explicitly whether this deployment is served over HTTPS; it defaults to
// the old production-only behaviour when not set, for cloud/HTTPS deployments.
const cookieSecure = process.env.COOKIE_SECURE != null
  ? String(process.env.COOKIE_SECURE).toLowerCase() === 'true'
  : isProduction;
const sameSite = cookieSecure ? 'strict' : 'lax';
const cookieOptions = { httpOnly: true, secure: cookieSecure, sameSite, maxAge: SESSION_HOURS * 60 * 60 * 1000, path: '/' };
const clearOptions = { httpOnly: true, secure: cookieSecure, sameSite, path: '/' };

function signToken({ id, user_code, role, name, sv }) {
  return jwt.sign({ id, user_code, role, name, sv }, process.env.JWT_SECRET, { expiresIn: `${SESSION_HOURS}h`, algorithm: 'HS256' });
}

// Called by the auth middleware after a token has been fully verified.
function renewIfNeeded(res, payload) {
  const left = Number(payload.exp) - Math.floor(Date.now() / 1000);
  if (!Number.isFinite(left) || left > (SESSION_HOURS * 3600) / 2) return;
  res.cookie('nnss_token', signToken(payload), cookieOptions);
}

module.exports = { cookieOptions, clearOptions, signToken, renewIfNeeded, SESSION_HOURS };
