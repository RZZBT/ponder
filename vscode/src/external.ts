// Animations from outside the library: local folders, then the community index (cache first, network only after
// the user agreed). Same order and rules as the JetBrains plugin (PonderService.kt / PonderActivation.kt).
import * as vscode from 'vscode';
import { join } from 'node:path';
import type { PackageKey } from '../../engine/src/sources/index-protocol';
import type { Located } from './locate';
import { findInFolders } from './local';
import { OnlineIndex, findInLookup, type Hit, type Lookup } from './online';
import { packageKeyFor } from './packageKey';

export const DEFAULT_INDEX_URL = 'https://rzzbt.github.io/ponder-index/';

type Mode = 'ask' | 'on' | 'off';

export class ExternalSources {
  private askedThisSession = false;
  readonly index: OnlineIndex;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {
    this.index = new OnlineIndex(join(context.globalStorageUri.fsPath, 'index-cache'));
  }

  private config() { return vscode.workspace.getConfiguration('ponder'); }
  private mode(): Mode { const m = this.config().get<string>('onlineLookup', 'ask'); return m === 'on' || m === 'off' ? m : 'ask'; }
  private base(): string { return this.config().get<string>('indexUrl', DEFAULT_INDEX_URL) || DEFAULT_INDEX_URL; }

  private folders(): string[] {
    const out = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => join(f.uri.fsPath, '.ponder'));
    const extra = this.config().get<unknown>('localFolders', []);
    if (Array.isArray(extra)) for (const e of extra) if (typeof e === 'string' && e.trim()) out.push(e.trim());
    return out;
  }

  private workspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  }

  /**
   * Looks for an animation outside the library. Returns the hit, or a short reason when nothing was found.
   * Never throws.
   */
  async find(located: Located, localReason: string): Promise<{ hit: Hit } | { reason: string }> {
    try {
      const key = packageKeyFor(located, this.workspaceRoots());
      if (!key) return { reason: localReason };
      this.log.appendLine(`package: ${key.ecosystem}/${key.name}${key.version ? ' ' + key.version : ''}`);

      const local = findInFolders(this.folders(), key, located.candidates, (f, p) => this.log.appendLine(`local file ${f}: ${p}`));
      if (local) return { hit: local };

      const mode = this.mode();
      if (mode === 'off') return { reason: localReason };
      const base = this.base();
      const cachedHit = findInLookup(this.index.cached(base, key), key, located.candidates);
      if (cachedHit) {
        // Shown at once from the cache; an old copy is refreshed quietly for next time.
        if (mode === 'on') this.index.refreshInBackground(base, key);
        return { hit: cachedHit };
      }
      if (!this.index.needsFetch(base, key)) return { reason: notFoundOnline(located.display, this.index.cached(base, key)) };

      if (mode === 'ask' && !(await this.askConsent(key))) return { reason: localReason };

      const lookup = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Ponder: looking for an animation online' },
        () => this.index.fetch(base, key),
      );
      if (lookup.kind === 'failed') this.log.appendLine(`online lookup failed: ${lookup.reason}`);
      const hit = findInLookup(lookup, key, located.candidates);
      return hit ? { hit } : { reason: notFoundOnline(located.display, lookup) };
    } catch (e) {
      this.log.appendLine(`external sources: ${e instanceof Error ? e.message : String(e)}`);
      return { reason: localReason };
    }
  }

  private async askConsent(key: PackageKey): Promise<boolean> {
    if (this.askedThisSession) return false;
    this.askedThisSession = true;
    const choice = await vscode.window.showInformationMessage(
      `This library has no Ponder animation of its own. Look for one in the community index? ` +
        `Only the package name is sent (${key.ecosystem}/${key.name}), never your code.`,
      'Allow', 'Not now', 'Never',
    );
    const target = vscode.ConfigurationTarget.Global;
    if (choice === 'Allow') { await this.config().update('onlineLookup', 'on', target); return true; }
    if (choice === 'Never') await this.config().update('onlineLookup', 'off', target);
    return false;
  }
}

function notFoundOnline(name: string, lookup: Lookup | null): string {
  if (lookup?.kind === 'failed') return `${name} has no animation in its library, and the community index could not be checked (${lookup.reason})`;
  return `no animation for ${name} yet: neither the library nor the community index has one`;
}
