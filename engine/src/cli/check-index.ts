// ponder check-index <folder>: validates a whole online index before it is published (e.g. to GitHub Pages).
// Stricter than the IDE clients: an entry the clients would silently drop is an error here, so problems are
// found by the publisher, not by users.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ECOSYSTEMS, INDEX_FORMAT, MAX_INDEX_BYTES, indexPath, parseIndexFile, type Ecosystem } from '../sources/index-protocol';

export interface IndexFinding { severity: 'error' | 'ok' | 'note'; where: string; message: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** The package a file path stands for: `v1/maven/com.example/math-utils.json` -> maven com.example:math-utils. */
export function keyFromIndexPath(rel: string): { ecosystem: Ecosystem; name: string } | null {
  const parts = rel.split('/');
  if (parts.length < 3 || parts[0] !== `v${INDEX_FORMAT}` || !parts[parts.length - 1]!.endsWith('.json')) return null;
  const ecosystem = parts[1] as Ecosystem;
  if (!(ECOSYSTEMS as readonly string[]).includes(ecosystem)) return null;
  const rest = parts.slice(2).join('/').replace(/\.json$/, '');
  return { ecosystem, name: ecosystem === 'maven' ? rest.replace('/', ':') : rest };
}

export function checkIndex(folder: string): IndexFinding[] {
  const findings: IndexFinding[] = [];
  let files: string[];
  try {
    if (!statSync(folder).isDirectory()) {
      return [{ severity: 'error', where: folder, message: 'this is a file; give the folder that contains v1/' }];
    }
    files = walk(folder);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const why = code === 'ENOENT' ? 'folder not found' : code === 'EACCES' || code === 'EPERM' ? 'no permission to read it' : (e as Error).message;
    return [{ severity: 'error', where: folder, message: why }];
  }
  if (/(^|[\\/])v\d+[\\/]?$/.test(folder) && !files.some((f) => relative(folder, f).split(sep)[0] === `v${INDEX_FORMAT}`)) {
    // Common slip: pointing at v1/ itself instead of the folder above it.
    return [{ severity: 'error', where: folder, message: `give the folder that contains v${INDEX_FORMAT}/, not v${INDEX_FORMAT}/ itself` }];
  }
  let packages = 0;
  for (const file of files) {
    const rel = relative(folder, file).split(sep).join('/');
    if (!rel.startsWith(`v${INDEX_FORMAT}/`)) {
      if (rel.endsWith('.json')) findings.push({ severity: 'note', where: rel, message: `not under v${INDEX_FORMAT}/, clients never request it` });
      continue;
    }
    const key = keyFromIndexPath(rel);
    if (!key) { findings.push({ severity: 'error', where: rel, message: 'not a valid index path (v1/<ecosystem>/<package>.json)' }); continue; }
    const canonical = indexPath(key);
    if (canonical !== rel) {
      findings.push({ severity: 'error', where: rel, message: canonical ? `clients request ${canonical}; rename the file` : 'not a valid package name' });
      continue;
    }
    if (statSync(file).size > MAX_INDEX_BYTES) { findings.push({ severity: 'error', where: rel, message: `larger than ${MAX_INDEX_BYTES} bytes` }); continue; }
    const r = parseIndexFile(readFileSync(file, 'utf8'), key);
    for (const p of r.problems) findings.push({ severity: 'error', where: rel, message: p });
    if (r.ok && r.documents.length === 0) findings.push({ severity: 'error', where: rel, message: 'no usable documents' });
    if (r.ok && r.problems.length === 0 && r.documents.length > 0) {
      packages++;
      const animations = r.documents.reduce((n, d) => n + Object.keys((JSON.parse(d.text) as { animations: object }).animations).length, 0);
      findings.push({ severity: 'ok', where: rel, message: `${r.documents.length} document(s), ${animations} animation(s)` });
    }
  }
  if (packages === 0 && !findings.some((f) => f.severity === 'error')) {
    findings.push({ severity: 'error', where: folder, message: `no index files found (expected v${INDEX_FORMAT}/<ecosystem>/<package>.json)` });
  }
  return findings;
}
