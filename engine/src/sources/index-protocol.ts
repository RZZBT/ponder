/**
 * The Ponder online index protocol (version 1). Pure logic shared by every client; the JetBrains plugin has a
 * Kotlin port (plugin/src/main/kotlin/dev/ponder/sources/IndexProtocol.kt). Both run schema/conformance/index.json,
 * so keep them in step. Specification: docs/online-index.md.
 *
 *   GET <base>/v1/<ecosystem>/<package path>.json   ->   { ponderIndex: 1, ecosystem, name, documents: [...] }
 */
import { parseDocument } from '../parser/validate';

export const INDEX_FORMAT = 1;
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_INDEX_DOCUMENTS = 32;

/** `std` is a language's standard library (Ponder 0.3): name `<language>/<module>`, e.g. `python/builtins`. */
export const ECOSYSTEMS = ['maven', 'npm', 'pypi', 'crates', 'go', 'packagist', 'nuget', 'std'] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

/** A package as the index knows it. [version] is the installed version when the client can tell, else null. */
export interface PackageKey {
  ecosystem: Ecosystem;
  /**
   * maven: `group:artifact`; npm: `name` or `@scope/name`; go: module path; packagist: `vendor/name`;
   * std: `<language>/<module>`. For std, [version] is the language version (Python 3.12, JDK 21, Rust 1.98).
   */
  name: string;
  version: string | null;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
// standard-library modules may start with "_" (Python's `_collections_abc`)
const STD_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._~-]*$/;

/** Languages whose standard library Ponder can look up, and how their modules are written. */
export const STD_LANGUAGES = {
  python: { display: 'Python', module: /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/ },
  javascript: { display: 'JavaScript', module: /^[A-Za-z_][A-Za-z0-9_]{0,63}$/ },
  java: { display: 'Java', module: /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,9}$/ },
  rust: { display: 'Rust', module: /^(core|alloc|std|proc_macro|test)(\.[a-z_][a-z0-9_]*)?$/ },
  go: { display: 'Go', module: /^[a-z0-9][a-z0-9_]*(\/[a-z0-9_][a-z0-9_.]*){0,6}$/ },
} as const;
export type StdLanguage = keyof typeof STD_LANGUAGES;

/** `Python standard library (builtins)` for std keys, `pypi/numpy` for packages. For messages, never for URLs. */
export function describePackage(key: Pick<PackageKey, 'ecosystem' | 'name'>): string {
  if (key.ecosystem === 'std') {
    const [language, ...module] = key.name.split('/');
    const lang = STD_LANGUAGES[language as StdLanguage]?.display ?? language;
    return `${lang} standard library (${module.join('/')})`;
  }
  return `${key.ecosystem}/${key.name}`;
}

/** The canonical name used in URLs and for comparisons. Null if the name cannot be a package of that ecosystem. */
export function canonicalName(ecosystem: Ecosystem, raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > 214) return null;
  let segments: string[];
  let canonical: string;
  switch (ecosystem) {
    case 'maven': {
      const parts = name.split(':');
      if (parts.length !== 2) return null;
      segments = parts;
      canonical = name;
      break;
    }
    case 'npm': {
      canonical = name.toLowerCase();
      segments = canonical.split('/');
      if (segments.length === 2) {
        if (!segments[0]!.startsWith('@')) return null;
        segments = [segments[0]!.slice(1), segments[1]!];
      } else if (segments.length !== 1) return null;
      break;
    }
    case 'pypi':
      canonical = name.toLowerCase().replace(/[-_.]+/g, '-'); // PEP 503
      segments = [canonical];
      break;
    case 'crates':
      canonical = name.toLowerCase().replace(/_/g, '-'); // crates.io treats - and _ alike
      segments = [canonical];
      break;
    case 'nuget':
      canonical = name.toLowerCase();
      segments = [canonical];
      break;
    case 'packagist':
      canonical = name.toLowerCase();
      segments = canonical.split('/');
      if (segments.length !== 2) return null;
      break;
    case 'go':
      canonical = name; // module paths are case-sensitive
      segments = canonical.split('/');
      if (segments.length > 16) return null;
      break;
    case 'std': {
      const slash = name.indexOf('/');
      if (slash <= 0) return null;
      const language = name.slice(0, slash).toLowerCase();
      const module = name.slice(slash + 1); // case kept: Java classes and JavaScript globals are case-sensitive
      const rule = STD_LANGUAGES[language as StdLanguage];
      if (!Object.prototype.hasOwnProperty.call(STD_LANGUAGES, language) || !rule.module.test(module)) return null;
      canonical = `${language}/${module}`;
      segments = [language, ...module.split('/')];
      for (const s of segments) {
        if (!STD_SEGMENT.test(s) || s === '.' || s === '..' || s.length > 128) return null;
      }
      return canonical;
    }
    default:
      return null;
  }
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === '.' || s === '..' || s.length > 128) return null;
  }
  return canonical;
}

/** Path relative to the index base URL, e.g. `v1/pypi/numpy.json`. Null for names that are not safe to request. */
export function indexPath(key: Pick<PackageKey, 'ecosystem' | 'name'>): string | null {
  if (!(ECOSYSTEMS as readonly string[]).includes(key.ecosystem)) return null;
  const c = canonicalName(key.ecosystem, key.name);
  if (c === null) return null;
  const path = key.ecosystem === 'maven' ? c.replace(':', '/') : c;
  return `v${INDEX_FORMAT}/${key.ecosystem}/${path}.json`;
}

