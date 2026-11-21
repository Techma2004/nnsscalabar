'use strict';
/*
 * Where uploaded pictures (blog / news images) are kept.
 *
 *   Cloudflare R2   when R2_* settings are present (the online deployment, Vercel):
 *                   the picture goes to the R2 bucket and the post stores its public https URL.
 *   Local folder    otherwise (a school PC): frontend/uploads/, stored as "uploads/<name>".
 *
 * Vercel's disk is read-only, so there the portal refuses uploads until R2 is configured
 * instead of failing in a confusing way.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const e = process.env;
const PUBLIC_URL = String(e.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const R2_READY = Boolean(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET && PUBLIC_URL);
const UPLOAD_DIR = path.join(__dirname, '..', 'frontend', 'uploads');
const PREFIX = 'posts/';
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FILE_RE = /^(uploads\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|webp|gif)$/i;
const R2_RE = PUBLIC_URL ? new RegExp(`^${escapeRe(PUBLIC_URL)}/${escapeRe(PREFIX)}[A-Za-z0-9][A-Za-z0-9._-]{0,80}\\.(png|jpe?g|webp|gif)$`, 'i') : null;

/** True for a picture reference a post may carry: a site file, an uploaded file or one of our R2 URLs. */
function isAllowedImageRef(ref) {
  return FILE_RE.test(ref) || Boolean(R2_RE && R2_RE.test(ref));
}

/** Origin the browser must be allowed to load pictures from (for the CSP), or null. */
function imageOrigin() {
  if (!PUBLIC_URL) return null;
  try { return new URL(PUBLIC_URL).origin; } catch { return null; }
}

function canStore() {
  return R2_READY || !e.VERCEL;
}

let client = null;
function r2() {
  if (!client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY },
      // Newer SDK versions add checksum headers R2 does not need.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    });
  }
  return client;
}

/** Store a checked image buffer. Returns the value to save in posts.image_url. */
async function saveImage(name, buf, ext) {
  if (R2_READY) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await r2().send(new PutObjectCommand({
      Bucket: e.R2_BUCKET,
      Key: PREFIX + name,
      Body: buf,
      ContentType: TYPES[ext] || 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable'
    }));
    return `${PUBLIC_URL}/${PREFIX}${name}`;
  }
  if (e.VERCEL) {
    const err = new Error('Picture storage is not set up (R2_* settings missing).');
    err.code = 'STORAGE_UNAVAILABLE';
    throw err;
  }
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf, { flag: 'wx' });
  return `uploads/${name}`;
}

module.exports = { isAllowedImageRef, imageOrigin, canStore, saveImage, r2Enabled: R2_READY };
