'use strict';
/*
 * Class "Continuous Assessment Sheet" service layer.
 *
 * One sheet = one subject, for one class + arm, in one term (exactly what the
 * paper sheet is). This module resolves which sheet a request means, enforces
 * who may see / edit it, loads it, and saves it.
 */
const db = require('./db');
const scheme = require('./scheme');

const ROSTER_STATUSES = ['active', 'repeating'];
const fail = (status, message, extra) => ({ error: { status, message, ...extra } });
const toNum = v => (v === null || v === undefined ? null : Number(v));

async function teacherRecord(userId) {
  const [[row]] = await db.query('SELECT id, dept_id FROM teachers WHERE user_id=? LIMIT 1', [userId]);
  return row || null;
}
async function hodRecord(userId) {
  const [[row]] = await db.query('SELECT id, dept_id FROM hods WHERE user_id=? LIMIT 1', [userId]);
  return row || null;
}

/**
 * Works out which sheet the request is about and whether this user may use it.
 * `q` is req.query (GET) or req.body (POST). Either
 *   { assignment_id, term_id }                      – how a teacher picks a sheet, or
 *   { class_level_id, arm_id, subject_id, term_id } – how HOD / admin / commandant browse.
 * Returns { ctx } or { error: { status, message } }.
 */
async function resolveSheetContext(user, q) {
  const role = user.role;
  if (!['teacher', 'hod', 'admin', 'commandant'].includes(role)) return fail(403, 'Result sheets are only available to staff.');

  const termId = Number(q.term_id);
  if (!Number.isInteger(termId) || termId < 1) return fail(400, 'Select an academic term.');

  let subjectId; let classLevelId; let armId; let assignment = null;
  if (q.assignment_id !== undefined && q.assignment_id !== null && q.assignment_id !== '') {
    const aid = Number(q.assignment_id);
    if (!Number.isInteger(aid) || aid < 1) return fail(400, 'Select a valid teaching assignment.');
    [[assignment]] = await db.query('SELECT id, teacher_id, subject_id, class_level_id, arm_id, session_id FROM teacher_class_assignments WHERE id=? LIMIT 1', [aid]);
    if (!assignment) return fail(404, 'Teaching assignment not found.');
    subjectId = assignment.subject_id; classLevelId = assignment.class_level_id; armId = assignment.arm_id;
  } else {
    subjectId = Number(q.subject_id); classLevelId = Number(q.class_level_id); armId = Number(q.arm_id);
    if (![subjectId, classLevelId, armId].every(n => Number.isInteger(n) && n > 0)) return fail(400, 'Select a class, arm, subject and term.');
  }

  const [[subject]] = await db.query('SELECT id, subject_name, dept_id, is_active FROM subjects WHERE id=? LIMIT 1', [subjectId]);
  const [[classLevel]] = await db.query('SELECT id, level_name, is_junior FROM class_levels WHERE id=? LIMIT 1', [classLevelId]);
  const [[arm]] = await db.query('SELECT id, arm_name FROM arms WHERE id=? LIMIT 1', [armId]);
  const [[term]] = await db.query(`SELECT t.id, t.term_name, t.session_id, t.result_locked, ac.session_name
    FROM terms t JOIN academic_sessions ac ON ac.id=t.session_id WHERE t.id=? LIMIT 1`, [termId]);
  if (!subject || !classLevel || !arm) return fail(404, 'That class, arm or subject no longer exists.');
  if (!term) return fail(404, 'Academic term not found.');
  if (assignment && assignment.session_id !== term.session_id) return fail(400, 'The selected term does not belong to this teaching assignment\'s session.');

  let teacher = null;
  if (role === 'teacher') {
    teacher = await teacherRecord(user.id);
    if (!teacher) return fail(404, 'Teacher record not found.');
    if (assignment) {
      if (assignment.teacher_id !== teacher.id) return fail(403, 'That assignment is not assigned to your account.');
    } else {
      const [[mine]] = await db.query(`SELECT id FROM teacher_class_assignments
        WHERE teacher_id=? AND subject_id=? AND class_level_id=? AND arm_id=? AND session_id=? LIMIT 1`,
        [teacher.id, subjectId, classLevelId, armId, term.session_id]);
      if (!mine) return fail(403, 'You are not assigned to this subject and class.');
    }
  }
  if (role === 'hod') {
    const hod = await hodRecord(user.id);
    if (!hod || hod.dept_id !== subject.dept_id) return fail(403, 'This subject belongs to another department.');
  }

  return {
    ctx: {
      role, teacher, subject, classLevel, arm, term,
      canEdit: role === 'teacher' && !term.result_locked
    }
  };
}

