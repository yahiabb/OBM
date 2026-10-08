import { mediaStore } from '../../lib/store.mjs';

export default async (req, context) => {
  const key = context.params?.key || new URL(req.url).pathname.split('/').pop();
  if (!/^[a-f0-9-]{36}(-sm)?$/.test(key)) return new Response('Introuvable', { status: 404 });
  const hit = await mediaStore().getWithMetadata(key, { type: 'arrayBuffer' });
  if (!hit) return new Response('Introuvable', { status: 404 });
  return new Response(hit.data, {
    headers: { 'content-type': hit.metadata?.type || 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' },
  });
};

export const config = { path: '/api/img/:key' };
