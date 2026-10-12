'use strict';
/*
 * Excel version of the Continuous Assessment Sheet.
 *
 * buildWorkbook()  – the reusable template (blank) or a class sheet pre-filled
 *                    with the roster and any scores already saved.
 * parseWorkbook()  – reads a filled-in sheet back into rows the importer can
 *                    match against the class roster.
 *
 * Columns (identical to the paper sheet, plus an optional Student ID column
 * so the importer can match students without relying on spelling):
 *
 *   A S/NO | B STUDENT ID | C STUDENTS NAME |
 *   D 1ST TEST (15%) | E QUIZ (5%) | F ASSIGNMENT (5%) | G TOTAL |
 *   H 2ND TEST (5%) | I PROJECT (5%) | J NOTE (5%) | K TOTAL |
 *   L EXAM (60%) | M TERM'S TOTAL | N GRADE
 */
const ExcelJS = require('exceljs');
const scheme = require('./scheme');

const SHEET_NAME = 'Score Sheet';
const HEADER_ROW = 6;
const FIRST_DATA_ROW = HEADER_ROW + 1;
const DEFAULT_BLANK_ROWS = 60;

// Column layout keyed by the scheme's field keys.
const COLS = {
  sn: 1, id: 2, name: 3,
  test1: 4, quiz: 5, assignment: 6, ca1: 7,
  test2: 8, project: 9, note: 10, ca2: 11,
  exam: 12, total: 13, grade: 14
};
const INPUT_KEYS = ['test1', 'quiz', 'assignment', 'test2', 'project', 'note', 'exam'];
const MAX_BY_KEY = Object.fromEntries([...scheme.COMPONENTS.map(c => [c.key, c.max]), ['exam', scheme.EXAM_MAX]]);

const colLetter = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const L = Object.fromEntries(Object.entries(COLS).map(([k, v]) => [k, colLetter(v)]));

