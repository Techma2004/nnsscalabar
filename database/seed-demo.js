#!/usr/bin/env node
/*
 * NNSS Calabar - realistic synthetic demo data.
 * Run: node database/seed-demo.js
 * Optional: STUDENT_COUNT=600 TEACHER_COUNT=48 node database/seed-demo.js
 *
 * Creates nnss_calabar_demo only. No production database is touched.
 * Results are intentionally left empty for a separate results seed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('../backend/node_modules/mysql2/promise');
const bcrypt = require('../backend/node_modules/bcryptjs');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const DB_NAME = 'nnss_calabar_demo';
const STUDENT_COUNT = Math.max(1, Number(process.env.STUDENT_COUNT || 600));
const TEACHER_COUNT = Math.max(6, Number(process.env.TEACHER_COUNT || 48));
const PASSWORD = process.env.DEMO_PASSWORD || 'DemoPass123!';

const studentFirst = [
  'Abasi','Ada','Amina','Blessing','Caleb','Daniel','David','Diana','Edidiong','Emem',
  'Esther','Favour','Grace','Hannah','Ifeoma','Imoh','James','Janet','Joseph','Kelechi',
  'Mary','Michael','Mercy','Mfon','Moses','Nathan','Ngozi','Obinna','Peace','Peter',
  'Precious','Samuel','Sarah','Sharon','Stephen','Success','Tosin','Victor','Victoria','Yusuf'
];
const studentLast = [
  'Akan','Adebayo','Archibong','Bassey','Bello','Balogun','Duke','Edem','Ekanem','Ekong',
  'Essien','Etim','Eyo','George','Ita','Iyang','Johnson','Lawal','Mba','Moses',
  'Ndi','Nwankwo','Obi','Obot','Okon','Okoro','Onyema','Otu','Udoh','Udo',
  'Ufot','Williams','Yakubu','Young'
];
const teacherFirst = [
  'Abasi','Ada','Angela','Anthony','Blessing','Caroline','Chinedu','Daniel','David','Deborah',
  'Edem','Emmanuel','Esther','Fatima','Gabriel','Grace','Helen','Irene','Janet','Joseph',
  'Joy','Kemi','Lawrence','Linda','Margaret','Michael','Mfon','Nathan','Ngozi','Obinna',
  'Olumide','Patience','Paul','Peter','Rita','Samuel','Sarah','Stephen','Theresa','Victor',
  'Victoria','William','Yusuf','Zainab'
];
const teacherLast = [
  'Akan','Bassey','Chukwu','Duke','Edem','Ekong','Essien','Etim','Eyo','Ita',
  'Johnson','King','Mba','Ndi','Obot','Okon','Okoro','Onyema','Peter','Sani',
  'Udo','Ufot','Udoh','Williams','Yakubu','Young'
];
const qualifications = ['B.Ed.','B.Sc. Education','B.A. Education','B.Tech. Education','M.Ed.'];
const juniorArms = ['OBUDU','CALABAR','KWA'];

function pickName(first, last, index) {
  return first[index % first.length] + ' ' + last[Math.floor(index / first.length) % last.length];
}
function dob(index) {
  const year = 2009 + (index % 6);
  const month = String(1 + (index % 12)).padStart(2, '0');
  const day = String(1 + (index % 27)).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  try {
    let schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    schema = schema.replace(/nnss_calabar/g, DB_NAME);
    await db.query(schema);
    await db.query('USE ' + DB_NAME);

    for (const arm of juniorArms) {
      await db.query(
        "INSERT INTO arms (arm_name, arm_type, category) VALUES (?, 'junior', 'Junior Secondary') " +
        "ON DUPLICATE KEY UPDATE arm_type='junior', category='Junior Secondary', is_active=TRUE",
        [arm]
      );
    }

    const [[session]] = await db.query(
      "SELECT id, session_name FROM academic_sessions WHERE is_current=TRUE ORDER BY id DESC LIMIT 1"
    );
    const [classes] = await db.query(
      'SELECT id, level_name, is_junior FROM class_levels ORDER BY sort_order, id'
    );
    const [arms] = await db.query(
      'SELECT id, arm_name, arm_type FROM arms WHERE is_active=TRUE ORDER BY id'
    );
    const [departments] = await db.query(
      'SELECT id, dept_name FROM departments ORDER BY id'
    );
    const [subjects] = await db.query(
      'SELECT id, subject_name, dept_id FROM subjects WHERE is_active=TRUE ORDER BY id'
    );
    const [trackSubjects] = await db.query(
      'SELECT track, subject_id FROM track_subjects ORDER BY track, subject_id'
    );

    assert(session, 'No current academic session exists.');
    assert(classes.length >= 6, 'Expected JSS1-JSS3 and SS1-SS3.');
    assert(departments.length > 0, 'No departments found.');
    assert(subjects.length > 0, 'No subjects found.');

    const subjectById = new Map(subjects.map(function (s) { return [s.id, s]; }));
    const trackMap = new Map();
    for (const row of trackSubjects) {
      if (!trackMap.has(row.track)) trackMap.set(row.track, []);
      if (subjectById.has(row.subject_id)) trackMap.get(row.track).push(row.subject_id);
    }

    const placements = [];
    for (const cls of classes) {
      const compatible = arms.filter(function (arm) {
        return cls.is_junior ? arm.arm_type === 'junior' : arm.arm_type !== 'junior';
      });
      assert(compatible.length, 'No compatible arms for ' + cls.level_name + '.');

      for (const arm of compatible) {
        let track = 'junior';
        if (!cls.is_junior) {
          track = arm.arm_type === 'science'
            ? 'science'
            : arm.arm_type === 'technical'
              ? 'technical'
              : 'arts';
        }
        placements.push({
          classId: cls.id,
          className: cls.level_name,
          armId: arm.id,
          armName: arm.arm_name,
          armType: arm.arm_type,
          isJunior: Boolean(cls.is_junior),
          track: track
        });
      }
    }

    assert(placements.length >= 18, 'Expected at least 18 class/arm placements.');
    await db.beginTransaction();

    // Safe reseed: this database is dedicated to synthetic demo accounts.
    await db.query(
      "DELETE FROM users WHERE user_code REGEXP '^(STU[0-9]{4}|TCH[0-9]{3}|HOD[0-9]{3})$'"
    );

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const enrollmentRows = [];

    // 600 students are spread across every compatible class/arm combination.
    for (let i = 1; i <= STUDENT_COUNT; i++) {
      const p = placements[(i - 1) % placements.length];
      const code = 'STU' + String(i).padStart(4, '0');
      const fullName = pickName(studentFirst, studentLast, i - 1);
      const gender = i % 2 === 0 ? 'M' : 'F';
      const email = code.toLowerCase() + '@demo.nnsscalabar.local';
      const parentName = pickName(studentLast, studentFirst, i + 17);
      const parentPhone = '080' + String(10000000 + i).slice(-8);

      const [u] = await db.query(
        "INSERT INTO users (user_code, full_name, email, phone, password_hash, role, gender, is_active) " +
        "VALUES (?, ?, ?, ?, ?, 'student', ?, TRUE)",
        [code, fullName, email, parentPhone, passwordHash, gender]
      );

      const [s] = await db.query(
        "INSERT INTO students " +
        "(user_id, admission_no, class_level_id, arm_id, date_of_birth, parent_name, parent_phone, " +
        "date_admitted, is_boarder, track, status) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-01', ?, ?, 'active')",
        [
          u.insertId,
          'ADM' + String(i).padStart(4, '0'),
          p.classId,
          p.armId,
          dob(i),
          parentName,
          parentPhone,
          i % 3 !== 0,
          p.track
        ]
      );

      for (const subjectId of (trackMap.get(p.track) || [])) {
        enrollmentRows.push([s.insertId, subjectId, session.id]);
      }
    }

    // Teachers are distributed round-robin across every department.
    // Academic teachers receive 1-2 subjects from their department.
    // Administration staff remain non-teaching staff rather than getting
    // fabricated classroom subjects.
    for (let i = 1; i <= TEACHER_COUNT; i++) {
      const dept = departments[(i - 1) % departments.length];
      const code = 'TCH' + String(i).padStart(3, '0');
      const fullName = pickName(teacherFirst, teacherLast, i - 1);
      const gender = i % 2 === 0 ? 'M' : 'F';
      const email = code.toLowerCase() + '@demo.nnsscalabar.local';

      const [u] = await db.query(
        "INSERT INTO users (user_code, full_name, email, password_hash, role, gender, is_active) " +
        "VALUES (?, ?, ?, ?, 'teacher', ?, TRUE)",
        [code, fullName, email, passwordHash, gender]
      );

      const [t] = await db.query(
        "INSERT INTO teachers (user_id, staff_no, dept_id, qualification, date_joined) VALUES (?, ?, ?, ?, ?)",
        [
          u.insertId,
          code,
          dept.id,
          qualifications[(i - 1) % qualifications.length],
          '2020-09-01'
        ]
      );

      const deptSubjects = subjects.filter(function (s) { return s.dept_id === dept.id; });
      if (!deptSubjects.length) continue;

      const assigned = [
        deptSubjects[(i - 1) % deptSubjects.length],
        deptSubjects[i % deptSubjects.length]
      ].filter(function (subject, index, arr) {
        return subject && arr.findIndex(function (x) { return x.id === subject.id; }) === index;
      });

      for (const subject of assigned) {
        await db.query(
          'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)',
          [t.insertId, subject.id]
        );

        const compatible = placements.filter(function (p) {
          return (trackMap.get(p.track) || []).includes(subject.id);
        });

        if (!compatible.length) continue;

        const start = (i * 3) % compatible.length;
        const take = Math.min(compatible.length, 6 + (i % 4));

        for (let n = 0; n < take; n++) {
          const p = compatible[(start + n) % compatible.length];
          await db.query(
            "INSERT IGNORE INTO teacher_class_assignments " +
            "(teacher_id, subject_id, class_level_id, arm_id, session_id) VALUES (?, ?, ?, ?, ?)",
            [t.insertId, subject.id, p.classId, p.armId, session.id]
          );
        }
      }
    }

    // One HOD account per actual department in schema.sql.
    const hodFirst = ['Abasi','Bassey','Duke','Essien','Etim','Okon','Udo','Eyo'];
    const hodLast = ['Ekanem','Ekong','Bassey','Archibong','Udoh','Okon','Essien','Eyo'];

    for (let i = 0; i < departments.length; i++) {
      const dept = departments[i];
      const code = 'HOD' + String(i + 1).padStart(3, '0');
      const fullName = 'Dr. ' + hodFirst[i % hodFirst.length] + ' ' + hodLast[i % hodLast.length];
      const gender = i % 2 === 0 ? 'F' : 'M';
      const email = code.toLowerCase() + '@demo.nnsscalabar.local';

      const [u] = await db.query(
        "INSERT INTO users (user_code, full_name, email, password_hash, role, gender, is_active) " +
        "VALUES (?, ?, ?, ?, 'hod', ?, TRUE)",
        [code, fullName, email, passwordHash, gender]
      );

      await db.query(
        "INSERT INTO hods (user_id, dept_id, appointed_date) VALUES (?, ?, '2022-09-01')",
        [u.insertId, dept.id]
      );
    }

    // Bulk enrollment keeps the 600-student seed reasonably fast.
    for (let i = 0; i < enrollmentRows.length; i += 500) {
      const batch = enrollmentRows.slice(i, i + 500);
      if (batch.length) {
        await db.query(
          "INSERT INTO student_subject_enrollment (student_id, subject_id, session_id) VALUES ?",
          [batch]
        );
      }
    }

    await db.commit();

    const [[counts]] = await db.query(
      "SELECT " +
      "(SELECT COUNT(*) FROM students) AS students, " +
      "(SELECT COUNT(*) FROM teachers) AS teachers, " +
      "(SELECT COUNT(*) FROM hods) AS hods, " +
      "(SELECT COUNT(*) FROM departments) AS departments, " +
      "(SELECT COUNT(*) FROM subjects) AS subjects, " +
      "(SELECT COUNT(*) FROM teacher_subjects) AS teacher_subjects, " +
      "(SELECT COUNT(*) FROM teacher_class_assignments) AS teacher_assignments, " +
      "(SELECT COUNT(*) FROM student_subject_enrollment) AS enrollments, " +
      "(SELECT COUNT(*) FROM results) AS results"
    );

    console.log('');
    console.log('==============================================');
    console.log(' NNSS CALABAR - DEMO DATABASE READY');
    console.log('==============================================');
    console.log('Database:          ' + DB_NAME);
    console.log('Session:           ' + session.session_name);
    console.log('Students:          ' + counts.students);
    console.log('Teachers:          ' + counts.teachers);
    console.log('HODs:              ' + counts.hods);
    console.log('Departments:       ' + counts.departments);
    console.log('Subjects:          ' + counts.subjects);
    console.log('Teacher subjects:  ' + counts.teacher_subjects);
    console.log('Teacher classes:   ' + counts.teacher_assignments);
    console.log('Enrollments:       ' + counts.enrollments);
    console.log('Results:           ' + counts.results + ' (intentionally empty)');
    console.log('');
    console.log('Student logins: STU0001-STU' + String(STUDENT_COUNT).padStart(4, '0'));
    console.log('Teacher logins: TCH001-TCH' + String(TEACHER_COUNT).padStart(3, '0'));
    console.log('HOD logins:     HOD001-HOD' + String(departments.length).padStart(3, '0'));
    console.log('Demo password:  ' + PASSWORD);
    console.log('==============================================');
  } catch (error) {
    try { await db.rollback(); } catch {}
    throw error;
  } finally {
    await db.end();
  }
}

main().catch(function (error) {
  console.error('Demo database seed failed: ' + (error.stack || error.message));
  process.exitCode = 1;
});
