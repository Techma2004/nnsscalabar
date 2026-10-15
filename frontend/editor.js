// NNSS Calabar - Blog & Newsletter editor for the school news team.
//
// One screen edits both public pages (blog.html and newsletter.html). Posts can be
// drafts (hidden from the public) or published, and every post can carry a picture.
import { getManagedPosts, createPost, updatePost, deletePost, uploadPostImage } from './api.js';

let C = null;
export function init(ctx) { C = ctx; }

const SITE_IMAGES = ['img-1.png', 'img-2.png', 'img-3.png', 'img-4.png', 'img-5.png', 'img-6.png', 'slider-01.png', 'slider-02.png', 'slider-03.png', 'slider-04.png', 'slider-05.png', 'slider-06.png'];
const KIND_LABEL = { blog: 'Blog', newsletter: 'Newsletter' };
const today = () => new Date().toISOString().slice(0, 10);

export async function load() {
  const f = C.state.contentFilter || (C.state.contentFilter = { kind: '', q: '' });
  const r = await getManagedPosts(f.kind || undefined, f.q || undefined);
  C.state.posts = r.rows;
}

const shortDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };

export function render() {
  const f = C.state.contentFilter, rows = C.state.posts || [];
  const list = rows.map(p => `<tr>
      <td><strong>${C.esc(p.title)}</strong><br><small>${C.esc((p.body || '').replace(/\s+/g, ' ').slice(0, 90))}${(p.body || '').length > 90 ? '…' : ''}</small></td>
      <td><span class="portal-badge">${KIND_LABEL[p.kind]}</span><br><small>${shortDate(p.event_date)}</small></td>
      <td><span class="portal-badge ${p.status === 'published' ? 'ok' : 'pending'}">${p.status === 'published' ? 'Published' : 'Draft'}</span><br><small>Edited ${shortDate(p.updated_at)}${p.updated_by_name || p.created_by_name ? ` by ${C.esc(p.updated_by_name || p.created_by_name)}` : ''}</small></td>
      <td><div class="portal-actions" style="flex-wrap:nowrap"><button class="btn btn-secondary btn-sm" data-edit-post="${p.id}">${C.ic('edit', 14)} Edit</button><button class="btn btn-secondary btn-sm" data-toggle-post="${p.id}">${p.status === 'published' ? 'Unpublish' : 'Publish'}</button><button class="btn btn-danger btn-sm" data-delete-post="${p.id}" aria-label="Delete ${C.esc(p.title)}">${C.ic('trash', 14)}</button></div></td></tr>`).join('');
  const tabs = [['', 'All'], ['blog', 'Blog'], ['newsletter', 'Newsletter']].map(([k, l]) => `<button class="tab-btn ${f.kind === k ? 'active' : ''}" data-post-kind="${k}">${l}</button>`).join('');
  return `<div class="portal-toolbar"><div><div class="eyebrow">School news team</div><h1>Blog &amp; Newsletter</h1><p>Write and edit what the public sees on the school's Blog and Newsletter pages. Drafts stay hidden until you publish them.</p></div>
      <div class="portal-actions"><a class="btn btn-secondary btn-auto" href="blog.html" target="_blank" rel="noopener">${C.ic('globe', 15)} View blog</a><a class="btn btn-secondary btn-auto" href="newsletter.html" target="_blank" rel="noopener">${C.ic('globe', 15)} View newsletter</a><button class="btn btn-primary btn-auto" id="newPost">${C.ic('plus', 15)} New post</button></div></div>
    ${C.card('Posts', `<div class="portal-actions" style="margin-bottom:1rem"><div class="tab-row">${tabs}</div>${C.searchBox('content', 'Search posts…')}</div>${C.table(['Post', 'Page and date', 'Status', ''], list, 'No posts yet. Press "New post" to write the first one.')}`)}`;
}

export function bind() {
  const f = C.state.contentFilter;
  C.bindSearch('content', q => { f.q = q; C.render('content', { silent: true }); });
  document.querySelectorAll('[data-post-kind]').forEach(b => b.onclick = () => { f.kind = b.dataset.postKind; C.render('content'); });
  document.getElementById('newPost').onclick = () => editor(null);
  const find = id => C.state.posts.find(p => p.id === Number(id));
  document.querySelectorAll('[data-edit-post]').forEach(b => b.onclick = () => editor(find(b.dataset.editPost)));
  document.querySelectorAll('[data-toggle-post]').forEach(b => b.onclick = async () => {
    const p = find(b.dataset.togglePost); if (!p) return;
    const status = p.status === 'published' ? 'draft' : 'published';
    try { const out = await updatePost(p.id, { ...p, status }); C.toast(out.message, 'success'); C.render('content', { silent: true }); } catch (e) { C.toast(e.message, 'error'); }
  });
  document.querySelectorAll('[data-delete-post]').forEach(b => b.onclick = async () => {
    const p = find(b.dataset.deletePost); if (!p) return;
    if (!confirm(`Delete "${p.title}"? It will disappear from the public page and cannot be brought back.`)) return;
    try { await deletePost(p.id); C.toast('Post deleted.', 'success'); C.render('content', { silent: true }); } catch (e) { C.toast(e.message, 'error'); }
  });
}

