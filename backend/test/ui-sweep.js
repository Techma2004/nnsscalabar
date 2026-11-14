#!/usr/bin/env node
'use strict';
/*
 * Opens EVERY screen of the portal for each role in a real browser and fails on any
 * JavaScript error, failed API call, blank page or text like "undefined" / "NaN" / "Unable to".
 * Run it against a throwaway database (see test/e2e-portal.js to fill one with a real journey).
 *
 *   npm i --no-save playwright && npx playwright install chromium     (once)
 *   BASE=http://127.0.0.1:5077 ACCOUNTS='[{"role":"admin","code":"ADM001","pw":"..."},{"role":"student","code":"STU0001","pw":"..."}]' \
 *     node backend/test/ui-sweep.js
 */
let chromium; try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is not installed: npm i --no-save playwright'); process.exit(2); }
const base = process.env.BASE || 'http://127.0.0.1:5077';
const accounts = JSON.parse(process.env.ACCOUNTS || '[]');
if (!accounts.length) { console.error('Set ACCOUNTS to a JSON list of {role, code, pw}.'); process.exit(2); }
(async()=>{
  const b=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
  let bad=0, total=0;
  for(const a of accounts){
    const ctx=await b.newContext({viewport:{width:1280,height:900}}); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort()); const page=await ctx.newPage();
    let errs=[]; page.on('pageerror',e=>errs.push('JS: '+e.message)); page.on('response',r=>{const u=r.url(); if(u.includes('/api/')&&r.status()>=400&&!u.endsWith('/auth/me'))errs.push(`API ${r.status()} ${u.replace(base,'')}`)});
    await page.goto(base+'/login.html',{waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>!document.querySelector('.login-page.session-check'));
    await page.fill('#loginUsername',a.code); await page.fill('#loginPassword',a.pw); await page.click('#loginBtn');
    try{ await page.waitForURL(/portal\.html/,{waitUntil:'domcontentloaded',timeout:8000}); await page.waitForSelector('#sidebarNav a',{timeout:8000}); }catch{ console.log(`FAIL ${a.role}: could not sign in`); bad++; await ctx.close(); continue; }
    const panels=await page.$$eval('#sidebarNav a[data-panel]',n=>n.map(x=>x.dataset.panel));
    for(const p of panels){
      errs=[]; total++;
      await page.click(`#sidebarNav a[data-panel="${p}"]`); await page.waitForTimeout(900);
      await page.waitForFunction(()=>!document.querySelector('.portal-loading'),{timeout:8000}).catch(()=>errs.push('still loading'));
      const txt=await page.innerText('#appRoot');
      const sus=[/unable to/i,/something went wrong/i,/\bundefined\b/,/\bNaN\b/,/\[object/i,/failed to/i].filter(r=>r.test(txt)).map(String);
      const ok=!errs.length&&!sus.length&&txt.trim().length>20;
      if(!ok){bad++; console.log(`FAIL ${a.role}/${p}: ${[...errs,...sus,txt.trim().length<=20?'blank page':''].filter(Boolean).join('; ')}`);}
      else console.log(`ok   ${a.role}/${p}`);
    }
    await ctx.close();
  }
  console.log(`\n${total} screens checked, ${bad} problem(s)`); await b.close(); process.exit(bad?1:0);
})();
