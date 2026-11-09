// Editor position to declaration to package or jar to candidate symbols, using the language extension's
// definition and outline providers. Works for every language that has both.
import * as vscode from 'vscode';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { candidates, findRoot, manifestName, sameName, type Dir } from '../../engine/src/packages/layout';
import { Jar, pomCoordinates } from '../../engine/src/node/jar';
import { cleanName, namesFor, nodePathAt, outlineParams, type OutlineNode } from './outline';
import { loadDocument, type AnimationRef } from './match';

export type Located =
  | { kind: 'package'; root: string; ponderPath: string | null; manifestName: string | null; candidates: string[]; display: string }
  | { kind: 'jar'; jar: string; candidates: string[]; display: string };

export type Outcome =
  | { found: true; animation: AnimationRef; documentText: string; source: string; located: Located }
  | { found: false; reason: string; located?: Located };

class FsDir implements Dir {
  constructor(readonly path: string) {}
  get name() { return basename(this.path); }
  get parent(): Dir | null { const p = dirname(this.path); return p === this.path ? null : new FsDir(p); }
  hasFile(rel: string) { try { return statSync(join(this.path, rel)).isFile(); } catch { return false; } }
  hasFileMatching(suffix: string) { try { return readdirSync(this.path).some((f) => f.endsWith(suffix)); } catch { return false; } }
  readText(rel: string) {
    try {
      const f = join(this.path, rel);
      return statSync(f).size < 256 * 1024 ? readFileSync(f, 'utf8') : null;
    } catch { return null; }
  }
}

type Definition = { at: vscode.Location; whole: vscode.Range };

/** Every definition the language extensions report for [pos], without duplicates. */
export async function definitionsAt(uri: vscode.Uri, pos: vscode.Position): Promise<Definition[]> {
  for (const cmd of ['vscode.executeDefinitionProvider', 'vscode.executeDeclarationProvider']) {
    const res = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(cmd, uri, pos);
    const defs: Definition[] = (res ?? []).map((l) => ('targetUri' in l
      ? { at: new vscode.Location(l.targetUri, l.targetSelectionRange ?? l.targetRange), whole: l.targetRange }
      : { at: l, whole: l.range }));
    const distinct = defs.filter((d, i) => defs.findIndex((o) => o.at.uri.toString() === d.at.uri.toString() && o.at.range.isEqual(d.at.range)) === i);
    if (distinct.length > 0) return distinct;
  }
  return [];
}

/** The innermost of several definitions when they are nested in one file (`new C()`: class and constructor). */
function innermost(defs: Definition[]): Definition | null {
  const sorted = [...defs].sort((a, b) => (a.whole.contains(b.whole) ? 1 : b.whole.contains(a.whole) ? -1 : 0));
  const inner = sorted[0]!;
  const nested = defs.every((d) => d.at.uri.toString() === inner.at.uri.toString() && d.whole.contains(inner.whole));
  return nested ? inner : null;
}

const describeDef = (d: Definition) => `${d.at.uri.scheme === 'file' ? d.at.uri.fsPath : d.at.uri.toString()}:${d.at.range.start.line + 1}`;

async function outlineAt(uri: vscode.Uri, pos: vscode.Position): Promise<OutlineNode[]> {
  const res = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
    'vscode.executeDocumentSymbolProvider', uri);
  if (!res?.length) return [];
  if ('children' in res[0]!) return nodePathAt(res as unknown as OutlineNode[], pos);
  // flat SymbolInformation: container names give the path
  const flat = (res as vscode.SymbolInformation[]).filter((s) => s.location.range.contains(pos));
  const best = flat.sort((a, b) => (a.location.range.contains(b.location.range) ? 1 : -1))[0];
  if (!best) return [];
  const container = best.containerName ? best.containerName.split(/\.|::/).map((n) => fakeNode(n)) : [];
  return [...container, fakeNode(best.name)];
}

const fakeNode = (name: string): OutlineNode => ({ name, range: { contains: () => true }, selectionRange: { contains: () => true }, children: [] });

