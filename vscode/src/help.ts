// Shows a Problem: a notification with the first thing to try and its buttons, plus "How to fix…", which opens a
// help page beside the code with every step. The page runs no scripts; its buttons are command links limited to
// the commands below.
import * as vscode from 'vscode';
import { longText, notificationText, summary, type Problem, type ProblemAction } from './problems';
import { ALLOWED_COMMANDS, helpHtml } from './helpPage';

const HOW_TO_FIX = 'How to fix…';

let panel: vscode.WebviewPanel | null = null;

export async function showProblem(problem: Problem, log: vscode.OutputChannel): Promise<void> {
  try {
    log.appendLine(longText(problem));
    void vscode.window.setStatusBarMessage(`Ponder: ${problem.title}`, 8000);
    const buttons = [...problem.actions.slice(0, 2).map((a) => a.label), HOW_TO_FIX];
    const show = problem.setup ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const choice = await show(notificationText(problem), ...buttons);
    if (!choice) return;
    if (choice === HOW_TO_FIX) { openHelp(problem); return; }
    const action = problem.actions.find((a) => a.label === choice);
    if (action) await run(action, log);
  } catch (e) {
    log.appendLine(`could not show the problem: ${e instanceof Error ? e.message : String(e)}`);
    void vscode.window.showInformationMessage(`Ponder: ${summary(problem)}`);
  }
}

async function run(action: ProblemAction, log: vscode.OutputChannel): Promise<void> {
  try {
    await vscode.commands.executeCommand(action.command, ...(action.args ?? []));
  } catch (e) {
    // e.g. "Select Python interpreter" when the Python extension is missing
    log.appendLine(`"${action.label}" failed: ${e instanceof Error ? e.message : String(e)}`);
    void vscode.window.showInformationMessage(`Ponder: "${action.label}" is not available here. The "Ponder" log has details.`);
  }
}

export function openHelp(problem: Problem): void {
  const title = `Ponder: ${problem.title}`;
  if (!panel) {
    panel = vscode.window.createWebviewPanel('ponder.help', title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, {
      enableScripts: false,
      enableCommandUris: ALLOWED_COMMANDS,
      localResourceRoots: [],
    });
    panel.onDidDispose(() => { panel = null; });
  }
  panel.title = title;
  panel.webview.html = helpHtml(problem);
  panel.reveal(vscode.ViewColumn.Beside, false);
}

