// `ponder check`: validates a ponder.json and confirms that every symbol names a declaration that exists in the
// package, so that every Ponder client can find the animation.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { parseDocument } from '../parser/validate';
import { parseSymbol } from '../parser/symbol';
import { findRoot, manifestName, sameName, type Dir } from '../packages/layout';
import { Jar, pomCoordinates } from '../node/jar';
import { classMethods } from '../node/classfile';

export type Severity = 'error' | 'warning' | 'ok' | 'note';
export interface Finding { severity: Severity; where: string; message: string }

/** Read access to a package: a folder or a jar. Paths are `/`-separated and relative to the package root. */
interface Source {
  label: string;
  read(path: string): Buffer | null;
  list(): string[];
}

function folderSource(root: string): Source {
  let cache: string[] | null = null;
  return {
    label: root,
    read: (p) => { try { const f = join(root, p); return statSync(f).size < 4 * 1024 * 1024 ? readFileSync(f) : null; } catch { return null; } },
    list: () => {
      if (cache) return cache;
      const out: string[] = [];
      const walk = (dir: string, depth: number) => {
        if (depth > 12 || out.length > 20_000) return;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === '__pycache__') continue;
          const full = join(dir, e.name);
          if (e.isDirectory()) walk(full, depth + 1);
          else out.push(relative(root, full).split(sep).join('/'));
        }
      };
      walk(root, 0);
      return (cache = out);
    },
  };
}

function jarSource(jar: Jar, label: string): Source {
  return { label, read: (p) => jar.read(p), list: () => [...jar.entries.keys()] };
}

class FsDir implements Dir {
  constructor(readonly path: string) {}
  get name() { return basename(this.path); }
  get parent(): Dir | null { const p = dirname(this.path); return p === this.path ? null : new FsDir(p); }
  hasFile(rel: string) { try { return statSync(join(this.path, rel)).isFile(); } catch { return false; } }
  hasFileMatching(suffix: string) { try { return readdirSync(this.path).some((f) => f.endsWith(suffix)); } catch { return false; } }
  readText(rel: string) { try { return readFileSync(join(this.path, rel), 'utf8'); } catch { return null; } }
}

export function check(target: string): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Severity, where: string, message: string) => findings.push({ severity, where, message });

  let text: string | null;
  let source: Source;
  let jar: Jar | null = null;
  let identity: string[] = [];
  try {
    if (target.endsWith('.jar')) {
      jar = Jar.open(target);
      text = jar.readText('META-INF/ponder/ponder.json');
      if (text === null) { add('error', target, 'the jar has no META-INF/ponder/ponder.json'); return findings; }
      source = jarSource(jar, target);
      identity = pomCoordinates(jar).map((c) => c.name);
      if (identity.length === 0) add('note', target, 'no META-INF/maven/**/pom.properties: IDEs can only check library.name against the IDE library name');
    } else {
      const file = statSync(target).isDirectory() ? join(target, 'ponder.json') : target;
      if (!existsSync(file)) { add('error', target, 'ponder.json not found'); return findings; }
      text = readFileSync(file, 'utf8');
      const normalized = file.split(sep).join('/');
      if (normalized.endsWith('META-INF/ponder/ponder.json')) {
        // JVM project before packaging: the file ends up in the jar; check against the project's classes and sources
        let project = dirname(file);
        while (dirname(project) !== project && !['pom.xml', 'build.gradle', 'build.gradle.kts'].some((m) => existsSync(join(project, m)))) project = dirname(project);
        add('note', file, `JVM project ${project}: checked against build/classes or target/classes when present, else the .java sources`);
        return checkDocument(text, folderSource(project), [], add, findings);
      }
      const root = findRoot(new FsDir(dirname(file)));
      const rootPath = (root.dir as FsDir).path;
      const expected = relative(rootPath, file).split(sep).join('/');
      if (root.ponderFile !== expected) {
        add('error', file, `IDEs look for the package's ponder.json at ${join(rootPath, root.ponderFile ?? 'ponder.json')}, not here (the package root is the first folder with ponder.json or a manifest such as package.json)`);
      }
      source = folderSource(rootPath);
      const name = manifestName(root);
      if (name) identity = [name];
    }
    return checkDocument(text, source, identity, add, findings);
  } finally {
    jar?.close();
  }
}

