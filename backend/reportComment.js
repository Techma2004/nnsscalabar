'use strict';
/*
 * The Commandant's comment printed at the bottom of a report card.
 *
 * It is worked out from the student's actual results, never typed in and never the
 * same for everyone. The band comes from the same grading scale the marks were graded
 * on (JSS: A/C/P/F, SSS: WAEC A1-F9), so a 62% average reads "Credit" for both
 * classes while 78% is "Excellent" in SSS but only "Credit" in JSS, exactly as the
 * grades printed above it. Subjects that were failed and the position in class are
 * mentioned only when they are true.
 */
const { gradeFor } = require('./scheme');

const BAND_TEXT = {
  Excellent: 'An outstanding result. Keep up the hard work and discipline.',
  'Very Good': 'A very good result. A little more effort will take you to the top.',
  Good: 'A good result. Keep working steadily and aim higher next term.',
  Credit: 'A fair result, but you can do better. Study more regularly and give each subject your full attention.',
  Pass: 'A weak pass. You must put in much more effort and study harder next term.',
  Fail: 'An unsatisfactory result. Serious improvement is needed. Meet your class teacher for help and study harder.'
};

const ordinal = n => { const v = n % 100; return `${n}${(v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`; };
const list = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * @param {{average:number, isJunior:boolean, subjects:{name:string,total:number}[], position?:number|null, armSize?:number|null}} input
 * @returns {string|null} null when there is nothing to comment on (no approved results)
 */
function commandantComment({ average, isJunior = false, subjects = [], position = null, armSize = null }) {
  if (!subjects.length || !Number.isFinite(Number(average))) return null;
  const band = gradeFor(Number(average), !!isJunior).remark;
  const parts = [BAND_TEXT[band]];
  const failed = subjects.filter(s => gradeFor(Number(s.total), !!isJunior).remark === 'Fail').map(s => s.name);
  if (failed.length) parts.push(`Special attention is needed in ${list(failed)}.`);
  if (position && armSize && armSize > 1 && position === 1) parts.push('Well done on finishing first in the class.');
  else if (position && armSize && armSize > 1 && position <= 3 && band !== 'Fail') parts.push(`Well done on finishing ${ordinal(position)} in the class.`);
  return parts.join(' ');
}

module.exports = { commandantComment };
