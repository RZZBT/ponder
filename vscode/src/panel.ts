// The webview that plays an animation. One panel, reused for every animation.
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

let panel: vscode.WebviewPanel | null = null;
let pending: { text: string; id: string } | null = null;

export function showAnimation(context: vscode.ExtensionContext, title: string, documentText: string, animationId: string, log: vscode.OutputChannel): void {
  pending = { text: documentText, id: animationId };
  if (panel) {
    panel.title = `Ponder: ${title}`;
    panel.reveal(vscode.ViewColumn.Beside, false);
    send();
    return;
  }
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  panel = vscode.window.createWebviewPanel('ponder', `Ponder: ${title}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, {
    enableScripts: true,
    localResourceRoots: [media],
    retainContextWhenHidden: false,
  });
  panel.webview.html = html(panel.webview, media);
  panel.onDidDispose(() => { panel = null; });
  panel.webview.onDidReceiveMessage((raw: unknown) => {
    const msg = parseMessage(raw);
    if (!msg) return;
    if (msg.type === 'loaded') send(); // the page script is up; the engine's own 'ready' needs no answer
    else if (msg.type === 'close') panel?.dispose();
    else if (msg.type === 'error' || msg.type === 'info') log.appendLine(`renderer ${msg.type}: ${msg.message}`);
  });
}

function send(): void {
  if (!panel || !pending) return;
  const kind = vscode.window.activeColorTheme.kind;
  const dark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
  const config = vscode.workspace.getConfiguration('ponder');
  const reduced = config.get<string>('reducedMotion', 'auto');
  void panel.webview.postMessage({
    type: 'start',
    text: pending.text,
    id: pending.id,
    theme: dark ? 'dark' : 'light',
    autoplay: config.get<boolean>('autoplay', true),
    reducedMotion: reduced === 'on' ? true : reduced === 'off' ? false : null,
  });
}

type Message = { type: 'loaded' } | { type: 'ready' } | { type: 'close' } | { type: 'error' | 'info'; message: string };

/** The page renders untrusted data; accept only these shapes. */
function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const t = (o as { type?: unknown }).type;
  if (t === 'loaded' || t === 'ready' || t === 'close') return { type: t };
  if (t === 'error' || t === 'info') {
    const m = (o as { message?: unknown }).message;
    return typeof m === 'string' ? { type: t, message: m.replace(/[\x00-\x1f]/g, ' ').slice(0, 300) } : null;
  }
  return null;
}

function html(webview: vscode.Webview, media: vscode.Uri): string {
  const nonce = randomBytes(18).toString('base64url');
  const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'ponder-player.js'));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'ponder-player.css'));
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `style-src 'nonce-${nonce}' ${webview.cspSource}`,
    'img-src data:',
  ].join('; ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${css}">
<style nonce="${nonce}">html,body{height:100%;margin:0;background:var(--vscode-editor-background)}#ponder-root{height:100%}</style>
</head><body><div id="ponder-root"></div>
<script nonce="${nonce}" src="${js}"></script>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  window.__ponderPost = function (s) { vscode.postMessage(s); };
  function report(type, message) { vscode.postMessage(JSON.stringify({ type: type, message: String(message).slice(0, 300) })); }
  window.addEventListener('error', function (e) { report('error', e.message + ' at ' + e.filename + ':' + e.lineno); });
  document.addEventListener('securitypolicyviolation', function (e) { report('error', 'CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI); });
  function hex(name) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v.slice(0, 7) : undefined;
  }
  window.addEventListener('message', function (e) {
    const m = e.data;
    if (!m || m.type !== 'start' || typeof m.text !== 'string' || typeof m.id !== 'string') return;
    Ponder.start(m.text, m.id, {
      theme: m.theme === 'light' ? 'light' : 'dark',
      autoplay: m.autoplay !== false,
      reducedMotion: typeof m.reducedMotion === 'boolean' ? m.reducedMotion : undefined,
      hostControls: false,
      colors: {
        background: hex('--vscode-editor-background'),
        foreground: hex('--vscode-editor-foreground'),
        muted: hex('--vscode-descriptionForeground'),
        accent: hex('--vscode-textLink-foreground'),
        border: hex('--vscode-panel-border'),
      },
    });
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var frames = 0, t0 = performance.now();
    (function tick() {
      frames++;
      if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
      else report('info', 'started; reduced motion ' + (reduced ? 'on' : 'off') + ', ' + frames + ' frames/s');
    })();
  });
  vscode.postMessage(JSON.stringify({ type: 'loaded' }));
})();
</script>
</body></html>`;
}
