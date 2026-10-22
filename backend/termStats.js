'use strict';
/*
 * Term statistics for a student's report card.
 *
 * Every figure is OPTIONAL: it is `null` whenever it cannot be worked out
 * honestly from approved results (no peers, nothing approved yet, ...), and the
 * portal simply leaves that line off the report card. Nothing is estimated.
 *
 *   result average  - the student's mean total across their approved subjects
 *   arm average     - mean of the result averages of every student in the same class + arm
 *   class average   - the same, across every arm of the class level
 *   position        - rank in the arm by result average (ties share a rank: 1, 2, 2, 4)
 *   per subject     - arm average, class average, highest and lowest score, and the
 *                     student's position among the arm for each subject
 *
 * `computeTermStats` is pure (rows in, numbers out) so it is unit-tested without a database.
 */

const round1 = n => Math.round(n * 10) / 10;
const mean = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/**
 * @param {object} input
 * @param {number} input.studentId
 * @param {number} input.armId                                       the student's arm
 * @param {{student_id:number, arm_id:number, avg_total:number, subjects:number}[]} input.students
 *        one entry per student in the class level who has approved results this term
 * @param {{subject_id:number, arm_id:number, n:number, sum_total:number, max_total:number}[]} input.subjectArms
 *        approved-result aggregates per subject and arm for the class level
 * @param {{subject_id:number, total:number}[]} input.studentSubjects  the student's own approved results
 * @param {{subject_id:number, total:number}[]} [input.armTotals]      every approved total in the student's arm (for lowest score and subject position)
 */
function computeTermStats({ studentId, armId, students, subjectArms, studentSubjects, armTotals = null }) {
  const me = students.find(s => s.student_id === studentId);
  if (!me) return null;

  const armPeers = students.filter(s => s.arm_id === armId);
  const armAvg = mean(armPeers.map(s => Number(s.avg_total)));
  const classAvg = mean(students.map(s => Number(s.avg_total)));

  // Competition ranking: equal averages share a rank, the next rank is skipped.
  const mine = Number(me.avg_total);
  const position = 1 + armPeers.filter(s => round1(Number(s.avg_total)) > round1(mine)).length;

  const subjects = {};
  for (const sub of studentSubjects) {
    const inArm = subjectArms.filter(x => x.subject_id === sub.subject_id && x.arm_id === armId);
    const inClass = subjectArms.filter(x => x.subject_id === sub.subject_id);
    const armN = inArm.reduce((a, x) => a + Number(x.n), 0);
    const classN = inClass.reduce((a, x) => a + Number(x.n), 0);
    const totals = armTotals ? armTotals.filter(x => x.subject_id === sub.subject_id).map(x => Number(x.total)) : [];
    subjects[sub.subject_id] = {
      arm_average: armN ? round1(inArm.reduce((a, x) => a + Number(x.sum_total), 0) / armN) : null,
      class_average: classN ? round1(inClass.reduce((a, x) => a + Number(x.sum_total), 0) / classN) : null,
      highest_in_arm: armN ? Math.max(...inArm.map(x => Number(x.max_total))) : null,
      students_in_arm: armN || null,
      lowest_in_arm: totals.length ? Math.min(...totals) : null,
      // Competition ranking again: equal totals share a position.
      position_in_arm: totals.length ? 1 + totals.filter(t => round1(t) > round1(Number(sub.total))).length : null
    };
  }

  return {
    result_average: round1(mine),
    arm_average: armAvg === null ? null : round1(armAvg),
    class_average: classAvg === null ? null : round1(classAvg),
    position,
    arm_size: armPeers.length,
    class_size: students.length,
    subjects
  };
}

/**
 * Loads the inputs for one student + term from the database and runs computeTermStats.
 * Only approved results count, so unpublished marks can never leak into an average.
 */
async function loadTermStats(db, { studentId, classLevelId, armId, termId, studentSubjects }) {
  const [students] = await db.query(
    `SELECT s.id AS student_id, s.arm_id, AVG(r.total_score) AS avg_total, COUNT(*) AS subjects
       FROM results r JOIN students s ON s.id = r.student_id JOIN users u ON u.id = s.user_id
      WHERE r.term_id = ? AND r.is_approved = 1 AND s.class_level_id = ? AND u.is_active = 1 AND s.status <> 'withdrawn'
      GROUP BY s.id, s.arm_id`, [termId, classLevelId]);
  const [subjectArms] = await db.query(
    `SELECT r.subject_id, s.arm_id, COUNT(*) AS n, SUM(r.total_score) AS sum_total, MAX(r.total_score) AS max_total
       FROM results r JOIN students s ON s.id = r.student_id JOIN users u ON u.id = s.user_id
      WHERE r.term_id = ? AND r.is_approved = 1 AND s.class_level_id = ? AND u.is_active = 1 AND s.status <> 'withdrawn'
      GROUP BY r.subject_id, s.arm_id`, [termId, classLevelId]);
  const [armTotals] = await db.query(
    `SELECT r.subject_id, r.total_score AS total
       FROM results r JOIN students s ON s.id = r.student_id JOIN users u ON u.id = s.user_id
      WHERE r.term_id = ? AND r.is_approved = 1 AND s.class_level_id = ? AND s.arm_id = ? AND u.is_active = 1 AND s.status <> 'withdrawn'`,
    [termId, classLevelId, armId]);
  return computeTermStats({
    studentId, armId,
    armTotals: armTotals.map(r => ({ subject_id: r.subject_id, total: Number(r.total) })),
    students: students.map(r => ({ student_id: r.student_id, arm_id: r.arm_id, avg_total: Number(r.avg_total), subjects: Number(r.subjects) })),
    subjectArms: subjectArms.map(r => ({ subject_id: r.subject_id, arm_id: r.arm_id, n: Number(r.n), sum_total: Number(r.sum_total), max_total: Number(r.max_total) })),
    studentSubjects
  });
}

module.exports = { computeTermStats, loadTermStats };
