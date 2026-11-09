// Real-browser smoke test of the built engine (needs a Chromium-based browser; Edge or Chrome are auto-detected,
// or set BROWSER=path). It drives the preview page over the DevTools protocol in REAL time, so it exercises
// requestAnimationFrame, the SVG renderer and the demo animation end to end, and measures the frame rate.
//
//   npm run build && npm run preview     (in one terminal)
//   node scripts/browser-smoke.mjs       (in another)  [--shots <dir>] to also save screenshots
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5173/engine/preview/index.html';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) { console.error('No Chromium-based browser found; set BROWSER=<path>.'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'ponder-smoke-'));
const proc = spawn(browser, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--window-size=1000,760', '--hide-scrollbars',
  // keep requestAnimationFrame running even if Windows reports the (headless) window as hidden, e.g. on a locked screen
  '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  URL_BASE,
], { stdio: 'ignore' });

// kill the whole browser process tree (a plain kill() leaves Chromium child processes on Windows)
function killBrowser() {
  if (!proc.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGKILL');
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}
const watchdog = setTimeout(() => { console.error('smoke test timed out'); killBrowser(); process.exit(1); }, 90_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

async function main() {
  let target, port;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      port ??= readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith(URL_BASE));
    } catch { /* browser still starting */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('could not attach to the browser page');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map();
  const pageErrors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evalJs = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const snap = async () => JSON.parse(await evalJs('JSON.stringify(Ponder.current().player.getSnapshot())'));
  const shot = async (name) => {
    if (!shotsDir) return;
    mkdirSync(shotsDir, { recursive: true });
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const numberX = () => evalJs("document.querySelector('circle').parentElement.getAttribute('transform')");

  // subscribe to errors, then reload so that errors during page start-up are captured too
  await cdp('Runtime.enable'); await cdp('Page.enable');
  // Without this, Edge/Chrome may mark the headless page "hidden" after a few seconds (e.g. when the screen is
  // locked or off) and stop requestAnimationFrame, which freezes every animation.
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Page.reload');
  await sleep(300);
  // wait for the page to mount the player
  for (let i = 0; i < 50; i++) { if (await evalJs('!!(window.Ponder && Ponder.current())').catch(() => false)) break; await sleep(100); }
  await sleep(100);

  const t0 = await snap();
  check('player mounted on slide 0, auto-playing', t0.index === 0 && t0.status === 'playing', JSON.stringify({ index: t0.index, status: t0.status }));
  await shot('1-intro');

  // auto transition: 1200 ms dwell + 700 ms tween (started ~now)
  let mid = await snap();
  for (let i = 0; i < 100 && !mid.transitioning; i++) { await sleep(30); mid = await snap(); } // poll: wall-clock sleeps are machine-dependent
  await sleep(250);
  mid = await snap();
  check('auto transition is mid-flight in real time (requestAnimationFrame is driving it)', mid.transitioning && mid.position > 0 && mid.position < 1, `position=${mid.position.toFixed(3)}`);
  await shot('2-mid-transition');
  await sleep(1100);
  const settled = await snap();
  check('auto transition settled on slide 1 and waits for the user', settled.index === 1 && settled.status === 'waiting' && settled.awaitingUser, JSON.stringify({ index: settled.index, status: settled.status }));
  await shot('3-too-small');

  // user-triggered fluid transition via the real Next button
  await evalJs("document.querySelector('[aria-label^=\"Next\"]').click()");
  await sleep(500);
  const m2 = await snap();
  check('Next button starts a fluid transition', m2.transitioning && m2.position > 1 && m2.position < 2, `position=${m2.position.toFixed(3)}`);
  await sleep(800);
  await shot('4-clamped-low');
  const s2 = await snap();
  check('reached slide 2 (clamped to minimum)', s2.index === 2 && s2.caption.includes('= 0'), s2.caption);

  // direct transition: instant
  await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
  const s3 = await snap();
  check('direct transition switches instantly (keyboard Right)', s3.index === 3 && !s3.transitioning, JSON.stringify({ index: s3.index }));
  await shot('5-too-large');

  // auto again, then finish with a staggered next transition
  await sleep(1400 + 1000 + 300);
  check('second auto transition ran by itself', (await snap()).index === 4);
  await shot('6-clamped-high');
  await evalJs("document.querySelector('[aria-label^=\"Next\"]').click()");
  await sleep(1200);
  const end = await snap();
  check('finished on the last slide', end.index === 5 && end.status === 'finished' && end.progress === 1, JSON.stringify({ index: end.index, status: end.status }));
  await shot('7-inside');

  // frame rate while idle-free animation runs: replay and count rAF ticks for 1 s
  const fps = await evalJs(`new Promise((resolve) => { let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else resolve(n); }; requestAnimationFrame(f); })`);
  check('browser delivers animation frames (headless rAF rate)', fps >= 30, `${fps} fps`);

  // previous + replay
  await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))");
  let prev = await snap();
  for (let i = 0; i < 100 && !(prev.index === 4 && prev.status === 'paused'); i++) { await sleep(50); prev = await snap(); }
  check('previous step works and pauses', prev.index === 4 && prev.status === 'paused', JSON.stringify({ index: prev.index, status: prev.status }));
  await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))");
  check('replay returns to slide 0', (await snap()).index === 0);

  // light theme
  await evalJs("document.getElementById('theme').value = 'light'; document.getElementById('theme').onchange()");
  await sleep(300);
  await shot('8-light-theme');
  check('no uncaught page errors or console.error output', pageErrors.length === 0, JSON.stringify(pageErrors));
  ws.close();
}

try { await main(); } catch (e) { console.error('smoke test crashed:', e); failures++; }
clearTimeout(watchdog);
killBrowser();
console.log(failures === 0 ? '\nBrowser smoke test: ALL PASSED' : `\nBrowser smoke test: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
