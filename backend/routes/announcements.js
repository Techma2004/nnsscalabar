const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

const VALID_AUDIENCE = ['student', 'teacher', 'hod', 'admin', 'commandant'];
const VALID_TYPES = ['info', 'warn', 'success', 'danger'];

function normalizeAudience(input, posterRole) {
  const requested = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(',') : []);
  let audience = requested.map(a => String(a).trim().toLowerCase()).filter(a => VALID_AUDIENCE.includes(a));
  if (!audience.length) audience = ['student', 'teacher', 'hod', 'admin', 'commandant'];
  // A department head can inform students/teachers/other HODs, but should
  // never be able to address a message "to admins/commandant" as if
  // instructing management — that stays admin/commandant-only.
  if (posterRole === 'hod') audience = audience.filter(a => !['admin', 'commandant'].includes(a));
  if (!audience.length) audience = ['hod'];
  return [...new Set(audience)];
}

router.get('/', auth, async (req, res) => {
  try {
    const audience = req.user?.role || 'student';
    const [rows] = await db.query(`SELECT id,title,body,type,is_pinned,publish_at,expires_at FROM announcements
      WHERE publish_at<=NOW() AND (expires_at IS NULL OR expires_at>NOW()) AND FIND_IN_SET(?, audience)>0
      ORDER BY is_pinned DESC,publish_at DESC LIMIT 50`, [audience]);
    res.json(rows);
  } catch (err) { console.error('[announcements/get]', err); res.status(500).json({ error: 'Unable to load announcements.' }); }
});

// Management view: everyone who can publish can also see every announcement
// they're allowed to touch (including future-scheduled and expired ones),
// with the author's name, so they know what's already been said before
// posting again and can edit/retract something that was wrong.
router.get('/manage', auth, async (req, res) => {
  if (!['admin', 'commandant', 'hod'].includes(req.user.role)) return res.status(403).json({ error: 'Management access required.' });
  const q = String(req.query.q || '').trim();
  const params = [];
  let searchClause = '';
  if (q) { searchClause = 'AND (a.title LIKE ? OR a.body LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  // An HOD only manages what they themselves posted; admin/commandant see everything.
  let ownerClause = '';
  if (req.user.role === 'hod') { ownerClause = 'AND a.author_id = ?'; params.push(req.user.id); }
  try {
    const [rows] = await db.query(`SELECT a.id,a.title,a.body,a.type,a.audience,a.is_pinned,a.publish_at,a.expires_at,u.full_name AS author_name
      FROM announcements a LEFT JOIN users u ON u.id=a.author_id
      WHERE 1=1 ${ownerClause} ${searchClause}
      ORDER BY a.publish_at DESC LIMIT 200`, params);
    res.json(rows);
  } catch (err) { console.error('[announcements/manage]', err); res.status(500).json({ error: 'Unable to load announcements.' }); }
});

router.post('/', auth, async (req, res) => {
  if (!['admin', 'commandant', 'hod'].includes(req.user.role)) return res.status(403).json({ error: 'Management access required.' });
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const type = VALID_TYPES.includes(req.body?.type) ? req.body.type : 'info';
  const audience = normalizeAudience(req.body?.audience, req.user.role).join(',');
  if (!title || !body) return res.status(400).json({ error: 'Title and announcement body are required.' });
  if (title.length > 200) return res.status(400).json({ error: 'Title must be 200 characters or fewer.' });
  try {
    const [result] = await db.query(`INSERT INTO announcements(title,body,type,author_id,audience,is_pinned,expires_at) VALUES(?,?,?,?,?,?,?)`,
      [title, body, type, req.user.id, audience, req.body?.is_pinned ? 1 : 0, req.body?.expires_at || null]);
    res.status(201).json({ id: result.insertId, message: 'Announcement published.' });
  } catch (err) { console.error('[announcements/post]', err); res.status(500).json({ error: 'Unable to publish announcement.' }); }
});

router.patch('/:id', auth, async (req, res) => {
  if (!['admin', 'commandant', 'hod'].includes(req.user.role)) return res.status(403).json({ error: 'Management access required.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid announcement ID.' });
  try {
    const [[existing]] = await db.query('SELECT id, author_id FROM announcements WHERE id=? LIMIT 1', [id]);
    if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
    if (req.user.role === 'hod' && existing.author_id !== req.user.id) return res.status(403).json({ error: 'You can only edit announcements you posted.' });

    const fields = [];
    const params = [];
    if (req.body?.title != null) { const t = String(req.body.title).trim(); if (!t) return res.status(400).json({ error: 'Title cannot be empty.' }); fields.push('title=?'); params.push(t); }
    if (req.body?.body != null) { const b = String(req.body.body).trim(); if (!b) return res.status(400).json({ error: 'Announcement body cannot be empty.' }); fields.push('body=?'); params.push(b); }
    if (req.body?.type != null) { fields.push('type=?'); params.push(VALID_TYPES.includes(req.body.type) ? req.body.type : 'info'); }
    if (req.body?.audience != null) { fields.push('audience=?'); params.push(normalizeAudience(req.body.audience, req.user.role).join(',')); }
    if (req.body?.is_pinned != null) { fields.push('is_pinned=?'); params.push(req.body.is_pinned ? 1 : 0); }
    if (req.body?.expires_at !== undefined) { fields.push('expires_at=?'); params.push(req.body.expires_at || null); }
    if (!fields.length) return res.status(400).json({ error: 'No changes supplied.' });
    params.push(id);
    await db.query(`UPDATE announcements SET ${fields.join(', ')} WHERE id=?`, params);
    res.json({ message: 'Announcement updated.' });
  } catch (err) { console.error('[announcements/patch]', err); res.status(500).json({ error: 'Unable to update announcement.' }); }
});

router.delete('/:id', auth, async (req, res) => {
  if (!['admin', 'commandant', 'hod'].includes(req.user.role)) return res.status(403).json({ error: 'Management access required.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid announcement ID.' });
  try {
    const [[existing]] = await db.query('SELECT id, author_id FROM announcements WHERE id=? LIMIT 1', [id]);
    if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
    if (req.user.role === 'hod' && existing.author_id !== req.user.id) return res.status(403).json({ error: 'You can only delete announcements you posted.' });
    await db.query('DELETE FROM announcements WHERE id=?', [id]);
    res.json({ message: 'Announcement deleted.' });
  } catch (err) { console.error('[announcements/delete]', err); res.status(500).json({ error: 'Unable to delete announcement.' }); }
});

module.exports = router;
