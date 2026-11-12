/**
 * Recognises declarations in a language's standard library from the file the editor jumped to (Ponder 0.3).
 * Pure logic, no file access; the JetBrains plugin has a Kotlin port (plugin/.../sources/StdLibrary.kt) and both run
 * schema/conformance/stdlib.json, so keep them in step.
 *
 *   …/typeshed/stdlib/builtins.pyi + [str, split]          -> std python/builtins, py:builtins.str.split
 *   …/typescript/lib/lib.es5.d.ts + [Array, map]            -> std javascript/Array, js:std#Array.map
 *   …/rustlib/src/rust/library/alloc/src/vec/mod.rs + [Vec, push] -> std rust/alloc.vec, rust:alloc::vec::Vec::push
 *   GOROOT/src/strings/strings.go + [Split]                 -> std go/strings, go:strings.Split
 *
 * Java's standard library is recognised by the IDE itself (the JDK), not by path.
 */
import { STD_LANGUAGES, type StdLanguage } from './index-protocol';

export interface StdDeclaration {
  language: StdLanguage;
  /** Module as used in the index name: `builtins`, `os.path`, `Array`, `alloc.vec`, `net/http`. */
  module: string;
  /** Index key name: `<language>/<module>`. */
  keyName: string;
  /** Language version when the path tells it (`3.12` from `lib/python3.12`, `1.98.1` from a toolchain), else null. */
  version: string | null;
  /** The standard library's root folder (typeshed `stdlib`, `typescript/lib`, a Rust crate, GOROOT). */
  root: string;
  /** Symbol strings, most specific first; the last one is always a `sym:` form. */
  candidates: string[];
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Forward slashes, no trailing slash. Windows drive letters are kept as they are. */
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** [names] are the enclosing names of the declaration, outermost first: `["str", "split"]`. */
export function recognizeStd(path: string, names: string[]): StdDeclaration | null {
  if (names.length === 0 || names.length > 8 || names.some((n) => !IDENT.test(n))) return null;
  const p = norm(path);
  return python(p, names) ?? javascript(p, names) ?? rust(p, names) ?? go(p, names);
}

function make(language: StdLanguage, module: string, version: string | null, root: string, candidates: string[]): StdDeclaration | null {
  if (!STD_LANGUAGES[language].module.test(module)) return null;
  return { language, module, keyName: `${language}/${module}`, version, root, candidates };
}

// ------------------------------------------------------------------ Python

/** `os/path.pyi` -> `os.path`; `collections/__init__.pyi` -> `collections`. */
function pythonModule(rel: string): string | null {
  const parts = rel.replace(/\.pyi?$/, '').split('/');
  if (/^\d/.test(parts[0] ?? '')) parts.shift(); // older Jedi: typeshed/stdlib/3/builtins.pyi, …/2and3/…
  if (parts[parts.length - 1] === '__init__') parts.pop();
  if (parts.length === 0 || parts.some((s) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s))) return null;
  return parts.join('.');
}

function python(p: string, names: string[]): StdDeclaration | null {
  let root: string | null = null;
  let rel = '';
  let version: string | null = null;
  // type stubs: Pylance and basedpyright (typeshed-fallback), Jedi, PyCharm (helpers/typeshed), mypy
  const stub = /^(.*\/typeshed(?:-fallback)?\/stdlib)\/(.+\.pyi)$/.exec(p);
  if (stub) { root = stub[1]!; rel = stub[2]!; }
  // CPython's own sources: lib/python3.12/… (Linux, macOS) or …/Python312/Lib/…, …/pythoncore-3.14-64/Lib/… (Windows)
  const posix = !stub && /^(.*\/lib\/python(3\.\d+))\/(.+\.py)$/.exec(p);
  if (posix) { root = posix[1]!; version = posix[2]!; rel = posix[3]!; }
  const win = !stub && !posix && /^(.*\/(?:python|pythoncore-)3[.-]?(\d+)[^/]*\/Lib)\/(.+\.py)$/i.exec(p);
  if (win) { root = win[1]!; version = `3.${win[2]!}`; rel = win[3]!; }
  if (root === null) return null;
  const first = rel.split('/')[0]!;
  if (['site-packages', 'dist-packages', 'test', 'tests', 'idlelib', 'lib2to3'].includes(first) || first.startsWith('@')) return null;
  const module = pythonModule(rel);
  if (!module) return null;
  return make('python', module, version, root, [`py:${module}.${names.join('.')}`, `sym:${rel}:${names.join('.')}`]);
}

