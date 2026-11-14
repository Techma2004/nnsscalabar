#!/usr/bin/env node
'use strict';
/*
 * Browser checks for the student's "My Results" screen. Needs two students that both have
 * approved results (test/e2e-portal.js makes a whole class of them) and a term with none.
 *
 *   BASE=http://127.0.0.1:5077 STUDENT_A=JSS3AYAM01 STUDENT_B=JSS3AYAM02 PASSWORD=... \
 *   EMPTY_SESSION=2026/2027 EMPTY_TERM="Second Term" node backend/test/ui-results-picker.js
 *
 * Covers: results visible on sign-in, an empty term shows "No results found" with a shortcut to
 * the terms that do have results, and one student's pick never leaks to the next student who
 * signs in on the same browser tab (this once hid the second student's results).
 */
let chromium; try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed: npm i --no-save playwright'); process.exit(2); }
const { BASE = 'http://127.0.0.1:5077', STUDENT_A, STUDENT_B, PASSWORD, EMPTY_SESSION = '2026/2027', EMPTY_TERM = 'Second Term' } = process.env;
if (!STUDENT_A || !STUDENT_B || !PASSWORD) { console.error('Set STUDENT_A, STUDENT_B and PASSWORD.'); process.exit(2); }
let failed = 0; const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' ' + d}`); if (!ok) failed++; };

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1200, height: 1100 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  const login = async code => {
    await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('.login-page.session-check'));
    await page.fill('#loginUsername', code); await page.fill('#loginPassword', PASSWORD); await page.click('#loginBtn');
    await page.waitForURL(/portal\.html/, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#sidebarNav a');
    await page.click('#sidebarNav a[data-panel="results"]'); await page.waitForSelector('#pickSession'); await page.waitForTimeout(400);
  };
  const view = async () => ({ s: await page.$eval('#pickSession', e => e.value), t: await page.$eval('#pickTerm', e => e.value), card: !!(await page.$('.report-card.rc')) });

  await login(STUDENT_A);
  let v = await view(); check('student A sees a report card on sign-in', v.card, JSON.stringify(v));
  const rows = await page.$$eval('.rc-table tbody tr', r => r.length); check('the card lists subjects', rows > 0);
  await page.selectOption('#pickSession', EMPTY_SESSION); await page.selectOption('#pickTerm', EMPTY_TERM); await page.waitForTimeout(300);
  v = await view(); const txt = await page.innerText('.portal-empty').catch(() => '');
  check('a term with no results shows "No results found"', !v.card && /No results found for/.test(txt), txt);
  check('...and points to the terms that do have results', /Your results are available for/.test(txt));
  await page.click('[data-pick-session]'); await page.waitForTimeout(300);
  check('the shortcut opens those results', (await view()).card);
  await page.selectOption('#pickSession', EMPTY_SESSION); await page.selectOption('#pickTerm', EMPTY_TERM); await page.waitForTimeout(300);
  await page.click('#logoutTop'); await page.waitForURL(/login\.html/, { waitUntil: 'domcontentloaded' });
  await login(STUDENT_B);
  v = await view(); check('student B is NOT stuck on student A\'s empty term', v.card, JSON.stringify(v));
  check('no JavaScript errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll results-screen checks passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
