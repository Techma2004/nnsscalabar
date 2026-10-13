const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTermStats } = require('../termStats');

const students = [
  { student_id: 1, arm_id: 10, avg_total: 80 },
  { student_id: 2, arm_id: 10, avg_total: 60 },
  { student_id: 3, arm_id: 10, avg_total: 80 },
  { student_id: 4, arm_id: 11, avg_total: 40 }
];
const subjectArms = [
  { subject_id: 7, arm_id: 10, n: 3, sum_total: 210, max_total: 90 },
  { subject_id: 7, arm_id: 11, n: 1, sum_total: 30, max_total: 30 }
];

test('arm average, class average and result average', () => {
  const s = computeTermStats({ studentId: 2, armId: 10, students, subjectArms, studentSubjects: [{ subject_id: 7, total: 60 }] });
  assert.equal(s.result_average, 60);
  assert.equal(s.arm_average, 73.3);
  assert.equal(s.class_average, 65);
  assert.equal(s.arm_size, 3);
  assert.equal(s.class_size, 4);
});

test('ties share a position and the next rank is skipped', () => {
  const a = computeTermStats({ studentId: 1, armId: 10, students, subjectArms, studentSubjects: [] });
  const b = computeTermStats({ studentId: 3, armId: 10, students, subjectArms, studentSubjects: [] });
  const c = computeTermStats({ studentId: 2, armId: 10, students, subjectArms, studentSubjects: [] });
  assert.deepEqual([a.position, b.position, c.position], [1, 1, 3]);
});

test('per-subject arm average, class average and highest', () => {
  const s = computeTermStats({ studentId: 1, armId: 10, students, subjectArms, studentSubjects: [{ subject_id: 7, total: 80 }] });
  assert.deepEqual(s.subjects[7], { arm_average: 70, class_average: 60, highest_in_arm: 90, students_in_arm: 3 });
});

test('subject with no peers yields nulls, and an unknown student yields null', () => {
  const s = computeTermStats({ studentId: 1, armId: 10, students, subjectArms, studentSubjects: [{ subject_id: 99, total: 50 }] });
  assert.equal(s.subjects[99].arm_average, null);
  assert.equal(s.subjects[99].highest_in_arm, null);
  assert.equal(computeTermStats({ studentId: 42, armId: 10, students, subjectArms, studentSubjects: [] }), null);
});
