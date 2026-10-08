import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import seed from './seed.json' with { type: 'json' };

const opts = (name) => process.env.BLOBS_LOCAL_URL
  ? { name, siteID: 'local', token: 'local', apiURL: process.env.BLOBS_LOCAL_URL, consistency: 'strong' }
  : { name, consistency: 'strong' };
export const dataStore = () => getStore(opts('obm-data'));
export const mediaStore = () => getStore(opts('obm-media'));
export const leadStore = () => getStore(opts('obm-leads'));

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export const fail = (status, message) => json({ error: message }, status);

export async function loadCatalog() {
  const store = dataStore();
  let cat = await store.get('catalog', { type: 'json' });
  if (!cat) {
    cat = { version: 1, updatedAt: new Date().toISOString(), products: seed.products };
    await store.setJSON('catalog', cat);
  }
  return cat;
}
export async function saveCatalog(cat) {
  cat.version = (cat.version || 0) + 1;
  cat.updatedAt = new Date().toISOString();
  await dataStore().setJSON('catalog', cat);
  return cat;
}
export const families = seed.families;

export async function audit(user, action, detail) {
  const store = dataStore();
  const log = (await store.get('audit', { type: 'json' })) || [];
  log.unshift({ at: new Date().toISOString(), user: user?.email || '?', action, detail });
  await store.setJSON('audit', log.slice(0, 500));
}

export const loadUsers = async () => (await dataStore().get('users', { type: 'json' })) || [];
export const saveUsers = (users) => dataStore().setJSON('users', users);
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
export function checkPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}
export const publicUser = (u) => ({ email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin || null });
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function loginAllowed(email) {
  const a = ((await dataStore().get('attempts', { type: 'json' })) || {})[email];
  return !(a && a.until && Date.now() < a.until);
}
export async function noteLogin(email, ok) {
  const store = dataStore();
  const all = (await store.get('attempts', { type: 'json' })) || {};
  if (ok) delete all[email];
  else {
    const a = all[email] || { n: 0 };
    a.n += 1;
    if (a.n >= 5) { a.until = Date.now() + 15 * 60e3; a.n = 0; }
    all[email] = a;
  }
  await store.setJSON('attempts', all);
}

const COOKIE = 'obm_admin';
const SESSION_HOURS = 8;
export async function secret() {
  const store = dataStore();
  let s = await store.get('session-secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); await store.set('session-secret', s); }
  return s;
}
const b64 = (s) => Buffer.from(s).toString('base64url');
export async function sessionCookie(user) {
  const payload = b64(JSON.stringify({ email: user.email, role: user.role, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  const sig = crypto.createHmac('sha256', await secret()).update(payload).digest('base64url');
  return `${COOKIE}=${payload}.${sig}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export async function currentUser(req) {
  const raw = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', await secret()).update(payload).digest('base64url');
  if (!safeEqual(sig, expect)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data.exp || Date.now() > data.exp) return null;
  const user = (await loadUsers()).find((u) => u.email === data.email);
  return user ? { email: user.email, name: user.name, role: user.role } : null;
}

export const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const clip = (s, n) => (s == null ? '' : String(s).trim().slice(0, n));

export const LEAD_STATUS = ['nouveau', 'contacte', 'devis', 'gagne', 'perdu'];
export const leadKey = (id) => 'lead/' + id;
export const LEAD_ID = /^OBM-\d{6}-[A-Z0-9]{4}$/;
export async function leadToken(id) {
  return crypto.createHmac('sha256', await secret()).update('lead:' + id).digest('base64url');
}
export async function loadLeads() {
  const store = leadStore();
  const keys = await listKeys(store, 'lead/');
  const all = await Promise.all(keys.map((k) => store.get(k, { type: 'json' })));
  return all.filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1));
}
export async function listKeys(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const keys = blobs.map((b) => b.key);
  if (keys.length) return keys.filter((k) => k.startsWith(prefix));
  return (await store.list()).blobs.map((b) => b.key).filter((k) => k.startsWith(prefix));
}
