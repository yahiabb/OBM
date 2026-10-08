import Anthropic from '@anthropic-ai/sdk';
import { HEAD, STATIC_LINES, FAMILIES } from './knowledge.mjs';
import { loadCatalog } from '../../lib/store.mjs';

const ORIG = { tanger: 'Fabriqué à Tanger (atelier OBM)', distribue: 'Négoce (fournisseur) — ne jamais dire fabriqué à Tanger', 'a-confirmer': 'Origine non confirmée — ne pas affirmer fabriqué à Tanger' };
let cached = { version: null, system: HEAD + STATIC_LINES.join('\n') };
function line(p) {
  const specs = (p.specs || []).map(([k, v]) => `${k} : ${v}`).join('; ');
  return [p.ref, p.name, p.tag ? `modèle ${p.tag}` : '', `${FAMILIES[p.f] || p.f} / ${p.sub}`, 'Origine : ' + (ORIG[p.origin] || ORIG['a-confirmer']),
    'Secteurs : ' + (p.sectors || []).join(', '), p.desc ? 'Description : ' + p.desc : '',
    specs ? 'Caractéristiques : ' + specs : 'Caractéristiques : sur demande (fiche partielle)',
    (p.stock || 0) > 0 ? 'En stock' : '', p.p ? `catalogue p. ${p.p}` : 'ajouté depuis le catalogue papier'].filter(Boolean).join(' | ');
}
async function systemPrompt() {
  try {
    const cat = await loadCatalog();
    if (cat.version !== cached.version) {
      cached = { version: cat.version, system: HEAD + cat.products.filter((p) => p.visible !== false).map(line).join('\n') };
    }
  } catch (err) { console.error('catalogue indisponible, version intégrée utilisée', err?.message); }
  return cached.system;
}

const MAX_TURNS = 30;
const MAX_CHARS = 2000;
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw.slice(-MAX_TURNS)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs.length && msgs[msgs.length - 1].role === 'user' ? msgs : null;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 });
  if (!client) return Response.json({ error: 'not_configured' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  const messages = cleanMessages(body.messages);
  if (!messages) return Response.json({ error: 'bad_request' }, { status: 400 });

  const ctx = [];
  if (typeof body.page === 'string') ctx.push(`Page consultée : ${body.page.slice(0, 200)}`);
  const LANGS = { fr: 'français', es: 'espagnol', en: 'anglais', ar: 'arabe' };
  if (LANGS[body.lang]) ctx.push(`Langue du site choisie par le visiteur : ${LANGS[body.lang]}`);
  if (Array.isArray(body.selection) && body.selection.length) ctx.push(`Sélection du visiteur : ${body.selection.slice(0, 20).join(' ; ').slice(0, 1500)}`);
  if (ctx.length) {
    const last = messages[messages.length - 1];
    last.content = `${last.content}\n\n[Contexte site, non écrit par le visiteur — ${ctx.join(' — ')}]`;
  }

  const enc = new TextEncoder();
  const send = (ctrl, obj) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        const run = client.beta.messages.stream({
          model: 'claude-opus-5-5',
          max_tokens: 2048,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: await systemPrompt(), cache_control: { type: 'ephemeral', ttl: '1h' } }],
          messages,
        });
        run.on('text', (t) => send(ctrl, { t }));
        const final = await run.finalMessage();
        if (final.stop_reason === 'refusal') send(ctrl, { refusal: true });
        send(ctrl, { done: true, stop: final.stop_reason });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) send(ctrl, { error: 'busy' });
        else if (err instanceof Anthropic.APIError) send(ctrl, { error: 'api', status: err.status });
        else send(ctrl, { error: 'network' });
        console.error('chat error', err?.status, err?.message);
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/chat' };
