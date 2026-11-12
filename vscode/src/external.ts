// Animations from outside the library: local folders, then the community index (cache first, network only after
// the user agreed). Same order and rules as the JetBrains plugin (PonderService.kt / PonderActivation.kt).
// Every way of finding nothing ends in a Problem that says what to try.
import * as vscode from 'vscode';
import { basename, join } from 'node:path';
import { STD_LANGUAGES, type PackageKey, type StdLanguage } from '../../engine/src/sources/index-protocol';
import type { Located } from './locate';
import { findInFolders } from './local';
import { OnlineIndex, findInLookup, newerPonderNeeded, type Hit, type Lookup } from './online';
import { isOwnCode, packageKeyFor } from './packageKey';
import { problems, type Problem } from './problems';

export const DEFAULT_INDEX_URL = 'https://rzzbt.github.io/ponder-index/';

type Mode = 'ask' | 'on' | 'off';

export class ExternalSources {
  private askedThisSession = false;
  readonly index: OnlineIndex;
  /** The last lookup that failed for network reasons, for "Retry now". */
  lastFailure: PackageKey | null = null;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {
    this.index = new OnlineIndex(join(context.globalStorageUri.fsPath, 'index-cache'));
  }

  private config() { return vscode.workspace.getConfiguration('ponder'); }
  private mode(): Mode { const m = this.config().get<string>('onlineLookup', 'ask'); return m === 'on' || m === 'off' ? m : 'ask'; }
  base(): string { return this.config().get<string>('indexUrl', DEFAULT_INDEX_URL) || DEFAULT_INDEX_URL; }

  async enableOnline(): Promise<void> {
    await this.config().update('onlineLookup', 'on', vscode.ConfigurationTarget.Global);
    this.askedThisSession = false;
  }

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
   * Looks for an animation outside the library. [local] is what the library itself said (for example "its
   * ponder.json is broken"); it is shown when nothing better is found. Never throws.
   */
  async find(located: Located, local: Problem | undefined): Promise<{ hit: Hit } | { problem: Problem }> {
    const name = located.display;
    try {
      let key = packageKeyFor(located, this.workspaceRoots());
      if (!key) {
        if (located.kind === 'package' && isOwnCode(located.root, this.workspaceRoots())) return { problem: local ?? problems.ownCode(name) };
        const library = located.kind === 'package' ? (located.manifestName ?? basename(located.root)) : located.kind === 'jar' ? basename(located.jar) : name;
        return { problem: local ?? problems.unknownLibrary(name, library) };
      }
      if (key.ecosystem === 'std' && key.version === null && key.name.startsWith('python/')) {
        key = { ...key, version: await activePythonVersion() };
      }
      this.log.appendLine(`package: ${key.ecosystem}/${key.name}${key.version ? ' ' + key.version : ''}`);
      const where = whereText(key);

      const fromFolder = findInFolders(this.folders(), key, located.candidates, (f, p) => this.log.appendLine(`local file ${f}: ${p}`));
      if (fromFolder) return { hit: fromFolder };

      const mode = this.mode();
      if (mode === 'off') return { problem: local ?? problems.onlineOff(name, where) };
      const base = this.base();
      const cached = this.index.cached(base, key);
      const cachedHit = findInLookup(cached, key, located.candidates);
      if (cachedHit) {
        // Shown at once from the cache; an old copy is refreshed quietly for next time.
        if (mode === 'on') this.index.refreshInBackground(base, key);
        return { hit: cachedHit };
      }
      if (!this.index.needsFetch(base, key)) return { problem: this.nothingFound(name, where, key, cached, local) };

      if (mode === 'ask' && !(await this.askConsent(key))) return { problem: local ?? problems.onlineSkipped(name) };

      const lookup = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Ponder: looking for an animation online' },
        () => this.index.fetch(base, key),
      );
      if (lookup.kind === 'failed') this.log.appendLine(`online lookup failed: ${lookup.reason}`);
      const hit = findInLookup(lookup, key, located.candidates);
      return hit ? { hit } : { problem: this.nothingFound(name, where, key, lookup, local) };
    } catch (e) {
      this.log.appendLine(`external sources: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return { problem: local ?? problems.unexpected() };
    }
  }

  private nothingFound(name: string, where: string, key: PackageKey, lookup: Lookup | null, local: Problem | undefined): Problem {
    if (lookup?.kind === 'failed') {
      this.lastFailure = key;
      return problems.indexUnreachable(name, lookup.reason);
    }
    const newer = newerPonderNeeded(lookup);
    if (newer) return problems.needsUpdate(newer);
    return local ?? problems.noAnimationYet(name, where);
  }

  /** Forgets the last network failure so the next lookup asks the index again. */
  forgetLastFailure(): void {
    if (this.lastFailure) this.index.forgetFailure(this.base(), this.lastFailure);
    this.lastFailure = null;
  }

  private async askConsent(key: PackageKey): Promise<boolean> {
    if (this.askedThisSession) return false;
    this.askedThisSession = true;
    const choice = await vscode.window.showInformationMessage(
      `No Ponder animation on this computer for this function. Look for one in the free community index? ` +
        `Only the library's name is sent (${sentText(key)}), never your code.`,
      'Allow', 'Not now', 'Never',
    );
    const target = vscode.ConfigurationTarget.Global;
    if (choice === 'Allow') { await this.config().update('onlineLookup', 'on', target); return true; }
    if (choice === 'Never') await this.config().update('onlineLookup', 'off', target);
    return false;
  }
}

/** `"numpy"` or `the Python standard library`, for messages. */
export function whereText(key: Pick<PackageKey, 'ecosystem' | 'name'>): string {
  if (key.ecosystem === 'std') return `the ${stdDisplay(key.name)} standard library`;
  return `"${key.name}"`;
}

/** What the consent question says will be sent: `pypi/numpy`, or `Python standard library, builtins`. */
export function sentText(key: Pick<PackageKey, 'ecosystem' | 'name'>): string {
  if (key.ecosystem === 'std') return `${stdDisplay(key.name)} standard library, ${key.name.split('/').slice(1).join('/')}`;
  return `${key.ecosystem}/${key.name}`;
}

function stdDisplay(keyName: string): string {
  const language = keyName.split('/')[0] ?? '';
  return Object.prototype.hasOwnProperty.call(STD_LANGUAGES, language) ? STD_LANGUAGES[language as StdLanguage].display : language;
}

/**
 * The Python version VS Code uses (Python extension API), for matching version ranges of standard-library
 * animations. Null when unknown; never waits more than 1.5 s.
 */
async function activePythonVersion(): Promise<string | null> {
  try {
    const ext = vscode.extensions.getExtension('ms-python.python');
    if (!ext) return null;
    const work = (async () => {
      const api = (ext.isActive ? ext.exports : await ext.activate()) as {
        environments?: {
          getActiveEnvironmentPath?: () => unknown;
          resolveEnvironment?: (p: unknown) => Promise<{ version?: { major?: number; minor?: number; micro?: number } } | undefined>;
        };
      } | undefined;
      const envs = api?.environments;
      if (!envs?.getActiveEnvironmentPath || !envs.resolveEnvironment) return null;
      const v = (await envs.resolveEnvironment(envs.getActiveEnvironmentPath()))?.version;
      if (typeof v?.major !== 'number' || v.major < 2) return null;
      return [v.major, v.minor ?? 0, v.micro].filter((n): n is number => typeof n === 'number' && n >= 0).join('.');
    })();
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 1500));
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  }
}