/** Candidates for a declaration at [def]. */
export async function locate(def: vscode.Location): Promise<Located | string> {
  const uri = def.uri;
  if (uri.scheme === 'jdt') return locateInJar(uri, def.range.start);
  if (uri.scheme !== 'file') return `the declaration is in "${uri.scheme}:" content, which Ponder cannot read`;

  const file = uri.fsPath;
  const nodes = await outlineAt(uri, def.range.start);
  const names = namesFor(nodes);
  if (names.length === 0) return 'the language extension reports no outline for the declaration';
  const root = findRoot(new FsDir(dirname(file)));
  const rootPath = (root.dir as FsDir).path;
  const rel = relative(rootPath, file).split(sep).join('/');
  return {
    kind: 'package',
    root: rootPath,
    ponderPath: root.ponderFile,
    manifestName: manifestName(root),
    candidates: candidates(root, rel, names),
    display: names[names.length - 1]!,
  };
}

/** Java classes from jars, as opened by the Java extension (jdt.ls): jdt://contents/x.jar/pkg/C.class?=proj/path<pkg(C.class */
async function locateInJar(uri: vscode.Uri, pos: vscode.Position): Promise<Located | string> {
  const handle = decodeURIComponent(uri.query);
  const m = /^=?[^/]*\/(.+?)<([\w.]*)\(([\w$]+)\.class/.exec(handle);
  if (!m) return 'cannot tell which jar contains the declaration';
  const jar = m[1]!.replace(/\\(.)/g, '$1');
  const fqn = (m[2] ? `${m[2]}.` : '') + m[3]!.replace(/\$/g, '.');
  const nodes = await outlineAt(uri, pos);
  const leaf = nodes[nodes.length - 1];
  if (!leaf) return 'the Java extension reports no outline for the class';
  const member = cleanName(leaf.name).pop() ?? '';
  const params = outlineParams(leaf.name);
  if (params === null) return 'Ponder animations cover methods and constructors';
  const simpleClass = fqn.slice(fqn.lastIndexOf('.') + 1);
  const name = member === simpleClass ? '<init>' : member;
  return { kind: 'jar', jar, candidates: [`${fqn}#${name}(${params.join(',')})`], display: member };
}

/** The ponder.json for a located declaration, and the animation in it. */
export function findAnimation(located: Located): Outcome {
  let text: string | null = null;
  let source = '';
  let identity: (lib: { group?: string; name: string }) => string | null = () => null;

  if (located.kind === 'package') {
    if (!located.ponderPath) return { found: false, reason: `${located.manifestName ?? basename(located.root)} has no ponder.json`, located };
    source = join(located.root, located.ponderPath);
    text = existsSync(source) ? readFileSync(source, 'utf8') : null;
    identity = (lib) => (located.manifestName && !sameName(located.manifestName, lib.name)
      ? `ponder.json declares library ${lib.name}, but the package is ${located.manifestName}` : null);
  } else {
    let j: Jar;
    try { j = Jar.open(located.jar); } catch { return { found: false, reason: `cannot read ${basename(located.jar)}`, located }; }
    try {
      text = j.readText('META-INF/ponder/ponder.json');
      const coords = pomCoordinates(j);
      identity = (lib) => (coords.length > 0 && !coords.some((c) => c.name === lib.name && (!lib.group || c.group === lib.group))
        ? `ponder.json declares library ${[lib.group, lib.name].filter(Boolean).join(':')}, but the jar is ${coords.map((c) => `${c.group}:${c.name}`).join(' / ')}`
        : null);
    } finally { j.close(); }
    source = `${located.jar}!/META-INF/ponder/ponder.json`;
    if (text === null) return { found: false, reason: `${basename(located.jar)} has no META-INF/ponder/ponder.json`, located };
  }
  if (text === null) return { found: false, reason: 'ponder.json could not be read', located };
  if (text.length > 256 * 1024) return { found: false, reason: 'ponder.json is larger than 256 KB', located };

  const doc = loadDocument(text);
  if (!doc.ok) return { found: false, reason: `ponder.json is invalid: ${doc.errors[0]?.path}: ${doc.errors[0]?.message}`, located };
  const animation = doc.find(located.candidates, located.kind === 'jar');
  if (!animation) return { found: false, reason: `no animation for ${located.candidates[0]}`, located };
  const mismatch = doc.library ? identity(doc.library) : null;
  if (mismatch) return { found: false, reason: mismatch, located };
  return { found: true, animation, documentText: text, source, located };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extensions that declare `onLanguage:<languageId>` (or contribute the language) but have not started yet. VS Code
 * normally starts them when a file opens; when it has not, definitions come back empty.
 */
export async function startLanguageSupport(languageId: string, log?: (s: string) => void): Promise<number> {
  const candidates = vscode.extensions.all.filter((e) => {
    const pkg = e.packageJSON as { activationEvents?: string[]; contributes?: { languages?: { id: string }[] } };
    const events = pkg.activationEvents ?? [];
    return events.includes(`onLanguage:${languageId}`)
      || (pkg.contributes?.languages ?? []).some((l) => l.id === languageId);
  });
  let active = 0;
  for (const e of candidates) {
    if (e.isActive) { active++; continue; }
    try {
      await e.activate();
      active++;
      log?.(`started ${e.id}`);
    } catch (err) {
      log?.(`could not start ${e.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return active;
}

/**
 * The animation for the reference at [pos]. When the language server reports several definitions (TypeScript
 * does for `const { f } = require(...)`: the export entry and the function), each is checked; the result is
 * used only if exactly one animation comes out of all of them.
 */
export async function resolveAt(uri: vscode.Uri, pos: vscode.Position, log?: (s: string) => void): Promise<Outcome> {
  let defs = await definitionsAt(uri, pos);
  if (defs.length === 0) {
    const languageId = (await vscode.workspace.openTextDocument(uri)).languageId;
    const active = await startLanguageSupport(languageId, log);
    if (active === 0) {
      return { found: false, reason: `VS Code has no language extension for "${languageId}" files; install or enable one that supports Go to Definition` };
    }
    // a language server that is starting (or loading the project) answers with nothing for a while
    for (let i = 0; i < 30 && defs.length === 0; i++) {
      await sleep(500);
      defs = await definitionsAt(uri, pos);
    }
  }
  log?.(`definitions: ${defs.length === 0 ? 'none' : defs.map(describeDef).join(', ')}`);
  if (defs.length === 0) {
    const word = (await vscode.workspace.openTextDocument(uri)).getWordRangeAtPosition(pos);
    return { found: false, reason: word ? 'the language extension found no definition for this name' : 'put the cursor on a function or method name' };
  }

  const nested = defs.length > 1 ? innermost(defs) : defs[0]!;
  const toCheck = nested ? [nested] : defs;
  const outcomes: Outcome[] = [];
  for (const d of toCheck) {
    const located = await locate(d.at);
    const outcome = typeof located === 'string' ? { found: false as const, reason: located } : findAnimation(located);
    log?.(`  ${describeDef(d)}: ${outcome.found ? 'animation ' + outcome.animation.id : outcome.reason}${typeof located === 'string' ? '' : ' [' + located.candidates.join(' ') + ']'}`);
    outcomes.push(outcome);
  }
  const found = outcomes.filter((o): o is Extract<Outcome, { found: true }> => o.found);
  const keys = new Set(found.map((o) => `${o.source}#${o.animation.id}`));
  if (keys.size === 1) return found[0]!;
  if (keys.size > 1) return { found: false, reason: 'the name has several definitions with different animations' };
  return outcomes.find((o) => !o.found && o.located) ?? outcomes[0]!;
}

/** Symbol candidates for the declaration under the cursor, or the declaration a reference points to. */
export async function symbolsAt(uri: vscode.Uri, pos: vscode.Position): Promise<string[]> {
  const defs = await definitionsAt(uri, pos);
  const out = new Set<string>();
  for (const d of defs.length > 0 ? defs : [{ at: new vscode.Location(uri, pos), whole: new vscode.Range(pos, pos) }]) {
    const located = await locate(d.at);
    if (typeof located !== 'string') located.candidates.forEach((c) => out.add(c));
  }
  return [...out];
}