const RESULT_COLUMNS = `r.id AS result_id, r.test1_score, r.quiz_score, r.assignment_score, r.test2_score, r.project_score, r.note_score,
  r.ca_score, r.exam_score, r.total_score, r.grade, r.remark, r.is_approved, r.rejected_at, r.rejection_note`;

function rowFromDb(row) {
  const comps = {
    test1: toNum(row.test1_score), quiz: toNum(row.quiz_score), assignment: toNum(row.assignment_score),
    test2: toNum(row.test2_score), project: toNum(row.project_score), note: toNum(row.note_score)
  };
  const hasResult = row.result_id !== null && row.result_id !== undefined;
  const componentsRecorded = Object.values(comps).some(v => v !== null);
  // Results saved before the sheet redesign only have a CA total. Show that
  // total honestly rather than inventing a split across the six components.
  const legacy = hasResult && !componentsRecorded && Number(row.ca_score) > 0;
  let state = 'none';
  if (hasResult) state = row.is_approved ? 'approved' : (row.rejected_at ? 'rejected' : 'pending');
  return {
    student_id: row.student_id,
    user_code: row.user_code,
    full_name: row.full_name,
    status: row.status,
    result_id: hasResult ? row.result_id : null,
    scores: { ...comps, exam: hasResult ? toNum(row.exam_score) : null },
    ca_total: hasResult ? toNum(row.ca_score) : null,
    total: hasResult ? toNum(row.total_score) : null,
    grade: hasResult ? row.grade : null,
    remark: hasResult ? row.remark : null,
    legacy_ca: legacy,
    state,
    rejection_note: row.rejection_note || null
  };
}

async function loadRoster(conn, ctx) {
  const [rows] = await conn.query(`SELECT st.id AS student_id, u.user_code, u.full_name, st.status, ${RESULT_COLUMNS}
    FROM students st JOIN users u ON u.id=st.user_id
    LEFT JOIN results r ON r.student_id=st.id AND r.subject_id=? AND r.term_id=?
    WHERE st.class_level_id=? AND st.arm_id=? AND u.is_active=1 AND st.status IN (?)
    ORDER BY u.full_name`, [ctx.subject.id, ctx.term.id, ctx.classLevel.id, ctx.arm.id, ROSTER_STATUSES]);
  return rows.map(rowFromDb);
}

async function loadSheet(ctx) {
  const students = await loadRoster(db, ctx);
  const [teachers] = await db.query(`SELECT DISTINCT tu.full_name FROM teacher_class_assignments tca
    JOIN teachers t ON t.id=tca.teacher_id JOIN users tu ON tu.id=t.user_id
    WHERE tca.subject_id=? AND tca.class_level_id=? AND tca.arm_id=? AND tca.session_id=? ORDER BY tu.full_name`,
    [ctx.subject.id, ctx.classLevel.id, ctx.arm.id, ctx.term.session_id]);
  const counts = { none: 0, pending: 0, approved: 0, rejected: 0 };
  students.forEach(s => { counts[s.state] += 1; });
  return {
    header: {
      school_name: scheme.SCHOOL_NAME,
      class_level_id: ctx.classLevel.id, class_name: ctx.classLevel.level_name, is_junior: !!ctx.classLevel.is_junior,
      arm_id: ctx.arm.id, arm_name: ctx.arm.arm_name,
      subject_id: ctx.subject.id, subject_name: ctx.subject.subject_name,
      term_id: ctx.term.id, term_name: ctx.term.term_name,
      session_name: ctx.term.session_name,
      no_in_class: students.length,
      teachers: teachers.map(t => t.full_name)
    },
    locked: !!ctx.term.result_locked,
    can_edit: ctx.canEdit,
    counts,
    students
  };
}

const sameNum = (a, b) => (a === null || a === undefined ? null : Number(a)) === (b === null || b === undefined ? null : Number(b));