const THIN = { style: 'thin', color: { argb: 'FF7A8699' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const FILL_INPUT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8DC' } };
const FILL_CALC = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF3' } };
const FILL_HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1628' } };

function gradeFormula(cell) {
  // Mirrors scheme.GRADE_SCALE / the database's generated `grade` column.
  return `IF(${cell}="","",IF(${cell}>=75,"A1",IF(${cell}>=70,"B2",IF(${cell}>=65,"B3",IF(${cell}>=60,"C4",IF(${cell}>=55,"C5",IF(${cell}>=50,"C6",IF(${cell}>=45,"D7",IF(${cell}>=40,"E8","F9")))))))))`;
}

/**
 * @param {object} opts
 * @param {object} [opts.header]   { class_name, arm_name, term_name, session_name, subject_name, form_teacher }
 * @param {Array}  [opts.rows]     [{ user_code, full_name, scores:{test1..exam} }]
 * @param {number} [opts.blankRows] rows to provide when no roster is given (template)
 */
async function buildWorkbook({ header = {}, rows = [], blankRows = DEFAULT_BLANK_ROWS } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NNSS Calabar';
  wb.created = new Date();
  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', xSplit: COLS.name, ySplit: HEADER_ROW }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
  });
  ws.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;

  const widths = { sn: 6, id: 15, name: 38, test1: 11, quiz: 9, assignment: 12, ca1: 9, test2: 9, project: 10, note: 8, ca2: 9, exam: 10, total: 11, grade: 8 };
  for (const [k, w] of Object.entries(widths)) ws.getColumn(COLS[k]).width = w;

  const lastCol = L.grade;
  const session = header.session_name || '____/____';

  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = scheme.SCHOOL_NAME;
  ws.getCell('A1').font = { name: 'Calibri', size: 14, bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = `CONTINUOUS ASSESSMENT SHEET ${session}`;
  ws.getCell('A2').font = { name: 'Calibri', size: 12, bold: true };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };

  const classLabel = [header.class_name, header.arm_name].filter(Boolean).join(' ');
  const info = (labelCell, valueRange, label, value) => {
    ws.getCell(labelCell).value = label;
    ws.getCell(labelCell).font = { bold: true };
    const [start, end] = valueRange.split(':');
    ws.mergeCells(valueRange);
    ws.getCell(start).value = value || '';
    ws.getCell(start).border = { bottom: { style: 'thin', color: { argb: 'FF7A8699' } } };
    ws.getCell(start).font = { bold: true };
  };
  info('A3', 'B3:C3', 'CLASS:', classLabel);
  info('D3', 'E3:G3', 'TERM:', header.term_name || '');
  info('H3', 'I3:N3', 'FORM TEACHER:', header.form_teacher || '');
  info('A4', 'B4:C4', 'NO IN CLASS:', rows.length ? rows.length : '');
  info('D4', 'E4:G4', 'SESSION:', header.session_name || '');
  info('H4', 'I4:N4', 'SUBJECT:', header.subject_name || '');

  ws.mergeCells(`A5:${lastCol}5`);
  ws.getCell('A5').value = 'Fill the yellow cells only (leave a row blank for a student who sat nothing). Student ID is optional - if it is left blank the importer matches by name. Totals and grade calculate themselves.';
  ws.getCell('A5').font = { italic: true, size: 9, color: { argb: 'FF5B6577' } };
  ws.getCell('A5').alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(5).height = 26;

  // ---- column titles (same wording as the paper sheet) ----
  const titles = {
    sn: 'S/NO', id: 'STUDENT ID (optional)', name: 'STUDENTS NAME',
    test1: '1ST TEST (15%)', quiz: 'QUIZ (5%)', assignment: 'ASSIGNMENT (5%)', ca1: 'TOTAL',
    test2: '2ND TEST (5%)', project: 'PROJECT (5%)', note: 'NOTE (5%)', ca2: 'TOTAL',
    exam: 'EXAM (60%)', total: "TERM'S TOTAL", grade: 'GRADE'
  };
  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.height = 48;
  for (const [k, title] of Object.entries(titles)) {
    const c = headerRow.getCell(COLS[k]);
    c.value = title;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = FILL_HEAD;
    c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: ['sn', 'id', 'name'].includes(k) ? 0 : 90 };
  }

  const count = rows.length || blankRows;
  for (let i = 0; i < count; i += 1) {
    const r = FIRST_DATA_ROW + i;
    const src = rows[i];
    const row = ws.getRow(r);
    row.height = 20;
    row.getCell(COLS.sn).value = i + 1;
    if (src) {
      row.getCell(COLS.id).value = src.user_code || '';
      row.getCell(COLS.name).value = src.full_name || '';
    }
    for (const k of INPUT_KEYS) {
      const cell = row.getCell(COLS[k]);
      const v = src && src.scores ? src.scores[k] : null;
      if (v !== null && v !== undefined && v !== '') cell.value = Number(v);
      cell.fill = FILL_INPUT;
      cell.alignment = { horizontal: 'center' };
      cell.dataValidation = {
        type: 'decimal', operator: 'between', allowBlank: true, showErrorMessage: true,
        formulae: [0, MAX_BY_KEY[k]], errorStyle: 'stop',
        errorTitle: 'Score out of range', error: `Enter a number from 0 to ${MAX_BY_KEY[k]}.`
      };
    }
    // Calculated cells.
    const ca1 = row.getCell(COLS.ca1);
    ca1.value = { formula: `IF(COUNT(${L.test1}${r}:${L.assignment}${r})=0,"",SUM(${L.test1}${r}:${L.assignment}${r}))` };
    const ca2 = row.getCell(COLS.ca2);
    ca2.value = { formula: `IF(COUNT(${L.test2}${r}:${L.note}${r})=0,"",SUM(${L.test2}${r}:${L.note}${r}))` };
    const total = row.getCell(COLS.total);
    total.value = { formula: `IF(COUNT(${L.test1}${r}:${L.note}${r},${L.exam}${r})=0,"",SUM(${L.ca1}${r},${L.ca2}${r},${L.exam}${r}))` };
    const grade = row.getCell(COLS.grade);
    grade.value = { formula: gradeFormula(`${L.total}${r}`) };
    for (const c of [ca1, ca2, total, grade]) { c.fill = FILL_CALC; c.alignment = { horizontal: 'center' }; c.font = { bold: true }; }

    for (let col = 1; col <= COLS.grade; col += 1) row.getCell(col).border = BORDER;
    row.getCell(COLS.sn).alignment = { horizontal: 'center' };
  }
  return wb;
}

// ---------------------------------------------------------------- parsing --

const cellText = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.result !== undefined) return String(v.result ?? '');
    if (v.text !== undefined) return String(v.text);
    return '';
  }
  return String(v);
};
const cellNumber = v => {
  if (v === null || v === undefined) return null;
  let x = v;
  if (typeof x === 'object') x = x.result !== undefined ? x.result : (x.text !== undefined ? x.text : null);
  if (x === null || x === undefined || String(x).trim() === '') return null;
  const n = typeof x === 'number' ? x : Number(String(x).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN; // NaN = present but not a number
};

function detectColumns(row) {
  const map = {};
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = cellText(cell.value).toUpperCase().replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (/NAME/.test(t)) map.name = col;
    else if (/\bID\b|\bCODE\b/.test(t)) map.id = col;
    else if (/(1ST|FIRST).*TEST/.test(t)) map.test1 = col;
    else if (/QUIZ/.test(t)) map.quiz = col;
    else if (/ASSIGN/.test(t)) map.assignment = col;
    else if (/(2ND|SECOND).*TEST/.test(t)) map.test2 = col;
    else if (/PROJECT/.test(t)) map.project = col;
    else if (/\bNOTE/.test(t)) map.note = col;
    else if (/^EXAM/.test(t)) map.exam = col;
  });
  return map;
}


