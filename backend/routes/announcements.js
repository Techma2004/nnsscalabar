const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const audience = req.user?.role || 'student';
    const [rows] = await db.query(`SELECT id,title,body,type,is_pinned,publish_at,expires_at FROM announcements
      WHERE publish_at<=NOW() AND (expires_at IS NULL OR expires_at>NOW()) AND FIND_IN_SET(?, audience)>0
      ORDER BY is_pinned DESC,publish_at DESC LIMIT 50`, [audience]);
    res.json(rows);
  } catch (err) { console.error('[announcements/get]', err); res.status(500).json({ error: 'Unable to load announcements.' }); }
});

router.post('/', auth, async (req, res) => {
  if (!['admin','commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Management access required.' });
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const type = ['info','warn','success','danger'].includes(req.body?.type) ? req.body.type : 'info';
  const audience = Array.isArray(req.body?.audience) ? req.body.audience.join(',') : (req.body?.audience || 'student,teacher,hod,admin,commandant');
  if (!title || !body) return res.status(400).json({ error: 'Title and announcement body are required.' });
  try {
    const [result] = await db.query(`INSERT INTO announcements(title,body,type,author_id,audience,is_pinned,expires_at) VALUES(?,?,?,?,?,?,?)`,
      [title,body,type,req.user.id,audience,req.body?.is_pinned ? 1 : 0,req.body?.expires_at || null]);
    res.status(201).json({ id: result.insertId, message: 'Announcement published.' });
  } catch (err) { console.error('[announcements/post]', err); res.status(500).json({ error: 'Unable to publish announcement.' }); }
});

module.exports = router;
