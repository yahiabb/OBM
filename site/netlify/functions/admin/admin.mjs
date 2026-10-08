import crypto from 'node:crypto';
import {
  loadCatalog, saveCatalog, families, audit, loadUsers, saveUsers, hashPassword, checkPassword, publicUser, safeEqual,
  loginAllowed, noteLogin, sessionCookie, clearCookie, currentUser, mediaStore, dataStore, json, fail, slugify, clip,
  leadStore, loadLeads, leadKey, LEAD_STATUS, LEAD_ID, listKeys,
} from '../../lib/store.mjs';

const PREFIX = { stockage: 'STO', vestiaires: 'VES', armoires: 'ARM', bureaux: 'BUR', sieges: 'SIE', scolaire: 'SCO', collectivites: 'COL' };
const ORIGINS = ['tanger', 'distribue', 'a-confirmer'];
const SECTORS = ['industrie', 'logistique', 'ecoles', 'bureaux', 'commerces'];
const LANGS = ['es', 'en', 'ar'];
const IMG_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const MAX_IMG = 4 * 1024 * 1024;
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function cleanSpecs(specs) {
  return (Array.isArray(specs) ? specs : [])
    .filter((s) => Array.isArray(s) && clip(s[0], 80) && clip(s[1], 300))
    .slice(0, 20).map(([k, v]) => [clip(k, 80), clip(v, 300)]);
}
function cleanImage(x) {
  if (typeof x === 'number' || /^\d+[a-z]?$/.test(String(x))) return x;
  return /^b:[a-f0-9-]{36}$/.test(String(x)) ? String(x) : null;
}
function cleanProduct(input, existing = {}) {
  const errors = [];
  const p = { ...existing };
  p.name = clip(input.name, 140); if (!p.name) errors.push('Le nom est obligatoire.');
  p.f = input.f; if (!PREFIX[p.f]) errors.push('Famille inconnue.');
  p.sub = clip(input.sub, 80); if (!p.sub) errors.push('La sous-famille est obligatoire.');
  p.tag = clip(input.tag, 40) || undefined;
  p.desc = clip(input.desc, 600) || undefined;
  p.specs = cleanSpecs(input.specs); if (!p.specs.length) delete p.specs;
  p.origin = ORIGINS.includes(input.origin) ? input.origin : 'a-confirmer';
  p.sectors = (Array.isArray(input.sectors) ? input.sectors : []).filter((s) => SECTORS.includes(s));
  p.stock = Math.max(0, Math.min(1e6, parseInt(input.stock, 10) || 0));
  p.alert = Math.max(0, Math.min(1e6, parseInt(input.alert, 10) || 0));
  p.visible = input.visible !== false;
  p.note = clip(input.note, 500) || undefined;
  const imgs = (Array.isArray(input.images) ? input.images : []).map(cleanImage).filter((x) => x != null).slice(0, 8);
  if (!imgs.length) errors.push('Ajoutez au moins une photo.');
  p.x = imgs[0]; if (imgs.length > 1) p.gallery = imgs; else delete p.gallery;
  p.status = (p.specs?.length || 0) >= 3 ? 'complete' : 'partielle';
  p.i18n = {};
  for (const l of LANGS) {
    const t = (input.i18n || {})[l] || {};
    const e = { name: clip(t.name, 140), sub: clip(t.sub, 80), desc: clip(t.desc, 600), specs: cleanSpecs(t.specs) };
    Object.keys(e).forEach((k) => (!e[k] || (Array.isArray(e[k]) && !e[k].length)) && delete e[k]);
    if (Object.keys(e).length) p.i18n[l] = e;
  }
  Object.keys(p).forEach((k) => p[k] === undefined && delete p[k]);
  return { p, errors };
}
function nextRef(products, f) {
  const pre = PREFIX[f];
  const max = products.filter((p) => p.ref.startsWith(pre + '-')).reduce((m, p) => Math.max(m, parseInt(p.ref.slice(4), 10) || 0), 0);
  return `${pre}-${String(max + 1).padStart(2, '0')}`;
}
function uniqueSlug(products, name, ref) {
  let base = slugify(name) || ref.toLowerCase(), s = base, i = 2;
  while (products.some((p) => p.slug === s && p.ref !== ref)) s = `${base}-${i++}`;
  return s;
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean);
  const [res, id] = parts;
  const method = req.method;
  if (method !== 'GET' && req.headers.get('x-obm-admin') !== '1') return fail(403, 'Requête refusée.');
  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(method) && res !== 'upload') {
    try { body = await req.json(); } catch { body = {}; }
  }

  try {
    if (res === 'setup') {
      const users = await loadUsers();
      if (method === 'GET') return json({ needed: users.length === 0, enabled: !!process.env.ADMIN_SETUP_CODE });
      if (users.length) return fail(409, 'L’espace admin est déjà configuré.');
      if (!process.env.ADMIN_SETUP_CODE) return fail(403, 'Définissez d’abord ADMIN_SETUP_CODE dans Netlify.');
      if (!safeEqual(body.code || '', process.env.ADMIN_SETUP_CODE)) return fail(403, 'Code de mise en service incorrect.');
      const email = clip(body.email, 120).toLowerCase(), name = clip(body.name, 80), password = String(body.password || '');
      if (!emailOk(email) || !name) return fail(400, 'Nom et e-mail valides requis.');
      if (password.length < 10) return fail(400, 'Mot de passe : 10 caractères minimum.');
      const user = { email, name, role: 'admin', ...hashPassword(password), createdAt: new Date().toISOString() };
      await saveUsers([user]);
      await audit(user, 'setup', 'Création du premier compte administrateur');
      return json({ user: publicUser(user) }, 201, { 'set-cookie': await sessionCookie(user) });
    }

    if (res === 'login' && method === 'POST') {
      const email = clip(body.email, 120).toLowerCase();
      if (!(await loginAllowed(email))) return fail(429, 'Trop d’essais. Réessayez dans 15 minutes.');
      const users = await loadUsers();
      const user = users.find((u) => u.email === email);
      const ok = !!user && checkPassword(String(body.password || ''), user);
      await noteLogin(email, ok);
      if (!ok) return fail(401, 'E-mail ou mot de passe incorrect.');
      user.lastLogin = new Date().toISOString();
      await saveUsers(users);
      return json({ user: publicUser(user) }, 200, { 'set-cookie': await sessionCookie(user) });
    }
    if (res === 'logout') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });

    const me = await currentUser(req);
    if (!me) return fail(401, 'Session expirée : reconnectez-vous.');
    if (res === 'me') return json({ user: me, families, team: (await loadUsers()).map((u) => ({ email: u.email, name: u.name })) });

    if (res === 'leads') {
      if (!id && method === 'GET') return json({ leads: await loadLeads(), statuses: LEAD_STATUS });
      if (!LEAD_ID.test(id || '')) return fail(404, 'Demande introuvable.');
      const store = leadStore();
      const lead = await store.get(leadKey(id), { type: 'json' });
      if (!lead) return fail(404, 'Demande introuvable.');
      if (method === 'GET' && parts[2] === 'file') {
        const f = (lead.files || []).find((x) => x.n === parseInt(parts[3], 10));
        if (!f || f.got !== f.parts) return fail(404, 'Fichier introuvable ou incomplet.');
        const chunks = await Promise.all(Array.from({ length: f.parts }, (_, i) => store.get(`file/${id}/${f.n}/${i}`, { type: 'arrayBuffer' })));
        const name = f.name.replace(/[^\w.\- ]/g, '_');
        return new Response(new Blob(chunks.map((c) => new Uint8Array(c))), { headers: {
          'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"`,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        } });
      }
      if (method === 'GET') return json({ lead });
      if (method === 'PATCH') {
        const now = new Date().toISOString();
        const changes = [];
        if (body.status != null && body.status !== lead.status) {
          if (!LEAD_STATUS.includes(body.status)) return fail(400, 'Statut inconnu.');
          changes.push(`statut : ${lead.status} → ${body.status}`);
          if (lead.status === 'nouveau' && !lead.firstContactAt) lead.firstContactAt = now;
          if (body.status === 'devis' && !lead.quoteAt) lead.quoteAt = now;
          if (['gagne', 'perdu'].includes(body.status)) lead.closedAt = now; else delete lead.closedAt;
          lead.status = body.status;
        }
        if (body.assignee !== undefined && body.assignee !== (lead.assignee || '')) {
          const users = await loadUsers();
          if (body.assignee && !users.some((u) => u.email === body.assignee)) return fail(400, 'Commercial inconnu.');
          lead.assignee = body.assignee || undefined;
          changes.push(`suivi par : ${body.assignee || 'personne'}`);
        }
        if (body.amount !== undefined) {
          const a = body.amount === '' || body.amount == null ? undefined : Math.max(0, Math.round(Number(String(body.amount).replace(/\s/g, '').replace(',', '.'))));
          if (a !== undefined && !Number.isFinite(a)) return fail(400, 'Montant invalide.');
          if (a !== lead.amount) { lead.amount = a; changes.push(`montant : ${a ?? '—'} MAD`); }
        }
        if (body.lostReason !== undefined) lead.lostReason = clip(body.lostReason, 120) || undefined;
        if (body.internal !== undefined) lead.internal = clip(body.internal, 2000) || undefined;
        const comment = clip(body.comment, 500);
        if (changes.length || comment) lead.history = [...(lead.history || []), { at: now, by: me.email, status: lead.status, note: [changes.join(' · '), comment].filter(Boolean).join(' — ') }];
        lead.updatedAt = now; lead.updatedBy = me.email;
        Object.keys(lead).forEach((k) => lead[k] === undefined && delete lead[k]);
        await store.setJSON(leadKey(id), lead);
        if (changes.length) await audit(me, 'lead', `${id} : ${changes.join(' · ')}`);
        return json({ lead });
      }
      if (method === 'DELETE') {
        if (me.role !== 'admin') return fail(403, 'Réservé aux administrateurs.');
        await Promise.all((await listKeys(store, `file/${id}/`)).map((k) => store.delete(k)));
        await store.delete(leadKey(id));
        await audit(me, 'lead-delete', `${id} — ${lead.contact?.nom || ''} ${lead.contact?.societe ? '(' + lead.contact.societe + ')' : ''}`);
        return json({ ok: true });
      }
    }

    if (res === 'products') {
      const cat = await loadCatalog();
      if (method === 'GET') return json({ version: cat.version, updatedAt: cat.updatedAt, products: cat.products });
      if (body.version && body.version !== cat.version) return fail(409, 'Le catalogue a été modifié entre-temps : rechargez la page.');
      if (method === 'POST') {
        const { p, errors } = cleanProduct(body.product || {});
        if (errors.length) return json({ error: errors.join(' ') }, 400);
        p.ref = nextRef(cat.products, p.f);
        p.slug = uniqueSlug(cat.products, p.name, p.ref);
        p.createdAt = new Date().toISOString(); p.createdBy = me.email;
        cat.products.push(p);
        await saveCatalog(cat);
        await audit(me, 'create', `${p.ref} — ${p.name}`);
        return json({ product: p, version: cat.version }, 201);
      }
      const idx = cat.products.findIndex((p) => p.ref === id);
      if (idx < 0) return fail(404, 'Article introuvable.');
      if (method === 'PUT') {
        const old = cat.products[idx];
        const { p, errors } = cleanProduct(body.product || {}, old);
        if (errors.length) return json({ error: errors.join(' ') }, 400);
        if (p.f !== old.f) return fail(400, 'Pour changer de famille, créez un nouvel article.');
        p.ref = old.ref;
        p.slug = old.slug;
        p.updatedAt = new Date().toISOString(); p.updatedBy = me.email;
        cat.products[idx] = p;
        await saveCatalog(cat);
        await audit(me, 'update', `${p.ref} — ${p.name}`);
        return json({ product: p, version: cat.version });
      }
      if (method === 'DELETE') {
        const [gone] = cat.products.splice(idx, 1);
        await saveCatalog(cat);
        const keys = [gone.x, ...(gone.gallery || [])].filter((x) => String(x).startsWith('b:')).map((x) => x.slice(2));
        await Promise.all(keys.flatMap((k) => [mediaStore().delete(k), mediaStore().delete(k + '-sm')]));
        await audit(me, 'delete', `${gone.ref} — ${gone.name}`);
        return json({ ok: true, version: cat.version });
      }
    }

    if (res === 'stock' && method === 'PATCH') {
      const cat = await loadCatalog();
      const p = cat.products.find((x) => x.ref === id);
      if (!p) return fail(404, 'Article introuvable.');
      const before = p.stock || 0;
      if (body.value != null) p.stock = Math.max(0, parseInt(body.value, 10) || 0);
      else p.stock = Math.max(0, before + (parseInt(body.delta, 10) || 0));
      if (body.alert != null) p.alert = Math.max(0, parseInt(body.alert, 10) || 0);
      await saveCatalog(cat);
      await audit(me, 'stock', `${p.ref} : ${before} → ${p.stock}${body.reason ? ' (' + clip(body.reason, 120) + ')' : ''}`);
      return json({ ref: p.ref, stock: p.stock, alert: p.alert || 0, version: cat.version });
    }

    if (res === 'upload' && method === 'POST') {
      const form = await req.formData();
      const lg = form.get('lg'), sm = form.get('sm');
      if (!lg || !sm) return fail(400, 'Photo manquante.');
      for (const f of [lg, sm]) {
        if (!IMG_TYPES.includes(f.type)) return fail(400, 'Format accepté : WebP, JPEG ou PNG.');
        if (f.size > MAX_IMG) return fail(400, 'Photo trop lourde (4 Mo maximum).');
      }
      const key = crypto.randomUUID();
      await mediaStore().set(key, await lg.arrayBuffer(), { metadata: { type: lg.type, by: me.email } });
      await mediaStore().set(key + '-sm', await sm.arrayBuffer(), { metadata: { type: sm.type, by: me.email } });
      return json({ image: 'b:' + key }, 201);
    }

    if (res === 'password' && method === 'POST') {
      const users = await loadUsers();
      const u = users.find((x) => x.email === me.email);
      if (!checkPassword(String(body.current || ''), u)) return fail(403, 'Mot de passe actuel incorrect.');
      if (String(body.next || '').length < 10) return fail(400, 'Nouveau mot de passe : 10 caractères minimum.');
      Object.assign(u, hashPassword(String(body.next)));
      await saveUsers(users);
      await audit(me, 'password', 'Changement de mot de passe');
      return json({ ok: true });
    }
    if (res === 'users') {
      if (me.role !== 'admin') return fail(403, 'Réservé aux administrateurs.');
      const users = await loadUsers();
      if (method === 'GET') return json({ users: users.map(publicUser) });
      if (method === 'POST') {
        const email = clip(body.email, 120).toLowerCase(), name = clip(body.name, 80), password = String(body.password || '');
        const role = body.role === 'admin' ? 'admin' : 'editor';
        if (!emailOk(email) || !name) return fail(400, 'Nom et e-mail valides requis.');
        if (users.some((u) => u.email === email)) return fail(409, 'Ce compte existe déjà.');
        if (password.length < 10) return fail(400, 'Mot de passe : 10 caractères minimum.');
        const user = { email, name, role, ...hashPassword(password), createdAt: new Date().toISOString() };
        users.push(user); await saveUsers(users);
        await audit(me, 'user-create', `${email} (${role})`);
        return json({ user: publicUser(user) }, 201);
      }
      if (method === 'DELETE') {
        const email = decodeURIComponent(id || '').toLowerCase();
        if (email === me.email) return fail(400, 'Vous ne pouvez pas supprimer votre propre compte.');
        const left = users.filter((u) => u.email !== email);
        if (left.length === users.length) return fail(404, 'Compte introuvable.');
        if (!left.some((u) => u.role === 'admin')) return fail(400, 'Il doit rester au moins un administrateur.');
        await saveUsers(left);
        await audit(me, 'user-delete', email);
        return json({ ok: true });
      }
    }

    if (res === 'audit' && method === 'GET') return json({ log: (await dataStore().get('audit', { type: 'json' })) || [] });

    return fail(404, 'Action inconnue.');
  } catch (err) {
    console.error('admin', err);
    return fail(500, 'Erreur serveur.');
  }
};

export const config = { path: ['/api/admin', '/api/admin/*'] };
