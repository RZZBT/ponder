// Runs suite.cjs inside a real VS Code against examples/js-consumer (built-in TypeScript support only).
// Uses the installed VS Code when found (set VSCODE_EXECUTABLE to override), otherwise downloads one.
import { runTests } from '@vscode/test-electron';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// VS Code's test launcher splits paths with spaces on Windows; go through a junction without spaces.
let repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.platform === 'win32' && repo.includes(' ')) {
  const link = join(tmpdir(), 'ponder-repo-link');
  if (!existsSync(link)) symlinkSync(repo, link, 'junction');
  repo = link;
}
const here = join(repo, 'vscode/test-integration');
const ext = join(repo, 'vscode');
const workspace = resolve(ext, '../examples/js-consumer');
if (!existsSync(join(workspace, 'node_modules/math-utils'))) {
  execSync('npm install --no-audit --no-fund', { cwd: workspace, stdio: 'inherit' });
}

const local = [
  process.env.VSCODE_EXECUTABLE,
  join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe'),
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '/usr/share/code/code',
].find((p) => p && existsSync(p));

await runTests({
  vscodeExecutablePath: local,
  extensionDevelopmentPath: ext,
  extensionTestsPath: process.env.PONDER_SUITE ?? join(here, 'suite.cjs'),
  launchArgs: [workspace, join(workspace, 'main.js'), ...(process.env.PONDER_ALL_EXTENSIONS ? [] : ['--disable-extensions']), '--skip-welcome', `--user-data-dir=${process.env.PONDER_USER_DATA ?? mkdtempSync(join(tmpdir(), 'ponder-vscode-'))}`],
});
