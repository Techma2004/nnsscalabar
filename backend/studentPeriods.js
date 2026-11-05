'use strict';
/*
 * The sessions and terms a student can pick from on the "My Results" screen.
 *
 * Every session the school has set up is listed (newest first), each with its terms, and
 * each term says whether THIS student has any approved result in it. A term without
 * results is still selectable: the portal then tells the student that no results have been
 * uploaded or published for it, instead of silently hiding the choice.
 *
 * `groupPeriods` is pure (rows in, structure out) so it is unit-tested without a database.
 */

/**
 * @param {{session_id:number, session_name:string, session_current:number|boolean, term_id:number, term_number:number,
 *          term_name:string, term_current:number|boolean, results:number}[]} rows  ordered newest session first, then term number
 */
function groupPeriods(rows) {
  const sessions = [];
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.session_id)) {
      const s = { session_name: r.session_name, is_current: !!r.session_current, terms: [] };
      byId.set(r.session_id, s); sessions.push(s);
    }
    byId.get(r.session_id).terms.push({ term_name: r.term_name, term_number: Number(r.term_number), is_current: !!r.term_current, has_results: Number(r.results) > 0 });
  }
  return { sessions, default: pickDefault(sessions) };
}

// Open on the most recent term that has results; a student with none yet opens on the
// term the school is currently in; failing that, on the first term listed.
function pickDefault(sessions) {
  for (const s of sessions) {
    const t = [...s.terms].reverse().find(x => x.has_results);
    if (t) return { session_name: s.session_name, term_name: t.term_name };
  }
  for (const s of sessions) {
    const t = s.terms.find(x => x.is_current);
    if (t) return { session_name: s.session_name, term_name: t.term_name };
  }
  const s = sessions[0];
  return s && s.terms[0] ? { session_name: s.session_name, term_name: s.terms[0].term_name } : null;
}

async function loadPeriods(db, studentId) {
  const [rows] = await db.query(
    `SELECT ac.id AS session_id, ac.session_name, ac.is_current AS session_current,
            t.id AS term_id, t.term_number, t.term_name, t.is_current AS term_current,
            (SELECT COUNT(*) FROM results r WHERE r.term_id = t.id AND r.student_id = ? AND r.is_approved = 1) AS results
       FROM academic_sessions ac JOIN terms t ON t.session_id = ac.id
      ORDER BY ac.start_date DESC, ac.id DESC, t.term_number ASC`, [studentId]);
  return groupPeriods(rows);
}

module.exports = { groupPeriods, pickDefault, loadPeriods };
