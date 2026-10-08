(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const IMAGES = (window.OBM && window.OBM.images) || {};
  const LANGS = { es: 'Espagnol', en: 'Anglais', ar: 'Arabe' };
  const ORIGIN = { tanger: ['Fabriqué à Tanger', 'made'], distribue: ['Distribué', 'dist'], 'a-confirmer': ['À confirmer', 'tbc'] };
  let me = null, families = [], products = [], version = 0, editing = null, photos = [];

  async function api(method, path, body) {
    const opt = { method, headers: { 'x-obm-admin': '1' }, credentials: 'same-origin' };
    if (body instanceof FormData) opt.body = body;
    else if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch('/api/admin/' + path, opt);
    let j = {};
    try { j = await r.json(); } catch {}
    if (r.status === 401 && path !== 'login' && path !== 'me') { showAuth('login', 'Session expirée : reconnectez-vous.'); throw new Error(j.error); }
    if (!r.ok) { const e = new Error(j.error || 'Erreur ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  const thumb = (x) => (typeof x === 'string' && x.startsWith('b:')) ? `/api/img/${x.slice(2)}-sm` : `/img/sm/${IMAGES[x]}.webp`;
  let toastT;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function ask(title, text, { yes = 'Confirmer', body = '' } = {}) {
    return new Promise((resolve) => {
      $('#dTitle').textContent = title; $('#dText').textContent = text; $('#dBody').innerHTML = body; $('#dYes').textContent = yes;
      $('#dialog').hidden = false;
      const done = (v) => { $('#dialog').hidden = true; $('#dYes').onclick = $('#dNo').onclick = null; resolve(v); };
      $('#dYes').onclick = () => done(true); $('#dNo').onclick = () => done(false);
    });
  }

  let authMode = 'login';
  function showAuth(mode, msg) {
    authMode = mode;
    $('#app').hidden = true; $('#auth').hidden = false;
    const setup = mode === 'setup';
    $('#fCodeRow').hidden = $('#fNameRow').hidden = !setup;
    $('#authTitle').textContent = setup ? 'Mise en service de l’espace admin' : 'Espace administrateur';
    $('#authLead').textContent = setup ? 'Créez le premier compte administrateur avec le code défini dans Netlify (variable ADMIN_SETUP_CODE).' : 'Connectez-vous pour gérer le catalogue et le stock.';
    $('#authBtn').textContent = setup ? 'Créer le compte' : 'Se connecter';
    $('#fPass').autocomplete = setup ? 'new-password' : 'current-password';
    $('#authErr').hidden = !msg; $('#authErr').textContent = msg || '';
  }
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#authBtn'); btn.disabled = true;
    try {
      const payload = { email: $('#fEmail').value.trim(), password: $('#fPass').value };
      if (authMode === 'setup') Object.assign(payload, { code: $('#fCode').value.trim(), name: $('#fName').value.trim() });
      await api('POST', authMode === 'setup' ? 'setup' : 'login', payload);
      $('#fPass').value = '';
      await start();
    } catch (err) { $('#authErr').hidden = false; $('#authErr').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  async function boot() {
    try {
      const s = await api('GET', 'setup');
      if (s.needed) return showAuth('setup', s.enabled ? '' : 'Pour activer l’espace admin, ajoutez la variable ADMIN_SETUP_CODE dans Netlify (Site configuration → Environment variables), puis redéployez.');
    } catch {}
    try { await start(); } catch { showAuth('login'); }
  }
  async function start() {
    const r = await api('GET', 'me');
    me = r.user; families = r.families; team = r.team || [];
    $('#auth').hidden = true; $('#app').hidden = false;
    $('#meName').textContent = `${me.name} · ${me.role === 'admin' ? 'administrateur' : 'éditeur'}`;
    $$('[data-admin]').forEach((b) => { b.hidden = me.role !== 'admin'; });
    $('#pFam').innerHTML = '<option value="">Toutes les familles</option>' + families.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
    $('select[name=f]').innerHTML = families.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
    $('#lWho').innerHTML = '<option value="">Tous les commerciaux</option><option value="-">Non attribuées</option>' + team.map((u) => `<option value="${esc(u.email)}">${esc(u.name)}</option>`).join('');
    await loadProducts();
    await loadLeads();
  }
  $('#logoutBtn').onclick = async () => { await api('POST', 'logout').catch(() => {}); showAuth('login'); };

  function showTab(tab) {
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    $$('.view').forEach((v) => { v.hidden = v.id !== 'v-' + tab; });
    if (tab === 'users') loadUsers();
    if (tab === 'audit') loadAudit();
    if (tab === 'stock') renderStock();
    if (tab === 'leads') renderLeads();
    if (tab === 'dash') renderDash();
    scrollTo(0, 0);
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  const STATUS = { nouveau: 'Nouvelle', contacte: 'Contactée', devis: 'Devis envoyé', gagne: 'Gagnée', perdu: 'Perdue' };
  const NORD = ['tanger', 'tetouan', 'larache', 'asilah', 'mdiq', 'fnideq', 'ksar', 'martil', 'gueznaya', 'mghogha', 'free zone', 'tfz', 'tac', 'chefchaouen', 'al hoceima', 'houara'];
  let leads = [], team = [], period = 30, current = null, seenIds = null;
  const day = 864e5;
  const fmtD = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const fmtDT = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtN = (n) => Math.round(n).toLocaleString('fr-FR');
  const dur = (ms) => ms < 3600e3 ? Math.max(1, Math.round(ms / 60e3)) + ' min' : ms < 48 * 3600e3 ? Math.round(ms / 3600e3) + ' h' : Math.round(ms / day) + ' j';
  const ago = (iso) => 'il y a ' + dur(Date.now() - new Date(iso));
  const isLate = (l) => l.status === 'nouveau' && Date.now() - new Date(l.at) > day;
  const pill = (s) => `<span class="st st--${s}">${STATUS[s] || s}</span>`;
  const who = (email) => team.find((u) => u.email === email)?.name || email || '';
  const isNord = (l) => { const v = norm(l.contact?.ville).replace(/[^a-z ]/g, ''); return !!v && NORD.some((k) => v.includes(k)); };
  function origin(l) {
    const s = l.source || {}, f = s.first || {};
    if (s.canal === 'assistant') return 'Assistant du site';
    if (s.code) return 'Code prospect';
    if (f.utm_source) return f.utm_source.charAt(0).toUpperCase() + f.utm_source.slice(1);
    if (f.referent) { try { const h = new URL(f.referent).hostname.replace(/^www\./, ''); return /google\./.test(h) ? 'Google' : /facebook|fb\./.test(h) ? 'Facebook' : /instagram/.test(h) ? 'Instagram' : /linkedin|lnkd/.test(h) ? 'LinkedIn' : h; } catch {} }
    if (s.declaree) return s.declaree;
    return 'Accès direct';
  }
  const need = (l) => l.type === 'rappel' ? `Rappel · ${l.creneau || ''}` : (l.items?.length ? `${l.items.length} article${l.items.length > 1 ? 's' : ''}` : (l.message || '').slice(0, 60) || l.secteur || '');

  async function loadLeads(silent) {
    try {
      const r = await api('GET', 'leads');
      const fresh = seenIds && r.leads.filter((l) => !seenIds.has(l.id));
      leads = r.leads; seenIds = new Set(leads.map((l) => l.id));
      if (fresh && fresh.length) toast(fresh.length > 1 ? `${fresh.length} nouvelles demandes reçues` : `Nouvelle demande : ${fresh[0].contact?.nom || fresh[0].id}`);
      const n = leads.filter((l) => l.status === 'nouveau').length;
      $('#newCount').hidden = !n; $('#newCount').textContent = n;
      renderDash(); renderLeads();
      $('#dashUpdated').textContent = 'Mis à jour à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (err) { if (!silent) toast(err.message, true); }
  }
  setInterval(() => { if (!$('#app').hidden && document.visibilityState === 'visible') loadLeads(true); }, 60e3);

  const tip = $('#tip');
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = el.dataset.tip; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px';
    tip.style.top = (e.clientY - h - 12 < 4 ? e.clientY + 18 : e.clientY - h - 12) + 'px';
  });

  function hbars(el, rows, unit = 'demande') {
    if (!rows.length) { el.innerHTML = '<p class="empty">Pas encore de données sur la période.</p>'; return; }
    const max = Math.max(...rows.map((r) => r.v)), tot = rows.reduce((a, r) => a + r.v, 0);
    el.innerHTML = `<div class="hb">${rows.map((r) => `<div class="hb__row" data-tip="<b>${esc(r.k)}</b><br>${r.v} ${unit}${r.v > 1 ? 's' : ''} · ${Math.round(r.v / tot * 100)} %${r.extra ? '<br>' + esc(r.extra) : ''}">
      <span class="hb__label">${esc(r.k)}</span><span class="hb__track"><span class="hb__bar" style="width:${r.v / max * 100}%"></span></span><span class="hb__val">${r.v}</span></div>`).join('')}</div>`;
  }
  const countBy = (list, fn, top = 8) => {
    const m = new Map(); list.forEach((l) => { const k = fn(l); if (k) m.set(k, (m.get(k) || 0) + 1); });
    let rows = [...m].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    if (rows.length > top) { const rest = rows.slice(top - 1).reduce((a, r) => a + r.v, 0); rows = [...rows.slice(0, top - 1), { k: 'Autres', v: rest }]; }
    return rows;
  };
  const niceMax = (v) => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); const n = [1, 2, 2.5, 5, 10].find((x) => x * p >= v); return n * p; };
  function columns(el, list) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let buckets = [];
    if (period <= 30) for (let i = period - 1; i >= 0; i--) { const s = new Date(now - i * day); buckets.push({ s, e: new Date(+s + day), x: s.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), lab: s.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }); }
    else if (period <= 90) { const mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7)); for (let i = 12; i >= 0; i--) { const s = new Date(+mon - i * 7 * day); buckets.push({ s, e: new Date(+s + 7 * day), x: fmtD(s), lab: 'Semaine du ' + s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) }); } }
    else for (let i = 11; i >= 0; i--) { const s = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.push({ s, e: new Date(now.getFullYear(), now.getMonth() - i + 1, 1), x: s.toLocaleDateString('fr-FR', { month: 'short' }), lab: s.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) }); }
    buckets.forEach((b) => { const inB = list.filter((l) => { const t = new Date(l.at); return t >= b.s && t < b.e; }); b.d = inB.filter((l) => l.type !== 'rappel').length; b.r = inB.length - b.d; });
    const max = niceMax(Math.max(1, ...buckets.map((b) => b.d + b.r)));
    const ticks = [0, max / 2, max];
    const every = Math.ceil(buckets.length / (innerWidth < 700 ? 5 : 10));
    el.innerHTML = `<div class="cc__grid">${ticks.map((t) => `<div style="bottom:${t / max * 100}%"><span>${t}</span></div>`).join('')}</div>
      <div class="cc__plot">${buckets.map((b, i) => `<div class="cc__col" data-tip="<b>${b.lab}</b><br>${b.d + b.r} demande${b.d + b.r > 1 ? 's' : ''}<br>Devis : ${b.d} · Rappel : ${b.r}">
        ${b.r ? `<span class="cc__seg cc__seg--2" style="height:${b.r / max * 100}%"></span>` : ''}${b.d ? `<span class="cc__seg" style="height:${b.d / max * 100}%"></span>` : ''}
        ${(buckets.length - 1 - i) % every === 0 ? `<span class="cc__x">${b.x}</span>` : ''}</div>`).join('')}</div>`;
  }

  function kpi(label, value, sub = '', { hero, go, title } = {}) {
    const tag = go ? 'button' : 'div';
    return `<${tag} class="kpi${hero ? ' kpi--hero' : ''}"${go ? ` data-goto="${go}" type="button"` : ''}${title ? ` title="${esc(title)}"` : ''}><span class="kpi__label">${label}</span><span class="kpi__value">${value}</span><span class="kpi__sub">${sub}</span></${tag}>`;
  }
  function renderDash() {
    if (!me) return;
    const h = new Date().getHours();
    $('#hello').textContent = `${h < 18 ? 'Bonjour' : 'Bonsoir'} ${me.name.split(' ')[0]}`;
    const t0 = Date.now() - period * day, tPrev = t0 - period * day;
    const cur = leads.filter((l) => +new Date(l.at) >= t0);
    const prev = leads.filter((l) => { const t = +new Date(l.at); return t >= tPrev && t < t0; });
    const diff = cur.length - prev.length;
    const deltaTxt = prev.length || cur.length ? `<span class="delta">${diff > 0 ? '▲ +' : diff < 0 ? '▼ ' : '= '}${diff}</span> vs ${period} j précédents` : 'aucune sur la période précédente';
    const todo = leads.filter((l) => l.status === 'nouveau'), late = todo.filter(isLate);
    const answered = cur.filter((l) => l.firstContactAt);
    const avg = answered.length ? answered.reduce((a, l) => a + (new Date(l.firstContactAt) - new Date(l.at)), 0) / answered.length : null;
    const within = answered.filter((l) => new Date(l.firstContactAt) - new Date(l.at) <= day).length;
    const won = cur.filter((l) => l.status === 'gagne'), lost = cur.filter((l) => l.status === 'perdu');
    const rate = won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) : null;
    const wonAmt = won.reduce((a, l) => a + (l.amount || 0), 0);
    const open = leads.filter((l) => l.status === 'devis'), openAmt = open.reduce((a, l) => a + (l.amount || 0), 0);
    const nord = cur.filter(isNord).length;
    const alerts = products.filter((p) => p.alert && (p.stock || 0) <= p.alert).length;
    const out = products.filter((p) => p.visible !== false && !(p.stock > 0)).length;
    $('#kpis').innerHTML = [
      kpi('Demandes reçues', cur.length, deltaTxt, { hero: true, go: 'leads' }),
      kpi('À traiter', todo.length, late.length ? `<span class="flag flag--bad">⚠ ${late.length} en attente depuis plus de 24 h</span>` : (todo.length ? `la plus ancienne : ${ago(todo[todo.length - 1].at)}` : '<span class="flag flag--ok">✓ tout est traité</span>'), { go: 'leads:nouveau' }),
      kpi('Première réponse', avg == null ? '—' : dur(avg), avg == null ? 'délai moyen, objectif 24 h' : `${Math.round(within / answered.length * 100)} % sous 24 h (objectif)<div class="meter"><i style="width:${within / answered.length * 100}%"></i></div>`, { title: 'Temps entre la réception et le passage au statut « Contactée » ou suivant' }),
      kpi('Taux de transformation', rate == null ? '—' : rate + '<small>%</small>', rate == null ? 'aucune demande clôturée' : `${won.length} gagnée${won.length > 1 ? 's' : ''} · ${lost.length} perdue${lost.length > 1 ? 's' : ''}${wonAmt ? ' · ' + fmtN(wonAmt) + ' MAD' : ''}`, { title: 'Gagnées ÷ (gagnées + perdues), demandes reçues sur la période' }),
      kpi('Devis en cours', open.length, openAmt ? fmtN(openAmt) + ' MAD en attente de réponse' : 'en attente de réponse client', { go: 'leads:devis' }),
      kpi('Stock', alerts, `alerte${alerts > 1 ? 's' : ''} de seuil · ${out} article${out > 1 ? 's' : ''} en ligne sans stock`, { go: 'stock' }),
    ].join('');
    columns($('#cTime'), cur);
    hbars($('#cStatus'), Object.keys(STATUS).map((s) => ({ k: STATUS[s], v: cur.filter((l) => l.status === s).length })).filter((r) => r.v));
    const sec = countBy(cur.filter((l) => l.type !== 'rappel'), (l) => l.secteur);
    hbars($('#cSector'), sec);
    if (cur.length) $('#cSector').insertAdjacentHTML('beforeend', `<p class="muted small" style="margin:10px 0 0">Zone Nord (Tanger, Tétouan, Larache…) : <b>${nord}</b> sur ${cur.length} demande${cur.length > 1 ? 's' : ''} · ${Math.round(nord / cur.length * 100)} %</p>`);
    hbars($('#cSource'), countBy(cur, origin));
    const im = new Map();
    cur.forEach((l) => (l.items || []).forEach((i) => { const o = im.get(i.ref) || { k: i.name, v: 0, q: 0 }; o.v++; o.q += i.q; im.set(i.ref, o); }));
    hbars($('#cItems'), [...im.values()].sort((a, b) => b.v - a.v).slice(0, 8).map((o) => ({ ...o, extra: `${o.q} pièce${o.q > 1 ? 's' : ''} demandée${o.q > 1 ? 's' : ''}` })));
    $('#recent tbody').innerHTML = leads.slice(0, 8).map((l) => `<tr data-lead="${l.id}">
      <td class="ref">${l.id}</td><td class="${isLate(l) ? 'late' : 'muted'}">${ago(l.at)}</td>
      <td class="who"><b>${esc(l.contact?.nom)}</b><small>${esc(l.contact?.societe || '')}</small></td>
      <td>${esc(l.contact?.ville || '')}</td><td>${esc(need(l))}</td><td>${pill(l.status)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Aucune demande pour l’instant. Elles apparaîtront ici dès qu’un client remplit le formulaire du site.</td></tr>';
  }
  $('#period').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    period = +b.dataset.p; $$('#period button').forEach((x) => x.classList.toggle('on', x === b)); renderDash();
  });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]'); if (g) { const [tab, st] = g.dataset.goto.split(':'); if (tab === 'leads') $('#lStatus').value = st || ''; showTab(tab); return; }
    const r = e.target.closest('tr[data-lead]'); if (r) openLead(r.dataset.lead);
  });

  $('#lStatus').innerHTML += Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  function filteredLeads() {
    const q = norm($('#lSearch').value), st = $('#lStatus').value, ty = $('#lType').value, w = $('#lWho').value;
    return leads.filter((l) => (!st || l.status === st) && (!ty || l.type === ty) && (!w || (w === '-' ? !l.assignee : l.assignee === w))
      && (!q || norm([l.id, l.contact?.nom, l.contact?.societe, l.contact?.ville, l.contact?.email, l.contact?.tel, l.secteur].join(' ')).includes(q)));
  }
  function renderLeads() {
    const list = filteredLeads();
    $('#lCount').textContent = `${list.length} demande${list.length > 1 ? 's' : ''}`;
    $('#lTable tbody').innerHTML = list.map((l) => `<tr data-lead="${l.id}">
      <td class="ref">${l.id}<br><small class="muted">${l.type === 'rappel' ? 'Rappel' : 'Devis'}</small></td>
      <td class="${isLate(l) ? 'late' : ''}">${fmtDT(l.at)}${isLate(l) ? '<br><small>en attente</small>' : ''}</td>
      <td class="who"><b>${esc(l.contact?.nom)}</b><small>${esc(l.contact?.societe || l.contact?.tel || '')}</small></td>
      <td>${esc(l.contact?.ville || '')}</td><td>${esc(l.secteur || '')}</td>
      <td class="num">${l.items?.length || ''}</td><td>${esc(origin(l))}</td><td>${esc(who(l.assignee))}</td>
      <td class="num">${l.amount ? fmtN(l.amount) : ''}</td><td>${pill(l.status)}</td></tr>`).join('')
      || '<tr><td colspan="10" class="empty">Aucune demande.</td></tr>';
  }
  ['#lSearch', '#lStatus', '#lType', '#lWho'].forEach((s) => $(s).addEventListener(s === '#lSearch' ? 'input' : 'change', renderLeads));
  $('#csvBtn').onclick = () => {
    const cols = [['N°', (l) => l.id], ['Type', (l) => l.type], ['Reçue le', (l) => fmtDT(l.at)], ['Statut', (l) => STATUS[l.status]], ['Nom', (l) => l.contact?.nom], ['Société', (l) => l.contact?.societe],
      ['Téléphone', (l) => l.contact?.tel], ['E-mail', (l) => l.contact?.email], ['Ville', (l) => l.contact?.ville], ['Fonction', (l) => l.contact?.fonction], ['Secteur', (l) => l.secteur], ['Délai', (l) => l.delai],
      ['Articles', (l) => (l.items || []).map((i) => `${i.ref} ${i.name} x${i.q}`).join(' | ')], ['Message', (l) => l.message], ['Origine', origin], ['Code', (l) => l.source?.code], ['Langue', (l) => l.source?.langue],
      ['Suivi par', (l) => who(l.assignee)], ['Montant (MAD)', (l) => l.amount], ['1re réponse', (l) => l.firstContactAt && fmtDT(l.firstContactAt)], ['Consentement', (l) => (l.consent ? 'oui' : 'non')]];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const csv = '﻿' + [cols.map((c) => cell(c[0])).join(';'), ...filteredLeads().map((l) => cols.map((c) => cell(c[1](l))).join(';'))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `demandes-obm-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
  const touch = (t) => t && Object.keys(t).length ? esc(Object.entries(t).filter(([k]) => k !== 'date').map(([k, v]) => `${k.replace('utm_', '')} : ${v}`).join(' · ')) : '';
  function openLead(id) {
    const l = leads.find((x) => x.id === id); if (!l) return;
    current = l;
    const c = l.contact || {}, s = l.source || {};
    const wa = c.tel ? 'https://wa.me/' + c.tel.replace(/\D/g, '').replace(/^0/, '212') : '';
    $('#ldTitle').textContent = `${l.type === 'rappel' ? 'Rappel' : 'Devis'} ${l.id}`;
    $('#ldSub').textContent = `Reçue le ${new Date(l.at).toLocaleString('fr-FR')} · ${ago(l.at)}`;
    $('#ldBody').innerHTML = `
      <div class="field"><span>Statut</span><div class="steps" id="ldSteps">${Object.entries(STATUS).map(([k, v]) => `<button type="button" data-s="${k}" class="${l.status === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div class="grid3">
        <label>Suivi par<select name="assignee"><option value="">—</option>${team.map((u) => `<option value="${esc(u.email)}"${u.email === l.assignee ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label>Montant du devis (MAD HT)<input name="amount" inputmode="numeric" value="${l.amount ?? ''}" placeholder="ex. 45000"></label>
        <label id="ldLost"${l.status === 'perdu' ? '' : ' hidden'}>Motif de perte<select name="lostReason">${['', 'Prix', 'Délai', 'Concurrent', 'Projet abandonné', 'Sans réponse', 'Autre'].map((o) => `<option${o === (l.lostReason || '') ? ' selected' : ''}>${o}</option>`).join('')}</select></label>
      </div>
      <label>Ajouter une note au suivi<input name="comment" maxlength="500" placeholder="ex. Appelé, visite prévue jeudi"></label>
      <div class="blk"><h3>Contact</h3>
        <dl class="kv">${row('Nom', esc(c.nom))}${row('Société', esc(c.societe))}${row('Fonction', esc(c.fonction))}${row('Téléphone', esc(c.tel))}${row('E-mail', esc(c.email))}${row('Ville', esc(c.ville) + (c.ville ? (isNord(l) ? ' · zone Nord' : '') : ''))}</dl>
        <div class="quick">${c.tel ? `<a class="btn btn--line btn--sm" href="tel:${esc(c.tel.replace(/\s/g, ''))}">Appeler</a><a class="btn btn--line btn--sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${c.email ? `<a class="btn btn--line btn--sm" href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Votre demande ' + l.id + ' — OBM Agencement')}">E-mail</a>` : ''}</div>
      </div>
      <div class="blk"><h3>Besoin</h3>
        <dl class="kv">${row('Secteur', esc(l.secteur))}${row('Délai', esc(l.delai))}${row('Créneau', esc(l.creneau))}</dl>
        ${l.message ? `<p class="msg">${esc(l.message)}</p>` : ''}
        ${l.items?.length ? `<h3>Sélection</h3><ul class="items">${l.items.map((i) => `<li><b>${esc(i.ref)}</b> ${esc(i.name)} × ${i.q}${i.note ? ' — ' + esc(i.note) : ''}</li>`).join('')}</ul>` : ''}
        ${l.files?.length ? `<h3>Pièces jointes</h3><div class="files">${l.files.map((f) => f.got === f.parts ? `<a class="btn btn--line btn--sm" href="/api/admin/leads/${l.id}/file/${f.n}" download>${esc(f.name)} · ${Math.max(1, Math.round(f.size / 1024))} Ko</a>` : `<span class="muted small">${esc(f.name)} (envoi incomplet)</span>`).join('')}</div>` : ''}
      </div>
      <div class="blk"><h3>Origine</h3>
        <dl class="kv">${row('Canal', esc(origin(l)))}${row('Déclarée', esc(s.declaree))}${row('Code prospect', esc(s.code))}${row('1er contact', touch(s.first))}${row('Dernier contact', touch(s.last))}${row('Langue', esc((s.langue || '').toUpperCase()))}${row('Page', esc(s.page))}${row('Infos commerciales', l.consent ? 'accepte' : 'n’a pas accepté')}</dl>
      </div>
      <label>Note interne<textarea name="internal" rows="3" maxlength="2000">${esc(l.internal || '')}</textarea></label>
      <div class="blk"><h3>Historique</h3><ul class="hist">${[...(l.history || [])].reverse().map((h) => `<li><time>${fmtDT(h.at)}</time><span><b>${h.by === 'site' ? 'Site' : esc(who(h.by))}</b> · ${esc(h.note || STATUS[h.status])}</span></li>`).join('')}</ul></div>`;
    $('#leadBox').dataset.status = l.status;
    $('#leadBox').hidden = false;
  }
  $('#leadBox').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { $('#leadBox').hidden = true; return; }
    const b = e.target.closest('#ldSteps [data-s]'); if (!b) return;
    $$('#ldSteps button').forEach((x) => x.classList.toggle('on', x === b));
    $('#leadBox').dataset.status = b.dataset.s;
    $('#ldLost').hidden = b.dataset.s !== 'perdu';
  });
  $('#lForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('#ldSave'); btn.disabled = true;
    try {
      const r = await api('PATCH', 'leads/' + current.id, { status: $('#leadBox').dataset.status, assignee: f.assignee.value, amount: f.amount.value, lostReason: f.lostReason.value, internal: f.internal.value, comment: f.comment.value });
      leads[leads.indexOf(current)] = r.lead;
      $('#leadBox').hidden = true; toast(`${r.lead.id} enregistrée`);
      const n = leads.filter((l) => l.status === 'nouveau').length; $('#newCount').hidden = !n; $('#newCount').textContent = n;
      renderDash(); renderLeads();
    } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  });
  $('#ldDel').onclick = async () => {
    if (!(await ask('Supprimer cette demande ?', `${current.id} et ses pièces jointes seront effacées définitivement. À réserver aux envois indésirables : pour une affaire non conclue, choisissez plutôt « Perdue ».`, { yes: 'Supprimer' }))) return;
    try { await api('DELETE', 'leads/' + current.id); leads = leads.filter((l) => l !== current); seenIds.delete(current.id); $('#leadBox').hidden = true; renderDash(); renderLeads(); toast('Demande supprimée'); }
    catch (err) { toast(err.message, true); }
  };

  const famName = (id) => families.find((f) => f.id === id)?.name || id;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const stockState = (p) => (p.stock || 0) === 0 ? ['Rupture', 'out'] : (p.alert && p.stock <= p.alert ? ['Stock bas', 'low'] : ['En stock', 'ok']);
  async function loadProducts() {
    const r = await api('GET', 'products');
    products = r.products; version = r.version;
    renderProducts(); renderStock(); renderDash();
  }
  function renderProducts() {
    const q = norm($('#pSearch').value), f = $('#pFam').value;
    const list = products.filter((p) => (!f || p.f === f) && (!q || norm([p.ref, p.name, p.tag, p.sub].join(' ')).includes(q)));
    $('#pCount').textContent = `${list.length} article${list.length > 1 ? 's' : ''}`;
    $('#pTable tbody').innerHTML = list.map((p) => {
      const [ol, oc] = ORIGIN[p.origin] || ORIGIN['a-confirmer'];
      const [sl, sc] = stockState(p);
      return `<tr>
        <td><img class="thumb" src="${thumb(p.x)}" alt="" loading="lazy"></td>
        <td class="ref">${esc(p.ref)}</td>
        <td class="name"><b>${esc(p.name)}</b><small>${esc(p.tag || '')}${p.tag ? ' · ' : ''}${p.status === 'complete' ? 'fiche détaillée' : 'données partielles'}</small></td>
        <td>${esc(famName(p.f))}<br><small class="muted">${esc(p.sub)}</small></td>
        <td><span class="pill pill--${oc}">${ol}</span></td>
        <td class="num">${p.stock || 0} <span class="pill pill--${sc}">${sl}</span></td>
        <td>${p.visible === false ? '<span class="pill pill--hidden">Masqué</span>' : '<span class="pill pill--ok">Visible</span>'}</td>
        <td><div class="acts"><button class="btn btn--line btn--sm" data-edit="${p.ref}">Modifier</button><button class="btn btn--line btn--sm" data-del="${p.ref}">Supprimer</button></div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">Aucun article.</td></tr>';
    const alerts = products.filter((p) => p.alert && (p.stock || 0) <= p.alert).length;
    $('#alertCount').hidden = !alerts; $('#alertCount').textContent = alerts;
  }
  $('#pSearch').addEventListener('input', renderProducts);
  $('#pFam').addEventListener('change', renderProducts);
  $('#pTable').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); if (ed) return openEditor(products.find((p) => p.ref === ed.dataset.edit));
    const del = e.target.closest('[data-del]'); if (!del) return;
    const p = products.find((x) => x.ref === del.dataset.del);
    const ok = await ask('Supprimer cet article ?', `${p.ref} — ${p.name} sera retiré du catalogue et ses photos envoyées seront effacées. Pour le retirer temporairement, décochez plutôt « Visible sur le site ».`, { yes: 'Supprimer' });
    if (!ok) return;
    try { const r = await api('DELETE', 'products/' + p.ref, { version }); version = r.version; products = products.filter((x) => x !== p); renderProducts(); renderStock(); toast('Article supprimé'); }
    catch (err) { toast(err.message, true); if (err.status === 409) loadProducts(); }
  });

  const form = $('#pForm');
  function specRow(k = '', v = '') {
    const d = document.createElement('div'); d.className = 'spec';
    d.innerHTML = `<input placeholder="Caractéristique (ex. Dimensions L × P × H)" value="${esc(k)}" maxlength="80"><input placeholder="Valeur (ex. 1 200 × 425 × 1 980 mm)" value="${esc(v)}" maxlength="300"><button type="button" aria-label="Retirer la ligne">×</button>`;
    d.querySelector('button').onclick = () => d.remove();
    return d;
  }
  $('#addSpec').onclick = () => $('#eSpecs').appendChild(specRow());
  function renderPhotos() {
    $('#ePhotos').innerHTML = photos.map((x, i) => `<div class="photo${x.uploading ? ' uploading' : ''}"><img src="${x.preview || thumb(x)}" alt="">
      <div class="ph-act">${i ? `<button type="button" data-main="${i}">Principale</button>` : '<span class="muted small">Principale</span>'}<button type="button" data-rm="${i}">Retirer</button></div></div>`).join('');
  }
  $('#ePhotos').addEventListener('click', (e) => {
    const m = e.target.closest('[data-main]'); if (m) { const [x] = photos.splice(+m.dataset.main, 1); photos.unshift(x); renderPhotos(); }
    const r = e.target.closest('[data-rm]'); if (r) { photos.splice(+r.dataset.rm, 1); renderPhotos(); }
  });
  async function resize(file, max) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    return blob;
  }
  $('#eFiles').addEventListener('change', async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    for (const file of files) {
      const slot = { uploading: true, preview: URL.createObjectURL(file) };
      photos.push(slot); renderPhotos();
      try {
        const [lg, sm] = await Promise.all([resize(file, 1400), resize(file, 720)]);
        const fd = new FormData(); fd.append('lg', lg, 'photo'); fd.append('sm', sm, 'photo-sm');
        const r = await api('POST', 'upload', fd);
        photos[photos.indexOf(slot)] = r.image; renderPhotos();
      } catch (err) { photos.splice(photos.indexOf(slot), 1); renderPhotos(); toast('Photo refusée : ' + err.message, true); }
    }
  });
  function fillSubs() {
    const f = families.find((x) => x.id === form.f.value);
    const extra = products.filter((p) => p.f === form.f.value).map((p) => p.sub);
    $('#subList').innerHTML = [...new Set([...(f?.subs || []), ...extra])].map((s) => `<option value="${esc(s)}">`).join('');
  }
  form.f.addEventListener('change', fillSubs);
  function openEditor(p) {
    editing = p || null;
    form.reset();
    $('#eTitle').textContent = p ? `Modifier ${p.ref}` : 'Nouvel article';
    form.f.disabled = !!p;
    const v = p || { f: families[0]?.id, origin: 'a-confirmer', sectors: [], stock: 0, alert: 0, visible: true };
    form.name.value = v.name || ''; form.tag.value = v.tag || ''; form.f.value = v.f; form.sub.value = v.sub || '';
    form.origin.value = v.origin || 'a-confirmer'; form.desc.value = v.desc || '';
    form.stock.value = v.stock || 0; form.alert.value = v.alert || 0; form.visible.checked = v.visible !== false; form.note.value = v.note || '';
    $$('#eSectors input').forEach((c) => { c.checked = (v.sectors || []).includes(c.value); });
    $('#eSpecs').innerHTML = ''; (v.specs || []).forEach(([k, val]) => $('#eSpecs').appendChild(specRow(k, val)));
    if (!(v.specs || []).length) $('#eSpecs').appendChild(specRow());
    photos = p ? [...(p.gallery || [p.x])] : []; renderPhotos();
    $('#eI18n').innerHTML = Object.entries(LANGS).map(([l, label]) => {
      const t = (v.i18n || {})[l] || {};
      return `<div class="lang" data-l="${l}"${l === 'ar' ? ' dir="rtl"' : ''}><h4>${label}</h4>
        <div class="grid2"><label>Nom<input data-k="name" value="${esc(t.name)}" maxlength="140"></label><label>Sous-famille<input data-k="sub" value="${esc(t.sub)}" maxlength="80"></label></div>
        <label>Description<textarea data-k="desc" rows="2" maxlength="600">${esc(t.desc)}</textarea></label></div>`;
    }).join('');
    fillSubs();
    $('#eErr').hidden = true;
    $('#editor').hidden = false; form.name.focus();
  }
  $('#newBtn').onclick = () => openEditor(null);
  $('#editor').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) $('#editor').hidden = true; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photos.some((x) => x.uploading)) return toast('Patientez : envoi des photos en cours.', true);
    const specs = $$('#eSpecs .spec').map((d) => [...d.querySelectorAll('input')].map((i) => i.value.trim())).filter(([k, v]) => k && v);
    const i18n = {};
    $$('#eI18n .lang').forEach((d) => {
      const o = {}; d.querySelectorAll('[data-k]').forEach((i) => { if (i.value.trim()) o[i.dataset.k] = i.value.trim(); });
      if (editing?.i18n?.[d.dataset.l]?.specs) o.specs = editing.i18n[d.dataset.l].specs;
      if (Object.keys(o).length) i18n[d.dataset.l] = o;
    });
    const product = {
      name: form.name.value, tag: form.tag.value, f: form.f.value, sub: form.sub.value, origin: form.origin.value, desc: form.desc.value,
      sectors: $$('#eSectors input:checked').map((c) => c.value), specs, images: photos,
      stock: form.stock.value, alert: form.alert.value, visible: form.visible.checked, note: form.note.value, i18n,
    };
    const btn = $('#eSave'); btn.disabled = true;
    try {
      const r = editing ? await api('PUT', 'products/' + editing.ref, { version, product }) : await api('POST', 'products', { version, product });
      version = r.version;
      if (editing) products[products.indexOf(editing)] = r.product; else products.push(r.product);
      $('#editor').hidden = true; renderProducts(); renderStock();
      toast(editing ? `${r.product.ref} enregistré` : `${r.product.ref} créé — visible sur le site d’ici une minute`);
    } catch (err) {
      $('#eErr').hidden = false; $('#eErr').textContent = err.message;
      if (err.status === 409) loadProducts();
    } finally { btn.disabled = false; }
  });

  function renderStock() {
    const q = norm($('#sSearch').value), only = $('#sAlerts').checked;
    const list = products.filter((p) => (!q || norm([p.ref, p.name, p.tag].join(' ')).includes(q)) && (!only || (p.alert && (p.stock || 0) <= p.alert)));
    $('#sTable tbody').innerHTML = list.map((p) => {
      const [sl, sc] = stockState(p);
      return `<tr data-ref="${p.ref}">
        <td><img class="thumb" src="${thumb(p.x)}" alt="" loading="lazy"></td>
        <td class="ref">${esc(p.ref)}</td>
        <td class="name"><b>${esc(p.name)}</b></td>
        <td class="num"><b class="qty">${p.stock || 0}</b></td>
        <td><div class="stockctl"><button type="button" data-d="-1" aria-label="Retirer">−</button><input class="mv" type="number" value="1" min="1" aria-label="Quantité du mouvement"><button type="button" data-d="1" aria-label="Ajouter">+</button><button type="button" data-set title="Fixer la quantité exacte">=</button></div></td>
        <td class="num"><input class="alert" type="number" min="0" value="${p.alert || 0}" aria-label="Seuil d’alerte"></td>
        <td><span class="pill pill--${sc}">${sl}</span></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">Aucun article.</td></tr>';
  }
  $('#sSearch').addEventListener('input', renderStock);
  $('#sAlerts').addEventListener('change', renderStock);
  async function stockCall(ref, body) {
    try {
      const r = await api('PATCH', 'stock/' + ref, { ...body, reason: $('#sReason').value.trim() || undefined });
      const p = products.find((x) => x.ref === ref); p.stock = r.stock; p.alert = r.alert; version = r.version;
      renderStock(); renderProducts(); toast(`${ref} : ${r.stock} en stock`);
    } catch (err) { toast(err.message, true); }
  }
  $('#sTable').addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-ref]'); if (!row) return;
    const n = Math.max(1, parseInt(row.querySelector('.mv').value, 10) || 1);
    const d = e.target.closest('[data-d]'); if (d) return stockCall(row.dataset.ref, { delta: n * +d.dataset.d });
    if (e.target.closest('[data-set]')) {
      const ok = await ask('Fixer la quantité', `Quantité exacte en stock pour ${row.dataset.ref} :`, { yes: 'Enregistrer', body: `<input id="dQty" type="number" min="0" value="${row.querySelector('.qty').textContent}">` });
      if (ok) stockCall(row.dataset.ref, { value: $('#dQty').value });
    }
  });
  $('#sTable').addEventListener('change', (e) => {
    if (!e.target.matches('input.alert')) return;
    const row = e.target.closest('tr[data-ref]');
    stockCall(row.dataset.ref, { delta: 0, alert: e.target.value });
  });

  async function loadUsers() {
    if (me.role !== 'admin') return;
    const r = await api('GET', 'users');
    $('#uTable tbody').innerHTML = r.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Administrateur' : 'Éditeur'}</td>
      <td class="muted">${u.lastLogin ? new Date(u.lastLogin).toLocaleString('fr-FR') : 'jamais'}</td>
      <td>${u.email === me.email ? '<span class="muted small">vous</span>' : `<button class="btn btn--line btn--sm" data-udel="${esc(u.email)}">Supprimer</button>`}</td></tr>`).join('');
  }
  $('#uTable').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-udel]'); if (!b) return;
    if (!(await ask('Supprimer ce compte ?', `${b.dataset.udel} ne pourra plus se connecter.`, { yes: 'Supprimer' }))) return;
    try { await api('DELETE', 'users/' + encodeURIComponent(b.dataset.udel)); loadUsers(); toast('Compte supprimé'); } catch (err) { toast(err.message, true); }
  });
  $('#uForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', 'users', { name: f.name.value, email: f.email.value, role: f.role.value, password: f.password.value });
      f.reset(); loadUsers(); toast('Compte créé');
    } catch (err) { toast(err.message, true); }
  });
  $('#pwdBtn').onclick = async () => {
    const ok = await ask('Changer mon mot de passe', '10 caractères minimum.', { yes: 'Enregistrer',
      body: '<div style="display:grid;gap:8px"><input id="pwCur" type="password" placeholder="Mot de passe actuel" autocomplete="current-password"><input id="pwNew" type="password" placeholder="Nouveau mot de passe" autocomplete="new-password"></div>' });
    if (!ok) return;
    try { await api('POST', 'password', { current: $('#pwCur').value, next: $('#pwNew').value }); toast('Mot de passe modifié'); } catch (err) { toast(err.message, true); }
  };

  const ACTIONS = { create: 'Création', update: 'Modification', delete: 'Suppression', stock: 'Stock', setup: 'Mise en service', password: 'Mot de passe', 'user-create': 'Compte créé', 'user-delete': 'Compte supprimé', lead: 'Demande', 'lead-delete': 'Demande supprimée' };
  async function loadAudit() {
    const r = await api('GET', 'audit');
    $('#log').innerHTML = r.log.map((l) => `<li><time>${new Date(l.at).toLocaleString('fr-FR')}</time><span>${esc(l.user)}</span><span><b>${ACTIONS[l.action] || esc(l.action)}</b> · ${esc(l.detail)}</span></li>`).join('') || '<li class="muted">Aucune modification pour l’instant.</li>';
  }

  boot();
})();
