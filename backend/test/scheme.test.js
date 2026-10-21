const test = require('node:test');
const assert = require('node:assert/strict');
const scheme = require('../scheme');

test('CA is 30 and exam is 70, out of 100', () => {
  assert.equal(scheme.CA_MAX, 30);
  assert.equal(scheme.EXAM_MAX, 70);
  assert.equal(scheme.TOTAL_MAX, 100);
  assert.equal(scheme.GROUPS.ca1.max, 15);
  assert.equal(scheme.GROUPS.ca2.max, 15);
});

test('every CA column is out of 5', () => {
  assert.equal(scheme.COMPONENTS.length, 6);
  for (const c of scheme.COMPONENTS) assert.equal(c.max, 5, c.label);
});

test('Senior Secondary uses the WAEC A1-F9 scale', () => {
  const cases = [[100, 'A1'], [75, 'A1'], [74, 'B2'], [70, 'B2'], [69, 'B3'], [65, 'B3'], [64, 'C4'], [60, 'C4'], [59, 'C5'], [55, 'C5'],
    [54, 'C6'], [50, 'C6'], [49, 'D7'], [45, 'D7'], [44, 'E8'], [40, 'E8'], [39, 'F9'], [0, 'F9']];
  for (const [total, grade] of cases) assert.equal(scheme.gradeFor(total, false).grade, grade, `SSS ${total}`);
  assert.equal(scheme.gradeFor(50, false).remark, 'Credit');
});

test('Junior Secondary uses A / C / P / F', () => {
  const cases = [[100, 'A'], [80, 'A'], [79, 'C'], [60, 'C'], [59, 'P'], [50, 'P'], [49, 'F'], [0, 'F']];
  for (const [total, grade] of cases) assert.equal(scheme.gradeFor(total, true).grade, grade, `JSS ${total}`);
  assert.equal(scheme.gradeFor(85, true).remark, 'Excellent');
  assert.equal(scheme.gradeFor(65, true).remark, 'Credit');
  assert.equal(scheme.gradeFor(55, true).remark, 'Pass');
  assert.equal(scheme.gradeFor(10, true).remark, 'Fail');
});

test('no grade for a missing total', () => {
  assert.equal(scheme.gradeFor(null), null);
  assert.equal(scheme.gradeFor(''), null);
  assert.equal(scheme.gradeFor('abc'), null);
});

test('scores above the new maxima are rejected', () => {
  const ok = scheme.parseScores({ test1: 5, quiz: 5, assignment: 5, test2: 5, project: 5, note: 5, exam: 70 });
  assert.deepEqual(ok.errors, []);
  assert.equal(scheme.caTotal(ok.values), 30);
  const bad = scheme.parseScores({ test1: 6, quiz: 5.5, exam: 71 });
  assert.equal(bad.errors.length, 3);
});
