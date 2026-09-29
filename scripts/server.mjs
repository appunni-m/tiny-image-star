import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, normalize, resolve, sep } from 'node:path';

const root = resolve('.');
const port = Number(process.env.PORT || 8000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm' };

createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  const relative = pathname === '/' ? 'index.html' : normalize(pathname.replace(/^\/+/, ''));
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep) && path !== resolve(root, 'index.html')) { response.writeHead(403).end('Forbidden'); return; }
  if (!existsSync(path) || !statSync(path).isFile()) { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(path).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Local Studio ready at http://127.0.0.1:${port}`));
