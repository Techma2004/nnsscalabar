const test = require('node:test');
const assert = require('node:assert/strict');
const { commandantComment } = require('../reportComment');

const subj = (...t) => t.map((total, i) => ({ name: `S${i + 1}`, total }));

test('the band follows the grading scale of the student\'s class', () => {
  // 78% average: Excellent on the senior scale (A1 from 75), only Credit on the junior scale (A from 80).
  assert.match(commandantComment({ average: 78, isJunior: false, subjects: subj(78) }), /outstanding/i);
  assert.match(commandantComment({ average: 78, isJunior: true, subjects: subj(78) }), /fair result/i);
  assert.match(commandantComment({ average: 82, isJunior: true, subjects: subj(82) }), /outstanding/i);
});

test('every band gives a different comment', () => {
  const avgs = [80, 72, 66, 58, 42, 30];
  const texts = avgs.map(a => commandantComment({ average: a, isJunior: false, subjects: subj(a) }));
  assert.equal(new Set(texts).size, avgs.length);
});

test('failed subjects are named only when there are some', () => {
  const none = commandantComment({ average: 64, isJunior: false, subjects: subj(64, 70) });
  assert.doesNotMatch(none, /Special attention/);
  const some = commandantComment({ average: 50, isJunior: false, subjects: [{ name: 'Chemistry', total: 30 }, { name: 'Physics', total: 35 }, { name: 'Biology', total: 90 }] });
  assert.match(some, /Special attention is needed in Chemistry and Physics\./);
  // 45 is a pass for SSS (D7) but a fail for JSS (F).
  assert.doesNotMatch(commandantComment({ average: 60, isJunior: false, subjects: [{ name: 'Art', total: 45 }] }), /Special attention/);
  assert.match(commandantComment({ average: 60, isJunior: true, subjects: [{ name: 'Art', total: 45 }] }), /Special attention is needed in Art\./);
});

test('class position is mentioned only for the top three of a real class', () => {
  assert.match(commandantComment({ average: 70, subjects: subj(70), position: 1, armSize: 30 }), /first in the class/);
  assert.match(commandantComment({ average: 70, subjects: subj(70), position: 3, armSize: 30 }), /3rd in the class/);
  assert.doesNotMatch(commandantComment({ average: 70, subjects: subj(70), position: 4, armSize: 30 }), /in the class/);
  assert.doesNotMatch(commandantComment({ average: 70, subjects: subj(70), position: 1, armSize: 1 }), /in the class/);
});

test('no approved results means no comment', () => {
  assert.equal(commandantComment({ average: 0, subjects: [] }), null);
  assert.equal(commandantComment({ average: NaN, subjects: subj(50) }), null);
});
