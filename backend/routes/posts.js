'use strict';
/*
 * Public blog and newsletter content.
 *
 *   GET    /api/posts?kind=blog|newsletter     public: published posts only, newest first
 *   GET    /api/posts/manage                   editors: every post including drafts
 *   POST   /api/posts                          editors: create
 *   PATCH  /api/posts/:id                      editors: change (also publish / unpublish)
 *   DELETE /api/posts/:id                      editors: remove
 *
 * "Editors" are the school's article / news team (role "editor"); the Administrator
 * and Commandant can do the same. Nobody else can change the public pages.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const v = require('../validate');
const { routeLimiter } = require('../middleware/security');
const router = express.Router();

const EDITORS = ['editor', 'admin', 'commandant'];
const KINDS = ['blog', 'newsletter'];
// Pictures must live on the school's own site (the browser is told to load images
// only from there): either a file already in the site folder, or one uploaded here.
const IMAGE_FILE_RE = /^(uploads\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|webp|gif)$/i;
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'frontend', 'uploads');
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

router.get('/', routeLimiter(300, 'Too many requests. Please try again shortly.'), async (req, res) => {
  const kind = String(req.query.kind || '');
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Choose blog or newsletter.' });
  try {
    const [rows] = await db.query(`SELECT id, kind, title, body, image_url, DATE_FORMAT(event_date,'%Y-%m-%d') AS event_date FROM posts WHERE kind=? AND status='published' ORDER BY event_date DESC, id DESC LIMIT 100`, [kind]);
    res.json({ rows });
  } catch (err) { console.error('[posts/public]', err); res.status(500).json({ error: 'Unable to load posts.' }); }
});

router.use(routeLimiter(300, 'Too many requests. Please try again later.'));
router.use(auth);
router.use((req, res, next) => (EDITORS.includes(req.user.role) ? next() : res.status(403).json({ error: 'Only the school news team can edit the blog and newsletter.' })));

router.get('/manage', async (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
  const q = String(req.query.q || '').trim().slice(0, 80);
  const params = []; let where = '1=1';
  if (kind) { where += ' AND p.kind=?'; params.push(kind); }
  if (q) { where += ' AND (p.title LIKE ? OR p.body LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  try {
    const [rows] = await db.query(`SELECT p.id, p.kind, p.title, p.body, p.image_url, DATE_FORMAT(p.event_date,'%Y-%m-%d') AS event_date, p.status, p.created_at, p.updated_at, cu.full_name AS created_by_name, uu.full_name AS updated_by_name
      FROM posts p LEFT JOIN users cu ON cu.id=p.created_by LEFT JOIN users uu ON uu.id=p.updated_by WHERE ${where} ORDER BY p.event_date DESC, p.id DESC LIMIT 300`, params);
    res.json({ rows });
  } catch (err) { console.error('[posts/manage]', err); res.status(500).json({ error: 'Unable to load posts.' }); }
});

function readPost(body) {
  const kind = String(body.kind || '');
  const title = v.optText(body.title, 200);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const status = body.status === 'draft' ? 'draft' : 'published';
  let image = body.image_url === undefined || body.image_url === null || body.image_url === '' ? null : String(body.image_url).trim();
  const date = v.optDate(body.event_date);
  if (!KINDS.includes(kind)) return { error: 'Choose blog or newsletter.' };
  if (!title || title.length < 3) return { error: 'Give the post a title (at least 3 characters).' };
  if (text.length < 10) return { error: 'Write the post text (at least 10 characters).' };
  if (text.length > 8000) return { error: 'The post text is too long (8,000 characters at most).' };
  if (image && !IMAGE_FILE_RE.test(image)) return { error: 'Choose a picture from the list, or upload one.' };
  if (date === undefined) return { error: 'Enter a valid date.' };
  // Pictures belong to the blog only; a newsletter post never carries one.
  if (kind !== 'blog') image = null;
  return { value: { kind, title, body: text, image_url: image, event_date: (date || new Date().toISOString().slice(0, 10)).slice(0, 10), status } };
}

// Upload a picture for a post (PNG, JPEG or WebP, up to 2.5 MB). The file is checked
// by its contents, not its name, and stored under a random name.
router.post('/image', async (req, res) => {
  const m = String(req.body?.image || '').match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return res.status(400).json({ error: 'Choose a PNG, JPEG or WebP picture.' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'That picture is larger than 2.5 MB. Choose a smaller one.' });
  const ext = sniffImage(buf);
  if (!ext) return res.status(400).json({ error: 'That file is not a PNG, JPEG or WebP picture.' });
  try {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const name = `post-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf, { flag: 'wx' });
    res.status(201).json({ image_url: `uploads/${name}` });
  } catch (err) { console.error('[posts/image]', err); res.status(500).json({ error: 'Unable to store the picture.' }); }
});

router.post('/', async (req, res) => {
  const { value, error } = readPost(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const [r] = await db.query('INSERT INTO posts (kind,title,body,image_url,event_date,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)',
      [value.kind, value.title, value.body, value.image_url, value.event_date, value.status, req.user.id, req.user.id]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?)', [req.user.id, 'CREATE_POST', 'post', r.insertId, JSON.stringify({ kind: value.kind, status: value.status })]);
    res.status(201).json({ message: value.status === 'published' ? 'Post published.' : 'Draft saved.', id: r.insertId });
  } catch (err) { console.error('[posts/create]', err); res.status(500).json({ error: 'Unable to save the post.' }); }
});

router.patch('/:id', async (req, res) => {
  const id = v.id(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid post.' });
  const { value, error } = readPost(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const [r] = await db.query('UPDATE posts SET kind=?, title=?, body=?, image_url=?, event_date=?, status=?, updated_by=? WHERE id=?',
      [value.kind, value.title, value.body, value.image_url, value.event_date, value.status, req.user.id, id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Post not found.' });
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?)', [req.user.id, 'UPDATE_POST', 'post', id, JSON.stringify({ kind: value.kind, status: value.status })]);
    res.json({ message: value.status === 'published' ? 'Post updated.' : 'Saved as a draft (hidden from the public).' });
  } catch (err) { console.error('[posts/update]', err); res.status(500).json({ error: 'Unable to save the post.' }); }
});

router.delete('/:id', async (req, res) => {
  const id = v.id(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid post.' });
  try {
    const [r] = await db.query('DELETE FROM posts WHERE id=?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Post not found.' });
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?)', [req.user.id, 'DELETE_POST', 'post', id, JSON.stringify({})]);
    res.json({ message: 'Post deleted.' });
  } catch (err) { console.error('[posts/delete]', err); res.status(500).json({ error: 'Unable to delete the post.' }); }
});

module.exports = router;
