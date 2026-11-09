// Shared fixtures (schema/fixtures/index.json): the Kotlin validator (plugin/src/test/.../ValidatorParityTest.kt)
// runs the same list.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/parser/validate';

interface Case { file: string; valid: boolean; errors: Array<{ path: string; messageContains: string }> }
const dir = resolve(__dirname, '../../schema/fixtures');
const index: Case[] = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8'));

describe('shared validator fixtures', () => {
  it('index is not empty', () => expect(index.length).toBeGreaterThan(20));
  for (const c of index) {
    it(`${c.valid ? 'accepts' : 'rejects'} ${c.file.split('/').pop()}`, () => {
      const r = parseDocument(readFileSync(resolve(dir, c.file), 'utf8'));
      expect(r.ok, JSON.stringify(r.errors)).toBe(c.valid);
      for (const e of c.errors) {
        expect(
          r.errors.some((x) => x.path === e.path && x.message.includes(e.messageContains)),
          `expected an error at ${e.path} containing "${e.messageContains}", got: ${JSON.stringify(r.errors)}`,
        ).toBe(true);
      }
    });
  }
});
