'use strict';
/*
 * Continuous-assessment scheme used by NNSS Calabar's "Continuous Assessment
 * Sheet". This is the single source of truth for the backend (validation,
 * totals, the Excel template) and is served to the browser via
 * GET /api/results/scheme so the UI can never drift from the server.
 *
 * Nigerian secondary-school scheme: Continuous Assessment (CA) is 30% and the
 * end-of-term examination is 70%, combined out of 100.
 *
 *   1ST TEST (10) | QUIZ (2)    | ASSIGNMENT (3) | TOTAL (15)
 *   2ND TEST (10) | PROJECT (3) | NOTE (2)       | TOTAL (15)
 *   EXAM (70)     | TERM'S TOTAL (100)           | GRADE
 *
 * To change how the 30 CA marks are shared between the six columns, edit the
 * `max` values in COMPONENTS below (they must still add up to CA_MAX = 30).
 * Everything else - validation, totals, the Excel template, the screens and the
 * database CHECK constraint described in database/007 - follows from here.
 *
 * Grading is two-tier, chosen by the class the result belongs to:
 *   - Senior Secondary (SSS 1-3): WAEC / NECO 9-point scale, A1 .. F9.
 *   - Junior Secondary (JSS 1-3): A / C / P / F (Distinction, Credit, Pass, Fail).
 */

const SCHOOL_NAME = 'NIGERIAN NAVY SECONDARY SCHOOL AKPABUYO CALABAR';

// `key` is the JSON field name used by the API; `column` is the DB column.
const COMPONENTS = [
  { key: 'test1',      column: 'test1_score',      label: '1st Test',   max: 10, group: 'ca1' },
  { key: 'quiz',       column: 'quiz_score',       label: 'Quiz',       max: 2,  group: 'ca1' },
  { key: 'assignment', column: 'assignment_score', label: 'Assignment', max: 3,  group: 'ca1' },
  { key: 'test2',      column: 'test2_score',      label: '2nd Test',   max: 10, group: 'ca2' },
  { key: 'project',    column: 'project_score',    label: 'Project',    max: 3,  group: 'ca2' },
  { key: 'note',       column: 'note_score',       label: 'Note',       max: 2,  group: 'ca2' }
];
const groupMax = g => COMPONENTS.filter(c => c.group === g).reduce((sum, c) => sum + c.max, 0);
const GROUPS = {
  ca1: { label: 'Total', max: groupMax('ca1') }, // 15
  ca2: { label: 'Total', max: groupMax('ca2') }  // 15
};
const EXAM_MAX = 70;
const CA_MAX = COMPONENTS.reduce((sum, c) => sum + c.max, 0); // 30
const TOTAL_MAX = CA_MAX + EXAM_MAX;                           // 100
if (CA_MAX !== 30 || TOTAL_MAX !== 100) throw new Error(`Scheme must be CA 30 + Exam 70 = 100 (got CA ${CA_MAX}, total ${TOTAL_MAX}).`);

// Senior Secondary (SSS 1-3): the WAEC / NECO 9-point scale used for the SSCE.
const SSS_SCALE = [
  { min: 75, grade: 'A1', remark: 'Excellent' },
  { min: 70, grade: 'B2', remark: 'Very Good' },
  { min: 65, grade: 'B3', remark: 'Good' },
  { min: 60, grade: 'C4', remark: 'Credit' },
  { min: 55, grade: 'C5', remark: 'Credit' },
  { min: 50, grade: 'C6', remark: 'Credit' },   // minimum credit most universities ask for
  { min: 45, grade: 'D7', remark: 'Pass' },
  { min: 40, grade: 'E8', remark: 'Pass' },
  { min: 0,  grade: 'F9', remark: 'Fail' }
];
// Junior Secondary (JSS 1-3): Alpha / Credit / Pass / Fail.
const JSS_SCALE = [
  { min: 80, grade: 'A', remark: 'Distinction' },
  { min: 60, grade: 'C', remark: 'Credit' },
  { min: 50, grade: 'P', remark: 'Pass' },
  { min: 0,  grade: 'F', remark: 'Fail' }
];
const GRADE_SCALES = { sss: SSS_SCALE, jss: JSS_SCALE };
const scaleFor = isJunior => (isJunior ? JSS_SCALE : SSS_SCALE);

const FIELD_KEYS = [...COMPONENTS.map(c => c.key), 'exam'];

/** Grade for a term total. `isJunior` picks the JSS scale; otherwise the SSS scale. */
function gradeFor(total, isJunior = false) {
  const t = Number(total);
  if (total === null || total === undefined || total === '' || !Number.isFinite(t)) return null;
  const scale = scaleFor(isJunior);
  return scale.find(g => t >= g.min) || scale[scale.length - 1];
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
    grade_scales: GRADE_SCALES
  };
}

module.exports = { SCHOOL_NAME, COMPONENTS, GROUPS, EXAM_MAX, CA_MAX, TOTAL_MAX, SSS_SCALE, JSS_SCALE, GRADE_SCALES, scaleFor, FIELD_KEYS, gradeFor, parseScores, caTotal, groupTotal, describe };