/**
 * Base URLs Ponder will talk to: https, or http only to this machine (for testing an index locally).
 * Returns the normalized base (always ending in `/`) or null.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return u.toString().replace(/\/?$/, '/');
}

// ------------------------------------------------------------------ versions

interface Version { nums: number[]; pre: string | null }

/** `1.2.3`, `v1.2`, `2.0.0-rc.1`, `1.26.4+local`. Null if there is no leading number. */
export function parseVersion(raw: string): Version | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:[-.]?([A-Za-z][0-9A-Za-z.-]*|[0-9A-Za-z.-]*[A-Za-z][0-9A-Za-z.-]*))?(?:\+.*)?$/.exec(raw.trim());
  if (!m) return null;
  const nums = m[1]!.split('.').map(Number);
  if (nums.some((n) => !Number.isSafeInteger(n))) return null;
  return { nums, pre: m[2] ? m[2].toLowerCase() : null };
}

export function compareVersions(a: Version, b: Version): number {
  const n = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < n; i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1; // a release is newer than its pre-releases
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

/**
 * Whether [version] is inside [range]. Range grammar: `*`, or comparators separated by spaces or commas, each
 * `>=x`, `>x`, `<=x`, `<x`, `=x` or `x` (exactly x), all of which must hold. An absent range accepts everything.
 * An unknown installed version (null) is accepted only by an absent range or `*`, so a file written for other
 * versions is never shown by guess. A malformed range accepts nothing.
 */
export function versionInRange(version: string | null, range: string | undefined | null): boolean {
  if (range === undefined || range === null || range.trim() === '' || range.trim() === '*') return true;
  if (version === null) return false;
  const v = parseVersion(version);
  if (!v) return false;
  const parts = range.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 8) return false;
  for (const p of parts) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(p);
    const bound = m ? parseVersion(m[2]!) : null;
    if (!m || !bound) return false;
    const c = compareVersions(v, bound);
    const ok = { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[m[1] ?? '='];
    if (!ok) return false;
  }
  return true;
}

// ------------------------------------------------------------------ index files

export interface IndexDocument {
  /** The ponder.json text handed to the renderer (re-serialized from the index entry). */
  text: string;
  versions: string | null;
  library: { group?: string; name: string };
}

export interface ParsedIndex {
  ok: boolean;
  /** Valid documents for this package, in file order. */
  documents: IndexDocument[];
  /** Why the file, or individual entries, were rejected. Never shown raw to users; for diagnostics. */
  problems: string[];
}

/** Whether a ponder.json `library` names the package [key]. */
export function libraryMatches(library: { group?: string; name: string }, key: Pick<PackageKey, 'ecosystem' | 'name'>): boolean {
  const want = canonicalName(key.ecosystem, key.name);
  if (want === null) return false;
  if (key.ecosystem === 'maven') {
    if (!library.group) return false;
    return canonicalName('maven', `${library.group}:${library.name}`) === want;
  }
  return canonicalName(key.ecosystem, library.name) === want;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses and checks an index file fetched for [key]. Entries that fail validation are dropped one by one (and
 * reported in `problems`); the file as a whole is rejected only if it is not an index for this package.
 */
export function parseIndexFile(text: string, key: Pick<PackageKey, 'ecosystem' | 'name'>): ParsedIndex {
  const fail = (why: string): ParsedIndex => ({ ok: false, documents: [], problems: [why] });
  if (text.length > MAX_INDEX_BYTES) return fail(`index file is larger than ${MAX_INDEX_BYTES} bytes`);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Windows editors save UTF-8 with a byte order mark
  let json: unknown;
  try { json = JSON.parse(text); } catch { return fail('index file is not valid JSON'); }
  if (!isObj(json)) return fail('index file is not a JSON object');
  if (json.ponderIndex !== INDEX_FORMAT) return fail(`unsupported index format ${JSON.stringify(json.ponderIndex)}`);
  if (json.ecosystem !== key.ecosystem) return fail(`index file is for ecosystem ${JSON.stringify(json.ecosystem)}, not ${key.ecosystem}`);
  const want = canonicalName(key.ecosystem, key.name);
  if (typeof json.name !== 'string' || want === null || canonicalName(key.ecosystem, json.name) !== want) {
    return fail(`index file is for package ${JSON.stringify(json.name)}, not ${key.name}`);
  }
  if (!Array.isArray(json.documents)) return fail('index file has no "documents" list');
  if (json.documents.length > MAX_INDEX_DOCUMENTS) return fail(`index file has more than ${MAX_INDEX_DOCUMENTS} documents`);

  const documents: IndexDocument[] = [];
  const problems: string[] = [];
  json.documents.forEach((entry, i) => {
    if (!isObj(entry) || !isObj(entry.ponder)) { problems.push(`documents[${i}]: expected { "versions"?, "ponder": {...} }`); return; }
    const versions = entry.versions;
    if (versions !== undefined && (typeof versions !== 'string' || versions.length > 200)) { problems.push(`documents[${i}].versions: expected a version range string`); return; }
    const docText = JSON.stringify(entry.ponder);
    const r = parseDocument(docText);
    if (!r.ok || !r.document) { problems.push(`documents[${i}].ponder: ${r.errors[0] ? `${r.errors[0].path}: ${r.errors[0].message}` : 'invalid'}`); return; }
    const library = r.document.library;
    if (!libraryMatches(library, key)) { problems.push(`documents[${i}]: ponder.json library ${[library.group, library.name].filter(Boolean).join(':')} is not ${key.name}`); return; }
    documents.push({ text: docText, versions: typeof versions === 'string' ? versions : null, library });
  });
  return { ok: true, documents, problems };
}
