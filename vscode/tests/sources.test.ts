import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PackageKey } from '../../engine/src/sources/index-protocol';
import { FRESH_MS, FetchError, OnlineIndex, RETRY_MS, findInLookup, httpsFetcher, isLocalBase, urlFor, type Fetcher } from '../src/online';
import { clearLocalCache, findInFolders } from '../src/local';
import {
  goVersionFromDirName, isOwnCode, manifestVersion, packageKeyForRoot, parseDistMetadata,
} from '../src/packageKey';

const base = 'https://index.test/';
const key: PackageKey = { ecosystem: 'pypi', name: 'mathutils', version: '1.2.0' };
const candidates = ['py:mathutils.abs'];

const ponder = (library: string, symbol: string, title: string) => ({
  version: 1, library: { name: library },
  animations: { a: { symbol, title, actors: { d: { type: 'circle' } }, slides: [{ caption: 'x' }] } },
});
const indexBody = (title = 'abs', versions: string | null = '>=1.0', name = 'mathutils') => JSON.stringify({
  ponderIndex: 1, ecosystem: 'pypi', name,
  documents: [{ ...(versions ? { versions } : {}), ponder: ponder(name, `py:${name}.abs`, title) }],
});
const temp = (p: string) => mkdtempSync(join(tmpdir(), p));

