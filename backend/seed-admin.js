require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

(async () => {
  const code = String(process.env.INITIAL_ADMIN_CODE || '').trim().toUpperCase();
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '');
  const name = String(process.env.INITIAL_ADMIN_NAME || 'NNSS System Administrator').trim();
  const email = process.env.INITIAL_ADMIN_EMAIL || null;
  if (!code || password.length < 8) throw new Error('Set INITIAL_ADMIN_CODE and INITIAL_ADMIN_PASSWORD (minimum 8 characters) before running npm run seed:admin.');
  const [existing] = await db.query('SELECT id FROM users WHERE user_code=? LIMIT 1',[code]);
  const hash = await bcrypt.hash(password,12);
  if (existing.length) {
    await db.query('UPDATE users SET full_name=?,email=?,password_hash=?,role=\'admin\',is_active=1 WHERE id=?',[name,email,hash,existing[0].id]);
    console.log(`Updated administrator account ${code}.`);
  } else {
    await db.query('INSERT INTO users(user_code,full_name,email,password_hash,role,is_active) VALUES(?,?,?,?,\'admin\',1)',[code,name,email,hash]);
    console.log(`Created administrator account ${code}.`);
  }
})().catch(err=>{console.error(err.message);process.exitCode=1}).finally(async()=>{try{await db.end()}catch{}});
