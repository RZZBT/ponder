import { describe, expect, it } from 'vitest';
import { DARK_PALETTE, lerpColor, parseHex, resolveColor } from '../src/animation/color';
import { makeEasing } from '../src/animation/easing';
import { blendActor, frameAt, sceneFrame, toVisual, type VisualActor } from '../src/animation/interpolate';
import { compileAnimation } from '../src/scene/compile';
import { BASE_STATE } from '../src/parser/props';
import { tiny } from './helpers';

const actor = (over: Partial<VisualActor> = {}): VisualActor => ({ ...toVisual(BASE_STATE, DARK_PALETTE), ...over });

describe('easing', () => {
  it('hits the end points exactly for every named easing', () => {
    for (const name of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back-out']) {
      const f = makeEasing(name);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
    }
  });
  it('linear is identity; default is symmetric and smooth', () => {
    expect(makeEasing('linear')(0.3)).toBeCloseTo(0.3, 6);
    const d = makeEasing(undefined);
    expect(d(0.5)).toBeCloseTo(0.5, 3);
    expect(d(0.25)).toBeLessThan(0.25); // slow start
    expect(d(0.75)).toBeGreaterThan(0.75); // slow finish
  });
  it('is monotonic for ease-in-out and accepts custom béziers', () => {
    const f = makeEasing('ease-in-out');
    let prev = 0;
    for (let i = 1; i <= 100; i++) { const v = f(i / 100); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(makeEasing([0.25, 0.1, 0.25, 1])(0.5)).toBeGreaterThan(0.5);
  });
  it('back-out overshoots but settles on 1', () => {
    const f = makeEasing('back-out');
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => f((i + 1) / 100)))).toBeGreaterThan(1);
    expect(f(1)).toBe(1);
  });
  it('clamps out-of-range input', () => {
    const f = makeEasing('ease-out');
    expect(f(-5)).toBe(0);
    expect(f(7)).toBe(1);
  });
});

describe('colors', () => {
  it('parses all hex forms and resolves tokens through the palette', () => {
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseHex('#ff000080')!.a).toBeCloseTo(0.5, 1);
    expect(resolveColor('accent', DARK_PALETTE)).toEqual(parseHex(DARK_PALETTE.accent!));
    expect(resolveColor('none', DARK_PALETTE).a).toBe(0);
    expect(resolveColor('garbage', DARK_PALETTE).a).toBe(0);
  });
  it('interpolates halfway', () => {
    expect(lerpColor('#000000', '#ffffff', 0.5, DARK_PALETTE)).toBe('rgb(128,128,128)');
  });
  it('fades to/from none instead of passing through black', () => {
    expect(lerpColor('none', '#ff0000', 0.5, DARK_PALETTE)).toBe('rgba(255,0,0,0.5)');
    expect(lerpColor('#00ff00', 'none', 0.5, DARK_PALETTE)).toBe('rgba(0,255,0,0.5)');
  });
});

describe('blendActor', () => {
  it('returns the exact end states by identity at t<=0 and t>=1', () => {
    const a = actor({ x: 0 }), b = actor({ x: 100 });
    expect(blendActor(a, b, 0)).toBe(a);
    expect(blendActor(a, b, 1)).toBe(b);
    expect(blendActor(a, b, 7)).toBe(b);
  });
  it('interpolates numbers, rotation, scale and colors', () => {
    const a = actor({ x: 0, rotation: 0, scale: 1, width: 10, fill: parseHex('#000000')! });
    const b = actor({ x: 100, rotation: 90, scale: 3, width: 30, fill: parseHex('#ffffff')! });
    const m = blendActor(a, b, 0.5);
    expect(m).toMatchObject({ x: 50, rotation: 45, scale: 2, width: 20 });
    expect(m.fill.r).toBeCloseTo(127.5, 5);
  });
  it('an appearing actor fades in at its final position (no slide-in from nowhere)', () => {
    const hidden = actor({ x: 0, opacity: 0 }), shown = actor({ x: 500, opacity: 1 });
    const m = blendActor(hidden, shown, 0.4);
    expect(m.x).toBe(500);
    expect(m.opacity).toBeCloseTo(0.4, 6);
  });
  it('a disappearing actor fades out in place', () => {
    const shown = actor({ x: 100, opacity: 1 }), gone = actor({ x: 900, opacity: 0 });
    const m = blendActor(shown, gone, 0.25);
    expect(m.x).toBe(100);
    expect(m.opacity).toBeCloseTo(0.75, 6);
    expect(blendActor(shown, gone, 1)).toBe(gone); // ... and the end state is still exactly the target
  });
  it('visible:false folds into opacity 0', () => {
    expect(toVisual({ ...BASE_STATE, visible: false, opacity: 0.8 }, DARK_PALETTE).opacity).toBe(0);
  });
  it('switches discrete properties (text, z, anchor) at the midpoint', () => {
    const a = actor({ text: 'a', z: 0, anchor: 'start' }), b = actor({ text: 'b', z: 5, anchor: 'end' });
    expect(blendActor(a, b, 0.49)).toMatchObject({ text: 'a', z: 0, anchor: 'start' });
    expect(blendActor(a, b, 0.5)).toMatchObject({ text: 'b', z: 5, anchor: 'end' });
  });
  it('interpolates polygons with matching point counts', () => {
    const a = actor({ points: [[0, 0], [10, 0], [0, 10]] }), b = actor({ points: [[0, 0], [20, 0], [0, 20]] });
    expect(blendActor(a, b, 0.5).points).toEqual([[0, 0], [15, 0], [0, 15]]);
  });
  it('falls back to a shape switch (never malformed geometry) when point counts differ', () => {
    const tri = actor({ points: [[0, 0], [10, 0], [0, 10]] });
    const quad = actor({ points: [[0, 0], [10, 0], [10, 10], [0, 10]] });
    expect(blendActor(tri, quad, 0.3).points).toEqual(tri.points);
    expect(blendActor(tri, quad, 0.7).points).toEqual(quad.points);
    for (const t of [0.1, 0.5, 0.9]) {
      for (const p of blendActor(tri, quad, t).points) expect(p.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('frameAt with stagger', () => {
  it('starts actors one after another in the given order', () => {
    const c = compileAnimation('t', tiny([{ to: 's1', duration: 400, stagger: 200, easing: 'linear', order: ['label', 'dot'] }]));
    const from = sceneFrame(c.scenes[0]!, DARK_PALETTE), to = sceneFrame(c.scenes[1]!, DARK_PALETTE);
    const ease = makeEasing('linear');
    const t = c.transitions[0]!;
    // t=200ms: label (rank 0) is 50% done, dot (rank 1) has not started
    const mid = frameAt(from, to, t, ease, 200);
    expect(mid.get('dot')!.x).toBe(0);
    // t=400ms: label finished (text switched), dot half way
    const later = frameAt(from, to, t, ease, 400);
    expect(later.get('label')!.text).toBe('two');
    expect(later.get('dot')!.x).toBeCloseTo(50, 6);
    // t=span: everything exactly on target
    const end = frameAt(from, to, t, ease, t.span);
    expect(end.get('dot')).toBe(to.get('dot'));
  });
});
