import crypto from 'node:crypto';
import { leadStore, dataStore, json, fail, clip, leadKey, leadToken, LEAD_ID, safeEqual, loadCatalog } from '../../lib/store.mjs';

const MAX_TOTAL = 8 * 1024 * 1024 + 64 * 1024;
const MAX_PART = 4 * 1024 * 1024 + 1024;
const MAX_FILES = 6;
const FILE_EXT = /\.(pdf|jpe?g|png|heic|heif|webp|dwg|dxf)$/i;
const UPLOAD_MINUTES = 30;
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const pad = (n) => String(n).padStart(2, '0');
function newId() {
  const d = new Date();
  const rnd = [...crypto.randomBytes(4)].map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  return `OBM-${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${rnd}`;
}

async function rateOk(ip) {
  const store = dataStore();
  const key = crypto.createHash('sha256').update('obm:' + (ip || '?')).digest('hex').slice(0, 24);
  const all = (await store.get('lead-rate', { type: 'json' })) || {};
  const now = Date.now();
  for (const k of Object.keys(all)) { all[k] = all[k].filter((t) => now - t < 3600e3); if (!all[k].length) delete all[k]; }
  const mine = all[key] || [];
  if (mine.length >= 8) return false;
  all[key] = [...mine, now];
  await store.setJSON('lead-rate', all);
  return true;
}

const parseTouch = (s) => Object.fromEntries(clip(s, 600).split(' ; ').map((x) => x.split('=')).filter((x) => x.length >= 2).map(([k, ...v]) => [clip(k, 30), clip(v.join('='), 200)]));

async function create(req, context) {
  let b;
  try { b = await req.json(); } catch { return fail(400, 'Requête invalide.'); }
  if (b.adresse_web) return json({ ok: true, numero: newId() }, 201);
  const type = b.type === 'rappel' ? 'rappel' : 'devis';
  const contact = {
    nom: clip(b.nom, 100), societe: clip(b.societe, 140), tel: clip(b.tel, 40), email: clip(b.email, 120).toLowerCase(),
    ville: clip(b.ville, 80), fonction: clip(b.fonction, 80),
  };
  if (!contact.nom || contact.tel.replace(/\D/g, '').length < 9) return fail(400, 'Nom et téléphone requis.');
  if (type === 'devis' && (!contact.societe || !emailOk(contact.email) || !contact.ville || !clip(b.secteur, 60))) return fail(400, 'Champs obligatoires manquants.');
  if (!(await rateOk(context?.ip))) return fail(429, 'Trop de demandes envoyées. Réessayez dans une heure ou appelez-nous.');

  const store = leadStore();
  let id = LEAD_ID.test(b.numero || '') ? b.numero : newId();
  if (await store.get(leadKey(id))) id = newId();

  const cat = await loadCatalog();
  const known = new Map(cat.products.map((p) => [p.ref, p]));
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60)
    .filter((i) => i && known.has(i.ref))
    .map((i) => ({ ref: i.ref, name: known.get(i.ref).name, q: Math.max(1, Math.min(100000, parseInt(i.q, 10) || 1)), note: clip(i.note, 200) || undefined }));

  const now = new Date().toISOString();
  const lead = {
    id, type, at: now, status: 'nouveau',
    contact,
    secteur: clip(b.secteur, 60), delai: clip(b.delai, 60), message: clip(b.message, 3000), creneau: clip(b.creneau, 60),
    items,
    source: {
      declaree: clip(b.source_declaree, 60), code: clip(b.code_prospect, 30).toUpperCase(),
      first: parseTouch(b.utm_premier_contact), last: parseTouch(b.utm_dernier_contact),
      canal: ['assistant', 'formulaire'].includes(b.canal) ? b.canal : (type === 'rappel' ? 'rappel' : 'formulaire'),
      page: clip(b.page, 300), langue: ['fr', 'es', 'en', 'ar'].includes(b.langue) ? b.langue : 'fr',
    },
    consent: b.consentement_commercial === true || b.consentement_commercial === 'oui',
    files: [],
    history: [{ at: now, by: 'site', status: 'nouveau', note: type === 'rappel' ? 'Demande de rappel reçue' : 'Demande de devis reçue' }],
  };
  Object.keys(lead).forEach((k) => (lead[k] === '' || lead[k] === undefined) && delete lead[k]);
  await store.setJSON(leadKey(id), lead);
  return json({ ok: true, numero: id, token: await leadToken(id) }, 201);
}

async function upload(req, id) {
  const url = new URL(req.url);
  if (!LEAD_ID.test(id)) return fail(404, 'Demande introuvable.');
  if (!safeEqual(req.headers.get('x-lead-token') || '', await leadToken(id))) return fail(403, 'Envoi refusé.');
  const store = leadStore();
  const lead = await store.get(leadKey(id), { type: 'json' });
  if (!lead) return fail(404, 'Demande introuvable.');
  if (Date.now() - new Date(lead.at) > UPLOAD_MINUTES * 60e3) return fail(403, 'Délai d’envoi dépassé.');
  const n = parseInt(url.searchParams.get('n'), 10), part = parseInt(url.searchParams.get('part'), 10), parts = parseInt(url.searchParams.get('parts'), 10);
  if (!(n >= 0 && n < MAX_FILES && part >= 0 && parts >= 1 && part < parts && parts <= 3)) return fail(400, 'Envoi invalide.');
  const name = clip(url.searchParams.get('name'), 120).replace(/[\\/]/g, '_');
  if (!FILE_EXT.test(name)) return fail(400, 'Format de fichier non accepté.');
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_PART) return fail(400, 'Fichier trop lourd.');
  let f = lead.files.find((x) => x.n === n);
  if (!f) {
    if (part !== 0) return fail(400, 'Envoi invalide.');
    f = { n, name, type: clip(url.searchParams.get('type'), 80) || 'application/octet-stream', size: 0, parts, got: 0 };
    lead.files.push(f);
  }
  if (part !== f.got) return fail(400, 'Envoi invalide.');
  const total = lead.files.reduce((a, x) => a + x.size, 0) + buf.byteLength;
  if (total > MAX_TOTAL) return fail(413, 'Pièces jointes trop lourdes (8 Mo au total).');
  await store.set(`file/${id}/${n}/${part}`, buf);
  f.size += buf.byteLength; f.got = part + 1;
  await store.setJSON(leadKey(id), lead);
  return json({ ok: true });
}

export default async (req, context) => {
  try {
    if (req.method !== 'POST') return fail(405, 'Méthode non autorisée.');
    const m = new URL(req.url).pathname.match(/^\/api\/lead\/([^/]+)\/file$/);
    return m ? await upload(req, m[1]) : await create(req, context);
  } catch (err) {
    console.error('lead', err);
    return fail(500, 'Erreur serveur.');
  }
};

export const config = { path: ['/api/lead', '/api/lead/*'] };
