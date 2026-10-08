(async () => {
  await (window.OBM_READY || null);
  const { families, products, images, sectors } = window.OBM;
  const EMAIL = 'commercial@obmagencement.com';
  const WA = '212674953900';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const isBlob = x => typeof x === 'string' && x.startsWith('b:');
  const img = x => isBlob(x) ? `/api/img/${x.slice(2)}` : `/img/${images[x]}.webp`;
  const sm = x => isBlob(x) ? `/api/img/${x.slice(2)}-sm` : `/img/sm/${images[x]}.webp`;
  const t = (s, v) => { let r = (window.I18N && window.I18N[s]) || s; if (v) for (const k in v) r = r.split('{' + k + '}').join(v[k]); return r; };
  window.t = t;
  const famById = Object.fromEntries(families.map(f => [f.id, f]));
  const secById = Object.fromEntries(sectors.map(s => [s.id, s]));
  const pad = n => String(n).padStart(2, '0');
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
  const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BASE_TITLE = document.title;
  products.forEach((p, i) => { p.id = i; p.slug = p.slug || slug(p.name); });
  const byRef = Object.fromEntries(products.map(p => [p.ref, p]));
  const bySlug = Object.fromEntries(products.map(p => [p.slug, p]));
  const count = f => products.filter(p => p.f === f).length;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const track = (event, data = {}) => { (window.dataLayer = window.dataLayer || []).push({ event, ...data }); };
  window.OBMApp = {};

  (function captureSource() {
    const q = new URLSearchParams(location.search);
    const utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(k => { if (q.get(k)) utm[k] = q.get(k); });
    const ref = document.referrer && !document.referrer.includes(location.host) ? document.referrer : '';
    const touch = (Object.keys(utm).length || ref) ? { ...utm, referent: ref, page: location.pathname + location.hash, date: new Date().toISOString() } : null;
    let first = store.get('obm-first');
    if (first && Date.now() - new Date(first.date) > 90 * 864e5) first = null;
    if (!first) store.set('obm-first', touch || { direct: true, date: new Date().toISOString() });
    if (touch) store.set('obm-last', touch);
  })();
  const touchText = k => { const t = store.get(k); return t ? Object.entries(t).map(([a, b]) => `${a}=${b}`).join(' ; ') : ''; };

  let sel = {};
  (function loadSel() {
    const s = store.get('obm-sel2');
    if (s && s.t && Date.now() - s.t < 30 * 864e5) sel = s.items || {};
    Object.keys(sel).forEach(r => { if (!byRef[r]) delete sel[r]; });
  })();
  const selTotal = () => Object.values(sel).reduce((a, b) => a + b.q, 0);
  function syncSel() {
    store.set('obm-sel2', { t: Date.now(), items: sel });
    const n = selTotal();
    $('#selCount').textContent = n;
    $('#openSel').classList.toggle('has', n > 0);
    $$('.add').forEach(b => {
      const on = !!sel[b.dataset.ref];
      b.classList.toggle('in', on);
      b.textContent = on ? t('✓ Ajouté') : t('+ Sélection');
    });
    renderFormSel(); updateWa();
  }
  function addSel(ref, q = 1, quiet) {
    if (!byRef[ref]) return;
    sel[ref] = sel[ref] ? { ...sel[ref], q: sel[ref].q + q } : { q, note: '' };
    syncSel(); bump();
    if (!quiet) toast(t('Ajouté à votre sélection'));
  }
  function toggleSel(ref) {
    if (sel[ref]) { delete sel[ref]; syncSel(); toast(t('Retiré de la sélection')); }
    else addSel(ref);
  }
  function bump() { const b = $('#openSel'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  let toastT;
  function toast(msg) {
    $('.toast')?.remove();
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2400);
  }
  const selLines = () => Object.entries(sel).map(([r, v]) => `${r} — ${byRef[r].name}${byRef[r].tag ? ' (' + byRef[r].tag + ')' : ''} × ${v.q}${v.note ? ' — ' + v.note : ''}`);

  const SYN = [
    ['vestiaire', 'vestiaires', 'taquilla', 'taquillas', 'locker'],
    ['armoire', 'armoires', 'armario', 'armarios', 'classement'],
    ['rayonnage', 'etagere', 'etageres', 'estanteria', 'estanterias', 'palettier', 'rack'],
    ['chaise', 'chaises', 'silla', 'sillas', 'siege', 'sieges', 'assise'],
    ['fauteuil', 'fauteuils', 'sillon'], ['bureau', 'bureaux', 'escritorio', 'desk'],
    ['table', 'tables', 'mesa', 'mesas', 'pupitre'], ['caisson', 'cajonera', 'tiroirs'],
    ['scolaire', 'ecole', 'escolar', 'colegio', 'eleve'], ['transpalette', 'transpaleta'], ['chariot', 'elevateur', 'carretilla'],
  ];
  const synOf = {};
  SYN.forEach(list => list.forEach(w => { synOf[w] = list; }));
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const hay = p => (p._hay ||= norm([p.name, p.ref, p.tag, p.sub, famById[p.f].name, p.desc, ...(p.specs || []).flat()].join(' '))
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' '));
  const STOP = new Set(['de', 'la', 'le', 'les', 'des', 'et', 'pour', 'avec', 'a', 'en', 'du', 'un', 'une', 'el', 'los', 'con', 'para']);
  function tokenMatch(t, words) {
    const alts = synOf[t] || [t];
    return alts.some(a => words.some(w => w.startsWith(a) || (a.length >= 4 && w.length >= 4 && lev(a, w.slice(0, a.length)) <= (a.length >= 7 ? 2 : 1))));
  }
  function matches(p, q) {
    const toks = norm(q).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(t => t.length > 1 && !STOP.has(t));
    if (!toks.length) return true;
    const words = hay(p);
    return toks.every(t => tokenMatch(t, words));
  }

  let sector = secById[location.hash.slice(1)] ? location.hash.slice(1) : 'industrie-tanger';
  $('#sectorTabs').innerHTML = sectors.map(s => `<button role="tab" data-s="${s.id}" id="tab-${s.id}">${esc(s.name)}</button>`).join('');
  function renderSector() {
    const s = secById[sector];
    $$('#sectorTabs button').forEach(b => { const on = b.dataset.s === sector; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    const inSector = products.filter(p => p.sectors.includes(s.key)).sort((a, b) => (b.status === 'complete') - (a.status === 'complete'));
    const made = inSector.filter(p => p.origin === 'tanger').slice(0, 5);
    const list = [...made, ...inSector.filter(p => p.origin !== 'tanger')].slice(0, 8);
    $('#sectorPanel').innerHTML = `
      <div class="sp__txt">
        ${s.who ? `<p class="sp__who">${esc(s.who)}</p>` : ''}
        <h3>${esc(s.title)}</h3>
        <ul class="sp__points">${s.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${s.faq ? `<details class="sp__faq"><summary>${esc(s.faq[0])}</summary><p>${esc(s.faq[1])}</p></details>` : ''}
        <div class="sp__cta"><a href="#devis" class="btn btn--red" data-secteur="${esc(s.form)}">${esc(s.cta)}</a>
        <button class="btn btn--line" type="button" data-ask="${esc(s.ask)}">${t('Poser une question')}</button></div>
      </div>
      <div class="sp__products">${list.map(miniCard).join('')}</div>`;
  }
  const miniCard = p => `<button class="mini" type="button" data-id="${p.id}"><img src="${sm(p.x)}" alt="" loading="lazy"><span>${esc(p.name)}</span>${p.origin === 'tanger' ? `<i class="made made--xs">${t('Fabriqué à Tanger')}</i>` : ''}</button>`;
  $('#sectorTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { sector = b.dataset.s; renderSector(); history.replaceState(null, '', '#' + sector); } });
  $('#sectorPanel').addEventListener('click', e => {
    const m = e.target.closest('.mini'); if (m) return openProduct(products[+m.dataset.id]);
    const c = e.target.closest('[data-secteur]'); if (c) $('#fSecteur').value = c.dataset.secteur;
    const a = e.target.closest('[data-ask]'); if (a) window.OBMAssistant?.open(a.dataset.ask);
  });

  let fam = 'all', query = '', madeOnly = false, visible = [];
  $('#chips').innerHTML = [{ id: 'all', name: t('Tout'), n: products.length }, ...families.map(f => ({ id: f.id, name: f.name, n: count(f.id) }))]
    .map(c => `<button class="chip" role="tab" data-f="${c.id}">${esc(c.name)}<small>${c.n}</small></button>`).join('');
  $('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) setFamily(b.dataset.f); });
  let qT;
  $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { query = e.target.value.trim(); render(); }, 120); });
  $('#fMade').addEventListener('change', e => { madeOnly = e.target.checked; render(); });
  function setFamily(f) { fam = f; render(); $(`.chip[data-f="${f}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  $('#footFam').innerHTML = families.map(f => `<li><a href="#produits" data-go="${f.id}">${esc(f.name)}</a></li>`).join('');
  document.addEventListener('click', e => { const a = e.target.closest('[data-go]'); if (a) setFamily(a.dataset.go); });

  const specLine = p => p.specs ? p.specs.slice(0, 2).map(s => s[1]).join(' · ') : (p.desc || t('Fiche technique sur demande'));
  const card = p => `
    <article class="card${p.wide ? ' wide' : ''}" data-id="${p.id}" tabindex="0" aria-label="${esc(p.name)}">
      <div class="card__img">
        ${p.tag ? `<span class="card__ref">${esc(p.tag)}</span>` : ''}
        ${p.origin === 'tanger' ? `<span class="made made--card">${t('Fabriqué à Tanger')}</span>` : ''}
        <img src="${sm(p.x)}" alt="${esc(p.name)}" loading="lazy" width="720" height="720" onload="this.classList.add('ok')">
        <span class="card__view">${t('Voir la fiche')}</span>
      </div>
      <div class="card__body">
        <span class="card__sub">${esc(p.ref)} · ${esc(p.sub)}</span>${p.inStock ? `<span class="stock-ok">${t('En stock')}</span>` : ''}
        <h4>${esc(p.name)}</h4>
        <p class="card__spec">${esc(specLine(p))}</p>
        <div class="card__foot"><span>${p.status === 'complete' ? t('Fiche détaillée') : t('Données sur demande')}</span><button class="add" data-ref="${p.ref}">${t('+ Sélection')}</button></div>
      </div>
    </article>`;
  const ctaCard = () => `
    <div class="cta-card"><h4>${t('Votre configuration n’est pas présentée ?')}</h4>
      <p>${t('Nous étudions votre espace sur site et adaptons la sélection à vos usages.')}</p>
      <a href="#devis" class="btn btn--red btn--sm">${t('Demander une étude gratuite')}</a></div>`;
  function render() {
    $$('.chip').forEach(c => c.classList.toggle('on', c.dataset.f === fam));
    visible = products.filter(p => (fam === 'all' || p.f === fam) && (!madeOnly || p.origin === 'tanger') && matches(p, query));
    const groups = [];
    visible.forEach(p => {
      const key = fam === 'all' ? famById[p.f].name : p.sub;
      let g = groups.find(g => g.key === key);
      if (!g) groups.push(g = { key, items: [] });
      g.items.push(p);
    });
    $('#result').textContent = visible.length ? `${t(visible.length > 1 ? '{n} références' : '{n} référence', { n: visible.length })}${fam !== 'all' ? ' · ' + famById[fam].name : ''}${madeOnly ? ' · ' + t('fabriquées à Tanger') : ''}${query ? ` · « ${query} »` : ''}` : '';
    $('#catalog').innerHTML = groups.map((g, i) => `
      <section class="group">
        <h3 class="group__h">${esc(g.key)}<small>${g.items.length}</small></h3>
        ${fam !== 'all' && i === 0 ? `<p class="fam-intro">${esc(famById[fam].intro)}</p>` : ''}
        <div class="grid">${g.items.map(card).join('')}${(i === groups.length - 1 && !query) ? ctaCard() : ''}</div>
      </section>`).join('');
    $('#empty').hidden = visible.length > 0;
    syncSel();
  }
  $('#catalog').addEventListener('click', e => {
    const add = e.target.closest('.add');
    if (add) { e.stopPropagation(); toggleSel(add.dataset.ref); return; }
    const c = e.target.closest('.card'); if (c) openProduct(products[+c.dataset.id]);
  });
  $('#catalog').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('card')) openProduct(products[+e.target.dataset.id]); });

  const modal = $('#modal'), zoom = $('#zoom'), mImg = $('#mImg');
  let cur = null, lastFocus = null;
  function openProduct(p, fromHash) {
    cur = p;
    const f = famById[p.f];
    $('#mCrumbs').innerHTML = `<a href="#produits" data-go="${f.id}" data-close>${esc(f.name)}</a><i>/</i>${esc(p.sub)}`;
    $('#mRef').textContent = t('Réf.') + ' ' + p.ref;
    $('#mTag').textContent = p.tag ? t('Modèle') + ' ' + p.tag : '';
    $('#mMade').hidden = p.origin !== 'tanger';
    $('#mStock').hidden = !p.inStock;
    $('#mTitle').textContent = p.name;
    $('#mDesc').textContent = p.desc || '';
    $('#mSpecs').innerHTML = (p.specs || []).map(s => `<tr><th>${esc(s[0])}</th><td>${esc(s[1])}</td></tr>`).join('');
    $('#mNote').textContent = p.status === 'complete' ? ''
      : t('Fiche technique sur demande : dimensions et caractéristiques détaillées communiquées avec le devis (catalogue 2026, p. {p}).', { p: pad(p.p) });
    $('#mNote').hidden = p.status === 'complete';
    $('#mSectors').textContent = t('Secteurs :') + ' ' + p.sectors.map(s => sectors.find(x => x.key === s)?.short || s).join(' · ');
    $('#mQuote').textContent = p.status === 'complete' ? t('Demander un devis') : t('Fiche technique sur demande');
    $('#mThumbs').innerHTML = (p.gallery || []).map(x => `<button data-x="${x}" class="${x === p.x ? 'on' : ''}"><img src="${sm(x)}" alt=""></button>`).join('');
    setImg(p.x);
    const rel = products.filter(r => r.f === p.f && r.sub === p.sub && r !== p);
    const list = [...rel, ...(rel.length < 4 ? products.filter(r => r.f === p.f && r.sub !== p.sub) : [])].slice(0, 4);
    $('#mRelated').innerHTML = list.length ? `<h4>${t('Dans la même famille')}</h4><div class="related__row">${list.map(r =>
      `<button data-id="${r.id}" title="${esc(r.name)}"><img src="${sm(r.x)}" alt="" loading="lazy"><span>${esc(r.tag || r.name)}</span></button>`).join('')}</div>` : '';
    updAdd();
    if (modal.hidden) { lastFocus = document.activeElement; modal.hidden = false; document.body.style.overflow = 'hidden'; }
    $('.modal__box').scrollTop = 0;
    $('.modal__x').focus({ preventScroll: true });
    if (!fromHash) history.replaceState(null, '', '#fiche-' + p.slug);
    document.title = `${p.name} — OBM Agencement`;
    updateWa();
    track('view_item', { ref: p.ref });
  }
  function setImg(x) { zoom.classList.remove('on'); zoom.classList.toggle('scene', !!cur.wide); mImg.src = img(x); mImg.alt = cur.name; }
  const updAdd = () => { $('#mAdd').textContent = sel[cur.ref] ? t('✓ Dans ma sélection') : t('Ajouter à ma sélection'); };
  function closeModal() {
    modal.hidden = true; document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
    document.title = BASE_TITLE; cur = null; updateWa();
    lastFocus?.focus?.({ preventScroll: true });
  }
  modal.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) closeModal();
    const r = e.target.closest('.related button'); if (r) openProduct(products[+r.dataset.id]);
  });
  $('#mAdd').onclick = () => { toggleSel(cur.ref); updAdd(); };
  $('#mQuote').onclick = () => {
    if (!sel[cur.ref]) addSel(cur.ref, 1, true);
    if (cur.status !== 'complete' && !$('#fMessage').value) $('#fMessage').value = t('Merci de m’envoyer la fiche technique : {name} ({ref}).', { name: cur.name, ref: cur.ref });
    closeModal();
  };
  $('#mShare').onclick = async () => {
    const url = location.href.split('#')[0] + '#fiche-' + cur.slug;
    try { await navigator.clipboard.writeText(url); toast(t('Lien de la fiche copié')); } catch (e) { toast(url); }
  };
  $('#mThumbs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    setImg(isNaN(b.dataset.x) ? b.dataset.x : +b.dataset.x);
    $$('#mThumbs button').forEach(t => t.classList.toggle('on', t === b));
  });
  zoom.addEventListener('click', e => { zoom.classList.toggle('on'); pan(e); });
  zoom.addEventListener('mousemove', pan);
  function pan(e) { const r = zoom.getBoundingClientRect(); mImg.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`; }
  const step = d => { const list = visible.length ? visible : products; const i = Math.max(0, list.indexOf(cur)); openProduct(list[(i + d + list.length) % list.length]); };
  $('#mPrev').onclick = () => step(-1);
  $('#mNext').onclick = () => step(1);
  function fromHash() {
    const m = location.hash.match(/^#fiche-(.+)$/);
    if (m && bySlug[m[1]]) openProduct(bySlug[m[1]], true);
    const s = location.hash.slice(1);
    if (secById[s]) { sector = s; renderSector(); $('#secteurs').scrollIntoView({ behavior: 'smooth' }); }
  }
  window.addEventListener('hashchange', fromHash);

  const drawer = $('#drawer');
  function renderSel() {
    const refs = Object.keys(sel);
    $('#selSum').textContent = refs.length ? `${t(refs.length > 1 ? '{n} références' : '{n} référence', { n: refs.length })} · ${t(selTotal() > 1 ? '{n} articles' : '{n} article', { n: selTotal() })}` : '';
    $('#selList').innerHTML = refs.length ? refs.map(r => {
      const p = byRef[r], v = sel[r];
      return `<li><img src="${sm(p.x)}" alt=""><div><b>${esc(p.name)}</b><small>${esc(r)}${p.tag ? ' · ' + esc(p.tag) : ''}</small>
        <input class="note" data-ref="${r}" value="${esc(v.note)}" placeholder="${t('Remarque : coloris, variante…')}" aria-label="${t('Remarque')} — ${esc(p.name)}"></div>
        <div class="qty"><button data-q="-1" data-ref="${r}" aria-label="${t('Moins')}">−</button><input value="${v.q}" data-ref="${r}" inputmode="numeric" aria-label="${t('Quantité')}"><button data-q="1" data-ref="${r}" aria-label="${t('Plus')}">+</button></div></li>`;
    }).join('') : `<li class="empty-sel">${t('Votre sélection est vide.')}<br>${t('Ajoutez des références depuis le catalogue ou l’assistant.')}</li>`;
  }
  const openDrawer = () => { renderSel(); drawer.hidden = false; document.body.style.overflow = 'hidden'; };
  const closeDrawer = () => { drawer.hidden = true; document.body.style.overflow = ''; };
  $('#openSel').onclick = openDrawer;
  $('#selGo').onclick = closeDrawer;
  drawer.addEventListener('click', e => {
    if (e.target.closest('[data-dclose]')) return closeDrawer();
    const b = e.target.closest('[data-q]'); if (!b) return;
    const r = b.dataset.ref; sel[r].q += +b.dataset.q;
    if (sel[r].q <= 0) delete sel[r];
    syncSel(); renderSel();
  });
  drawer.addEventListener('change', e => {
    const r = e.target.dataset.ref; if (!r || !sel[r]) return;
    if (e.target.matches('.qty input')) { const v = parseInt(e.target.value, 10); if (v > 0) sel[r].q = v; else delete sel[r]; syncSel(); renderSel(); }
    if (e.target.matches('.note')) { sel[r].note = e.target.value.slice(0, 200); syncSel(); }
  });
  $('#selClear').onclick = () => { sel = {}; syncSel(); renderSel(); };

  function renderFormSel() {
    const refs = Object.keys(sel);
    $('#formSel').innerHTML = refs.length
      ? `<b>${t('Votre sélection')} (${refs.length})</b><button type="button" id="editSel">${t('Modifier')}</button><ul>${refs.map(r => `<li>${esc(byRef[r].name)} × ${sel[r].q}${sel[r].note ? ' — ' + esc(sel[r].note) : ''}</li>`).join('')}</ul>`
      : '';
  }
  $('#formSel').addEventListener('click', e => { if (e.target.id === 'editSel') openDrawer(); });
  const newNumber = () => { const d = new Date(); return `OBM-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; };
  const REQUIRED = { nom: t('Indiquez votre nom.'), societe: t('Indiquez votre société ou établissement.'), tel: t('Indiquez un numéro de téléphone.'), email: t('Indiquez une adresse e-mail valide.'), ville: t('Indiquez votre ville.'), secteur: t('Choisissez votre secteur.') };
  function validate(f, names, focus = true) {
    let first = null;
    names.forEach(n => {
      const el = f.elements[n]; let msg = '';
      const v = el.value.trim();
      if (!v) msg = REQUIRED[n] || t('Champ obligatoire.');
      else if (n === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = REQUIRED.email;
      else if (n === 'tel' && v.replace(/\D/g, '').length < 9) msg = t('Numéro incomplet : 9 chiffres minimum.');
      el.classList.toggle('err', !!msg);
      let hint = el.parentElement.querySelector('.hint');
      if (msg) { if (!hint) { hint = document.createElement('small'); hint.className = 'hint'; el.after(hint); } hint.textContent = msg; if (!first) first = el; }
      else hint?.remove();
    });
    if (first && focus) first.focus();
    return !first;
  }
  $$('#quoteForm input, #quoteForm select').forEach(i => i.addEventListener('blur', () => { if (REQUIRED[i.name] && i.value) validate($('#quoteForm'), [i.name], false); }));
  const SKIP = ['fichiers', 'form-name', 'numero'];
  async function sendLead(form, type) {
    const files = [...(form.querySelector('input[type=file]')?.files || [])];
    if (files.reduce((a, f) => a + f.size, 0) > 8 * 1024 * 1024) throw new Error('size');
    const body = { type, numero: form.numero.value, langue: document.documentElement.lang.slice(0, 2) };
    for (const [k, v] of new FormData(form)) if (!SKIP.includes(k) && typeof v === 'string') body[k] = v;
    body.utm_premier_contact ||= touchText('obm-first'); body.utm_dernier_contact ||= touchText('obm-last');
    if (type === 'devis') body.items = Object.entries(sel).map(([ref, v]) => ({ ref, q: v.q, note: v.note }));
    const res = await fetch('/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(res.status === 429 ? 'rate' : 'http ' + res.status); throw e; }
    let filesOk = true;
    for (const [n, f] of files.entries()) {
      const CH = 4 * 1024 * 1024, parts = Math.max(1, Math.ceil(f.size / CH));
      for (let i = 0; i < parts && filesOk; i++) {
        const q = new URLSearchParams({ n, part: i, parts, name: f.name, type: f.type || '' });
        const r = await fetch(`/api/lead/${j.numero}/file?${q}`, { method: 'POST', headers: { 'x-lead-token': j.token, 'content-type': 'application/octet-stream' }, body: f.slice(i * CH, (i + 1) * CH) }).catch(() => null);
        if (!r || !r.ok) filesOk = false;
      }
    }
    return { numero: j.numero || form.numero.value, filesOk };
  }
  $('#quoteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.adresse_web.value) return;
    if (!validate(f, Object.keys(REQUIRED))) { toast(t('Vérifiez les champs signalés')); return; }
    let num = newNumber();
    f.numero.value = num; f.selection.value = selLines().join('\n'); f.page.value = location.href;
    f.utm_premier_contact.value = touchText('obm-first'); f.utm_dernier_contact.value = touchText('obm-last');
    f.canal.value = f.canal.value || 'formulaire';
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = t('Envoi…');
    let ok = true;
    try {
      const r = await sendLead(f, 'devis'); num = r.numero;
      if (!r.filesOk) setTimeout(() => toast(t('Demande enregistrée, mais les pièces jointes n’ont pas pu être envoyées : transmettez-les par WhatsApp en citant le numéro.')), 600);
    }
    catch (err) {
      ok = false;
      if (err.message === 'size') { btn.disabled = false; btn.textContent = t('Envoyer ma demande'); toast(t('Fichiers trop lourds : 8 Mo au total maximum')); return; }
      if (err.message === 'rate') { btn.disabled = false; btn.textContent = t('Envoyer ma demande'); toast(t('Trop de demandes envoyées. Réessayez dans une heure ou appelez-nous.')); return; }
    }
    btn.disabled = false; btn.textContent = t('Envoyer ma demande');
    showSent(num, ok, f);
    track('generate_lead', { type: Object.keys(sel).length ? 'selection' : 'devis', numero: num, ok });
  });
  function showSent(num, ok, f) {
    $('#sentNum').textContent = t('N°') + ' ' + num;
    const summary = `Demande ${num}\n${f.nom.value} — ${f.societe.value} — ${f.ville.value}\n${f.secteur.value}\n${selLines().join('\n')}\n${f.message.value}`;
    $('#sentWa').href = `https://wa.me/${WA}?text=${encodeURIComponent(summary)}`;
    const alt = $('#sentAlt');
    alt.hidden = ok;
    if (!ok) alt.innerHTML = t('La connexion a échoué : votre demande n’a pas pu être enregistrée. Envoyez-la par WhatsApp ou à {email} en citant le numéro {num}.', { email: `<strong class="sel-text">${EMAIL}</strong>`, num });
    f.hidden = true; $('#sent').hidden = false;
    $('#sent').scrollIntoView({ block: 'nearest' });
  }
  $('#sentNew').onclick = () => { $('#sent').hidden = true; $('#quoteForm').hidden = false; $('#quoteForm').reset(); };
  $('#callbackForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.adresse_web.value) return;
    if (!validate(f, ['nom', 'tel'])) return;
    f.numero.value = newNumber(); f.source.value = touchText('obm-last') || touchText('obm-first'); f.page.value = location.href;
    try {
      const r = await sendLead(f, 'rappel');
      toast(t('Demande de rappel enregistrée ({num})', { num: r.numero })); f.reset(); track('callback_request');
    }
    catch (err) { toast(t('Échec de l’envoi : appelez le +212 6 74 95 39 00')); }
  });

  function waText(extra) {
    const where = cur ? t('la fiche {name} ({ref})', { name: cur.name, ref: cur.ref }) : t('votre site');
    const lines = selLines();
    return `${t('Bonjour OBM, je consulte {where}.', { where })}${lines.length ? '\n' + t('Ma sélection :') + '\n' + lines.join('\n') : ''}${extra ? '\n' + extra : ''}`;
  }
  function updateWa() { const h = `https://wa.me/${WA}?text=${encodeURIComponent(waText())}`; $('#waBtn').href = h; const m = $('#mbarWa'); if (m) m.href = h; }
  document.addEventListener('click', e => { const t = e.target.closest('[data-track]'); if (t) track(t.dataset.track + '_click'); });

  Object.assign(window.OBMApp, {
    products, byRef, famById, sm, matches,
    openProduct: ref => byRef[ref] && openProduct(byRef[ref]),
    addToSelection: (ref, q) => addSel(ref, q || 1),
    openSelection: openDrawer,
    selection: () => selLines(),
    showFamily: f => { setFamily(f); $('#produits').scrollIntoView({ behavior: 'smooth' }); },
    waLink: extra => `https://wa.me/${WA}?text=${encodeURIComponent(waText(extra))}`,
    prefill(data) {
      const map = { nom: 'fNom', societe: 'fSociete', tel: 'fTel', email: 'fEmail', ville: 'fVille', fonction: 'fFonction', message: 'fMessage', code: 'fCode' };
      Object.entries(data || {}).forEach(([k, v]) => {
        if (!v) return;
        if (k === 'secteur') {
          const key = norm(String(v));
          const o = [...$('#fSecteur').options].find(o => o.value && (norm(o.text).includes(key) || key.includes(norm(o.text).split(/[ /]/)[0])));
          if (o) $('#fSecteur').value = o.value;
          return;
        }
        const el = map[k] && document.getElementById(map[k]);
        if (el) el.value = String(v).slice(0, 1500);
      });
      $('#quoteForm').canal.value = 'assistant';
    },
    goQuote() { $('#sent').hidden = true; $('#quoteForm').hidden = false; $('#devis').scrollIntoView({ behavior: 'smooth' }); },
    goCallback() { $('.callback').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('#cbNom').focus(), 500); },
    track,
  });

  (function heroSlides() {
    const trio = $('.hero__trio'), cap = $('#heroCap'), dots = $('#heroDots');
    if (!trio || !cap || !dots) return;
    const SLIDES = [
      { cap: cap.innerHTML },
      { f: 'stockage', refs: ['STO-01', 'STO-03', 'STO-04'] },
      { f: 'sieges', refs: ['SIE-19', 'SIE-01', 'SIE-17'] },
      { f: 'scolaire', refs: ['SCO-01', 'SCO-09', 'SCO-06'] },
      { f: 'collectivites', refs: ['COL-01', 'COL-03', 'COL-04'] },
    ].filter(s => !s.refs || s.refs.every(r => byRef[r]));
    const box = document.createElement('div'); box.className = 'hero__slides';
    trio.replaceWith(box);
    trio.classList.add('hero__slide', 'is-active'); box.appendChild(trio);
    SLIDES.slice(1).forEach(s => {
      const d = document.createElement('div'); d.className = 'hero__trio hero__slide'; d.setAttribute('aria-hidden', 'true');
      d.innerHTML = s.refs.map(r => `<img src="${img(byRef[r].x)}" alt="${esc(byRef[r].name)}" width="1400" height="1400" loading="lazy">`).join('');
      box.appendChild(d);
      s.cap = `<b class="hero__fam">${esc(famById[s.f].name)}</b>${esc(famById[s.f].tags)}`;
    });
    const slides = [...box.children];
    dots.innerHTML = SLIDES.map((s, i) => `<button type="button" role="tab" aria-label="${esc(t('Diapositive {n}', { n: i + 1 }))}"${i ? '' : ' aria-selected="true"'}></button>`).join('');
    let cur = 0, timer = null;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function go(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach((el, k) => { el.classList.toggle('is-active', k === cur); el.setAttribute('aria-hidden', k !== cur); });
      [...dots.children].forEach((d, k) => d.setAttribute('aria-selected', k === cur));
      cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');
      cap.innerHTML = SLIDES[cur].cap;
      preload(cur + 1);
    }
    const preload = i => slides[(i + slides.length) % slides.length].querySelectorAll('img').forEach(im => { im.loading = 'eager'; });
    addEventListener('load', () => preload(1));
    const play = () => { if (!still && !timer) timer = setInterval(() => go(cur + 1), 4500); };
    const stop = () => { clearInterval(timer); timer = null; };
    dots.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { go([...dots.children].indexOf(b)); stop(); play(); } });
    const fig = $('.hero__visual');
    fig.addEventListener('mouseenter', stop); fig.addEventListener('mouseleave', play);
    fig.addEventListener('focusin', stop); fig.addEventListener('focusout', play);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
    play();
  })();

  (function atelierReel() {
    const reel = $('#reel'); if (!reel) return;
    const slides = [...reel.querySelectorAll('.reel__slide')];
    const bars = reel.querySelector('.reel__bars');
    bars.innerHTML = slides.map(() => '<span><i></i></span>').join('');
    const fills = [...bars.querySelectorAll('i')];
    slides.forEach(s => { const v = s.querySelector('video'); if (v) s.style.background = `#0d1730 url(${v.poster}) center/cover`; });
    const btn = reel.querySelector('.reel__toggle');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cur = 0, timer = null, playing = false, visible = false, started = 0, remaining = 0;
    function dur(i) {
      const v = slides[i].querySelector('video'), max = +slides[i].dataset.dur || 6500;
      return v && v.duration ? Math.min(v.duration * 1000, max) : max;
    }
    function paint(i, ms) {
      fills.forEach((f, k) => {
        f.style.transition = 'none';
        f.style.width = k < i ? '100%' : '0%';
      });
      void bars.offsetWidth;
      if (ms) { fills[i].style.transition = `width ${ms}ms linear`; fills[i].style.width = '100%'; }
    }
    function show(i) {
      slides[cur].querySelector('video')?.pause();
      cur = (i + slides.length) % slides.length;
      slides.forEach((s, k) => s.classList.toggle('is-active', k === cur));
      const v = slides[cur].querySelector('video');
      const next = slides[(cur + 1) % slides.length].querySelector('video');
      if (next) next.preload = 'auto';
      if (v) { v.currentTime = 0; if (playing) v.play().catch(() => {}); }
      remaining = dur(cur);
      if (playing) run(); else paint(cur, 0);
    }
    function run() {
      clearTimeout(timer); started = Date.now();
      paint(cur, remaining);
      timer = setTimeout(() => show(cur + 1), remaining);
    }
    function play() {
      if (playing) return; playing = true; reel.classList.remove('is-paused');
      btn.setAttribute('aria-label', t('Pause'));
      slides[cur].querySelector('video')?.play().catch(() => {});
      run();
    }
    function pause() {
      if (!playing) return; playing = false; reel.classList.add('is-paused');
      btn.setAttribute('aria-label', t('Lecture'));
      clearTimeout(timer); remaining = Math.max(400, remaining - (Date.now() - started));
      slides[cur].querySelector('video')?.pause();
      const w = getComputedStyle(fills[cur]).width; fills[cur].style.transition = 'none'; fills[cur].style.width = w;
    }
    let userPaused = still;
    btn.onclick = () => { userPaused = playing; playing ? pause() : play(); };
    reel.addEventListener('click', e => { if (e.target.closest('.reel__toggle')) return; const r = reel.getBoundingClientRect(); show(e.clientX - r.left < r.width / 3 ? cur - 1 : cur + 1); });
    new IntersectionObserver(es => es.forEach(en => { visible = en.isIntersecting; if (visible && !userPaused) play(); else if (!visible) pause(); }), { threshold: .35 }).observe(reel);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else if (visible && !userPaused) play(); });
    reel.classList.toggle('is-paused', true);
    show(0);
  })();

  (function marquee() {
    const A = $('#mqA'), B = $('#mqB'); if (!A || !B) return;
    const tile = p => `<button type="button" class="mq" data-id="${p.id}" aria-label="${esc(p.name)}"><img src="${sm(p.x)}" alt="" loading="lazy" width="720" height="720"><span>${esc(p.tag || p.name)}</span></button>`;
    const pick = products.filter(p => !p.wide);
    const half = Math.ceil(pick.length / 2);
    [[A, pick.slice(0, half)], [B, pick.slice(half)]].forEach(([row, list]) => {
      const html = list.map(tile).join('');
      row.innerHTML = `<div class="marquee__track">${html}${html}</div>`;
      row.querySelector('.marquee__track').style.setProperty('--dur', list.length * 3.2 + 's');
      row.querySelectorAll('.mq').forEach((b, i) => { if (i >= list.length) b.setAttribute('aria-hidden', 'true'), b.tabIndex = -1; });
    });
    document.querySelector('.marquee').addEventListener('click', e => { const b = e.target.closest('.mq'); if (b) openProduct(products[+b.dataset.id]); });
  })();

  const madeList = products.filter(p => p.origin === 'tanger');
  $('#featuredGrid').innerHTML = ['VES-02', 'VES-01', 'ARM-02', 'ARM-04', 'ARM-01', 'ARM-03'].map(r => byRef[r]).filter(Boolean).map(miniCard).join('');
  $('#featuredGrid').addEventListener('click', e => { const m = e.target.closest('.mini'); if (m) openProduct(products[+m.dataset.id]); });
  (function rotateFeatured() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const grid = $('#featuredGrid'); let slot = 0, hover = false;
    grid.addEventListener('mouseenter', () => { hover = true; }); grid.addEventListener('mouseleave', () => { hover = false; });
    setInterval(() => {
      if (hover || document.hidden) return;
      const shown = [...grid.children].map(c => +c.dataset.id);
      const pool = madeList.filter(p => !shown.includes(p.id)); if (!pool.length) return;
      const next = pool[Math.floor(Math.random() * pool.length)];
      const cell = grid.children[slot % grid.children.length]; slot++;
      cell.classList.add('is-out');
      setTimeout(() => { const n = document.createElement('div'); n.innerHTML = miniCard(next); const el = n.firstElementChild; el.classList.add('is-in'); cell.replaceWith(el); requestAnimationFrame(() => el.classList.remove('is-in')); }, 450);
    }, 2600);
  })();
  $('[data-go-made]').textContent = t('Voir les {n} produits fabriqués', { n: madeList.length });
  $('[data-go-made]').onclick = () => { $('#fMade').checked = true; madeOnly = true; fam = 'all'; render(); $('#produits').scrollIntoView({ behavior: 'smooth' }); };
  document.addEventListener('click', e => { const c = e.target.closest('a[data-secteur]'); if (c) $('#fSecteur').value = c.dataset.secteur; });
  $('#mbarBot').onclick = () => window.OBMAssistant?.open();

  const langBox = $('#lang');
  if (langBox) {
    const btn = langBox.querySelector('.lang__btn'), menu = langBox.querySelector('.lang__menu');
    const cur = (document.documentElement.lang || 'fr').slice(0, 2);
    langBox.querySelector('.lang__cur').textContent = cur === 'ar' ? 'ع' : cur.toUpperCase();
    langBox.querySelector(`[data-l="${cur}"]`)?.setAttribute('aria-current', 'true');
    btn.onclick = () => { menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', !menu.hidden); };
    document.addEventListener('click', e => { if (!langBox.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    menu.addEventListener('click', e => { const l = e.target.closest('a'); if (l) { e.preventDefault(); location.href = l.getAttribute('href') + location.hash; } });
  }

  document.addEventListener('keydown', e => {
    if (!modal.hidden) { if (e.key === 'Escape') closeModal(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); return; }
    if (!drawer.hidden && e.key === 'Escape') closeDrawer();
  });
  const header = $('#header'), toolbar = $('#toolbar');
  const onScroll = () => { header.classList.toggle('scrolled', scrollY > 10); toolbar.classList.toggle('stuck', toolbar.getBoundingClientRect().top <= header.offsetHeight + 1); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  $('#burger').onclick = () => $('#nav').classList.toggle('open');
  $('#nav').addEventListener('click', e => { if (e.target.tagName === 'A') $('#nav').classList.remove('open'); });

  renderSector();
  render();
  fromHash();
  window.__obmAppReady?.();
})();
