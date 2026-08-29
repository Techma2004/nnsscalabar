/* =====================================================
   NNSS CALABAR — main.js
   Shared utilities for all public pages
   ===================================================== */

// ---- THEME ----
(function initTheme() {
  const saved = localStorage.getItem('nnss_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('nnss_theme', next);
}

// ---- MOBILE NAV ----
function toggleMobileNav() {
  const nav = document.getElementById('navLinks');
  if (nav) nav.classList.toggle('open');
}

// Close mobile nav when clicking outside
document.addEventListener('click', function(e) {
  const nav = document.getElementById('navLinks');
  const hamburger = document.querySelector('.hamburger');
  if (nav && nav.classList.contains('open') &&
      !nav.contains(e.target) && !hamburger?.contains(e.target)) {
    nav.classList.remove('open');
  }
});

// ---- HERO CAROUSEL ----
let currentSlide = 0;
let carouselTimer = null;

function initCarousel() {
  const slides = document.querySelectorAll('.carousel-slide');
  if (!slides.length) return;

  const dotsContainer = document.getElementById('carouselDots');
  if (dotsContainer) {
    slides.forEach((_, i) => {
      const btn = document.createElement('button');
      btn.onclick = () => goToSlide(i);
      if (i === 0) btn.classList.add('active');
      dotsContainer.appendChild(btn);
    });
  }

  carouselTimer = setInterval(() => changeSlide(1), 5000);
}

function goToSlide(n) {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dots button');
  if (!slides.length) return;

  slides[currentSlide].classList.remove('active');
  if (dots[currentSlide]) dots[currentSlide].classList.remove('active');

  currentSlide = (n + slides.length) % slides.length;

  slides[currentSlide].classList.add('active');
  if (dots[currentSlide]) dots[currentSlide].classList.add('active');

  // Reset timer
  if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = setInterval(() => changeSlide(1), 5000); }
}

function changeSlide(dir) {
  goToSlide(currentSlide + dir);
}

// ---- TOAST NOTIFICATIONS ----
function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const iconEl = document.createElement('span');
  iconEl.textContent = icons[type] || icons.info;
  const msgEl = document.createElement('span');
  msgEl.textContent = msg;
  toast.append(iconEl, msgEl);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.4s ease';
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ---- SCROLL ANIMATIONS ----
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card, .blog-card, .quick-link-card, .info-card, .newsletter-item').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

// ---- INIT ON LOAD ----
document.addEventListener('DOMContentLoaded', () => {
  initCarousel();
  initScrollAnimations();

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });

  // Active nav highlighting
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
});
