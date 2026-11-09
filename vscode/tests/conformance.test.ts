// Runs schema/conformance/packages.json, the cases the JetBrains plugin runs too (ConformanceTest.kt).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { candidates, findRoot, manifestName, type Dir } from '../../engine/src/packages/layout';
import { loadDocument } from '../src/match';
import { isValidSymbolSyntax } from '../../engine/src/parser/symbol';

interface PackageCase {
  name: string;
  files: Record<string, string>;
  decl: string;
  names: string[];
  expect: { root: string; ponder: string | null; manifestName?: string; candidates: string[] };
}
interface MatchCase { name: string; symbols: string[]; separateAnimations?: boolean; candidates: string[]; expect: string | null }

const spec = JSON.parse(readFileSync(new URL('../../schema/conformance/packages.json', import.meta.url), 'utf8')) as {
  packages: PackageCase[];
  matching: MatchCase[];
};

class FakeDir implements Dir {
  constructor(private readonly files: Record<string, string>, readonly path: string) {}
  get name() { return this.path.slice(this.path.lastIndexOf('/') + 1); }
  get parent(): Dir | null {
    return this.path ? new FakeDir(this.files, this.path.includes('/') ? this.path.slice(0, this.path.lastIndexOf('/')) : '') : null;
  }
  private full(n: string) { return this.path ? `${this.path}/${n}` : n; }
  hasFile(n: string) { return this.full(n) in this.files; }
  hasFileMatching(suffix: string) {
    return Object.keys(this.files).some((k) => k.startsWith(`${this.path}/`) && !k.slice(this.path.length + 1).includes('/') && k.endsWith(suffix));
  }
  readText(n: string) { return this.files[this.full(n)] ?? null; }
}

describe('conformance: packages', () => {
  for (const c of spec.packages) {
    it(c.name, () => {
      const root = findRoot(new FakeDir(c.files, c.decl.slice(0, c.decl.lastIndexOf('/'))));
      const rootPath = (root.dir as FakeDir).path;
      expect(rootPath).toBe(c.expect.root);
      expect(root.ponderFile).toBe(c.expect.ponder);
      if (c.expect.manifestName !== undefined) expect(manifestName(root)).toBe(c.expect.manifestName);
      const got = candidates(root, c.decl.slice(rootPath.length + 1), c.names);
      expect(got).toEqual(c.expect.candidates);
      for (const s of got) expect(isValidSymbolSyntax(s), s).toBe(true);
    });
  }
});

describe('conformance: matching', () => {
  const docFor = (c: MatchCase) => {
    const anim = (symbol: string, aliases: string[]) => ({
      symbol, ...(aliases.length ? { aliases } : {}), title: 't',
      actors: { x: { type: 'circle', radius: 5 } }, slides: [{ caption: 'a' }, { changes: { x: { x: 1 } } }],
    });
    const animations = c.separateAnimations
      ? Object.fromEntries(c.symbols.map((s, i) => [`a${i}`, anim(s, [])]))
      : { a0: anim(c.symbols[0]!, c.symbols.slice(1)) };
    return loadDocument(JSON.stringify({ version: 1, library: { name: 'n' }, animations }));
  };
  for (const c of spec.matching) {
    it(c.name, () => {
      expect(docFor(c).find(c.candidates)?.symbol ?? null).toBe(c.expect);
    });
  }
});