describe('online index client', () => {
  let now = 1_000_000_000;
  let calls = 0;
  let respond: (url: string) => Promise<string | null> = async () => indexBody();
  const fetcher: Fetcher = (url) => { calls++; return respond(url); };
  let index: OnlineIndex;
  let dir: string;

  beforeEach(() => {
    now = 1_000_000_000; calls = 0; respond = async () => indexBody();
    dir = temp('ponder-cache-');
    index = new OnlineIndex(dir, fetcher, () => now);
  });

  it('requests the documented url and finds the animation', async () => {
    let asked = '';
    respond = async (u) => { asked = u; return indexBody(); };
    const l = await index.fetch(base, key);
    expect(asked).toBe('https://index.test/v1/pypi/mathutils.json');
    expect(findInLookup(l, key, candidates)?.animation.title).toBe('abs');
    expect(findInLookup(l, key, ['py:mathutils.nope'])).toBeNull();
  });

  it('caches fresh results and refetches after a day', async () => {
    await index.fetch(base, key); await index.fetch(base, key);
    expect(calls).toBe(1);
    now += FRESH_MS + 1;
    await index.fetch(base, key);
    expect(calls).toBe(2);
  });

  it('refreshes a stale copy in the background, keeping the cached one meanwhile', async () => {
    await index.fetch(base, key);
    index.refreshInBackground(base, key); // fresh: nothing to do
    expect(calls).toBe(1);
    now += FRESH_MS + 1;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    respond = async () => { await gate; return indexBody('abs, fixed'); };
    index.refreshInBackground(base, key);
    expect(findInLookup(index.cached(base, key), key, candidates)?.animation.title).toBe('abs'); // not waiting
    release();
    await index.fetch(base, key); // joins the running request
    expect(calls).toBe(2);
    expect(findInLookup(index.cached(base, key), key, candidates)?.animation.title).toBe('abs, fixed');
  });

  it('a failed background refresh never loses the cached animation or rejects', async () => {
    await index.fetch(base, key);
    now += FRESH_MS + 1;
    respond = async () => { throw new FetchError('you seem to be offline'); };
    index.refreshInBackground(base, key);
    await index.fetch(base, key);
    expect(index.cached(base, key)?.kind).toBe('failed');
    expect(findInLookup(index.cached(base, key), key, candidates)?.animation.title).toBe('abs');
  });

  it('a local test index is always refetched', async () => {
    const local = 'http://localhost:8123/';
    await index.fetch(local, key);
    expect(index.needsFetch(local, key)).toBe(true);
    expect(isLocalBase('http://127.0.0.1:9000/idx')).toBe(true);
    expect(isLocalBase(base)).toBe(false);
    expect(isLocalBase('https://localhost.example.com/')).toBe(false);
  });

  it('remembers 404 as absent', async () => {
    respond = async () => null;
    expect((await index.fetch(base, key)).kind).toBe('absent');
    await index.fetch(base, key);
    expect(calls).toBe(1);
  });

  it('gives a friendly reason when offline and does not retry storm', async () => {
    respond = async () => { throw new FetchError('you seem to be offline'); };
    const l = await index.fetch(base, key);
    expect(l.kind === 'failed' && l.reason).toBe('you seem to be offline');
    await index.fetch(base, key);
    expect(calls).toBe(1);
    now += RETRY_MS + 1;
    await index.fetch(base, key);
    expect(calls).toBe(2);
  });

  it('keeps using the last good copy when offline, also after a restart', async () => {
    await index.fetch(base, key);
    now += FRESH_MS + 1;
    respond = async () => { throw new Error('reset'); };
    const l = await index.fetch(base, key);
    expect(l.kind).toBe('failed');
    expect(findInLookup(l, key, candidates)?.animation.title).toBe('abs');
    const restarted = new OnlineIndex(dir, async () => { throw new Error('must not fetch'); }, () => now);
    expect(findInLookup(restarted.cached(base, key), key, candidates)?.animation.title).toBe('abs');
  });

  it('survives a restart without network', async () => {
    await index.fetch(base, key);
    const restarted = new OnlineIndex(dir, async () => { throw new Error('must not fetch'); }, () => now);
    expect(restarted.needsFetch(base, key)).toBe(false);
  });

  it('drops corrupt cache files', async () => {
    await index.fetch(base, key);
    for (const f of readdirSync(dir)) writeFileSync(join(dir, f), '{ not json');
    const restarted = new OnlineIndex(dir, fetcher, () => now);
    expect(restarted.cached(base, key)).toBeNull();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('a broken index file never replaces a good copy', async () => {
    await index.fetch(base, key);
    now += FRESH_MS + 1;
    respond = async () => '<html>maintenance</html>';
    const l = await index.fetch(base, key);
    expect(l.kind).toBe('failed');
    expect(findInLookup(l, key, candidates)?.animation.title).toBe('abs');
  });

  it('respects version ranges, including unknown installed versions', async () => {
    respond = async () => indexBody('abs', '<1.0');
    expect(findInLookup(await index.fetch(base, key), key, candidates)).toBeNull();
    const unknown = { ...key, version: null };
    index.clear(); respond = async () => indexBody('abs', '>=1.0');
    expect(findInLookup(await index.fetch(base, unknown), unknown, candidates)).toBeNull();
    index.clear(); respond = async () => indexBody('abs', null);
    expect(findInLookup(await index.fetch(base, unknown), unknown, candidates)).not.toBeNull();
  });

  it('never uses a file for another package', async () => {
    respond = async () => indexBody('evil', null, 'evil');
    expect(findInLookup(await index.fetch(base, key), key, [...candidates, 'py:evil.abs'])).toBeNull();
  });

  it('unsafe names and insecure index addresses never reach the network', async () => {
    expect((await index.fetch(base, { ...key, name: '../../etc/passwd' })).kind).toBe('failed');
    expect((await index.fetch('http://evil.example/', key)).kind).toBe('failed');
    expect(calls).toBe(0);
    expect(urlFor('http://evil.example/', key)).toBeNull();
  });

  it('shares one request between concurrent lookups', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    respond = async () => { await gate; return indexBody(); };
    const all = Promise.all(Array.from({ length: 8 }, () => index.fetch(base, key)));
    release();
    for (const l of await all) expect(findInLookup(l, key, candidates)).not.toBeNull();
    expect(calls).toBe(1);
  });
});

describe('https transport (against a local server)', () => {
  let server: Server;
  let root = '';
  const routes = new Map<string, { status: number; body?: string; location?: string; bytes?: number }>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      const r = routes.get(req.url ?? '');
      if (!r) { res.writeHead(404); res.end('not found'); return; }
      if (r.location) { res.writeHead(r.status, { location: r.location }); res.end(); return; }
      res.writeHead(r.status);
      res.end(r.bytes ? Buffer.alloc(r.bytes, 32) : r.body);
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  it('200, 404 and server errors', async () => {
    routes.set('/ok.json', { status: 200, body: '{"a":1}' });
    routes.set('/boom.json', { status: 500, body: 'x' });
    expect(await httpsFetcher(`${root}/ok.json`, 1000)).toBe('{"a":1}');
    expect(await httpsFetcher(`${root}/missing.json`, 1000)).toBeNull();
    await expect(httpsFetcher(`${root}/boom.json`, 1000)).rejects.toThrow('error 500');
  });

  it('cuts off oversized responses', async () => {
    routes.set('/big.json', { status: 200, bytes: 5000 });
    await expect(httpsFetcher(`${root}/big.json`, 1000)).rejects.toThrow('too large');
  });

  it('follows a few redirects, but not to insecure hosts and not forever', async () => {
    routes.set('/r1.json', { status: 302, location: '/ok.json' });
    routes.set('/ok.json', { status: 200, body: '{"a":1}' });
    expect(await httpsFetcher(`${root}/r1.json`, 1000)).toBe('{"a":1}');
    routes.set('/evil.json', { status: 302, location: 'http://example.com/x.json' });
    await expect(httpsFetcher(`${root}/evil.json`, 1000)).rejects.toThrow('secure');
    routes.set('/loop.json', { status: 302, location: '/loop.json' });
    await expect(httpsFetcher(`${root}/loop.json`, 1000)).rejects.toThrow('redirected too often');
  });

  it('reports an unreachable host without throwing raw errors', async () => {
    await expect(httpsFetcher('http://127.0.0.1:1/x.json', 1000)).rejects.toBeInstanceOf(FetchError);
  });
});

describe('package identification', () => {
  it('reads versions from manifests and folder names', () => {
    expect(manifestVersion('package.json', '{ "name": "lodash", "version": "4.17.21" }')).toBe('4.17.21');
    expect(manifestVersion('Cargo.toml', '[package]\nname = "x"\nversion = "1.0.3"\n[dependencies]\nversion = "9"')).toBe('1.0.3');
    expect(manifestVersion('pyproject.toml', "[project]\nname='m'\ndynamic=['version']")).toBeNull();
    expect(goVersionFromDirName('mux@v1.8.0')).toBe('v1.8.0');
    expect(parseDistMetadata('Name: scikit-learn\nVersion: 1.3.0\n\nName: x')).toEqual({ name: 'scikit-learn', version: '1.3.0' });
  });

  it('identifies an npm dependency and an installed python package', () => {
    const ws = temp('ponder-ws-');
    const lodash = join(ws, 'node_modules', 'lodash');
    mkdirSync(lodash, { recursive: true });
    writeFileSync(join(lodash, 'package.json'), '{ "name": "lodash", "version": "4.17.21" }');
    expect(packageKeyForRoot(lodash, 'lodash')).toEqual({ ecosystem: 'npm', name: 'lodash', version: '4.17.21' });

    const sp = join(ws, '.venv', 'site-packages');
    mkdirSync(join(sp, 'sklearn'), { recursive: true });
    mkdirSync(join(sp, 'scikit_learn-1.3.0.dist-info'), { recursive: true });
    writeFileSync(join(sp, 'sklearn', '__init__.py'), '');
    writeFileSync(join(sp, 'scikit_learn-1.3.0.dist-info', 'top_level.txt'), 'sklearn\n');
    writeFileSync(join(sp, 'scikit_learn-1.3.0.dist-info', 'METADATA'), 'Name: scikit-learn\nVersion: 1.3.0\n');
    expect(packageKeyForRoot(join(sp, 'sklearn'), null)).toEqual({ ecosystem: 'pypi', name: 'scikit-learn', version: '1.3.0' });
  });

  it('treats packages in the workspace as the user\'s own code, dependencies not (Windows and POSIX paths)', () => {
    if (process.platform === 'win32') { // node:path is platform-specific: Windows paths only make sense there
      expect(isOwnCode('C:\\work\\app', ['C:\\work'])).toBe(true);
      expect(isOwnCode('C:\\work', ['C:\\work'])).toBe(true);
      expect(isOwnCode('c:\\work\\app', ['C:\\work'])).toBe(true);
      expect(isOwnCode('C:\\work\\node_modules\\lodash', ['C:\\work'])).toBe(false);
      expect(isOwnCode('C:\\work\\.venv\\Lib\\site-packages\\numpy', ['C:\\work'])).toBe(false);
      expect(isOwnCode('D:\\other\\lib', ['C:\\work'])).toBe(false);
    }
    expect(isOwnCode('/home/me/app/src', ['/home/me/app'])).toBe(true);
    expect(isOwnCode('/home/me/app/node_modules/x', ['/home/me/app'])).toBe(false);
    expect(isOwnCode('/home/me/.cargo/registry/serde', ['/home/me/app'])).toBe(false);
    expect(isOwnCode('/home/me/app-other', ['/home/me/app'])).toBe(false);
  });
});

describe('local folders', () => {
  beforeEach(() => clearLocalCache());

  it('finds a matching file and ignores files for other packages, broken files and non-ponder JSON', () => {
    const dir = temp('ponder-local-');
    writeFileSync(join(dir, 'other.json'), JSON.stringify(ponder('other', 'py:mathutils.abs', 'WRONG')));
    writeFileSync(join(dir, 'broken.json'), '{ "animations": oops');
    writeFileSync(join(dir, 'package.json'), '{ "name": "x" }');
    writeFileSync(join(dir, 'binary.json'), Buffer.from([0, 1, 2, 255]));
    const problems: string[] = [];
    expect(findInFolders([dir, join(dir, 'missing')], key, candidates, (_, p) => problems.push(p))).toBeNull();
    expect(problems).toHaveLength(1); // only the broken ponder-looking file is reported

    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'mathutils.json'), JSON.stringify(ponder('mathutils', 'py:mathutils.abs', 'MINE')));
    const hit = findInFolders([dir], key, candidates);
    expect(hit?.animation.title).toBe('MINE');
    expect(hit?.source).toBe('Local file · mathutils.json');
  });
});
