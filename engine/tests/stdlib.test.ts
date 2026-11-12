// schema/conformance/stdlib.json is also run by the Kotlin plugin (StdLibraryTest.kt): both must agree.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goVersionFromFile, recognizeStd } from '../src/sources/stdlib';
import { describePackage, indexPath } from '../src/sources/index-protocol';

interface Case {
  name: string;
  path: string;
  names: string[];
  expect: { key: string; version: string | null; candidates: string[] } | null;
}
const cases: Case[] = JSON.parse(readFileSync(resolve(__dirname, '../../schema/conformance/stdlib.json'), 'utf8')).cases;

describe('standard-library recognition', () => {
  it('has cases', () => expect(cases.length).toBeGreaterThan(25));
  for (const c of cases) {
    it(c.name, () => {
      const r = recognizeStd(c.path, c.names);
      if (c.expect === null) {
        expect(r).toBeNull();
        return;
      }
      expect(r).not.toBeNull();
      expect({ key: r!.keyName, version: r!.version, candidates: r!.candidates }).toEqual(c.expect);
      // every recognised module must also be a requestable index address
      expect(indexPath({ ecosystem: 'std', name: r!.keyName })).toBe(`v1/std/${r!.keyName}.json`);
    });
  }

  it('never throws on odd input', () => {
    for (const p of ['', '/', '\\\\server\\share\\', 'typeshed/stdlib/.pyi', '/go/src/.go', 'x'.repeat(5000)]) {
      expect(() => recognizeStd(p, ['f'])).not.toThrow();
    }
    expect(recognizeStd('/x/typeshed/stdlib/builtins.pyi', ['bad name'])).toBeNull();
  });
});

describe('labels and versions', () => {
  it('describes standard-library keys for people', () => {
    expect(describePackage({ ecosystem: 'std', name: 'python/builtins' })).toBe('Python standard library (builtins)');
    expect(describePackage({ ecosystem: 'std', name: 'go/net/http' })).toBe('Go standard library (net/http)');
    expect(describePackage({ ecosystem: 'pypi', name: 'numpy' })).toBe('pypi/numpy');
  });

  it("reads Go's VERSION file", () => {
    expect(goVersionFromFile('go1.22.3\ntime 2024-05-01T00:00:00Z\n')).toBe('1.22.3');
    expect(goVersionFromFile('devel +abc123')).toBeNull();
  });
});
