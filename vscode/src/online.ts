// Client of the Ponder online index (protocol: docs/online-index.md, shared rules in
// engine/src/sources/index-protocol.ts). Same behaviour as the JetBrains plugin's OnlineIndex.kt:
//  - found, or "no animations for this package" (404): cached for FRESH_MS;
//  - network or server problems: remembered for RETRY_MS, and an older good copy keeps working meanwhile.
// No vscode import, so it can be unit-tested. Nothing here throws to callers.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  ECOSYSTEMS, INDEX_FORMAT, MAX_INDEX_BYTES, indexPath, normalizeBaseUrl, parseIndexFile, versionInRange,
  type Ecosystem, type PackageKey, type ParsedIndex,
} from '../../engine/src/sources/index-protocol';
import { loadDocument, type AnimationRef } from './match';

export const FRESH_MS = 24 * 60 * 60 * 1000;
export const RETRY_MS = 15 * 60 * 1000;

export type Lookup =
  | { kind: 'index'; parsed: ParsedIndex; fetchedAt: number }
  | { kind: 'absent'; fetchedAt: number }
  | { kind: 'failed'; reason: string; fetchedAt: number; previous: Extract<Lookup, { kind: 'index' }> | null };

/** Body of a 2xx response, null for 404/410; rejects with a FetchError for anything else. */
export type Fetcher = (url: string, maxBytes: number) => Promise<string | null>;

export class FetchError extends Error {
  constructor(readonly friendly: string) { super(friendly); }
}

export interface Hit { animation: AnimationRef; documentText: string; source: string }

/** An index served from this machine, for testing before publishing. */
export function isLocalBase(base: string): boolean {
  const b = normalizeBaseUrl(base);
  return b !== null && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(b);
}

export function urlFor(base: string, key: Pick<PackageKey, 'ecosystem' | 'name'>): string | null {
  const b = normalizeBaseUrl(base);
  const p = indexPath(key);
  return b && p ? b + p : null;
}

/** The first animation in a lookup that fits the installed version and one of [candidates]. */
export function findInLookup(lookup: Lookup | null, key: PackageKey, candidates: string[]): Hit | null {
  const index = !lookup ? null : lookup.kind === 'index' ? lookup : lookup.kind === 'failed' ? lookup.previous : null;
  if (!index) return null;
  for (const d of index.parsed.documents) {
    if (!versionInRange(key.version, d.versions)) continue;
    const doc = loadDocument(d.text);
    const animation = doc.ok ? doc.find(candidates) : null;
    if (animation) return { animation, documentText: d.text, source: `Community index · ${key.ecosystem}/${key.name}` };
  }
  return null;
}

interface Entry { lookup: Lookup; body: string | null }

export class OnlineIndex {
  private readonly memory = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Lookup>>();

