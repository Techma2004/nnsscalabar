#!/usr/bin/env node
/*
 * Creates an isolated nnss_calabar_test database from database/schema.sql and
 * fills it with realistic synthetic users, classes, subjects, enrollments and
 * teacher assignments. It intentionally creates no results.
 *
 * Run from the repository root:
 *   node database/test-seed.js
 *
 * The script reads backend/.env for the MySQL server credentials, but always
 * connects to the server without selecting the application's database first.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('../backend/node_modules/mysql2/promise');
const bcrypt = require('../backend/node_modules/bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const DB_NAME = 'nnss_calabar_test';
const PASSWORD = 'DemoPass123!';
const STUDENT_COUNT = 600;
const TEACHER_COUNT = 48;
const HOD_DEPARTMENTS = [
  'Sciences', 'Languages', 'Arts & Commercial',
  'Technical', 'Social Studies', 'Administration'
];

const firstNames = ['Amina','Daniel','Emem','Favour','Grace','Hassan','Ifeoma','James','Kelechi','Mary','Ngozi','Okechukwu','Peace','Samuel','Tosin','Usman','Victoria','Yusuf','Ada','Bassey'];
const lastNames = ['Bello','Okoro','Williams','Etim','Ekanem','Ibrahim','Johnson','Obi','Udo','Adebayo','Essien','Musa','George','Nwankwo','Archibong','Lawal','Udoh','Otu','Edem','Balogun'];
const teacherFirstNames = ['Abasi','Blessing','Chinedu','David','Esther','Fatima','Gabriel','Helen','Irene','Joseph','Kemi','Lawrence','Margaret','Nathan','Olumide','Patience','Rita','Stephen','Theresa','Victor','Zainab','Andrew','Caroline','Emmanuel','Janet','Michael'];
const teacherLastNames = ['Akan','Bassey','Chukwu','Duke','Ekong','Essien','Eyo','Ita','King','Mba','Ndi','Obot','Okon','Onyema','Peter','Sani','Udo','Ufot','Wright','Yakubu'];
const qualifications = ['B.Ed.','B.Sc. Education','B.A. Education','B.Tech. Education','M.Ed.'];
const juniorArms = ['OBUDU','CALABAR','KWA'];

function nameFrom(listA, listB, n) {
  return `${listA[n % listA.length]} ${listB[Math.floor(n / listA.length) % listB.length]}`;
}
function dateForStudent(i) {
  const year = 2009 + (i % 6);
  const month = String(1 + (i % 12)).padStart(2, '0');
  const day = String(1 + (i % 27)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    let schema = fs.readFileSync(schemaPath, 'utf8');
    // The consolidated schema creates and selects nnss_calabar. Replace only
    // the database identifier so the production database is never touched.
    schema = schema.replace(/nnss_calabar/g, DB_NAME);
    await connection.query(schema);
    await connection.query(`USE \`${DB_NAME}\``);

    for (const arm of juniorArms) {
      await connection.query(
        `INSERT INTO arms (arm_name, arm_type, category) VALUES (?, 'junior', 'Junior Secondary') ON DUPLICATE KEY UPDATE is_active=TRUE`,
        [arm]
      );
    }

    const [[session]] = await connection.query("SELECT id FROM academic_sessions WHERE is_current=TRUE ORDER BY id DESC LIMIT 1");
    assert(session, 'No current academic session was created by the schema.');
    const [classes] = await connection.query('SELECT id, level_name, is_junior FROM class_levels ORDER BY sort_order, id');
    const [arms] = await connection.query('SELECT id, arm_name, arm_type FROM arms WHERE is_active=TRUE ORDER BY id');
    const [departments] = await connection.query('SELECT id, dept_name FROM departments ORDER BY id');
    const [subjects] = await connection.query('SELECT id, subject_name, dept_id FROM subjects WHERE is_active=TRUE ORDER BY id');
    const [trackSubjects] = await connection.query('SELECT track, subject_id FROM track_subjects ORDER BY track, subject_id');
    assert(classes.length >= 6, 'Expected at least six class levels.');
    assert(departments.length >= 6, 'Expected at least six departments.');
    assert(subjects.length > 0, 'Expected seeded subjects.');

    const deptByName = new Map(departments.map(d => [d.dept_name, d]));
    const subjectById = new Map(subjects.map(s => [s.id, s]));
    const trackMap = new Map();
    for (const row of trackSubjects) {
      if (!trackMap.has(row.track)) trackMap.set(row.track, []);
      if (subjectById.has(row.subject_id)) trackMap.get(row.track).push(row.subject_id);
    }

    const classArms = classes.flatMap(c => {
      const valid = c.is_junior
        ? arms.filter(a => a.arm_type === 'junior')
        : arms.filter(a => a.arm_type !== 'junior');
      assert(valid.length, `No compatible arms for ${c.level_name}.`);
      return valid.map(a => ({ classId: c.id, className: c.level_name, isJunior: !!c.is_junior, armId: a.id, armName: a.arm_name, armType: a.arm_type }));
    });

    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const studentRows = [];
    const studentEnrollments = [];

    for (let i = 1; i <= STUDENT_COUNT; i += 1) {
      const placement = classArms[(i - 1) % classArms.length];
      let track;
      if (placement.isJunior) track = 'junior';
      else if (placement.armType === 'science') track = 'science';
      else if (placement.armType === 'technical') track = 'technical';
      else track = 'arts';
      const code = `STU${String(i).padStart(4, '0')}`;
      const fullName = nameFrom(firstNames, lastNames, i - 1);
      const gender = i % 2 ? 'F' : 'M';
      const email = `${code.toLowerCase()}@test.nnsscalabar.local`;
      const parentName = nameFrom(lastNames, firstNames, i + 7);
      const parentPhone = `080${String(10000000 + i).slice(-8)}`;
      const [userResult] = await connection.query(
        `INSERT INTO users (user_code, full_name, email, phone, password_hash, role, gender, is_active)
         VALUES (?, ?, ?, ?, ?, 'student', ?, TRUE)
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), full_name=VALUES(full_name), password_hash=VALUES(password_hash), is_active=TRUE`,
        [code, fullName, email, parentPhone, passwordHash, gender]
      );
      const userId = userResult.insertId;
      const [studentResult] = await connection.query(
        `INSERT INTO students (user_id, admission_no, class_level_id, arm_id, date_of_birth, parent_name, parent_phone, date_admitted, is_boarder, track, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-01', ?, ?, 'active')
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), class_level_id=VALUES(class_level_id), arm_id=VALUES(arm_id), track=VALUES(track), status='active'`,
        [userId, `ADM${String(i).padStart(4, '0')}`, placement.classId, placement.armId, dateForStudent(i), parentName, parentPhone, i % 3 !== 0, track]
      );
      const studentId = studentResult.insertId;
      studentRows.push({ code, fullName, className: placement.className, armName: placement.armName, track });
      for (const subjectId of (trackMap.get(track) || [])) {
        studentEnrollments.push([studentId, subjectId, session.id]);
      }
    }

    for (let i = 1; i <= TEACHER_COUNT; i += 1) {
      const code = `TCH${String(i).padStart(3, '0')}`;
      const fullName = nameFrom(teacherFirstNames, teacherLastNames, i - 1);
      const dept = departments[(i - 1) % departments.length];
      const email = `${code.toLowerCase()}@test.nnsscalabar.local`;
      const [userResult] = await connection.query(
        `INSERT INTO users (user_code, full_name, email, password_hash, role, gender, is_active)
         VALUES (?, ?, ?, ?, 'teacher', ?, TRUE)
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), full_name=VALUES(full_name), password_hash=VALUES(password_hash), is_active=TRUE`,
        [code, fullName, email, passwordHash, i % 2 ? 'F' : 'M']
      );
      const userId = userResult.insertId;
      const [teacherResult] = await connection.query(
        `INSERT INTO teachers (user_id, staff_no, dept_id, qualification, date_joined)
         VALUES (?, ?, ?, ?, '2020-09-01')
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), dept_id=VALUES(dept_id), qualification=VALUES(qualification)`,
        [userId, code, dept.id, qualifications[(i - 1) % qualifications.length]]
      );
      const teacherId = teacherResult.insertId;
      const deptSubjects = subjects.filter(s => s.dept_id === dept.id);
      const assignedSubjects = deptSubjects.length ? deptSubjects : subjects;
      const subject = assignedSubjects[(i - 1) % assignedSubjects.length];
      await connection.query('INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [teacherId, subject.id]);
      for (const placement of classArms.filter(x => !x.isJunior || dept.dept_name === 'Administration').slice((i - 1) % 3, 12)) {
        if ((placement.isJunior && dept.dept_name !== 'Administration') || (!placement.isJunior && (placement.armType === 'science' || placement.armType === 'technical' || placement.armType === 'arts'))) {
          await connection.query(
            `INSERT IGNORE INTO teacher_class_assignments (teacher_id, subject_id, class_level_id, arm_id, session_id) VALUES (?, ?, ?, ?, ?)`,
            [teacherId, subject.id, placement.classId, placement.armId, session.id]
          );
        }
      }
    }

    // Separate HOD accounts: HOD001-HOD006 are not counted among TCH001-TCH048.
    for (let i = 0; i < HOD_DEPARTMENTS.length; i += 1) {
      const dept = deptByName.get(HOD_DEPARTMENTS[i]);
      assert(dept, `Department not found: ${HOD_DEPARTMENTS[i]}`);
      const code = `HOD${String(i + 1).padStart(3, '0')}`;
      const fullName = `Head ${dept.dept_name}`;
      const email = `${code.toLowerCase()}@test.nnsscalabar.local`;
      const [userResult] = await connection.query(
        `INSERT INTO users (user_code, full_name, email, password_hash, role, gender, is_active)
         VALUES (?, ?, ?, ?, 'hod', ?, TRUE)
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), full_name=VALUES(full_name), password_hash=VALUES(password_hash), is_active=TRUE`,
        [code, fullName, email, passwordHash, i % 2 ? 'F' : 'M']
      );
      await connection.query(
        `INSERT INTO hods (user_id, dept_id, appointed_date) VALUES (?, ?, '2020-09-01')
         ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), appointed_date=VALUES(appointed_date)`,
        [userResult.insertId, dept.id]
      );
    }

    // Insert enrollments in manageable batches.
    for (let i = 0; i < studentEnrollments.length; i += 500) {
      const batch = studentEnrollments.slice(i, i + 500);
      if (batch.length) await connection.query('INSERT IGNORE INTO student_subject_enrollment (student_id, subject_id, session_id) VALUES ?', [batch]);
    }

    await connection.commit();
    const [[counts]] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM students) students,
      (SELECT COUNT(*) FROM teachers) teachers,
      (SELECT COUNT(*) FROM hods) hods,
      (SELECT COUNT(*) FROM student_subject_enrollment) enrollments,
      (SELECT COUNT(*) FROM results) results`);
    console.log(`Created test database: ${DB_NAME}`);
    console.log(`Students: ${counts.students}; teachers: ${counts.teachers}; HODs: ${counts.hods}; enrollments: ${counts.enrollments}; results: ${counts.results}`);
    console.log(`Shared test password: ${PASSWORD}`);
    console.log('Student login range: STU0001–STU0600');
    console.log('Teacher login range: TCH001–TCH048');
    console.log('HOD login range: HOD001–HOD006');
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`Test database seed failed: ${error.message}`);
  process.exitCode = 1;
});