function checkDocument(text: string, source: Source, identity: string[], add: (s: Severity, w: string, m: string) => void, findings: Finding[]): Finding[] {
  const result = parseDocument(text);
  for (const e of result.errors) add('error', e.path, e.message);
  for (const w of result.warnings) add('warning', w.path, w.message);
  const doc = result.document;
  if (!doc) return findings;

  if (identity.length > 0 && !identity.some((n) => sameName(n, doc.library.name))) {
    add('error', '$.library.name', `"${doc.library.name}" does not match the package (${identity.join(', ')}); IDEs will hide every animation`);
  }
  for (const [id, a] of Object.entries(doc.animations)) {
    [a.symbol, ...(a.aliases ?? [])].forEach((s, i) => {
      const where = i === 0 ? `$.animations.${id}.symbol` : `$.animations.${id}.aliases[${i - 1}]`;
      const r = verifySymbol(s, source, doc.library.name);
      add(r.severity, where, `${s}: ${r.message}`);
    });
  }
  return findings;
}

interface Verdict { severity: Severity; message: string }

export function verifySymbol(symbol: string, src: Source, libraryName: string): Verdict {
  const { scheme, body } = parseSymbol(symbol);
  switch (scheme) {
    case 'jvm': return verifyJvm(body, src);
    case 'py': return verifyPython(body, src);
    case 'js': return verifyJs(body, src, libraryName);
    case 'sym': return verifySym(body, src);
    case 'rust': return verifyByName(src, ['.rs'], body.split('::').slice(1), 'fn');
    case 'go': return verifyByName(src, ['.go'], body.slice(body.lastIndexOf('/') + 1).split('.').slice(1), 'func');
    case 'cpp': return verifyByName(src, ['.h', '.hh', '.hpp', '.hxx', '.c', '.cc', '.cpp', '.cxx'], body.replace(/\(.*$/, '').split('::'), '');
    case 'dotnet': return { severity: 'note', message: 'not checked (needs the compiled assembly; Copy Ponder Symbol in Visual Studio gives the exact id)' };
  }
}

// ---- JVM: the class file must contain the method with exactly these parameter types

function verifyJvm(body: string, src: Source): Verdict {
  const m = /^(.+)#(.+)\((.*)\)$/.exec(body);
  if (!m) return { severity: 'error', message: 'not a JVM symbol' };
  const [, cls, member, params] = m as unknown as [string, string, string, string];
  const parts = cls.split('.');
  let bytes: Buffer | null = null;
  // nested classes: com.example.Outer.Inner is com/example/Outer$Inner.class
  for (let split = parts.length; split >= 1 && !bytes; split--) {
    const path = parts.slice(0, split).join('/') + parts.slice(split).map((p) => '$' + p).join('') + '.class';
    bytes = src.read(path) ?? src.read(`build/classes/java/main/${path}`) ?? src.read(`target/classes/${path}`);
  }
  if (!bytes) {
    const java = src.list().find((f) => f.endsWith(`/${parts.join('/')}.java`) || f === `${parts.join('/')}.java`);
    if (!java) return { severity: 'error', message: `class ${cls} not found in ${src.label}` };
    const code = src.read(java)!.toString('utf8');
    const name = member === '<init>' ? parts[parts.length - 1]! : member;
    return new RegExp(`\\b${name}\\s*\\(`).test(code)
      ? { severity: 'warning', message: `${name} found in ${java}, but parameter types are only checked against compiled classes; run the check on the jar` }
      : { severity: 'error', message: `no method ${name} in ${java}` };
  }
  let methods;
  try { methods = classMethods(bytes); } catch (e) { return { severity: 'error', message: `cannot read class ${cls}: ${(e as Error).message}` }; }
  const wanted = params ? params.split(',') : [];
  const same = methods.filter((x) => x.name === member);
  if (same.some((x) => x.params.join(',') === wanted.join(','))) return { severity: 'ok', message: 'found' };
  if (same.length === 0) return { severity: 'error', message: `${cls} has no method ${member}` };
  return { severity: 'error', message: `${cls}.${member} exists only as ${same.map((x) => `(${x.params.join(',')})`).join(', ')}` };
}

// ---- Python: module file, then nested def/class by indentation

function verifyPython(body: string, src: Source): Verdict {
  const names = body.split('.');
  const files = new Set(src.list());
  const rootIsPackage = files.has('__init__.py');
  for (let split = names.length - 1; split >= 1; split--) {
    let mod = names.slice(0, split);
    if (rootIsPackage) mod = mod.slice(1); // the package folder itself is the first name
    const base = mod.join('/');
    for (const prefix of rootIsPackage ? [''] : ['', 'src/']) {
      const candidates = base ? [`${prefix}${base}.py`, `${prefix}${base}.pyi`, `${prefix}${base}/__init__.py`] : ['__init__.py'];
      const file = candidates.find((c) => files.has(c));
      if (!file) continue;
      const rest = names.slice(split);
      return findNested(src.read(file)!.toString('utf8'), rest, (n) => new RegExp(`^(\\s*)(?:async\\s+)?(?:def|class)\\s+${n}\\b`))
        ? { severity: 'ok', message: `found in ${file}` }
        : { severity: 'error', message: `${rest.join('.')} is not defined in ${file}` };
    }
  }
  return { severity: 'error', message: `no module for ${body} in ${src.label}` };
}

/** Finds `names[0]`, then `names[1]` indented inside it, and so on. */
function findNested(code: string, names: string[], pattern: (name: string) => RegExp): boolean {
  const lines = code.split(/\r?\n/);
  let from = 0;
  let minIndent = -1;
  for (const n of names) {
    const re = pattern(n);
    let hit = -1;
    for (let i = from; i < lines.length; i++) {
      const indent = /^\s*/.exec(lines[i]!)![0].length;
      if (minIndent >= 0 && lines[i]!.trim() && indent <= minIndent) break;
      if (re.test(lines[i]!)) { hit = i; minIndent = indent; break; }
    }
    if (hit < 0) return false;
    from = hit + 1;
  }
  return true;
}

// ---- JavaScript / TypeScript

const JS_EXT = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx', '.d.ts'];

function verifyJs(body: string, src: Source, libraryName: string): Verdict {
  const hash = body.indexOf('#');
  const spec = body.slice(0, hash);
  const member = body.slice(hash + 1).split('.');
  const pkgJson = src.read('package.json');
  const pkgName = pkgJson ? (/"name"\s*:\s*"([^"]+)"/.exec(pkgJson.toString('utf8'))?.[1] ?? null) : null;
  const name = pkgName ?? libraryName;
  if (!spec.startsWith(name) || (spec.length > name.length && spec[name.length] !== '/')) {
    return { severity: 'error', message: `starts with "${spec}", but the package is "${name}"` };
  }
  const files = src.list().filter((f) => JS_EXT.some((e) => f.endsWith(e)));
  const sub = spec.slice(name.length + 1);
  const scope = sub ? files.filter((f) => stripJsExt(f) === sub || stripJsExt(f) === `${sub}/index`) : files;
  if (sub && scope.length === 0) return { severity: 'error', message: `no file ${sub}.* in the package` };
  const [first, ...rest] = member as [string, ...string[]];
  for (const f of scope) {
    const code = src.read(f)!.toString('utf8');
    const declared = new RegExp(`(?:function\\*?|class|const|let|var|interface|type|enum)\\s+${first}\\b|exports\\.${first}\\s*=|export\\s+default\\s+(?:function|class)\\s+${first}\\b`).test(code)
      || (first === 'default' && /export\s+default|module\.exports\s*=/.test(code));
    if (!declared) continue;
    if (rest.length === 0) return { severity: 'ok', message: `found in ${f}` };
    const methodRe = (m: string) => m === 'constructor'
      ? /\bconstructor\s*\(/
      : new RegExp(`(?:^|[{};])\\s*(?:(?:public|private|protected|static|async|get|set|readonly)\\s+)*\\*?${m}\\s*[(<:=]`, 'm');
    if (rest.every((m) => methodRe(m).test(code))) return { severity: 'ok', message: `found in ${f}` };
  }
  return { severity: 'error', message: `${member.join('.')} is not declared in ${sub ? sub : 'the package'}` };
}

const stripJsExt = (f: string) => f.replace(/\.d\.ts$/, '').replace(/\.[cm]?[jt]sx?$/, '');

// ---- sym: and the remaining languages: the names must appear as declarations in the file(s)

function verifySym(body: string, src: Source): Verdict {
  const colon = body.indexOf(':');
  const file = body.slice(0, colon);
  const names = body.slice(colon + 1).split('.');
  const code = src.read(file);
  if (!code) return { severity: 'error', message: `file ${file} not found in the package` };
  const missing = names.filter((n) => !new RegExp(`\\b${escape(n)}\\b`).test(code.toString('utf8')));
  return missing.length === 0
    ? { severity: 'ok', message: `${names.join('.')} appears in ${file}` }
    : { severity: 'error', message: `${missing.join(', ')} not found in ${file}` };
}

function verifyByName(src: Source, exts: string[], names: string[], keyword: string): Verdict {
  const last = names[names.length - 1];
  if (!last) return { severity: 'error', message: 'no name' };
  const re = new RegExp(keyword ? `\\b${keyword}\\b[^\\n{;]*\\b${escape(last)}\\b` : `\\b${escape(last)}\\s*\\(`);
  const hit = src.list().filter((f) => exts.some((e) => f.endsWith(e))).find((f) => re.test(src.read(f)!.toString('utf8')));
  return hit
    ? { severity: 'ok', message: `${last} declared in ${hit} (module path not checked)` }
    : { severity: 'error', message: `no declaration of ${last} in the package sources` };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
