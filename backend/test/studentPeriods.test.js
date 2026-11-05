const test = require('node:test');
const assert = require('node:assert/strict');
const { groupPeriods } = require('../studentPeriods');

const row = (sid, sname, scur, tn, tcur, results) => ({ session_id: sid, session_name: sname, session_current: scur, term_id: sid * 10 + tn, term_number: tn, term_name: ['First', 'Second', 'Third'][tn - 1] + ' Term', term_current: tcur, results });

test('groups terms under their session, newest session first, and flags which have results', () => {
  const p = groupPeriods([row(2, '2026/2027', 1, 1, 1, 0), row(2, '2026/2027', 1, 2, 0, 0), row(1, '2025/2026', 0, 1, 0, 11), row(1, '2025/2026', 0, 2, 0, 0)]);
  assert.deepEqual(p.sessions.map(s => s.session_name), ['2026/2027', '2025/2026']);
  assert.deepEqual(p.sessions[1].terms.map(t => [t.term_name, t.has_results]), [['First Term', true], ['Second Term', false]]);
});

test('opens on the latest term that has results', () => {
  const p = groupPeriods([row(2, '2026/2027', 1, 1, 1, 0), row(1, '2025/2026', 0, 1, 0, 9), row(1, '2025/2026', 0, 2, 0, 7), row(1, '2025/2026', 0, 3, 0, 0)]);
  assert.deepEqual(p.default, { session_name: '2025/2026', term_name: 'Second Term' });
});

test('a student with no results yet opens on the current term', () => {
  const p = groupPeriods([row(2, '2026/2027', 1, 1, 0, 0), row(2, '2026/2027', 1, 2, 1, 0), row(1, '2025/2026', 0, 1, 0, 0)]);
  assert.deepEqual(p.default, { session_name: '2026/2027', term_name: 'Second Term' });
});

test('no sessions set up at all gives no default and no crash', () => {
  assert.deepEqual(groupPeriods([]), { sessions: [], default: null });
});
