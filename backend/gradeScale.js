'use strict';
/*
 * A result is graded on the scale of the class its student is in NOW:
 * Junior Secondary classes use A / C / P / F, Senior Secondary the WAEC A1-F9.
 * `results.is_junior` carries that choice into the database's generated
 * `grade` / `remark` columns, so it has to follow the student when their class
 * changes (promotion) or when a class is switched between Junior and Senior.
 *
 * Only rows that are on the wrong scale are touched, so running this when
 * nothing changed is free, and `updated_at` is left alone (a regrade is not a
 * teacher edit).
 */
const db = require('./db');

/**
 * @param {object} [conn]  a connection (inside a transaction) or the pool
 * @param {object} [opts]
 * @param {number} [opts.classId]    only students currently in this class level
 * @param {number} [opts.studentId]  only this student
 * @returns {Promise<number>} how many results were moved to the other scale
 */
async function syncResultScales(conn = db, { classId, studentId } = {}) {
  const where = ['r.is_junior <> cl.is_junior']; const params = [];
  if (classId) { where.push('s.class_level_id = ?'); params.push(classId); }
  if (studentId) { where.push('s.id = ?'); params.push(studentId); }
  const [result] = await conn.query(
    `UPDATE results r SET is_junior = cl.is_junior
        FROM students s, class_levels cl
      WHERE s.id = r.student_id AND cl.id = s.class_level_id AND ${where.join(' AND ')}`, params);
  return result.affectedRows || 0;
}

module.exports = { syncResultScales };
