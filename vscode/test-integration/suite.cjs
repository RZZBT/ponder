// Executed inside the VS Code extension host by run.mjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  await vscode.extensions.getExtension('ponder.ponder').activate();
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const doc = await vscode.workspace.openTextDocument(path.join(folder, 'main.js'));
  await vscode.window.showTextDocument(doc);
  const text = doc.getText();

  const at = (marker, delta = 0) => {
    const i = text.indexOf(marker);
    assert.ok(i >= 0, `marker not found: ${marker}`);
    return doc.positionAt(i + delta);
  };
  const resolve = (marker, delta) => vscode.commands.executeCommand('ponder._resolve', doc.uri, at(marker, delta));

  // the TypeScript server needs a moment after opening the file
  let first;
  for (let i = 0; i < 60; i++) {
    first = await resolve('clamp(-4', 2);
    if (first.found) break;
    await sleep(1000);
  }

  const results = [];
  const expect = async (marker, delta, id) => {
    const r = await resolve(marker, delta);
    results.push(`${r.found ? 'found ' + r.animation.id : 'none  (' + r.reason + ')'}  <- ${marker}`);
    if (id) assert.equal(r.found && r.animation.id, id, `${marker}: ${r.reason ?? ''}`);
    else assert.equal(r.found, false, `${marker} should have no animation`);
  };

  try {
    await expect('clamp(-4', 2, 'clamp-int');
    await expect('isBetween(5', 2, 'is-between');
    await expect('gcd(48', 1, 'gcd');
    await expect('binarySearch([', 3, 'binary-search');
    await expect('isPalindrome(', 3, 'palindrome');
    await expect('insertionSort([', 3, 'insertion-sort');
    await expect('factorial(4', 3, 'factorial');
    await expect('new IntStack(', 6, 'stack-new');
    await expect('stack.push(3', 7, 'stack-push');
    await expect('stack.pop(', 7, 'stack-pop');
    await expect('{ clamp, isBetween', 3, 'clamp-int');
    await expect('IntStack } = require', 3, 'stack-new');
    await expect('localClamp(-4', 3, null);
    await expect('Math.abs(', 6, null);
  } finally {
    console.log('\n' + results.join('\n') + '\n');
  }

  // the command opens a webview panel
  await vscode.window.showTextDocument(doc);
  vscode.window.activeTextEditor.selection = new vscode.Selection(at('gcd(48', 1), at('gcd(48', 1));
  await vscode.commands.executeCommand('ponder.open');
  await sleep(1500);
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => t.label);
  assert.ok(tabs.some((l) => l.startsWith('Ponder: ')), `no Ponder tab in ${JSON.stringify(tabs)}`);
  console.log('panel opened: ' + tabs.filter((l) => l.startsWith('Ponder')).join(', '));
}

module.exports = { run };
