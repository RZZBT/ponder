// Which package a declaration belongs to, as the online index and local folders know it. Port of the JetBrains
// plugin's PackageKey.kt. Built only from evidence on disk (manifest, pip's .dist-info, the jar's pom.properties),
// never guessed from a file name. No vscode import.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { Located } from './locate';
import { MANIFESTS, sameName } from '../../engine/src/packages/layout';
import { Jar, pomCoordinates } from '../../engine/src/node/jar';
import { indexPath, type Ecosystem, type PackageKey } from '../../engine/src/sources/index-protocol';

const MAX_TEXT = 256 * 1024;
const MAX_SCANNED = 3000;

function readSmall(file: string): string | null {
  try { return statSync(file).isFile() && statSync(file).size <= MAX_TEXT ? readFileSync(file, 'utf8') : null; } catch { return null; }
}

const valid = (k: PackageKey): PackageKey | null => (indexPath(k) ? k : null);

export function ecosystemForManifest(manifest: string): Ecosystem | null {
  switch (manifest) {
    case 'package.json': return 'npm';
    case 'Cargo.toml': return 'crates';
    case 'go.mod': return 'go';
    case 'pyproject.toml': case 'setup.cfg': case 'setup.py': return 'pypi';
    case 'composer.json': return 'packagist';
    default: return null;
  }
}

function tomlValue(text: string, key: string, sections: string[]): string | null {
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) section = t;
    else if (sections.includes(section)) {
      const m = new RegExp(`^${key}\\s*=\\s*["']([^"']{1,64})["']`).exec(t);
      if (m) return m[1]!;
    }
  }
  return null;
}

export function manifestVersion(manifest: string, text: string): string | null {
  let v: string | null = null;
  if (manifest === 'package.json' || manifest === 'composer.json') v = /"version"\s*:\s*"([^"]{1,64})"/.exec(text)?.[1] ?? null;
  else if (manifest === 'Cargo.toml' || manifest === 'pyproject.toml') v = tomlValue(text, 'version', ['[package]', '[project]', '[tool.poetry]']);
  else if (manifest === 'setup.cfg') v = /^version\s*=\s*(\S{1,64})/m.exec(text)?.[1] ?? null;
  return v && v.trim() ? v : null;
}

/** Go's module cache stores `github.com/gorilla/mux@v1.8.0`. */
export function goVersionFromDirName(dirName: string): string | null {
  const i = dirName.lastIndexOf('@');
  const v = i >= 0 ? dirName.slice(i + 1) : '';
  return v.startsWith('v') && v.length > 1 ? v : null;
}

export function parseDistMetadata(text: string): { name: string; version: string | null } | null {
  let name: string | null = null;
  let version: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line === '') break;
    if (name === null && line.startsWith('Name:')) name = line.slice(5).trim();
    if (version === null && line.startsWith('Version:')) version = line.slice(8).trim();
  }
  return name ? { name, version: version || null } : null;
}

function pythonDist(packageDir: string): { name: string; version: string | null } | null {
  const parent = dirname(packageDir);
  let entries: string[];
  try { entries = readdirSync(parent); } catch { return null; }
  if (entries.length > MAX_SCANNED) return null;
  const module = basename(packageDir);
  for (const e of entries) {
    if (!e.endsWith('.dist-info')) continue;
    const dir = join(parent, e);
    const top = readSmall(join(dir, 'top_level.txt'));
    const provides = top !== null ? top.split(/\r?\n/).some((l) => l.trim() === module) : sameName(e.replace(/\.dist-info$/, '').split('-')[0]!, module);
    if (!provides) continue;
    const meta = readSmall(join(dir, 'METADATA'));
    if (meta) return parseDistMetadata(meta);
  }
  return null;
}

/** For a source package found by findRoot. */
export function packageKeyForRoot(root: string, manifestName: string | null): PackageKey | null {
  try {
    const manifest = MANIFESTS.find((m) => { try { return statSync(join(root, m)).isFile(); } catch { return false; } });
    if (manifest) {
      const ecosystem = ecosystemForManifest(manifest);
      if (ecosystem && manifestName) {
        const text = readSmall(join(root, manifest));
        const version = ecosystem === 'go' ? goVersionFromDirName(basename(root)) : text ? manifestVersion(manifest, text) : null;
        return valid({ ecosystem, name: manifestName, version });
      }
    }
    if (readSmall(join(root, '__init__.py')) !== null) {
      const d = pythonDist(root);
      return d ? valid({ ecosystem: 'pypi', name: d.name, version: d.version }) : null;
    }
  } catch { /* identification problems only mean "no online lookup" */ }
  return null;
}

/** For a jar: its single pom.properties (a fat jar with several cannot be attributed, so it gets none). */
export function packageKeyForJar(jarPath: string): PackageKey | null {
  let jar: Jar;
  try { jar = Jar.open(jarPath); } catch { return null; }
  try {
    const coords = pomCoordinates(jar);
    if (coords.length !== 1) return null;
    const c = coords[0]!;
    return valid({ ecosystem: 'maven', name: `${c.group}:${c.name}`, version: c.version ?? null });
  } catch { return null; } finally { jar.close(); }
}

const DEPENDENCY_FOLDER = /[\\/](node_modules|site-packages|dist-packages|vendor)[\\/]/;

/**
 * A package inside an open workspace folder is the user's own code, unless it sits in a dependency folder.
 * Own code never gets a package key: a package key is what gets sent to the online index.
 */
export function isOwnCode(root: string, workspaceFolders: string[]): boolean {
  if (DEPENDENCY_FOLDER.test(root + '/')) return false;
  return workspaceFolders.some((w) => {
    const rel = relative(w, root);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}

/** Null for the user's own code (never sent anywhere) or when the package cannot be identified for sure. */
export function packageKeyFor(located: Located, workspaceFolders: string[]): PackageKey | null {
  if (located.kind === 'jar') return packageKeyForJar(located.jar);
  // the standard library is never the user's own code; the key names the language and module, e.g. std python/builtins
  if (located.kind === 'std') return valid({ ecosystem: 'std', name: located.keyName, version: located.version });
  if (isOwnCode(located.root, workspaceFolders)) return null;
  return packageKeyForRoot(located.root, located.manifestName);
}
