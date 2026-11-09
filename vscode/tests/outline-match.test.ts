import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanName, outlineParams } from '../src/outline';
import { loadDocument, looseJvm } from '../src/match';
import { Jar, pomCoordinates } from '../../engine/src/node/jar';

describe('outline names', () => {
  it('strips what language servers add', () => {
    expect(cleanName('clamp(int, int, int) : int')).toEqual(['clamp']);
    expect(cleanName('(*IntStack).Push')).toEqual(['IntStack', 'Push']);
    expect(cleanName('(IntStack).Len')).toEqual(['IntStack', 'Len']);
    expect(cleanName('impl IntStack')).toEqual(['IntStack']);
    expect(cleanName('impl<T> Display for Stack<T>')).toEqual(['Stack']);
    expect(cleanName('IntStack::push')).toEqual(['IntStack', 'push']);
    expect(cleanName('List<T>')).toEqual(['List']);
    expect(cleanName('push')).toEqual(['push']);
    expect(cleanName('IntStack:push')).toEqual(['IntStack', 'push']);
  });

  it('reads Java parameter types', () => {
    expect(outlineParams('clamp(int, int, int) : int')).toEqual(['int', 'int', 'int']);
    expect(outlineParams('join(String...) : String')).toEqual(['String[]']);
    expect(outlineParams('size() : int')).toEqual([]);
    expect(outlineParams('IntStack')).toBeNull();
  });
});

const doc = (animations: Record<string, { symbol: string; aliases?: string[] }>) => JSON.stringify({
  version: 1,
  library: { name: 'math-utils' },
  animations: Object.fromEntries(Object.entries(animations).map(([id, a]) => [id, {
    ...a, title: id, actors: { x: { type: 'circle', radius: 5 } }, slides: [{ caption: 'a' }, { changes: { x: { x: 1 } } }],
  }])),
});

describe('matching', () => {
  it('matches exact symbols and ignores the jvm: prefix', () => {
    const d = loadDocument(doc({ a: { symbol: 'jvm:p.C#m(int)' }, b: { symbol: 'py:m.f', aliases: ['sym:m.py:f'] } }));
    expect(d.find(['p.C#m(int)'])?.id).toBe('a');
    expect(d.find(['sym:m.py:f'])?.id).toBe('b');
    expect(d.find(['py:m.g'])).toBeNull();
  });

  it('matches JVM parameters by simple name only when asked to', () => {
    const d = loadDocument(doc({ a: { symbol: 'p.C#join(java.lang.String[],int)' } }));
    expect(looseJvm('p.C#join(java.lang.String[],int)')).toBe('p.C#join(String[],int)');
    expect(d.find(['p.C#join(String[],int)'])).toBeNull();
    expect(d.find(['p.C#join(String[],int)'], true)?.id).toBe('a');
  });

  it('matches C++ without parameters when there is one overload', () => {
    expect(loadDocument(doc({ a: { symbol: 'cpp:m::clamp(int,int,int)' } })).find(['cpp:m::clamp'])?.id).toBe('a');
    const two = loadDocument(doc({ a: { symbol: 'cpp:m::clamp(int)' }, b: { symbol: 'cpp:m::clamp(double)' } }));
    expect(two.find(['cpp:m::clamp'])).toBeNull();
  });

  it('reports invalid files', () => {
    const d = loadDocument('{"version": 2}');
    expect(d.ok).toBe(false);
    expect(d.errors.length).toBeGreaterThan(0);
  });
});

describe('jar reader', () => {
  it('reads stored and deflated entries', () => {
    const entries: [string, Buffer, number][] = [
      ['META-INF/ponder/ponder.json', Buffer.from('{"version":1}'), 8],
      ['META-INF/maven/com.example/math-utils/pom.properties', Buffer.from('groupId=com.example\nartifactId=math-utils\n'), 0],
    ];
    const local: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, data, method] of entries) {
      const body = method === 8 ? deflateRawSync(data) : data;
      const n = Buffer.from(name);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
      local.push(lh, n, body);
      central.push(ch, n);
      offset += 30 + n.length + body.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    const path = join(mkdtempSync(join(tmpdir(), 'ponder-jar-')), 't.jar');
    writeFileSync(path, Buffer.concat([...local, cd, eocd]));

    const jar = Jar.open(path);
    try {
      expect(jar.readText('META-INF/ponder/ponder.json')).toBe('{"version":1}');
      expect(pomCoordinates(jar)).toEqual([{ group: 'com.example', name: 'math-utils' }]);
      expect(jar.readText('missing')).toBeNull();
    } finally { jar.close(); }
  });
});
