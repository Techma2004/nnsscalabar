#!/usr/bin/env node
/*
 * Creates an isolated nnss_calabar_test database from database/schema.sql
 * and fills it with synthetic users, classes, subjects, enrollments and
 * teacher assignments. It intentionally creates no results.
 *
 * Run from the repository root:
 *   node database/test-seed.js
 *
 * Requires database creation privileges.
 * Optionally provide DEMO_PASSWORD; otherwise a random password is generated.
 * Re-running updates existing test accounts rather than duplicating them.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('../backend/node_modules/mysql2/promise');
const bcrypt = require('../backend/node_modules/bcryptjs');

require('../backend/node_modules/dotenv').config({
  path: path.join(__dirname, '..', 'backend', '.env')
});

function resolveDemoPassword() {
  const supplied = process.env.DEMO_PASSWORD;

  if (supplied) {
    return { password: supplied, generated: false };
  }

  return {
    password: crypto.randomBytes(12).toString('base64url'),
    generated: true
  };
}

function saveDemoPassword(password, generated) {
  const file = path.join(__dirname, '.demo-credentials');

  fs.writeFileSync(
    file,
    `Demo account password: ${password}\n`,
    { mode: 0o600 }
  );

  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on filesystems without permission support.
  }

  return generated
    ? `A random password was generated and saved to ${file}`
    : `The DEMO_PASSWORD value was saved to ${file}`;
}

const DB_NAME = 'nnss_calabar_test';

if (process.env.DB_NAME === DB_NAME) {
  console.warn(`Note: backend/.env DB_NAME is already ${DB_NAME}.`);
}

const {
  password: PASSWORD,
  generated: PASSWORD_GENERATED
} = resolveDemoPassword();

const STUDENT_COUNT = 900;
const TEACHER_COUNT = 78;

const HOD_DEPARTMENTS = [
  'Sciences',
  'Languages',
  'Arts & Commercial',
  'Technical',
  'Social Studies',
  'Administration'
];

const firstNames = [
  'Amina', 'Daniel', 'Emem', 'Favour', 'Grace',
  'Hassan', 'Ifeoma', 'James', 'Kelechi', 'Mary',
  'Ngozi', 'Okechukwu', 'Peace', 'Samuel', 'Tosin',
  'Usman', 'Victoria', 'Yusuf', 'Ada', 'Bassey'
];

const lastNames = [
  'Bello', 'Okoro', 'Williams', 'Etim', 'Ekanem',
  'Ibrahim', 'Johnson', 'Obi', 'Udo', 'Adebayo',
  'Essien', 'Musa', 'George', 'Nwankwo', 'Archibong',
  'Lawal', 'Udoh', 'Otu', 'Edem', 'Balogun'
];

const teacherFirstNames = [
  'Abasi', 'Blessing', 'Chinedu', 'David', 'Esther',
  'Fatima', 'Gabriel', 'Helen', 'Irene', 'Joseph',
  'Kemi', 'Lawrence', 'Margaret', 'Nathan', 'Olumide',
  'Patience', 'Rita', 'Stephen', 'Theresa', 'Victor',
  'Zainab', 'Andrew', 'Caroline', 'Emmanuel', 'Janet',
  'Michael'
];

const teacherLastNames = [
  'Akan', 'Bassey', 'Chukwu', 'Duke', 'Ekong',
  'Essien', 'Eyo', 'Ita', 'King', 'Mba',
  'Ndi', 'Obot', 'Okon', 'Onyema', 'Peter',
  'Sani', 'Udo', 'Ufot', 'Wright', 'Yakubu'
];

function nameFrom(listA, listB, n) {
  return `${listA[n % listA.length]} ${
    listB[Math.floor(n / listA.length) % listB.length]
  }`;
}

function dateForStudent(i) {
  const year = 2009 + (i % 6);
  const month = String(1 + (i % 12)).padStart(2, '0');
  const day = String(1 + (i % 27)).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  let transactionStarted = false;

  try {
    // Load the actual schema into an isolated test database.
    const schemaPath = path.join(__dirname, 'schema.sql');
    let schema = fs.readFileSync(schemaPath, 'utf8');

    schema = schema.replace(/nnss_calabar/g, DB_NAME);

    await connection.query(schema);
    await connection.query(`USE \`${DB_NAME}\``);

    const [[session]] = await connection.query(`
      SELECT id
      FROM academic_sessions
      WHERE is_current = TRUE
      ORDER BY id DESC
      LIMIT 1
    `);

    assert(
      session,
      'No current academic session was created by the schema.'
    );

    const [classes] = await connection.query(`
      SELECT id, level_name, is_junior
      FROM class_levels
      ORDER BY sort_order, id
    `);

    // Use the real arms seeded by schema.sql.
    // Do not insert OBUDU, CALABAR or KWA: those are not schema arms.
    const [arms] = await connection.query(`
      SELECT id, arm_name, arm_type
      FROM arms
      WHERE is_active = TRUE
      ORDER BY id
    `);

    const [departments] = await connection.query(`
      SELECT id, dept_name
      FROM departments
      ORDER BY id
    `);

    const [subjects] = await connection.query(`
      SELECT id, subject_name, dept_id
      FROM subjects
      WHERE is_active = TRUE
      ORDER BY id
    `);

    const [trackSubjects] = await connection.query(`
      SELECT track, subject_id
      FROM track_subjects
      ORDER BY track, subject_id
    `);

    assert(classes.length >= 6, 'Expected at least six class levels.');
    assert(arms.length > 0, 'Expected schema-defined active arms.');
    assert(departments.length >= 6, 'Expected at least six departments.');
    assert(subjects.length > 0, 'Expected seeded subjects.');

    const deptByName = new Map(
      departments.map(dept => [dept.dept_name, dept])
    );

    const subjectById = new Map(
      subjects.map(subject => [subject.id, subject])
    );

    const trackMap = new Map();

    for (const row of trackSubjects) {
      if (!trackMap.has(row.track)) {
        trackMap.set(row.track, []);
      }

      if (subjectById.has(row.subject_id)) {
        trackMap.get(row.track).push(row.subject_id);
      }
    }

    /*
     * The schema seeds these senior arms:
     * AGU, AYAM, DAMISA, EKUN, EKPE and SIRI.
     *
     * It does not seed separate junior-only arm names. Therefore, use
     * schema-defined arms for junior classes too, while deriving the
     * student's academic track from class_levels.is_junior.
     */
    const classArms = classes.flatMap(classLevel => {
      const validArms = classLevel.is_junior
        ? arms
        : arms.filter(arm => arm.arm_type !== 'junior');

      assert(
        validArms.length > 0,
        `No compatible schema-defined arms for ${classLevel.level_name}.`
      );

      return validArms.map(arm => ({
        classId: classLevel.id,
        className: classLevel.level_name,
        isJunior: Boolean(classLevel.is_junior),
        armId: arm.id,
        armName: arm.arm_name,
        armType: arm.arm_type
      }));
    });

    await connection.beginTransaction();
    transactionStarted = true;

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const studentEnrollments = [];

    // Create students and their enrollments.
    for (let i = 1; i <= STUDENT_COUNT; i += 1) {
      const placement = classArms[(i - 1) % classArms.length];

      let track;

      if (placement.isJunior) {
        track = 'junior';
      } else if (placement.armType === 'science') {
        track = 'science';
      } else if (placement.armType === 'technical') {
        track = 'technical';
      } else {
        track = 'arts';
      }

      const code = `STU${String(i).padStart(4, '0')}`;
      const fullName = nameFrom(firstNames, lastNames, i - 1);
      const gender = i % 2 ? 'F' : 'M';
      const email = `${code.toLowerCase()}@test.nnsscalabar.local`;
      const parentName = nameFrom(lastNames, firstNames, i + 7);
      const parentPhone = `080${String(10000000 + i).slice(-8)}`;

      const [userResult] = await connection.query(
        `INSERT INTO users
          (user_code, full_name, email, password_hash, role, gender, is_active)
         VALUES (?, ?, ?, ?, 'student', ?, TRUE)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           full_name = VALUES(full_name),
           password_hash = VALUES(password_hash),
           is_active = TRUE`,
        [code, fullName, email, passwordHash, gender]
      );

      const userId = userResult.insertId;

      const [studentResult] = await connection.query(
        `INSERT INTO students
          (user_id, admission_no, class_level_id, arm_id,
           date_of_birth, parent_name, parent_phone,
           date_admitted, track, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-01', ?, 'active')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           class_level_id = VALUES(class_level_id),
           arm_id = VALUES(arm_id),
           track = VALUES(track),
           status = 'active'`,
        [
          userId,
          `ADM${String(i).padStart(4, '0')}`,
          placement.classId,
          placement.armId,
          dateForStudent(i),
          parentName,
          parentPhone,
          track
        ]
      );

      const studentId = studentResult.insertId;

      for (const subjectId of (trackMap.get(track) || [])) {
        studentEnrollments.push([
          studentId,
          subjectId,
          session.id
        ]);
      }
    }

    // Create teachers, subject assignments and class assignments.
    for (let i = 1; i <= TEACHER_COUNT; i += 1) {
      const code = `TCH${String(i).padStart(3, '0')}`;
      const fullName = nameFrom(teacherFirstNames, teacherLastNames, i - 1);
      const dept = departments[(i - 1) % departments.length];
      const email = `${code.toLowerCase()}@test.nnsscalabar.local`;

      const [userResult] = await connection.query(
        `INSERT INTO users
          (user_code, full_name, email, phone, password_hash,
           role, gender, is_active)
         VALUES (?, ?, ?, ?, ?, 'teacher', ?, TRUE)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           full_name = VALUES(full_name),
           phone = VALUES(phone),
           password_hash = VALUES(password_hash),
           is_active = TRUE`,
        [
          code,
          fullName,
          email,
          `0701${String(1000000 + i).slice(-7)}`,
          passwordHash,
          i % 2 ? 'F' : 'M'
        ]
      );

      const [teacherResult] = await connection.query(
        `INSERT INTO teachers (user_id, staff_no, dept_id, date_joined)
         VALUES (?, ?, ?, '2020-09-01')
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           dept_id = VALUES(dept_id)`,
        [userResult.insertId, code, dept.id]
      );

      const teacherId = teacherResult.insertId;

      const deptSubjects = subjects.filter(
        subject => subject.dept_id === dept.id
      );

      const assignedSubjects = deptSubjects.length
        ? deptSubjects
        : subjects;

      const subject = assignedSubjects[
        (i - 1) % assignedSubjects.length
      ];

      await connection.query(
        `INSERT IGNORE INTO teacher_subjects
          (teacher_id, subject_id)
         VALUES (?, ?)`,
        [teacherId, subject.id]
      );

      const assignments = classArms
        .filter(placement =>
          !placement.isJunior || dept.dept_name === 'Administration'
        )
        .slice((i - 1) % 3, 12);

      for (const placement of assignments) {
        if (!placement.isJunior ||
            dept.dept_name === 'Administration') {
          await connection.query(
            `INSERT IGNORE INTO teacher_class_assignments
              (teacher_id, subject_id, class_level_id, arm_id, session_id)
             VALUES (?, ?, ?, ?, ?)`,
            [
              teacherId,
              subject.id,
              placement.classId,
              placement.armId,
              session.id
            ]
          );
        }
      }
    }

    // Create separate HOD accounts.
    for (let i = 0; i < HOD_DEPARTMENTS.length; i += 1) {
      const dept = deptByName.get(HOD_DEPARTMENTS[i]);

      assert(dept, `Department not found: ${HOD_DEPARTMENTS[i]}`);

      const code = `HOD${String(i + 1).padStart(3, '0')}`;
      const fullName = `Head ${dept.dept_name}`;
      const email = `${code.toLowerCase()}@test.nnsscalabar.local`;

      const [userResult] = await connection.query(
        `INSERT INTO users
          (user_code, full_name, email, phone, password_hash,
           role, gender, is_active)
         VALUES (?, ?, ?, ?, ?, 'hod', ?, TRUE)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           full_name = VALUES(full_name),
           phone = VALUES(phone),
           password_hash = VALUES(password_hash),
           is_active = TRUE`,
        [
          code,
          fullName,
          email,
          `0702${String(1000000 + i + 1).slice(-7)}`,
          passwordHash,
          i % 2 ? 'F' : 'M'
        ]
      );

      await connection.query(
        `INSERT INTO hods (user_id, dept_id, appointed_date)
         VALUES (?, ?, '2020-09-01')
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id),
           appointed_date = VALUES(appointed_date)`,
        [userResult.insertId, dept.id]
      );
    }

    // Insert enrollments in manageable batches.
    for (let i = 0; i < studentEnrollments.length; i += 500) {
      const batch = studentEnrollments.slice(i, i + 500);

      if (batch.length) {
        await connection.query(
          `INSERT IGNORE INTO student_subject_enrollment
            (student_id, subject_id, session_id)
           VALUES ?`,
          [batch]
        );
      }
    }

    await connection.commit();
    transactionStarted = false;

    const [[counts]] = await connection.query(`
      SELECT
        (SELECT COUNT(*) FROM students) AS students,
        (SELECT COUNT(*) FROM teachers) AS teachers,
        (SELECT COUNT(*) FROM hods) AS hods,
        (SELECT COUNT(*) FROM student_subject_enrollment) AS enrollments,
        (SELECT COUNT(*) FROM results) AS results
    `);

    console.log(`Created test database: ${DB_NAME}`);
    console.log(
      `Students: ${counts.students}; ` +
      `teachers: ${counts.teachers}; ` +
      `HODs: ${counts.hods}; ` +
      `enrollments: ${counts.enrollments}; ` +
      `results: ${counts.results}`
    );

    console.log(saveDemoPassword(PASSWORD, PASSWORD_GENERATED));
    console.log(
      `Student login range: STU0001–STU${String(STUDENT_COUNT).padStart(4, '0')}`
    );
    console.log(
      `Teacher login range: TCH001–TCH${String(TEACHER_COUNT).padStart(3, '0')}`
    );

    const [perDept] = await connection.query(`
      SELECT d.dept_name, COUNT(t.id) AS teachers
      FROM departments d
      LEFT JOIN teachers t ON t.dept_id = d.id
      GROUP BY d.id
      ORDER BY d.id
    `);

    console.log(
      'Teachers per department: ' +
      perDept.map(dept => `${dept.dept_name} ${dept.teachers}`).join(', ')
    );

    console.log(
      `Open it in the portal by setting DB_NAME=${DB_NAME} ` +
      'in a COPY of backend/.env; your real database is not touched.'
    );
    console.log('HOD login range: HOD001–HOD006');
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }
    }

    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`Test database seed failed: ${error.message}`);
  process.exitCode = 1;
});
