// StayScout local server (zero dependencies). On Vercel, api/*.js is used instead.
// Named dev-server.js on purpose: Vercel auto-detects a root server.js and routes everything to it.
// Serves the frontend from /public plus the JSON API:
//   GET /api/info                         which data source is active
//   GET /api/place?q=Japan                country → popular cities (or a single city)
//   GET /api/trip?cities=Tokyo,Kyoto&...  nightly price series for each city
//   GET /api/city?cities=Tokyo&...        hotels + areas for one city (served from cache)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as routes from './lib/routes.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function serveStatic(pathname, res) {
  const path = normalize(pathname === '/' ? '/index.html' : pathname);
  try {
    if (path.includes('..')) throw new Error('bad path');
    const body = await readFile(join(PUBLIC_DIR, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const handler = pathname.startsWith('/api/') && routes[pathname.slice(5)];
    return handler ? handler(req, res) : serveStatic(pathname, res);
  })
  .listen(PORT, () => {
    console.log(`StayScout running at http://localhost:${PORT}`);
  });
