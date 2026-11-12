// The help page shown by "How to fix…": plain HTML, no scripts, buttons are command links limited to
// ALLOWED_COMMANDS. No vscode import, so it can be unit-tested.
import type { Problem, ProblemAction } from "./problems";

/** Commands a help page may run. Anything else in a link is refused by VS Code. */
export const ALLOWED_COMMANDS = [
  'workbench.trust.manage',
  'workbench.extensions.installExtension',
  'workbench.extensions.search',
  'workbench.action.files.openFolder',
  'workbench.action.terminal.new',
  'python.setInterpreter',
  'ponder.enableOnlineLookup',
  'ponder.retryOnline',
  'ponder.showExtension',
  'ponder.showLog',
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** `code` in backticks becomes <code>; everything else is escaped text. */
const rich = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export function commandUri(action: ProblemAction): string {
  const args = action.args && action.args.length > 0 ? `?${encodeURIComponent(JSON.stringify(action.args))}` : '';
  return `command:${action.command}${args}`;
}

export function helpHtml(problem: Problem): string {
  const actions = [...problem.actions, { label: 'Show Ponder log', command: 'ponder.showLog' }]
    .filter((a) => ALLOWED_COMMANDS.includes(a.command))
    .map((a) => `<a class="button" href="${esc(commandUri(a))}">${esc(a.label)}</a>`)
    .join(' ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 8px 20px 24px; line-height: 1.5; max-width: 760px; }
  h1 { font-size: 1.35em; margin: 0.6em 0 0.3em; }
  .kind { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  h2 { font-size: 1.05em; margin: 1.4em 0 0.4em; }
  ol { padding-left: 1.4em; } li { margin: 0.45em 0; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 0.3em; border-radius: 3px; }
  .button { display: inline-block; margin: 0.3em 0.4em 0.3em 0; padding: 0.35em 0.9em; border-radius: 3px; text-decoration: none;
            background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .button:hover { background: var(--vscode-button-hoverBackground); }
  .note { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-top: 2em; }
</style></head>
<body>
  <div class="kind">${problem.setup ? 'Something on this computer is stopping Ponder' : 'No animation to show'}</div>
  <h1>${rich(problem.title)}</h1>
  <p>${rich(problem.detail)}</p>
  <h2>Try</h2>
  <ol>${problem.tries.map((t) => `<li>${rich(t)}</li>`).join('')}</ol>
  <p>${actions}</p>
  <p class="note">Nothing in your code was changed. Close this tab at any time.</p>
</body></html>`;
}
