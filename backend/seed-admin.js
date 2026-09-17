require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

(async () => {
  const code = String(process.env.INITIAL_ADMIN_CODE || '').trim().toUpperCase();
  // Only a Commandant can create admin/commandant accounts through the API, so
  // seeding an 'admin' left no way to ever create the first Commandant without
  // hand-writing SQL. Allow the bootstrap role to be chosen; default stays
  // 'admin' so existing setups are unchanged.
  const role = String(process.env.INITIAL_ADMIN_ROLE || 'admin').trim().toLowerCase();
  if (!['admin', 'commandant'].includes(role)) throw new Error("INITIAL_ADMIN_ROLE must be 'admin' or 'commandant'.");
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '');
  const name = String(process.env.INITIAL_ADMIN_NAME || 'NNSS System Administrator').trim();
  const email = process.env.INITIAL_ADMIN_EMAIL || null;
  if (!code || password.length < 8) throw new Error('Set INITIAL_ADMIN_CODE and INITIAL_ADMIN_PASSWORD (minimum 8 characters) before running npm run seed:admin.');
  const [existing] = await db.query('SELECT id FROM users WHERE user_code=? LIMIT 1',[code]);
  const hash = await bcrypt.hash(password,12);
  if (existing.length) {
    await db.query('UPDATE users SET full_name=?,email=?,password_hash=?,role=?,is_active=1 WHERE id=?',[name,email,hash,role,existing[0].id]);
    console.log(`Updated ${role} account ${code}.`);
  } else {
    await db.query('INSERT INTO users(user_code,full_name,email,password_hash,role,is_active) VALUES(?,?,?,?,?,1)',[code,name,email,hash,role]);
    console.log(`Created ${role} account ${code}.`);
  }
})().catch(err=>{console.error(err.message);process.exitCode=1}).finally(async()=>{try{await db.end()}catch{}});
