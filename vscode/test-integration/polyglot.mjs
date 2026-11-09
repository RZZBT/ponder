// Opens every language in examples/polyglot (plus the JavaScript demo) in VS Code with its language extension
// and prints which calls open which animation.
//
//   node test-integration/polyglot.mjs [--extensions-dir <dir>] [language ...]
//
// Language extensions are taken from --extensions-dir (default: your normal VS Code extensions).
import { runTests } from '@vscode/test-electron';
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.platform === 'win32' && repo.includes(' ')) {
  const link = join(tmpdir(), 'ponder-repo-link');
  if (!existsSync(link)) symlinkSync(repo, link, 'junction');
  repo = link;
}

const lib = (marker, delta, expect) => ({ marker, delta, expect });
const CASES = {
  javascript: { dir: 'examples/js-consumer', file: 'main.js', waitMs: 60_000, markers: [
    lib('clamp(-4', 2, 'clamp-int'), lib('stack.push(3', 7, 'stack-push'), lib('localClamp(-4', 3, null)] },
  typescript: { dir: 'examples/polyglot/typescript', file: 'app/main.ts', waitMs: 60_000, markers: [
    lib('clamp(-4', 2, 'clamp'), lib('s.push(3', 3, 'push'), lib('localClamp(1', 3, null)] },
  python: { dir: 'examples/polyglot/python', file: 'main.py', waitMs: 90_000, markers: [
    lib('clamp(-4', 2, 'clamp'), lib('s.push(3', 3, 'push'), lib('local_clamp(1', 3, null)] },
  rust: { dir: 'examples/polyglot/rust', file: 'app/src/main.rs', waitMs: 180_000, markers: [
    lib('clamp(-4', 2, 'clamp'), lib('s.push(3', 3, 'push'), lib('local_clamp(1', 3, null)] },
  cpp: { dir: 'examples/polyglot/cpp', file: 'app/main.cpp', waitMs: 120_000, markers: [
    lib('clamp(-4', 2, 'clamp'), lib('s.push(3', 3, 'push'), lib('local_clamp(1', 3, null)] },
  php: { dir: 'examples/polyglot/php', file: 'app/index.php', waitMs: 90_000, markers: [
    lib('clamp(-4', 2, 'clamp'), lib('push(3', 2, 'push'), lib('local_clamp(1', 3, null)] },
  lua: { dir: 'examples/polyglot/lua', file: 'main.lua', waitMs: 90_000, markers: [
    lib('clamp(-4', 2, 'clamp'), lib('push(3', 2, 'push'), lib('local_clamp(1', 3, null)] },
  java: { dir: 'examples/polyglot/java', file: 'src/demo/Main.java', waitMs: 240_000, markers: [
    lib('clamp(-4', 2, 'clamp-int'), lib('s.push(3', 3, 'stack-push'), lib('new IntStack(', 6, 'stack-new'), lib('localClamp(1', 3, null)] },
};

const args = process.argv.slice(2);
const extIdx = args.indexOf('--extensions-dir');
const extDir = extIdx >= 0 ? args.splice(extIdx, 2)[1] : null;
const languages = args.length ? args : Object.keys(CASES);
const local = [process.env.VSCODE_EXECUTABLE, join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe')].find((p) => p && existsSync(p));

const summary = [];
for (const language of languages) {
  const c = CASES[language];
  const results = join(mkdtempSync(join(tmpdir(), 'ponder-poly-')), 'results.json');
  process.env.PONDER_CASE = JSON.stringify({ language, ...c });
  process.env.PONDER_RESULTS = results;
  try {
    await runTests({
      vscodeExecutablePath: local,
      extensionDevelopmentPath: join(repo, 'vscode'),
      extensionTestsPath: join(repo, 'vscode/test-integration/polyglot-suite.cjs'),
      launchArgs: [join(repo, c.dir), '--skip-welcome', '--disable-workspace-trust',
        `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ponder-vscode-'))}`, ...(extDir ? [`--extensions-dir=${extDir}`] : [])],
    });
  } catch (e) {
    summary.push({ language, error: String(e) });
    continue;
  }
  summary.push(existsSync(results) ? JSON.parse(readFileSync(results, 'utf8')) : { language, error: 'no results' });
}

console.log('\n==== Ponder in VS Code, by language ====');
for (const s of summary) {
  if (s.error && !s.results?.length) { console.log(`\n${s.language}: ERROR ${s.error.split('\n')[0]}`); continue; }
  const passed = s.results.filter((r) => r.ok).length;
  console.log(`\n${s.language} (${s.languageId}; language server ready after ${Math.round(s.readyAfterMs / 1000)} s; ${passed}/${s.results.length} as expected)`);
  for (const r of s.results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.marker.padEnd(16)} expected ${String(r.expect).padEnd(10)} got ${r.got ?? `nothing (${r.reason})`}`);
    if (!r.ok && r.candidates) console.log(`        candidates: ${r.candidates.join('  ')}`);
  }
}
