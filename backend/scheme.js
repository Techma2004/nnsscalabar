'use strict';
/*
 * Continuous-assessment scheme used by NNSS Calabar's "Continuous Assessment
 * Sheet". This is the single source of truth for the backend (validation,
 * totals, the Excel template) and is served to the browser via
 * GET /api/results/scheme so the UI can never drift from the server.
 *
 * Layout of the paper sheet this models:
 *
 *   1ST TEST (15) | QUIZ (5) | ASSIGNMENT (5) | TOTAL (25)
 *   2ND TEST (5)  | PROJECT (5) | NOTE (5)     | TOTAL (15)
 *   EXAM (60)     | TERM'S TOTAL (100)         | GRADE
 *
 * The exam maximum is not printed on the sheet; 60 is what makes the sheet add
 * up to 100 (25 + 15 + 60), which the grading scale also requires.
 */

const SCHOOL_NAME = 'NIGERIAN NAVY SECONDARY SCHOOL AKPABUYO CALABAR';

// `key` is the JSON field name used by the API; `column` is the DB column.
const COMPONENTS = [
  { key: 'test1',      column: 'test1_score',      label: '1st Test',   max: 15, group: 'ca1' },
  { key: 'quiz',       column: 'quiz_score',       label: 'Quiz',       max: 5,  group: 'ca1' },
  { key: 'assignment', column: 'assignment_score', label: 'Assignment', max: 5,  group: 'ca1' },
  { key: 'test2',      column: 'test2_score',      label: '2nd Test',   max: 5,  group: 'ca2' },
  { key: 'project',    column: 'project_score',    label: 'Project',    max: 5,  group: 'ca2' },
  { key: 'note',       column: 'note_score',       label: 'Note',       max: 5,  group: 'ca2' }
];
const GROUPS = {
  ca1: { label: 'Total', max: 25 },
  ca2: { label: 'Total', max: 15 }
};
const EXAM_MAX = 60;
const CA_MAX = COMPONENTS.reduce((sum, c) => sum + c.max, 0); // 40
const TOTAL_MAX = CA_MAX + EXAM_MAX;                           // 100

// Same WAEC-style scale the database uses for results.grade / results.remark.
const GRADE_SCALE = [
  { min: 75, grade: 'A1', remark: 'Excellent' },
  { min: 70, grade: 'B2', remark: 'Very Good' },
  { min: 65, grade: 'B3', remark: 'Very Good' },
  { min: 60, grade: 'C4', remark: 'Good' },
  { min: 55, grade: 'C5', remark: 'Good' },
  { min: 50, grade: 'C6', remark: 'Credit' },
  { min: 45, grade: 'D7', remark: 'Pass' },
  { min: 40, grade: 'E8', remark: 'Pass' },
  { min: 0,  grade: 'F9', remark: 'Fail' }
];

const FIELD_KEYS = [...COMPONENTS.map(c => c.key), 'exam'];

function gradeFor(total) {
  const t = Number(total);
  if (!Number.isFinite(t)) return null;
  return GRADE_SCALE.find(g => t >= g.min) || GRADE_SCALE[GRADE_SCALE.length - 1];
}

const round2 = n => Math.round(n * 100) / 100;

/**
 * Parse one sheet row. Blank / null / undefined / '' means "not recorded" and
 * is kept as null; anything else must be a finite number within 0..max.
 * Returns { values, errors, blank } where `values` has a number-or-null for
 * every field in FIELD_KEYS.
 */
function parseScores(input) {
  const values = {};
  const errors = [];
  let filled = 0;
  const fields = [...COMPONENTS.map(c => ({ key: c.key, label: c.label, max: c.max })), { key: 'exam', label: 'Exam', max: EXAM_MAX }];
  for (const f of fields) {
    const raw = input ? input[f.key] : undefined;
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) { values[f.key] = null; continue; }
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) { values[f.key] = null; errors.push(`${f.label} must be a number.`); continue; }
    if (n < 0 || n > f.max) { values[f.key] = null; errors.push(`${f.label} must be between 0 and ${f.max}.`); continue; }
    values[f.key] = round2(n);
    filled += 1;
  }
  return { values, errors, blank: filled === 0 };
}

/** Sum of the six continuous-assessment components (blank counts as 0). */
function caTotal(values) {
  return round2(COMPONENTS.reduce((sum, c) => sum + (Number(values[c.key]) || 0), 0));
}
function groupTotal(values, group) {
  return round2(COMPONENTS.filter(c => c.group === group).reduce((sum, c) => sum + (Number(values[c.key]) || 0), 0));
}

/** Public description of the scheme for the browser. */
function describe() {
  return {
    school_name: SCHOOL_NAME,
    components: COMPONENTS.map(({ key, label, max, group }) => ({ key, label, max, group })),
    groups: GROUPS,
    exam_max: EXAM_MAX,
    ca_max: CA_MAX,
    total_max: TOTAL_MAX,
    grade_scale: GRADE_SCALE
  };
}

module.exports = { SCHOOL_NAME, COMPONENTS, GROUPS, EXAM_MAX, CA_MAX, TOTAL_MAX, GRADE_SCALE, FIELD_KEYS, gradeFor, parseScores, caTotal, groupTotal, describe };
