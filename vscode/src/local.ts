// ponder.json files kept outside libraries: `.ponder/` in each workspace folder and `ponder.localFolders`.
// Same rules as the JetBrains plugin's LocalFolders.kt: a file only applies to the package its `library` names.
// No vscode import.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { libraryMatches, type PackageKey } from '../../engine/src/sources/index-protocol';
import { loadDocument } from './match';
import type { Hit } from './online';

const MAX_FILES = 500;
const MAX_DEPTH = 3;
const MAX_BYTES = 256 * 1024;

interface Cached { mtime: number; size: number; doc: ReturnType<typeof loadDocument> | null; library: { group?: string; name: string } | null; text: string }

const cache = new Map<string, Cached>();

function jsonFiles(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let entries: string[];
  try { entries = readdirSync(dir).sort(); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) jsonFiles(p, depth + 1, out);
    else if (s.isFile() && e.toLowerCase().endsWith('.json')) out.push(p);
  }
  return out;
}

function load(file: string, report: (file: string, problem: string) => void): Cached | null {
  let s;
  try { s = statSync(file); } catch { return null; }
  const c = cache.get(file);
  if (c && c.mtime === s.mtimeMs && c.size === s.size) return c;
  let entry: Cached = { mtime: s.mtimeMs, size: s.size, doc: null, library: null, text: '' };
  if (s.size > MAX_BYTES) report(file, `larger than ${MAX_BYTES} bytes`);
  else {
    let text: string | null = null;
    try { text = readFileSync(file, 'utf8'); } catch { /* unreadable */ }
    // only files that look like ponder documents are reported; other JSON is simply ignored
    if (text !== null && text.includes('"animations"')) {
      const doc = loadDocument(text);
      if (!doc.ok) report(file, `${doc.errors[0]?.path}: ${doc.errors[0]?.message}`);
      entry = { ...entry, doc: doc.ok ? doc : null, library: doc.library ?? null, text };
    }
  }
  cache.set(file, entry);
  return entry;
}

export function findInFolders(
  folders: string[], key: PackageKey, candidates: string[], report: (file: string, problem: string) => void = () => {},
): Hit | null {
  for (const folder of folders) {
    for (const file of jsonFiles(folder)) {
      const e = load(file, report);
      if (!e?.doc || !e.library || !libraryMatches(e.library, key)) continue;
      const animation = e.doc.find(candidates);
      if (animation) return { animation, documentText: e.text, source: `Local file · ${file.split(/[\\/]/).pop()}` };
    }
  }
  return null;
}

export function clearLocalCache(): void { cache.clear(); }
