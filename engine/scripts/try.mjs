// One command to see an animation: builds the engine, starts the preview server and opens the browser.
//   cd engine && npm install && npm run try                       -> the bundled demo
//   npm run try -- ../path/to/META-INF/ponder/ponder.json         -> your file, live: save it and the page updates
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const engine = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.PORT ?? '5173';
const url = `http://localhost:${port}/engine/preview/index.html`;

const arg = process.argv[2];
if (arg) {
  // npm runs scripts from engine/, so resolve relative paths against where the user typed the command
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  if (!existsSync(file)) { console.error(`File not found: ${file}`); process.exit(1); }
  process.env.PONDER_FILE = file;
}

const build = spawnSync(process.execPath, ['build.mjs'], { cwd: engine, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const open =
  process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
  : process.platform === 'darwin' ? ['open', [url]]
  : ['xdg-open', [url]];
setTimeout(() => { try { spawn(open[0], open[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {} }, 500);

await import('./preview-server.mjs');
