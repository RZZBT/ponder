// Zero-dependency static server for the browser preview. Serves the repository root so the page can load
// both the built engine (engine/dist) and the demo ponder.json (examples/...).
//   npm run build && npm run preview   ->   http://localhost:5173/engine/preview/index.html
// If PONDER_FILE is set (npm run try -- path/to/ponder.json), that file is also served at /__ponder-file
// and the preview page shows it, re-running whenever the file changes.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.env.PORT ?? 5173);
const authorFile = process.env.PONDER_FILE ? resolve(process.env.PONDER_FILE) : null;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__ponder-file') {
      if (!authorFile) { res.writeHead(404).end('no file'); return; }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ponder-file': encodeURIComponent(authorFile) });
      res.end(await readFile(authorFile));
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/engine/preview/index.html';
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('forbidden'); return; } // no path traversal
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Ponder preview: http://localhost:${port}/engine/preview/index.html`);
  if (authorFile) console.log(`Watching ${authorFile} (save it and the preview updates)`);
});
