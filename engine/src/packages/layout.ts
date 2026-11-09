// Package detection and symbol candidates. Same algorithm as plugin/.../packages/PackageLayout.kt; both run
// schema/conformance/packages.json.

export const PONDER_FILE = 'ponder.json';
export const PONDER_RESOURCE = 'META-INF/ponder/ponder.json';
const MAX_LEVELS = 32;

export const MANIFESTS = [
  'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'setup.cfg', 'composer.json',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'Package.swift', 'pubspec.yaml', 'mix.exs', 'Gemfile',
];

const CONTAINERS = new Set(['node_modules', 'site-packages', 'dist-packages', 'vendor', 'registry', 'packages']);

export interface Dir {
  readonly name: string;
  readonly parent: Dir | null;
  hasFile(relPath: string): boolean;
  hasFileMatching(suffix: string): boolean;
  readText(relPath: string): string | null;
}

export interface Root { dir: Dir; ponderFile: string | null; manifest: string | null }

export function findRoot(start: Dir): Root {
  let dir: Dir | null = start;
  for (let levels = 0; dir && levels < MAX_LEVELS; levels++) {
    const d: Dir = dir;
    const ponder = d.hasFile(PONDER_FILE) ? PONDER_FILE : d.hasFile(PONDER_RESOURCE) ? PONDER_RESOURCE : null;
    const manifest = MANIFESTS.find((m) => d.hasFile(m)) ?? (d.hasFileMatching('.gemspec') || d.hasFileMatching('.csproj') ? '' : null);
    if (ponder !== null || manifest !== null) return { dir: d, ponderFile: ponder, manifest: manifest || null };
    const parent = d.parent;
    const isTopPythonPackage = d.hasFile('__init__.py') && !parent?.hasFile('__init__.py');
    if (isTopPythonPackage || !parent || CONTAINERS.has(parent.name)) return { dir: d, ponderFile: null, manifest: null };
    dir = parent;
  }
  return { dir: start, ponderFile: null, manifest: null };
}

export function manifestName(root: Root): string | null {
  const m = root.manifest;
  if (!m) return null;
  const text = root.dir.readText(m);
  if (text === null) return null;
  switch (m) {
    case 'package.json':
    case 'composer.json':
      return /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;
    case 'Cargo.toml':
    case 'pyproject.toml':
      return tomlName(text);
    case 'go.mod':
      return /^module\s+(\S+)/m.exec(text)?.[1] ?? null;
    case 'setup.cfg':
      return /^name\s*=\s*(\S+)/m.exec(text)?.[1] ?? null;
    default:
      return null;
  }
}

function tomlName(text: string): string | null {
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) section = t;
    else if (section === '[package]' || section === '[project]' || section === '[tool.poetry]') {
      const m = /^name\s*=\s*["']([^"']+)["']/.exec(t);
      if (m) return m[1]!;
    }
  }
  return null;
}

const normalizeName = (s: string) => s.toLowerCase().replace(/[-_.]+/g, '-');
export const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);

export function candidates(root: Root, relPath: string, names: string[]): string[] {
  if (names.length === 0) return [];
  const out = [`sym:${relPath}:${names.join('.')}`];
  const ext = relPath.includes('.') ? relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase() : '';
  const stripped = relPath.endsWith('.d.ts') ? relPath.slice(0, -'.d.ts'.length) : relPath;
  const noExt = stripped.includes('.') ? stripped.slice(0, stripped.lastIndexOf('.')) : stripped;
  const pkg = manifestName(root);
  const nameFrom = (manifest: string) => (root.manifest === manifest ? pkg : null);
  switch (ext) {
    case 'py':
    case 'pyi': {
      const parts = noExt.split('/');
      const isPackage = root.dir.hasFile('__init__.py');
      if (parts[0] === 'src' && !isPackage) parts.shift();
      if (isPackage) parts.unshift(root.dir.name);
      if (parts[parts.length - 1] === '__init__') parts.pop();
      out.push(`py:${[...parts, ...names].join('.')}`);
      break;
    }
    case 'js': case 'mjs': case 'cjs': case 'jsx': case 'ts': case 'mts': case 'cts': case 'tsx': {
      const name = nameFrom('package.json') ?? root.dir.name;
      const member = names.join('.');
      out.push(`js:${name}#${member}`);
      const sub = noExt.endsWith('/index') ? noExt.slice(0, -'/index'.length) : noExt;
      if (sub !== 'index') out.push(`js:${name}/${sub}#${member}`);
      break;
    }
    case 'go': {
      const module = nameFrom('go.mod') ?? root.dir.name;
      const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
      out.push(`go:${dir ? `${module}/${dir}` : module}.${names.join('.')}`);
      break;
    }
    case 'rs': {
      const crate = (nameFrom('Cargo.toml') ?? root.dir.name).replace(/[^A-Za-z0-9_]/g, '_');
      const mods = (noExt.startsWith('src/') ? noExt.slice(4) : noExt).split('/');
      if (['lib', 'main', 'mod'].includes(mods[mods.length - 1]!)) mods.pop();
      out.push(`rust:${[crate, ...mods, ...names].join('::')}`);
      break;
    }
    case 'h': case 'hh': case 'hpp': case 'hxx': case 'c': case 'cc': case 'cpp': case 'cxx': case 'ixx':
      out.push(`cpp:${names.join('::')}`);
      break;
  }
  return out;
}
