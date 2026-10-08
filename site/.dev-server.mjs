import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';
const blobs = new BlobsServer({ directory: process.argv[2], port: 8972, token: 'local' });
await blobs.start();
process.env.BLOBS_LOCAL_URL = 'http://localhost:8972';
process.env.ADMIN_SETUP_CODE = 'code-de-test-local';
const fn = async (p) => (await import(path.resolve('netlify/functions', p))).default;
const admin = await fn('admin/admin.mjs'), catalog = await fn('catalog/catalog.mjs'), img = await fn('img/img.mjs'), lead = await fn('lead/lead.mjs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8899');
  let handler = null;
  if (url.pathname.startsWith('/api/admin')) handler = admin;
  else if (url.pathname === '/api/catalog') handler = catalog;
  else if (url.pathname.startsWith('/api/img/')) handler = img;
  else if (url.pathname.startsWith('/api/lead')) handler = lead;
  if (handler) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handler(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half' }), { ip: req.socket.remoteAddress, params: { key: url.pathname.split('/').pop() } });
    const h = Object.fromEntries(r.headers); if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].replace('; Secure', '');
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join('public', decodeURIComponent(url.pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8899, () => console.log('prêt sur http://localhost:8899'));
