import * as vscode from 'vscode';
import { resolveAt, symbolsAt, type Outcome } from './locate';
import { showAnimation } from './panel';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Ponder');

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
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
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
        showAnimation(context, outcome.animation.title, outcome.documentText, outcome.animation.id, log);
      } else {
        log.appendLine(`no animation: ${outcome.reason}`);
        void vscode.window.setStatusBarMessage(`Ponder: ${outcome.reason}`, 6000);
        void vscode.window.showInformationMessage(`No Ponder animation: ${outcome.reason}`);
      }
    }),

    vscode.commands.registerCommand('ponder.copySymbol', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const symbols = await symbolsAt(editor.document.uri, editor.selection.active);
      if (symbols.length === 0) {
        void vscode.window.showInformationMessage('Put the cursor on a function or method name.');
        return;
      }
      const pick = symbols.length === 1 ? symbols[0] : await vscode.window.showQuickPick(
        [...symbols].sort((a, b) => Number(a.startsWith('sym:')) - Number(b.startsWith('sym:'))),
        { placeHolder: 'Symbol to copy into ponder.json' },
      );
      if (!pick) return;
      await vscode.env.clipboard.writeText(pick);
      void vscode.window.setStatusBarMessage(`Copied: ${pick}`, 4000);
    }),

    // used by the integration tests
    vscode.commands.registerCommand('ponder._resolve', (uri: vscode.Uri, pos: vscode.Position): Promise<Outcome> => resolveAt(uri, pos)),
  );
}

export function deactivate(): void {}