/**
 * Saves a whole class sheet in one transaction.
 *
 *  - Rows left completely blank are skipped (student absent / not assessed).
 *  - Every other row must have all seven fields filled (0 is a valid mark),
 *    so a half-entered row can never reach the HOD's approval queue.
 *  - Rows whose marks did not change are left untouched, so re-saving a sheet
 *    does not throw already-approved results back into the approval queue.
 *  - A changed row goes back to "pending" and clears any earlier rejection.
 */
async function saveSheetRows(ctx, user, submitted) {
  if (!Array.isArray(submitted)) return fail(400, 'No rows were supplied.');
  if (submitted.length > 400) return fail(400, 'Too many rows in one sheet.');
  if (ctx.term.result_locked) return fail(409, 'This term is locked and cannot be edited.');

  const conn = await db.getConnection();
  try {
    const roster = await loadRoster(conn, ctx);
    const byCode = new Map(roster.map(s => [s.user_code, s]));

    const rowErrors = []; const toSave = []; const seen = new Set();
    let skippedBlank = 0; let unchanged = 0;
    submitted.forEach((raw, idx) => {
      const code = String(raw?.student_code || '').trim().toUpperCase();
      const student = byCode.get(code);
      if (!student) { rowErrors.push({ row: idx + 1, student_code: code, name: null, messages: ['This student is not on the active roster for this class.'] }); return; }
      if (seen.has(code)) { rowErrors.push({ row: idx + 1, student_code: code, name: student.full_name, messages: ['This student appears twice.'] }); return; }
      seen.add(code);
      const parsed = scheme.parseScores(raw);
      if (parsed.blank && !parsed.errors.length) { skippedBlank += 1; return; }
      const messages = [...parsed.errors];
      if (!parsed.errors.length) {
        const missing = [...scheme.COMPONENTS, { key: 'exam', label: 'Exam' }].filter(f => parsed.values[f.key] === null).map(f => f.label);
        if (missing.length) messages.push(`Missing: ${missing.join(', ')} (enter 0 if the student scored nothing).`);
      }
      if (messages.length) { rowErrors.push({ row: idx + 1, student_code: code, name: student.full_name, messages }); return; }

      const ex = student.scores;
      const same = student.result_id && !student.legacy_ca && scheme.FIELD_KEYS.every(k => sameNum(ex[k], parsed.values[k]));
      if (same) { unchanged += 1; return; }
      toSave.push({ student, values: parsed.values });
    });

    if (rowErrors.length) return fail(400, `${rowErrors.length} row${rowErrors.length === 1 ? ' needs' : 's need'} correction before this sheet can be saved.`, { row_errors: rowErrors });
    if (!toSave.length) return { saved: 0, unchanged, skipped_blank: skippedBlank };

    await conn.beginTransaction();
    for (const { student, values } of toSave) {
      const ca = scheme.caTotal(values);
      await conn.query(`INSERT INTO results
          (student_id, subject_id, term_id, teacher_id, test1_score, quiz_score, assignment_score, test2_score, project_score, note_score, ca_score, exam_score, is_junior, is_approved)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)
        ON DUPLICATE KEY UPDATE
          test1_score=VALUES(test1_score), quiz_score=VALUES(quiz_score), assignment_score=VALUES(assignment_score),
          test2_score=VALUES(test2_score), project_score=VALUES(project_score), note_score=VALUES(note_score),
          ca_score=VALUES(ca_score), exam_score=VALUES(exam_score), teacher_id=VALUES(teacher_id), is_junior=VALUES(is_junior),
          is_approved=0, approved_by=NULL, approved_at=NULL, rejected_at=NULL, rejected_by=NULL, rejection_note=NULL,
          updated_at=CURRENT_TIMESTAMP`,
        [student.student_id, ctx.subject.id, ctx.term.id, ctx.teacher.id,
          values.test1, values.quiz, values.assignment, values.test2, values.project, values.note, ca, values.exam, ctx.classLevel.is_junior ? 1 : 0]);
      await conn.query(`INSERT INTO result_approval_log (result_id, action, actor_id, note)
        SELECT r.id, 'revised', ?, ? FROM results r WHERE r.student_id=? AND r.subject_id=? AND r.term_id=?`,
        [user.id, 'Score sheet submitted/revised by teacher', student.student_id, ctx.subject.id, ctx.term.id]);
    }
    await conn.commit();
    return { saved: toSave.length, unchanged, skipped_blank: skippedBlank };
  } catch (err) {
    try { await conn.rollback(); } catch { /* nothing to roll back */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * One row per (class, arm, subject) assignment in a term with how far its
 * sheet has got. Powers the HOD / admin / Commandant "Result Sheets" and
 * "Submission Progress" views.
 */
async function sheetIndex(termId, { deptId = null, teacherId = null } = {}) {
  const [[term]] = await db.query(`SELECT t.id, t.term_name, t.session_id, t.result_locked, ac.session_name
    FROM terms t JOIN academic_sessions ac ON ac.id=t.session_id WHERE t.id=? LIMIT 1`, [termId]);
  if (!term) return null;
  const params = [termId, term.session_id];
  let deptClause = '';
  if (deptId) { deptClause = 'AND sub.dept_id=?'; params.push(deptId); }
  if (teacherId) { deptClause += ' AND tca.teacher_id=?'; params.push(teacherId); }
  const [rows] = await db.query(`SELECT tca.id AS assignment_id, tca.subject_id, tca.class_level_id, tca.arm_id,
      sub.subject_name, sub.dept_id, d.dept_name, cl.level_name AS class_name, a.arm_name, tu.full_name AS teacher_name,
      (SELECT COUNT(*) FROM students st JOIN users su ON su.id=st.user_id
        WHERE st.class_level_id=tca.class_level_id AND st.arm_id=tca.arm_id AND su.is_active=1 AND st.status IN ('active','repeating')) AS roster_count,
      COUNT(r.id) AS entered,
      COALESCE(SUM(r.is_approved=1),0) AS approved,
      COALESCE(SUM(r.is_approved=0 AND r.rejected_at IS NULL),0) AS pending,
      COALESCE(SUM(r.is_approved=0 AND r.rejected_at IS NOT NULL),0) AS rejected,
      ROUND(AVG(r.total_score),1) AS avg_score
    FROM teacher_class_assignments tca
    JOIN subjects sub ON sub.id=tca.subject_id
    JOIN class_levels cl ON cl.id=tca.class_level_id
    JOIN arms a ON a.id=tca.arm_id
    JOIN teachers t ON t.id=tca.teacher_id
    JOIN users tu ON tu.id=t.user_id
    LEFT JOIN departments d ON d.id=sub.dept_id
    LEFT JOIN students sx ON sx.class_level_id=tca.class_level_id AND sx.arm_id=tca.arm_id AND sx.status IN ('active','repeating')
    LEFT JOIN results r ON r.student_id=sx.id AND r.subject_id=tca.subject_id AND r.term_id=?
    WHERE tca.session_id=? AND sub.is_active=1 ${deptClause}
    GROUP BY tca.id, sub.id, d.id, cl.id, a.id, tu.id
    ORDER BY cl.sort_order, cl.id, a.arm_name, sub.subject_name`, params);
  const sheets = rows.map(r => {
    const roster = Number(r.roster_count); const entered = Number(r.entered);
    const approved = Number(r.approved); const pending = Number(r.pending); const rejected = Number(r.rejected);
    let status = 'not_started';
    if (entered > 0) status = 'in_progress';
    if (roster > 0 && entered >= roster) status = pending || rejected ? 'submitted' : 'approved';
    return {
      assignment_id: r.assignment_id, subject_id: r.subject_id, class_level_id: r.class_level_id, arm_id: r.arm_id,
      subject_name: r.subject_name, dept_id: r.dept_id, dept_name: r.dept_name,
      class_name: r.class_name, arm_name: r.arm_name, teacher_name: r.teacher_name,
      roster_count: roster, entered, approved, pending, rejected,
      avg_score: r.avg_score === null ? null : Number(r.avg_score), status
    };
  });
  return { term: { id: term.id, term_name: term.term_name, session_name: term.session_name, result_locked: !!term.result_locked }, sheets };
}

module.exports = { resolveSheetContext, loadSheet, loadRoster, saveSheetRows, sheetIndex, teacherRecord, hodRecord, ROSTER_STATUSES };
