import * as vscode from 'vscode';
import { resolveAt, symbolsAt, type Outcome } from './locate';
import { showAnimation } from './panel';
import { ExternalSources } from './external';
import { clearLocalCache } from './local';
import { showProblem } from './help';
import { problems } from './problems';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Ponder');
  const external = new ExternalSources(context, log);

  // Like the JetBrains plugin, Alt+W first tries the name under the mouse pointer. VS Code reports the pointer
  // only through hover requests, so remember the last one.
  let hover: { uri: string; pos: vscode.Position; at: number } | null = null;

  context.subscriptions.push(
    log,
    vscode.languages.registerHoverProvider({ scheme: 'file' }, {
      provideHover(document, position) {
        hover = { uri: document.uri.toString(), pos: position, at: Date.now() };
        return undefined;
      },
    }),
    vscode.commands.registerCommand('ponder.open', async () => {
      try {
        await openPonder(context, log, external, hover);
      } catch (e) {
        // a tool meant to help must never greet anyone with a stack trace
        log.appendLine(`unexpected: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        void showProblem(problems.unexpected(), log);
      }
    }),

    vscode.commands.registerCommand('ponder.copySymbol', async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { void showProblem(problems.noName(), log); return; }
        const symbols = await symbolsAt(editor.document.uri, editor.selection.active);
        if (symbols.length === 0) { void showProblem(problems.noName(), log); return; }
        const pick = symbols.length === 1 ? symbols[0] : await vscode.window.showQuickPick(
          [...symbols].sort((a, b) => Number(a.startsWith('sym:')) - Number(b.startsWith('sym:'))),
          { placeHolder: 'Symbol to copy into ponder.json' },
        );
        if (!pick) return;
        await vscode.env.clipboard.writeText(pick);
        void vscode.window.setStatusBarMessage(`Copied: ${pick}`, 4000);
      } catch (e) {
        log.appendLine(`copy symbol: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        void showProblem(problems.unexpected(), log);
      }
    }),

    vscode.commands.registerCommand('ponder.clearCache', () => {
      external.index.clear();
      clearLocalCache();
      void vscode.window.setStatusBarMessage('Ponder: cached animations cleared', 4000);
    }),

    // buttons of problems (help.ts)
    vscode.commands.registerCommand('ponder.enableOnlineLookup', async () => {
      await external.enableOnline();
      void vscode.window.showInformationMessage('Ponder: online lookups are on. Press Alt+W on the function again.');
    }),
    vscode.commands.registerCommand('ponder.retryOnline', async () => {
      external.forgetLastFailure();
      await vscode.commands.executeCommand('ponder.open');
    }),
    vscode.commands.registerCommand('ponder.showExtension', () => vscode.commands.executeCommand('extension.open', context.extension.id)),
    vscode.commands.registerCommand('ponder.showLog', () => log.show(true)),

    // used by the integration tests
    vscode.commands.registerCommand('ponder._resolve', (uri: vscode.Uri, pos: vscode.Position): Promise<Outcome> => resolveAt(uri, pos)),
  );
}

async function openPonder(
  context: vscode.ExtensionContext,
  log: vscode.OutputChannel,
  external: ExternalSources,
  hover: { uri: string; pos: vscode.Position; at: number } | null,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void showProblem(problems.noName(), log);
    return;
  }
  const uri = editor.document.uri;
  const positions = [editor.selection.active];
  if (hover && hover.uri === uri.toString() && Date.now() - hover.at < 4000 && !hover.pos.isEqual(positions[0]!)) positions.unshift(hover.pos);
  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Ponder: looking up the definition' },
    async () => {
      let last: Outcome | null = null;
      for (const pos of positions) {
        log.appendLine(`Alt+W at ${uri.fsPath}:${pos.line + 1}:${pos.character + 1} (${editor.document.languageId})`);
        last = await resolveAt(uri, pos, (s) => log.appendLine(s));
        if (last.found) break;
      }
      return last!;
    });

  if (outcome.found) {
    showAnimation(context, outcome.animation.title, outcome.documentText, outcome.animation.id, log, 'From the library');
    return;
  }
  log.appendLine(`not in the library: ${outcome.reason}`);
  if (outcome.located) {
    const ext = await external.find(outcome.located, outcome.problem);
    if ('hit' in ext) {
      log.appendLine(`found: ${ext.hit.source}`);
      showAnimation(context, ext.hit.animation.title, ext.hit.documentText, ext.hit.animation.id, log, ext.hit.source);
      return;
    }
    void showProblem(ext.problem, log);
    return;
  }
  void showProblem(outcome.problem ?? problems.unsupportedDeclaration(outcome.reason), log);
}

export function deactivate(): void {}
