// schema/conformance/index.json is also run by the Kotlin plugin (IndexProtocolTest.kt): both must agree.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  indexPath, normalizeBaseUrl, parseIndexFile, versionInRange, type Ecosystem,
} from '../src/sources/index-protocol';

const cases = JSON.parse(readFileSync(resolve(__dirname, '../../schema/conformance/index.json'), 'utf8'));

describe('index paths', () => {
  for (const c of cases.paths) {
    it(`${c.ecosystem} ${JSON.stringify(c.name)} -> ${c.path}`, () => {
      expect(indexPath({ ecosystem: c.ecosystem as Ecosystem, name: c.name })).toBe(c.path);
    });
  }
});

describe('version ranges', () => {
  for (const c of cases.versions) {
    it(`${c.version} in ${JSON.stringify(c.range)} = ${c.in}`, () => {
      expect(versionInRange(c.version, c.range)).toBe(c.in);
    });
  }
});

describe('base urls', () => {
  for (const c of cases.baseUrls) {
    it(`${c.raw}`, () => expect(normalizeBaseUrl(c.raw)).toBe(c.normalized));
  }
});

describe('index files', () => {
  for (const c of cases.indexFiles) {
    it(c.name, () => {
      const text = c.text ?? JSON.stringify(c.json);
      const r = parseIndexFile(text, c.key);
      expect(r.ok).toBe(c.ok);
      expect(r.documents).toHaveLength(c.documents);
      if (c.problemContains) expect(r.problems.join('\n')).toContain(c.problemContains);
      for (const d of r.documents) expect(() => JSON.parse(d.text)).not.toThrow();
    });
  }

  it('never throws on hostile input', () => {
    const key = { ecosystem: 'npm' as const, name: 'x' };
    for (const t of ['', 'null', '[]', '{', '"x"', '1', '{"ponderIndex":1,"ecosystem":"npm","name":"x","documents":[null,1,[],{"ponder":[]}]}',
      '['.repeat(100_000), 'x'.repeat(3 * 1024 * 1024)]) {
      expect(() => parseIndexFile(t, key)).not.toThrow();
    }
  });

  it('rejects more documents than allowed', () => {
    const docs = Array.from({ length: 40 }, () => ({ ponder: {} }));
    const r = parseIndexFile(JSON.stringify({ ponderIndex: 1, ecosystem: 'npm', name: 'x', documents: docs }), { ecosystem: 'npm', name: 'x' });
    expect(r.ok).toBe(false);
  });
});
