// Portal login page logic (moved out of login.html so a strict CSP can forbid inline scripts).
import { login, getCurrentUser } from './api.js';
const $=s=>document.querySelector(s);

document.getElementById('loginPoints').innerHTML = [
  ['document','Academic records and published results'],
  ['pencil','Teacher score entry and class management'],
  ['settings','Administrative and departmental controls']
].map(([icon,text]) => `<div class="login-point">${window.Icon(icon,{size:16})}<span>${text}</span></div>`).join('');

const pwdToggle = $('#pwdToggleBtn');
pwdToggle.innerHTML = window.Icon('eye', { size: 18 });
pwdToggle.onclick = () => {
  const input = $('#loginPassword');
  const showing = input.type === 'password';
  input.type = showing ? 'text' : 'password';
  pwdToggle.innerHTML = window.Icon(showing ? 'eyeoff' : 'eye', { size: 18 });
  pwdToggle.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
};

$('#portalLoginForm').addEventListener('submit',async e=>{e.preventDefault();const username=$('#loginUsername').value.trim().toUpperCase();const password=$('#loginPassword').value;const error=$('#loginError');const btn=$('#loginBtn');error.style.display='none';btn.disabled=true;btn.innerHTML='<span class="loading"></span> Signing in…';try{await login(username,password);window.showToast('Sign in successful.','success');setTimeout(()=>location.href='portal.html',350);}catch(err){error.textContent=err.message||'Unable to sign in.';error.style.display='block';btn.disabled=false;btn.textContent='Sign in';}});
getCurrentUser().then(()=>location.href='portal.html').catch(()=>{});
