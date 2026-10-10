// Home page: animated statistics counters (moved out of index.html so a strict CSP can forbid inline scripts).
// Animate stats counter
function animateCounter(id, target, suffix) {
  let count = 0;
  const step = Math.ceil(target / 50);
  const el = document.getElementById(id);
  const interval = setInterval(() => {
    count = Math.min(count + step, target);
    el.textContent = count + (suffix || '');
    if (count >= target) clearInterval(interval);
  }, 30);
}

// Observe stats section
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      animateCounter('statStudents', 1200);
      animateCounter('statTeachers', 85);
      statsObserver.disconnect();
    }
  });
});
const statsEl = document.querySelector('.stats-section');
if (statsEl) statsObserver.observe(statsEl);
