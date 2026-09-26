/* =====================================================
   NNSS CALABAR — main.js
   Shared utilities for all public pages
   ===================================================== */
(function initTheme(){const saved=localStorage.getItem('nnss_theme')||'light';document.documentElement.setAttribute('data-theme',saved);})();
function toggleTheme(){const cur=document.documentElement.getAttribute('data-theme');const next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);localStorage.setItem('nnss_theme',next);}
function toggleMobileNav(){const nav=document.getElementById('navLinks');if(nav)nav.classList.toggle('open');}
document.addEventListener('click',function(e){const nav=document.getElementById('navLinks');const hamburger=document.querySelector('.hamburger');if(nav&&nav.classList.contains('open')&&!nav.contains(e.target)&&!hamburger?.contains(e.target))nav.classList.remove('open');});
let currentSlide=0,carouselTimer=null;
function initCarousel(){const slides=document.querySelectorAll('.carousel-slide');if(!slides.length)return;const dotsContainer=document.getElementById('carouselDots');if(dotsContainer){dotsContainer.innerHTML='';slides.forEach((_,i)=>{const btn=document.createElement('button');btn.type='button';btn.onclick=()=>goToSlide(i);if(i===0)btn.classList.add('active');dotsContainer.appendChild(btn);});}carouselTimer=setInterval(()=>changeSlide(1),5000);}
function goToSlide(n){const slides=document.querySelectorAll('.carousel-slide');const dots=document.querySelectorAll('.carousel-dots button');if(!slides.length)return;slides[currentSlide].classList.remove('active');if(dots[currentSlide])dots[currentSlide].classList.remove('active');currentSlide=(n+slides.length)%slides.length;slides[currentSlide].classList.add('active');if(dots[currentSlide])dots[currentSlide].classList.add('active');if(carouselTimer){clearInterval(carouselTimer);carouselTimer=setInterval(()=>changeSlide(1),5000);}}
function changeSlide(dir){goToSlide(currentSlide+dir);}
function showToast(msg,type='info',duration=3500){const container=document.getElementById('toastContainer');if(!container)return;const icons={success:'checkcircle',error:'xcircle',info:'infocircle',warning:'alerttriangle'};const toast=document.createElement('div');toast.className=`toast ${type}`;const iconEl=document.createElement('span');iconEl.innerHTML=typeof window.Icon==='function'?window.Icon(icons[type]||icons.info,{size:18}):'';const msgEl=document.createElement('span');msgEl.textContent=msg;toast.append(iconEl,msgEl);container.appendChild(toast);setTimeout(()=>{toast.style.opacity='0';toast.style.transform='translateX(100%)';toast.style.transition='all .4s ease';setTimeout(()=>toast.remove(),400);},duration);}
function initScrollAnimations(){const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.style.opacity='1';entry.target.style.transform='translateY(0)';}});},{threshold:.1});document.querySelectorAll('.feature-card,.blog-card,.quick-link-card,.info-card,.newsletter-item').forEach(el=>{el.style.opacity='0';el.style.transform='translateY(20px)';el.style.transition='opacity .5s ease,transform .5s ease';observer.observe(el);});}
function initChromeIcons(){if(typeof window.Icon!=='function')return;[['#mobileToggle','menu',20],['#modalClose','x',16],['#logoutSide','logout',16]].forEach(([sel,name,size])=>{const el=document.querySelector(sel);if(!el)return;if(sel==='#logoutSide')el.innerHTML=`${window.Icon(name,{size})}<span>Sign out</span>`;else el.innerHTML=window.Icon(name,{size});});}
function initContentIcons(){if(typeof window.Icon!=='function')return;document.querySelectorAll('[data-icon]').forEach(el=>el.insertAdjacentHTML('afterbegin',window.Icon(el.dataset.icon,{size:15})));}

function initHomeFixes(){
  if(!document.querySelector('.hero-carousel')&&!document.querySelector('.result-card'))return;
  const style=document.createElement('style');
  style.textContent=`
    @media (max-width: 768px){
      .hero-carousel{height:auto;min-height:0;aspect-ratio:4/5;background:var(--primary);}
      .carousel-slide{height:100%;background-size:contain;background-repeat:no-repeat;background-position:center;background-color:var(--primary);}
      .carousel-overlay{background:linear-gradient(180deg,rgba(11,18,32,.2) 0%,rgba(11,18,32,.72) 100%);padding:1.25rem;justify-content:flex-end;}
      .carousel-overlay h2{font-size:clamp(1.65rem,7vw,2.45rem);}
      .carousel-overlay p{font-size:.95rem;max-width:100%;margin-bottom:1.1rem;}
      .carousel-overlay .cta-btn{padding:11px 24px;font-size:.92rem;}
    }
    .result-card::before{content:"";display:block;width:88px;height:88px;margin:1.25rem auto .25rem;background:url("command-logo.png") center/contain no-repeat;}
    @media print{
      .result-card::before{width:92px;height:92px;margin:.15in auto .08in;}
      .result-card{box-shadow:none!important;border-color:#ccc;break-inside:avoid;}
    }
  `;
  document.head.appendChild(style);

  const targets=['about.html','blog.html','login.html','newsletter.html','login.html'];
  document.querySelectorAll('.hero-carousel .carousel-slide').forEach((slide,index)=>{
    const btn=slide.querySelector('.cta-btn');
    if(!btn||!targets[index])return;
    btn.type='button';
    btn.onclick=()=>{window.location.assign(new URL(targets[index],document.baseURI).href);};
  });
}

document.addEventListener('DOMContentLoaded',()=>{
  initCarousel();initScrollAnimations();initChromeIcons();initContentIcons();initHomeFixes();
  document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{const target=document.querySelector(a.getAttribute('href'));if(target){e.preventDefault();target.scrollIntoView({behavior:'smooth',block:'start'});}}));
  const path=window.location.pathname.split('/').pop()||'index.html';
  document.querySelectorAll('.nav-links a').forEach(a=>{const href=a.getAttribute('href');if(href===path||(path===''&&href==='index.html'))a.classList.add('active');});
});
