import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../src/cli/check';
import { descriptorParams } from '../src/node/classfile';
import { Jar } from '../src/node/jar';

const repo = join(__dirname, '../..');
const errors = (target: string) => check(target).filter((f) => f.severity === 'error');

const anim = (symbol: string) => ({
  symbol, title: 't', actors: { x: { type: 'circle', radius: 5 } }, slides: [{ caption: 'a' }, { changes: { x: { x: 1 } } }],
});

describe('ponder check', () => {
  it('accepts every demo library', () => {
    expect(errors(join(repo, 'examples/js-math-utils'))).toEqual([]);
    expect(errors(join(repo, 'examples/python/mathutils'))).toEqual([]);
    expect(errors(join(repo, 'examples/consumer/libs/math-utils-1.0.0.jar'))).toEqual([]);
    expect(check(join(repo, 'examples/js-math-utils')).filter((f) => f.severity === 'ok')).toHaveLength(11);
  });

  it('reports symbols that do not exist and a wrong library name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ponder-check-'));
    writeFileSync(join(dir, 'package.json'), '{"name":"mylib"}');
    writeFileSync(join(dir, 'index.js'), 'function clamp(v) { return v; }\nclass Stack { push(x) {} }\nmodule.exports = { clamp, Stack };');
    writeFileSync(join(dir, 'ponder.json'), JSON.stringify({
      version: 1, library: { name: 'other' },
      animations: { a: anim('js:mylib#clamp'), b: anim('js:mylib#clampp'), c: anim('js:mylib#Stack.push'), d: anim('js:mylib#Stack.pop') },
    }));
    const found = errors(dir).map((f) => f.where);
    expect(found).toEqual(['$.library.name', '$.animations.b.symbol', '$.animations.d.symbol']);
  });

  it('checks JVM parameter types against the class file', () => {
    const jar = Jar.open(join(repo, 'examples/consumer/libs/math-utils-1.0.0.jar'));
    const dir = mkdtempSync(join(tmpdir(), 'ponder-check-'));
    mkdirSync(join(dir, 'com/example/math'), { recursive: true });
    writeFileSync(join(dir, 'com/example/math/MathUtils.class'), jar.read('com/example/math/MathUtils.class')!);
    jar.close();
    writeFileSync(join(dir, 'ponder.json'), JSON.stringify({ version: 1, library: { name: 'math-utils' }, animations: {
      ok: anim('com.example.math.MathUtils#clamp(double,double,double)'),
      wrong: anim('com.example.math.MathUtils#clamp(long,long,long)'),
      missing: anim('com.example.math.Nope#f()'),
    } }));
    const byWhere = Object.fromEntries(check(dir).map((f) => [f.where, f]));
    expect(byWhere['$.animations.ok.symbol']?.severity).toBe('ok');
    expect(byWhere['$.animations.wrong.symbol']?.message).toContain('exists only as');
    expect(byWhere['$.animations.missing.symbol']?.severity).toBe('error');
  });

  it('reads JVM descriptors', () => {
    expect(descriptorParams('(I[Ljava/lang/String;J[[D)V')).toEqual(['int', 'java.lang.String[]', 'long', 'double[][]']);
    expect(descriptorParams('()I')).toEqual([]);
    expect(descriptorParams('(Lcom/x/Outer$Inner;)V')).toEqual(['com.x.Outer.Inner']);
  });
});