// ------------------------------------------------------------ safety limits --
// An .xlsx is a zip archive, and a few kilobytes of zip can expand to gigabytes
// ("zip bomb"). The upload is capped at 4 MB compressed, but ExcelJS inflates it
// fully in memory, so check the sizes the archive declares *before* parsing.
const MAX_ENTRIES = 300;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_SHEET_ROWS = 2000;

function assertSafeXlsx(buffer) {
  const bad = () => new Error('That file is not a valid Excel (.xlsx) score sheet.');
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw bad(); // NOPMD
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } // NOPMD
  }
  if (eocd < 0) throw bad();
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  // 0xFFFF / 0xFFFFFFFF mean ZIP64, which a score sheet never needs.
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw bad(); // NOPMD
  if (entries === 0 || entries > MAX_ENTRIES || cdOffset + cdSize > buffer.length) throw bad();
  let pos = cdOffset; let total = 0;
  for (let i = 0; i < entries; i += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) throw bad(); // NOPMD
    const uncompressed = buffer.readUInt32LE(pos + 24);
    if (uncompressed === 0xffffffff || uncompressed > MAX_ENTRY_BYTES) throw new Error('That Excel file is too large when unpacked.'); // NOPMD
    total += uncompressed;
    if (total > MAX_TOTAL_BYTES) throw new Error('That Excel file is too large when unpacked.');
    pos += 46 + buffer.readUInt16LE(pos + 28) + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
  }
}

/** Returns { rows: [{ line, student_id, name, scores, problems }], warnings } */
async function parseWorkbook(buffer) {
  assertSafeXlsx(buffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(SHEET_NAME) || wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no worksheet.');
  if (ws.rowCount > MAX_SHEET_ROWS) throw new Error(`The sheet has more than ${MAX_SHEET_ROWS} rows. Use the NNSS score-sheet template.`);

  let headerRowNo = null; let cols = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 40); r += 1) {
    const m = detectColumns(ws.getRow(r));
    if (m.name && m.test1 && m.exam) { headerRowNo = r; cols = m; break; }
  }
  if (!cols) throw new Error('Could not find the column titles (STUDENTS NAME, 1ST TEST ... EXAM). Use the NNSS score-sheet template.');

  const missing = INPUT_KEYS.filter(k => !cols[k]);
  const rows = [];
  for (let r = headerRowNo + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell(cols.name).value).trim();
    const id = cols.id ? cellText(row.getCell(cols.id).value).trim().toUpperCase() : '';
    if (!name && !id) continue;
    const scores = {}; const problems = [];
    for (const k of INPUT_KEYS) {
      if (!cols[k]) { scores[k] = null; continue; }
      const n = cellNumber(row.getCell(cols[k]).value);
      if (n === null) scores[k] = null;
      else if (Number.isNaN(n)) { scores[k] = null; problems.push(`${k} is not a number`); }
      else scores[k] = n;
    }
    rows.push({ line: r, student_id: id, name, scores, problems });
  }
  return { rows, warnings: missing.length ? [`Columns not found in the file: ${missing.join(', ')}.`] : [] };
}

const normName = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const nameKey = s => normName(s).split(' ').filter(Boolean).sort().join(' ');

/** Match parsed rows against the class roster [{ user_code, full_name }]. */
function matchToRoster(parsedRows, roster) {
  const byCode = new Map(roster.map(s => [String(s.user_code).toUpperCase(), s]));
  const byName = new Map(); const byKey = new Map(); const ambiguous = new Set();
  for (const s of roster) {
    const n = normName(s.full_name); const k = nameKey(s.full_name);
    if (byName.has(n)) ambiguous.add(n); else byName.set(n, s);
    if (byKey.has(k)) ambiguous.add(k); else byKey.set(k, s);
  }
  const matched = []; const unmatched = []; const seen = new Set();
  for (const p of parsedRows) {
    let s = p.student_id ? byCode.get(p.student_id) : null;
    if (!s && p.name) {
      const n = normName(p.name); const k = nameKey(p.name);
      if (!ambiguous.has(n) && byName.has(n)) s = byName.get(n);
      else if (!ambiguous.has(k) && byKey.has(k)) s = byKey.get(k);
    }
    if (!s) { unmatched.push({ line: p.line, name: p.name || p.student_id }); continue; }
    if (seen.has(s.user_code)) { unmatched.push({ line: p.line, name: `${p.name || p.student_id} (duplicate row)` }); continue; }
    seen.add(s.user_code);
    matched.push({ user_code: s.user_code, full_name: s.full_name, scores: p.scores, problems: p.problems, line: p.line });
  }
  return { matched, unmatched };
}

module.exports = { buildWorkbook, parseWorkbook, assertSafeXlsx, matchToRoster, SHEET_NAME, HEADER_ROW, FIRST_DATA_ROW, INPUT_KEYS };