  constructor(
    private readonly cacheDir: string,
    private readonly fetcher: Fetcher = httpsFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cached knowledge, fresh or stale. Never touches the network. */
  cached(base: string, key: PackageKey): Lookup | null {
    const url = urlFor(base, key);
    if (!url) return null;
    const m = this.memory.get(url);
    if (m) return m.lookup;
    const d = this.readDisk(url);
    if (d) this.memory.set(url, d);
    return d?.lookup ?? null;
  }

  needsFetch(base: string, key: PackageKey): boolean {
    const c = this.cached(base, key);
    if (!c) return urlFor(base, key) !== null;
    if (isLocalBase(base)) return true; // a test index on this machine: always pick up the latest edit
    const age = this.now() - c.fetchedAt;
    if (age < 0) return true;
    return c.kind === 'failed' ? age > RETRY_MS : age > FRESH_MS;
  }

  /**
   * Brings a stale cached copy up to date for next time, without waiting. Used after an animation was shown from
   * the cache, so a fixed or updated index file reaches people who already looked once. Never throws or rejects.
   */
  refreshInBackground(base: string, key: PackageKey): void {
    try {
      if (this.needsFetch(base, key)) this.fetch(base, key).catch(() => { /* the cached copy stays in use */ });
    } catch { /* the cached copy stays in use */ }
  }

  /** Fetches the package's index file; concurrent calls for one package share one request. */
  fetch(base: string, key: PackageKey): Promise<Lookup> {
    const url = urlFor(base, key);
    if (!url) return Promise.resolve({ kind: 'failed', reason: 'not a valid package name or index address', fetchedAt: this.now(), previous: null });
    const running = this.inflight.get(url);
    if (running) return running;
    const p = this.doFetch(url, base, key).finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }

  private async doFetch(url: string, base: string, key: PackageKey): Promise<Lookup> {
    if (!this.needsFetch(base, key)) return this.cached(base, key)!;
    const before = this.cached(base, key);
    const previous = before?.kind === 'index' ? before : before?.kind === 'failed' ? before.previous : null;
    const at = this.now();
    let entry: Entry;
    try {
      const body = await this.fetcher(url, MAX_INDEX_BYTES);
      if (body === null) entry = { lookup: { kind: 'absent', fetchedAt: at }, body: null };
      else {
        const parsed = parseIndexFile(body, key);
        entry = parsed.ok
          ? { lookup: { kind: 'index', parsed, fetchedAt: at }, body }
          : { lookup: { kind: 'failed', reason: `the index file for ${key.name} is broken`, fetchedAt: at, previous }, body: null };
      }
    } catch (e) {
      const reason = e instanceof FetchError ? e.friendly : 'the index could not be reached';
      entry = { lookup: { kind: 'failed', reason, fetchedAt: at, previous }, body: null };
    }
    this.memory.set(url, entry);
    this.writeDisk(url, entry);
    return entry.lookup;
  }

  clear(): void {
    this.memory.clear();
    try { for (const f of readdirSync(this.cacheDir)) rmSync(join(this.cacheDir, f), { force: true }); } catch { /* nothing cached */ }
  }

  // ------------------------------------------------------------------ disk cache

  private file(url: string): string {
    return join(this.cacheDir, `${createHash('sha256').update(url).digest('hex')}.json`);
  }

  private writeDisk(url: string, entry: Entry): void {
    try {
      const target = this.file(url);
      // a failure must not overwrite a good copy: the good copy is what works offline
      if (entry.lookup.kind === 'failed') { try { statSync(target); return; } catch { /* no copy yet */ } }
      mkdirSync(this.cacheDir, { recursive: true });
      const record = {
        v: 1, url, at: entry.lookup.fetchedAt,
        status: entry.lookup.kind === 'index' ? 'ok' : entry.lookup.kind,
        body: entry.body ?? undefined,
        reason: entry.lookup.kind === 'failed' ? entry.lookup.reason : undefined,
      };
      const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(tmp, JSON.stringify(record));
      renameSync(tmp, target);
    } catch { /* read-only or full disk: no offline copy, nothing else */ }
  }

  private readDisk(url: string): Entry | null {
    const file = this.file(url);
    try {
      if (statSync(file).size > MAX_INDEX_BYTES * 2) return null;
      const o = JSON.parse(readFileSync(file, 'utf8')) as { v?: number; url?: string; at?: number; status?: string; body?: string; reason?: string };
      if (o.v !== 1 || o.url !== url || typeof o.at !== 'number') throw new Error('stale format');
      if (o.status === 'ok' && typeof o.body === 'string') {
        const key = keyFromUrl(url);
        if (!key) throw new Error('bad url');
        const parsed = parseIndexFile(o.body, key);
        if (!parsed.ok) throw new Error('bad body');
        return { lookup: { kind: 'index', parsed, fetchedAt: o.at }, body: o.body };
      }
      if (o.status === 'absent') return { lookup: { kind: 'absent', fetchedAt: o.at }, body: null };
      if (o.status === 'failed') return { lookup: { kind: 'failed', reason: o.reason ?? 'unavailable', fetchedAt: o.at, previous: null }, body: null };
      throw new Error('unknown status');
    } catch (e) {
      // missing file is normal; anything else is a corrupt entry: drop it and fetch again later
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') { try { rmSync(file, { force: true }); } catch { /* ignore */ } }
      return null;
    }
  }
}

function keyFromUrl(url: string): Pick<PackageKey, 'ecosystem' | 'name'> | null {
  const marker = `/v${INDEX_FORMAT}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const path = url.slice(i + marker.length).replace(/\.json$/, '');
  const slash = path.indexOf('/');
  const ecosystem = path.slice(0, slash) as Ecosystem;
  const rest = path.slice(slash + 1);
  if (slash < 0 || !(ECOSYSTEMS as readonly string[]).includes(ecosystem) || !rest) return null;
  return { ecosystem, name: ecosystem === 'maven' ? rest.replace('/', ':') : rest };
}

// ------------------------------------------------------------------ transport

/**
 * https GET through Node's http(s) modules, which VS Code routes through its proxy settings. Short timeouts, a
 * size cap, at most 3 redirects and only to https (or to this machine when testing a local index).
 */
export const httpsFetcher: Fetcher = (url, maxBytes) => get(url, maxBytes, 0);

function get(url: string, maxBytes: number, redirects: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { reject(new FetchError('not a valid index address')); return; }
    if (!normalizeBaseUrl(`${u.protocol}//${u.host}/`)) { reject(new FetchError('the index address is not secure (https)')); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'user-agent': 'Ponder for VS Code', accept: 'application/json' }, timeout: 6000 }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) { reject(new FetchError('the index redirected too often')); return; }
        let next: string;
        try { next = new URL(res.headers.location, u).toString(); } catch { reject(new FetchError('the index sent a broken redirect')); return; }
        get(next, maxBytes, redirects + 1).then(resolve, reject);
        return;
      }
      if (status === 404 || status === 410) { res.resume(); resolve(null); return; }
      if (status < 200 || status >= 300) { res.resume(); reject(new FetchError(`the index answered with error ${status}`)); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new FetchError('the index file is too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', () => reject(new FetchError('the index could not be reached')));
    });
    req.on('timeout', () => { req.destroy(); reject(new FetchError('the index did not answer in time')); });
    req.on('error', (e: NodeJS.ErrnoException) => {
      reject(new FetchError(e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? 'you seem to be offline'
        : e.code === 'ECONNREFUSED' ? 'the index could not be reached' : 'the index could not be reached'));
    });
  });
}
