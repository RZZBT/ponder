// Ponder 0.3: the standard library through local folders and the community index, and the 0.2.2 lookup timing.
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PackageKey } from '../../engine/src/sources/index-protocol';
import { recognizeStd } from '../../engine/src/sources/stdlib';
import { ABSENT_MS, FRESH_MS, FetchError, OnlineIndex, RETRY_MS, findInLookup, newerPonderNeeded, urlFor, type Fetcher } from '../src/online';
import { clearLocalCache, findInFolders } from '../src/local';
import { packageKeyFor } from '../src/packageKey';
import type { Located } from '../src/locate';

const temp = (p: string) => mkdtempSync(join(tmpdir(), p));
const base = 'https://index.test/';

const builtinsDoc = (title: string, extra: Record<string, unknown> = {}) => ({
  version: 1, ...extra, library: { name: 'python/builtins' },
  animations: { sorted: { symbol: 'py:builtins.sorted', title, actors: { d: { type: 'circle' } }, slides: [{ caption: 'x' }] } },
});

/** What locate() builds for `sorted` in Pylance's typeshed. */
function sortedLocation(): Located {
  const std = recognizeStd('C:/Users/d/.vscode/extensions/ms-python.vscode-pylance-2026.4.1/dist/typeshed-fallback/stdlib/builtins.pyi', ['sorted'])!;
  return { kind: 'std', language: std.language, module: std.module, keyName: std.keyName, version: '3.12.4', root: std.root, candidates: std.candidates, display: 'sorted' };
}

describe('standard-library package keys', () => {
  it('a built-in function gets a std key with the language version', () => {
    expect(packageKeyFor(sortedLocation(), ['D:/work'])).toEqual({ ecosystem: 'std', name: 'python/builtins', version: '3.12.4' });
  });

  it('the std key asks the documented address', () => {
    expect(urlFor(base, { ecosystem: 'std', name: 'python/builtins' })).toBe('https://index.test/v1/std/python/builtins.json');
    expect(urlFor(base, { ecosystem: 'std', name: 'go/net/http' })).toBe('https://index.test/v1/std/go/net/http.json');
  });
});

describe('standard library from a local folder', () => {
  beforeEach(() => clearLocalCache());

  it('finds a .ponder file written for the Python built-ins, and only for them', () => {
    const dir = temp('ponder-std-local-');
    writeFileSync(join(dir, 'itertools.json'), JSON.stringify({ ...builtinsDoc('WRONG MODULE'), library: { name: 'python/itertools' } }));
    const loc = sortedLocation();
    const key = packageKeyFor(loc, [])!;
    expect(findInFolders([dir], key, loc.candidates)).toBeNull();
    writeFileSync(join(dir, 'builtins.json'), JSON.stringify(builtinsDoc('How sorted() works')));
    clearLocalCache();
    const hit = findInFolders([dir], key, loc.candidates);
    expect(hit?.animation.title).toBe('How sorted() works');
  });
});

describe('standard library from the community index', () => {
  let now = 1_000_000_000;
  let calls = 0;
  let respond: (url: string) => Promise<string | null>;
  const fetcher: Fetcher = (url) => { calls++; return respond(url); };
  let index: OnlineIndex;
  const key: PackageKey = { ecosystem: 'std', name: 'python/builtins', version: '3.12.4' };
  const candidates = ['py:builtins.sorted'];
  const file = (docs: unknown[]) => JSON.stringify({ ponderIndex: 1, ecosystem: 'std', name: 'python/builtins', documents: docs });

  beforeEach(() => {
    now = 1_000_000_000; calls = 0;
    respond = async () => file([{ versions: '>=3.8', ponder: builtinsDoc('How sorted() works') }]);
    index = new OnlineIndex(temp('ponder-std-cache-'), fetcher, () => now);
  });

  it('finds the animation and labels it for people', async () => {
    let asked = '';
    respond = async (u) => { asked = u; return file([{ versions: '>=3.8', ponder: builtinsDoc('How sorted() works') }]); };
    const hit = findInLookup(await index.fetch(base, key), key, candidates);
    expect(asked).toBe('https://index.test/v1/std/python/builtins.json');
    expect(hit?.animation.title).toBe('How sorted() works');
    expect(hit?.source).toBe('Community index · Python standard library (builtins)');
  });

  it('respects language-version ranges', async () => {
    respond = async () => file([{ versions: '>=3.13', ponder: builtinsDoc('only for 3.13+') }]);
    expect(findInLookup(await index.fetch(base, key), key, candidates)).toBeNull();
  });

  it('"no animation yet" is checked again after an hour, not a day', async () => {
    respond = async () => null;
    expect((await index.fetch(base, key)).kind).toBe('absent');
    now += ABSENT_MS - 1000;
    expect(index.needsFetch(base, key)).toBe(false);
    now += 2000;
    expect(index.needsFetch(base, key)).toBe(true);
    expect(ABSENT_MS).toBeLessThan(FRESH_MS);
  });

  it('"Retry now" forgets a network failure, but keeps a good copy', async () => {
    respond = async () => { throw new FetchError('you seem to be offline'); };
    expect((await index.fetch(base, key)).kind).toBe('failed');
    expect(index.needsFetch(base, key)).toBe(false); // would wait RETRY_MS
    index.forgetFailure(base, key);
    expect(index.needsFetch(base, key)).toBe(true);
    respond = async () => file([{ ponder: builtinsDoc('back online') }]);
    expect(findInLookup(await index.fetch(base, key), key, candidates)?.animation.title).toBe('back online');
    index.forgetFailure(base, key); // a good copy is not forgotten
    expect(index.needsFetch(base, key)).toBe(false);
    expect(RETRY_MS).toBeGreaterThan(0);
  });

  it('an entry for a newer Ponder is skipped and explained', async () => {
    respond = async () => file([{ ponder: builtinsDoc('needs tables', { requires: ['tables'] }) }]);
    const lookup = await index.fetch(base, key);
    expect(findInLookup(lookup, key, candidates)).toBeNull();
    expect(newerPonderNeeded(lookup)).toBe('This file needs a newer Ponder: it uses "tables", which this version does not have. Update Ponder to see this animation.');
    expect(calls).toBe(1);
  });

  it('no message when nothing needs a newer Ponder', () => {
    expect(newerPonderNeeded(null)).toBeNull();
    expect(newerPonderNeeded({ kind: 'absent', fetchedAt: 0 })).toBeNull();
  });
});
