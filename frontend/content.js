/* NNSS CALABAR - content.js
   Fills the public Blog and Newsletter pages from the database (/api/posts),
   so the school's news team can change them from the portal. Text is always
   inserted as text, never as HTML. */
(function () {
  const list = document.getElementById('postList');
  if (!list) return;
  const kind = list.dataset.kind;
  const fmt = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const paragraphs = (parent, text) => String(text || '').split(/\n{2,}|\r\n\r\n/).map(t => t.trim()).filter(Boolean).forEach(t => parent.appendChild(el('p', '', t)));
  const imageStyle = url => /^https:\/\//i.test(url) ? url : encodeURI(url);

  function blogCard(p) {
    const card = el('div', 'blog-card');
    const img = el('div', 'blog-card-img' + (p.image_url ? '' : ' no-image'));
    if (p.image_url) { img.style.backgroundImage = `url("${imageStyle(p.image_url)}")`; img.style.backgroundSize = 'cover'; img.style.backgroundPosition = 'center'; img.setAttribute('role', 'img'); img.setAttribute('aria-label', p.title); }
    else if (typeof window.Icon === 'function') img.innerHTML = window.Icon('newspaper', { size: 44 });
    const body = el('div', 'blog-card-content post-body');
    body.appendChild(el('div', 'date', fmt(p.event_date)));
    body.appendChild(el('h3', '', p.title));
    paragraphs(body, p.body);
    card.append(img, body);
    return card;
  }
  function newsItem(p) {
    const item = el('div', 'newsletter-item');
    item.appendChild(el('h3', '', p.title));
    item.appendChild(el('div', 'date', fmt(p.event_date)));
    const body = el('div', 'post-body'); paragraphs(body, p.body); item.appendChild(body);
    return item;
  }
  function empty(text) { list.replaceChildren(el('div', 'post-empty', text)); }

  fetch(`/api/posts?kind=${encodeURIComponent(kind)}`, { headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad response'))))
    .then(data => {
      const rows = data.rows || [];
      if (!rows.length) return empty(kind === 'blog' ? 'No blog posts have been published yet. Please check back soon.' : 'No news has been published yet. Please check back soon.');
      list.replaceChildren(...rows.map(kind === 'blog' ? blogCard : newsItem));
      document.dispatchEvent(new Event('nnss:content-ready'));
    })
    .catch(() => empty('We could not load this page right now. Please try again in a moment.'));
})();
