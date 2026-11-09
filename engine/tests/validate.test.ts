import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/parser/limits';
import { isValidSymbol, parseDocument, validateDocument } from '../src/parser/validate';
import { demoDoc, demoText } from './helpers';

const schema = JSON.parse(readFileSync(resolve(__dirname, '../../schema/ponder.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaValidate = ajv.compile(schema);

const minimal = (): any => ({
  version: 1,
  library: { group: 'g', name: 'n' },
  animations: {
    a: {
      symbol: 'p.C#m(int)', title: 't',
      actors: { x: { type: 'circle' } },
      slides: [{ id: 's1' }, { id: 's2', changes: { x: { x: 5 } } }],
    },
  },
});
const anim = (d: any) => d.animations.a;
const errorsOf = (d: unknown) => validateDocument(d).errors.map((e) => `${e.path}: ${e.message}`);

describe('demo document', () => {
  it('passes the engine validator', () => {
    const r = parseDocument(demoText());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('passes the JSON schema', () => {
    const ok = schemaValidate(demoDoc());
    expect(schemaValidate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe('schema agrees with validator on structural mistakes', () => {
  const cases: Array<[string, (d: any) => void]> = [
    ['unknown actor type', (d) => (anim(d).actors.x.type = 'star')],
    ['bad color', (d) => (anim(d).actors.x.fill = 'blue')],
    ['wrong property for type', (d) => (anim(d).actors.x.width = 5)],
    ['missing slides', (d) => delete anim(d).slides],
    ['bad symbol', (d) => (anim(d).symbol = 'clamp')],
    ['bad trigger', (d) => (anim(d).transitions = [{ to: 's2', trigger: 'sometimes' }])],
    ['wrong version', (d) => (d.version = 2)],
  ];
  for (const [name, mutate] of cases) {
    it(name, () => {
      const d = minimal();
      mutate(d);
      expect(schemaValidate(d)).toBe(false);
      expect(validateDocument(d).ok).toBe(false);
    });
  }
  it('minimal document is valid in both', () => {
    expect(schemaValidate(minimal())).toBe(true);
    expect(validateDocument(minimal()).ok).toBe(true);
  });
});

describe('helpful errors', () => {
  it('points at the exact path and suggests the right name', () => {
    const d = minimal();
    anim(d).slides[1].changes.x = { strokWidth: 3 };
    const e = errorsOf(d).join('\n');
    expect(e).toContain('animations.a.slides[1].changes.x.strokWidth');
    expect(e).toContain('Did you mean "strokeWidth"?');
  });
  it('explains a type mismatch', () => {
    const d = minimal();
    anim(d).actors.x.x = '250';
    expect(errorsOf(d)[0]).toBe('$.animations.a.actors.x.x: Expected a number but found the string "250".');
  });
  it('rejects unknown slide references with a suggestion', () => {
    const d = minimal();
    anim(d).transitions = [{ to: 's22' }];
    expect(errorsOf(d)[0]).toContain('Unknown slide "s22". Did you mean "s2"?');
  });
  it('rejects unknown actors in changes', () => {
    const d = minimal();
    anim(d).slides[1].changes = { ghost: { x: 1 } };
    expect(errorsOf(d)[0]).toContain('Unknown actor "ghost"');
  });
  it('rejects changing declaration-only keys', () => {
    const d = minimal();
    anim(d).slides[1].changes.x.type = 'rectangle';
    expect(errorsOf(d)[0]).toContain('cannot change between slides');
  });
  it('requires version 1', () => {
    const d = minimal();
    delete d.version;
    expect(errorsOf(d)[0]).toContain('Add "version": 1');
  });
  it('transition "from" must be the preceding slide', () => {
    const d = minimal();
    anim(d).slides.push({ id: 's3' });
    anim(d).transitions = [{ from: 's1', to: 's3' }];
    expect(errorsOf(d)[0]).toContain('can only be reached from the slide just before it ("s2")');
  });
  it('detects group cycles, non-group parents and missing parents', () => {
    const d = minimal();
    anim(d).actors = {
      g1: { type: 'group', parent: 'g2' }, g2: { type: 'group', parent: 'g1' },
      c: { type: 'circle', parent: 'nope' }, d: { type: 'circle', parent: 'c' },
    };
    const e = errorsOf(d).join('\n');
    expect(e).toContain('cycle');
    expect(e).toContain('not a declared actor');
    expect(e).toContain('only "group" actors can contain');
  });
});

describe('symbols', () => {
  it.each([
    'com.example.math.MathUtils#clamp(int,int,int)',
    'a.B#c()', 'Main#run()', 'a.B#<init>(java.lang.String,int[])', 'a.B.Inner#m(java.util.List)', 'a.B#m(double[][])',
  ])('accepts %s', (s) => expect(isValidSymbol(s)).toBe(true));
  it.each([
    'clamp', 'a.B#c(int, int)', 'a.B#c(String)', 'a.B#c(', 'a.B#(int)', 'a.B#c(int)extra', '',
  ])('rejects %j', (s) => expect(isValidSymbol(s)).toBe(false));
  it('rejects the same symbol bound twice (also via aliases)', () => {
    const d = minimal();
    d.animations.b = { ...anim(d), symbol: 'p.C#m(int)' };
    expect(errorsOf(d).join('\n')).toContain('already bound');
    const e = minimal();
    anim(e).aliases = ['p.C#m(int)'];
    expect(errorsOf(e).join('\n')).toContain('already bound');
  });
});

describe('limits and hostile input', () => {
  it('rejects oversized files before parsing', () => {
    const r = parseDocument(' '.repeat(LIMITS.maxFileBytes + 1));
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toContain('too large');
  });
  it('reports malformed JSON without throwing', () => {
    const r = parseDocument('{ "version": 1, ');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toContain('Not valid JSON');
  });
  it.each([null, 5, 'x', [], true])('rejects non-object root %j', (v) => {
    expect(validateDocument(v).ok).toBe(false);
  });
  it('rejects too many actors / slides / polygon points / long text', () => {
    let d = minimal();
    anim(d).actors = Object.fromEntries(Array.from({ length: LIMITS.maxActors + 1 }, (_, i) => [`a${i}`, { type: 'circle' }]));
    expect(errorsOf(d).join('\n')).toContain('Too many actors');
    d = minimal();
    anim(d).slides = Array.from({ length: LIMITS.maxSlides + 1 }, (_, i) => ({ id: `s${i}` }));
    expect(errorsOf(d).join('\n')).toContain('Too many slides');
    d = minimal();
    anim(d).actors.p = { type: 'polygon', points: Array.from({ length: LIMITS.maxPolygonPoints + 1 }, () => [0, 0]) };
    expect(errorsOf(d).join('\n')).toContain('at most 64 points');
    d = minimal();
    anim(d).actors.t = { type: 'text', text: 'x'.repeat(LIMITS.maxTextLength + 1) };
    expect(errorsOf(d).join('\n')).toContain('too long');
  });
  it('rejects out-of-range and non-finite numbers', () => {
    const d = minimal();
    anim(d).actors.x.radius = 1e9;
    anim(d).actors.x.opacity = 2;
    anim(d).transitions = [{ to: 's2', duration: LIMITS.maxDurationMs + 1 }];
    const e = errorsOf(d).join('\n');
    expect(e).toContain('radius: 1000000000 is out of range');
    expect(e).toContain('opacity: 2 is out of range');
    expect(e).toContain('duration');
  });
  it('rejects reserved ids such as __proto__ and constructor', () => {
    const text = '{"version":1,"library":{"group":"g","name":"n"},"animations":{"a":{"symbol":"p.C#m()","title":"t","actors":{"__proto__":{"type":"circle"},"constructor":{"type":"circle"}},"slides":[{"id":"s"}]}}}';
    const r = parseDocument(text);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.message).join('\n')).toContain('reserved');
    expect(({} as any).type).toBeUndefined(); // no prototype pollution
  });
  it('limits total running time', () => {
    const d = minimal();
    anim(d).slides = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}` }));
    anim(d).transitions = Array.from({ length: 29 }, (_, i) => ({ to: `s${i + 1}`, duration: 9000, delay: 9000 }));
    expect(errorsOf(d).join('\n')).toContain('Total animation time');
  });
  it('accepts HTML-looking text as inert data (the renderer never parses it)', () => {
    const d = minimal();
    anim(d).actors.t = { type: 'text', text: '<img src=x onerror=alert(1)>' };
    expect(validateDocument(d).ok).toBe(true);
  });
  it('never throws on garbage', () => {
    const junk = [
      { version: 1, library: 5 },
      { version: 1, library: {}, animations: 7 },
      { version: 1, library: {}, animations: { a: 1 } },
      { version: 1, library: {}, animations: { a: { actors: [], slides: {}, transitions: 3 } } },
    ];
    for (const j of junk) expect(() => validateDocument(j)).not.toThrow();
  });
});
