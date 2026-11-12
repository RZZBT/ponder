// `ponder check-index`: validates an online index folder before it is published.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkIndex, keyFromIndexPath } from '../src/cli/check-index';

const sample = resolve(__dirname, '../../examples/online-index');
const doc = (name: string, group?: string) => ({
  version: 1,
  library: group ? { group, name } : { name },
  animations: { a: { symbol: 'js:x#f', title: 't', actors: { d: { type: 'circle' } }, slides: [{}] } },
});
const indexFile = (ecosystem: string, name: string, documents: unknown[]) => JSON.stringify({ ponderIndex: 1, ecosystem, name, documents });

let tmp: string | null = null;
function folder(files: Record<string, string>): string {
  tmp = mkdtempSync(join(tmpdir(), 'ponder-index-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(tmp, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return tmp;
}
afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); tmp = null; });
const errors = (f: ReturnType<typeof checkIndex>) => f.filter((x) => x.severity === 'error');

describe('check-index', () => {
  it('accepts the sample index in examples/online-index', () => {
    const f = checkIndex(sample);
    expect(errors(f)).toEqual([]);
    expect(f.filter((x) => x.severity === 'ok').map((x) => x.where)).toEqual([
      'v1/maven/com.example/math-utils.json', 'v1/npm/math-utils.json', 'v1/pypi/mathutils.json',
    ]);
  });

  it('the sample index is up to date with the example libraries', () => {
    // Regenerate with: node examples/online-index/generate.mjs
    const file = JSON.parse(readFileSync(join(sample, 'v1/npm/math-utils.json'), 'utf8'));
    const source = JSON.parse(readFileSync(resolve(__dirname, '../../examples/js-math-utils/ponder.json'), 'utf8'));
    delete source.$schema;
    expect(file.documents[0].ponder).toEqual(source);
  });

  it('reports a missing folder in plain words', () => {
    const f = checkIndex(join(tmpdir(), 'ponder-no-such-folder-x7'));
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toBe('folder not found');
  });

  it('reports a file given instead of a folder', () => {
    const dir = folder({ 'v1/npm/x.json': indexFile('npm', 'x', [{ ponder: doc('x') }]) });
    expect(checkIndex(join(dir, 'v1/npm/x.json'))[0]!.message).toContain('this is a file');
  });

  it('explains when the v1 folder itself is given', () => {
    const dir = folder({ 'v1/npm/x.json': indexFile('npm', 'x', [{ ponder: doc('x') }]) });
    expect(checkIndex(join(dir, 'v1'))[0]!.message).toContain('not v1/ itself');
  });

  it('an empty folder is an error', () => {
    const dir = folder({ 'README.md': '# my index' });
    expect(errors(checkIndex(dir))[0]!.message).toContain('no index files found');
  });

  it('a file name clients would never request must be renamed', () => {
    // GitHub Pages is case-sensitive; clients ask for the lower-case canonical name.
    const dir = folder({ 'v1/pypi/Scikit_Learn.json': indexFile('pypi', 'scikit-learn', [{ ponder: doc('scikit-learn') }]) });
    const e = errors(checkIndex(dir));
    expect(e).toHaveLength(1);
    expect(e[0]!.message).toBe('clients request v1/pypi/scikit-learn.json; rename the file');
  });

  it('an unknown ecosystem folder is an error', () => {
    const dir = folder({ 'v1/cocoapods/x.json': '{}' });
    expect(errors(checkIndex(dir))[0]!.message).toContain('not a valid index path');
  });

  it('a file that names another package is an error', () => {
    const dir = folder({ 'v1/npm/lodash.json': indexFile('npm', 'underscore', [{ ponder: doc('underscore') }]) });
    expect(errors(checkIndex(dir))[0]!.message).toContain('not lodash');
  });

  it('every bad entry is an error here, even though clients would only skip it', () => {
    const dir = folder({
      'v1/npm/x.json': indexFile('npm', 'x', [{ ponder: doc('x') }, { ponder: { ...doc('x'), version: 9 } }, { versions: 3, ponder: doc('x') }]),
    });
    const e = errors(checkIndex(dir));
    expect(e.map((x) => x.message.split(':')[0])).toEqual(['documents[1].ponder', 'documents[2].versions']);
  });

  it('a file with no usable documents is an error', () => {
    const dir = folder({ 'v1/npm/x.json': indexFile('npm', 'x', []) });
    expect(errors(checkIndex(dir))[0]!.message).toBe('no usable documents');
  });

  it('broken JSON is an error, not a crash', () => {
    const dir = folder({ 'v1/npm/x.json': '{ "ponderIndex": 1, ' });
    expect(errors(checkIndex(dir))[0]!.message).toContain('not valid JSON');
  });

  it('accepts a file saved with a byte order mark', () => {
    const dir = folder({ 'v1/npm/x.json': '﻿' + indexFile('npm', 'x', [{ ponder: doc('x') }]) });
    expect(errors(checkIndex(dir))).toEqual([]);
  });

  it('maven files live under the group folder', () => {
    const good = folder({ 'v1/maven/com.example/lib.json': indexFile('maven', 'com.example:lib', [{ ponder: doc('lib', 'com.example') }]) });
    expect(errors(checkIndex(good))).toEqual([]);
  });

  it('json files outside v1/ are only noted', () => {
    const dir = folder({
      'package.json': '{}',
      'v1/npm/x.json': indexFile('npm', 'x', [{ ponder: doc('x') }]),
    });
    const f = checkIndex(dir);
    expect(errors(f)).toEqual([]);
    expect(f.find((x) => x.where === 'package.json')!.severity).toBe('note');
  });
});

describe('keyFromIndexPath', () => {
  it.each([
    ['v1/npm/@types/node.json', { ecosystem: 'npm', name: '@types/node' }],
    ['v1/maven/com.example/math-utils.json', { ecosystem: 'maven', name: 'com.example:math-utils' }],
    ['v1/go/github.com/gorilla/mux.json', { ecosystem: 'go', name: 'github.com/gorilla/mux' }],
    ['v2/npm/x.json', null],
    ['v1/npm/x.txt', null],
    ['v1/x.json', null],
  ])('%s', (rel, key) => expect(keyFromIndexPath(rel)).toEqual(key));
});