const readAsDataUrl = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

function editor(post) {
  const isEdit = !!post;
  let image = post?.image_url || '';
  const pick = SITE_IMAGES.map(n => `<button type="button" class="thumb ${image === n ? 'selected' : ''}" data-pick-image="${n}" aria-label="Use ${n}"><img src="${n}" alt="" loading="lazy"></button>`).join('');
  C.openModal(isEdit ? 'Edit post' : 'New post', `<div class="portal-form-grid">
    <div class="form-group"><label for="pKind">Show on</label><select id="pKind"><option value="blog" ${post?.kind === 'blog' ? 'selected' : ''}>Blog page</option><option value="newsletter" ${post?.kind === 'newsletter' ? 'selected' : ''}>Newsletter page</option></select></div>
    <div class="form-group"><label for="pDate">Date shown</label><input id="pDate" type="date" value="${C.esc(post?.event_date || today())}"></div>
    <div class="form-group full"><label for="pTitle">Title *</label><input id="pTitle" maxlength="200" value="${C.esc(post?.title || '')}"></div>
    <div class="form-group full"><label for="pBody">Text *</label><textarea id="pBody" rows="9" maxlength="8000">${C.esc(post?.body || '')}</textarea><small class="field-help">Leave a blank line between paragraphs.</small></div>
    <div class="form-group full" id="pImageGroup"><label>Picture (optional, shown on the blog)</label>
      <div class="thumb-grid" id="pThumbs"><button type="button" class="thumb thumb-none ${image ? '' : 'selected'}" data-pick-image="">No picture</button>${pick}</div>
      <div class="portal-actions" style="margin-top:.6rem"><label class="btn btn-secondary btn-sm" for="pUpload">${C.ic('image', 14)} Upload a picture<input id="pUpload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><span id="pUploadNote" class="field-help"></span></div>
      <div id="pPreview"></div></div>
    <div class="form-group"><label for="pStatus">When saved</label><select id="pStatus"><option value="published" ${post?.status !== 'draft' ? 'selected' : ''}>Publish now</option><option value="draft" ${post?.status === 'draft' ? 'selected' : ''}>Keep as a draft (hidden)</option></select></div>
    <div class="full"><button class="btn btn-primary" id="savePost">${isEdit ? 'Save changes' : 'Save post'}</button></div></div>`);

  const preview = () => { document.getElementById('pPreview').innerHTML = image && !SITE_IMAGES.includes(image) ? `<img class="post-preview" src="${C.esc(image)}" alt="Chosen picture">` : ''; document.querySelectorAll('[data-pick-image]').forEach(b => b.classList.toggle('selected', b.dataset.pickImage === image)); };
  preview();
  document.getElementById('pThumbs').onclick = e => { const b = e.target.closest('[data-pick-image]'); if (!b) return; image = b.dataset.pickImage; preview(); };
  document.getElementById('pUpload').onchange = async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const note = document.getElementById('pUploadNote');
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { note.textContent = 'Choose a PNG, JPEG or WebP picture.'; return; }
    if (file.size > 2.5 * 1024 * 1024) { note.textContent = 'That picture is larger than 2.5 MB.'; return; }
    note.textContent = 'Uploading…';
    try { const out = await uploadPostImage(await readAsDataUrl(file)); image = out.image_url; note.textContent = 'Picture added.'; preview(); } catch (err) { note.textContent = err.message; }
  };
  document.getElementById('savePost').onclick = async () => {
    const body = { kind: document.getElementById('pKind').value, title: document.getElementById('pTitle').value.trim(), body: document.getElementById('pBody').value.trim(), image_url: image || null, event_date: document.getElementById('pDate').value || today(), status: document.getElementById('pStatus').value };
    if (body.title.length < 3) return C.toast('Give the post a title.', 'error');
    if (body.body.length < 10) return C.toast('Write the post text.', 'error');
    const btn = document.getElementById('savePost'); btn.disabled = true;
    try { const out = isEdit ? await updatePost(post.id, body) : await createPost(body); C.closeModal(); C.toast(out.message, 'success'); C.render('content', { silent: true }); }
    catch (e) { C.toast(e.message, 'error'); btn.disabled = false; }
  };
}