// ------------------------------------------------------------------ JavaScript / TypeScript

function javascript(p: string, names: string[]): StdDeclaration | null {
  // TypeScript's built-in declarations, in a project's node_modules or bundled with the editor
  const m = /^(.*\/typescript\/lib)\/(lib\.[A-Za-z0-9.]+\.d\.ts)$/.exec(p);
  if (!m) return null;
  const [first, ...rest] = names as [string, ...string[]];
  // `interface ArrayConstructor { from() }` holds Array.from; top-level `declare function parseInt` is a global
  const module = rest.length === 0 ? 'globals' : first.replace(/Constructor$/, '') || first;
  const candidates = [`js:std#${names.join('.')}`];
  if (rest.length > 0 && module !== first) candidates.push(`js:std#${module}.${rest.join('.')}`);
  candidates.push(`sym:${m[2]!}:${names.join('.')}`);
  return make('javascript', module, null, m[1]!, candidates);
}

// ------------------------------------------------------------------ Rust

function rust(p: string, names: string[]): StdDeclaration | null {
  // the rust-src component of a toolchain: …/toolchains/1.98.1-x86_64-…/lib/rustlib/src/rust/library/core/src/…
  const m = /^(.*\/rustlib\/src\/rust\/library\/(core|alloc|std|proc_macro|test))\/src\/(.+)\.rs$/.exec(p);
  if (!m) return null;
  const crate = m[2]!;
  const mods = m[3]!.split('/');
  if (mods.some((s) => !/^[a-z_][a-z0-9_]*$/.test(s))) return null;
  if (['lib', 'mod', 'main'].includes(mods[mods.length - 1]!)) mods.pop();
  const module = mods.length > 0 ? `${crate}.${mods[0]!}` : crate;
  const version = /\/toolchains\/(\d+\.\d+\.\d+)(?:[-/]|$)/.exec(p)?.[1] ?? null;
  return make('rust', module, version, m[1]!, [
    `rust:${[crate, ...mods, ...names].join('::')}`,
    `sym:src/${m[3]!}.rs:${names.join('.')}`,
  ]);
}

// ------------------------------------------------------------------ Go

function go(p: string, names: string[]): StdDeclaration | null {
  // GOROOT: …/go/src/…, an SDK like …/sdk/go1.22.3/src/…, or a downloaded toolchain in the module cache
  const m = /^(.*\/(?:go|go(\d+(?:\.\d+)*)|golang\.org\/toolchain@v[^/]*?-go(\d+(?:\.\d+)*)[^/]*))\/src\/((?:[^/]+\/)*)([^/]+)\.go$/i.exec(p);
  if (!m) return null;
  const pkg = m[4]!.replace(/\/$/, '');
  const file = m[5]!;
  if (!pkg || file.endsWith('_test')) return null;
  const parts = pkg.split('/');
  // a dot in the first element means a module path (github.com/…): a GOPATH project, not the standard library
  if (parts[0]!.includes('.') || ['cmd', 'vendor'].includes(parts[0]!) || parts.includes('testdata') || parts.includes('vendor')) return null;
  const version = m[2] ?? m[3] ?? null;
  return make('go', pkg, version, m[1]!, [`go:${pkg}.${names.join('.')}`, `sym:src/${pkg}/${file}.go:${names.join('.')}`]);
}

/** Go's `VERSION` file in GOROOT starts with `go1.22.3`. */
export function goVersionFromFile(text: string): string | null {
  return /^go(\d+(?:\.\d+)*)/.exec(text.trim())?.[1] ?? null;
}
