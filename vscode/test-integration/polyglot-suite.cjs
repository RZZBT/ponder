// Runs inside VS Code (see polyglot.mjs). Resolves every marker of one language and writes the results to
// PONDER_RESULTS; never fails, so one language cannot hide the results of another.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const spec = JSON.parse(process.env.PONDER_CASE);
  const out = { language: spec.language, results: [], extensions: [] };
  try {
    await vscode.extensions.getExtension('ponder.ponder').activate();
    const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const doc = await vscode.workspace.openTextDocument(path.join(folder, spec.file));
    await vscode.window.showTextDocument(doc);
    out.languageId = doc.languageId;
    out.extensions = vscode.extensions.all.filter((e) => e.isActive && !e.id.startsWith('vscode.')).map((e) => e.id);
    const text = doc.getText();
    const pos = (m) => doc.positionAt(text.indexOf(m.marker) + m.delta);

    // wait for the language server: retry the first library call until something resolves
    const started = Date.now();
    const first = spec.markers.find((m) => m.expect);
    let r;
    while (Date.now() - started < spec.waitMs) {
      r = await vscode.commands.executeCommand('ponder._resolve', doc.uri, pos(first));
      if (r.found) break;
      await sleep(2000);
    }
    out.readyAfterMs = Date.now() - started;

    for (const m of spec.markers) {
      if (text.indexOf(m.marker) < 0) { out.results.push({ ...m, ok: false, got: 'marker missing' }); continue; }
      const res = await vscode.commands.executeCommand('ponder._resolve', doc.uri, pos(m));
      const got = res.found ? res.animation.id : null;
      out.results.push({
        marker: m.marker,
        expect: m.expect,
        got,
        ok: got === m.expect,
        reason: res.found ? undefined : res.reason,
        candidates: res.located ? res.located.candidates : undefined,
      });
    }
  } catch (e) {
    out.error = String(e && e.stack || e);
  }
  fs.writeFileSync(process.env.PONDER_RESULTS, JSON.stringify(out, null, 2));
}

module.exports = { run };
