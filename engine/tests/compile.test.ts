import { describe, expect, it } from 'vitest';
import { compileAnimation } from '../src/scene/compile';
import type { Animation } from '../src/scene/model';
import { demoAnimation, tiny } from './helpers';

describe('state inheritance', () => {
  it('carries unspecified properties forward and applies only what changed', () => {
    const c = compileAnimation('t', tiny([]));
    expect(c.scenes).toHaveLength(3);
    expect(c.scenes[0]!.actors.get('dot')!.x).toBe(0);
    expect(c.scenes[1]!.actors.get('dot')!.x).toBe(100);
    expect(c.scenes[1]!.actors.get('dot')!.fill).toBe('#ff0000'); // inherited
    expect(c.scenes[2]!.actors.get('dot')!.x).toBe(300);
    expect(c.scenes[2]!.actors.get('dot')!.fill).toBe('#0000ff');
    expect(c.scenes[2]!.actors.get('label')!.text).toBe('two'); // set in slide 1, untouched in slide 2
    expect(c.scenes[0]!.actors.get('label')!.text).toBe('one'); // earlier scenes are never mutated
  });
  it('applies type defaults', () => {
    const c = compileAnimation('t', tiny([]));
    const dot = c.scenes[0]!.actors.get('dot')!;
    expect(dot).toMatchObject({ rotation: 0, scale: 1, opacity: 1, visible: true, z: 0, strokeWidth: 2, stroke: 'none' });
    expect(c.scenes[0]!.actors.get('label')!.fill).toBe('text');
  });
  it('produces immutable scenes', () => {
    const c = compileAnimation('t', tiny([]));
    expect(Object.isFrozen(c.scenes)).toBe(true);
    expect(Object.isFrozen(c.scenes[0])).toBe(true);
    expect(Object.isFrozen(c.scenes[1]!.actors.get('dot'))).toBe(true);
    expect(() => { (c.scenes[1]!.actors.get('dot') as any).x = 9; }).toThrow();
  });
  it('is deterministic: compiling twice gives identical scenes', () => {
    const a = compileAnimation('t', demoAnimation());
    const b = compileAnimation('t', demoAnimation());
    const dump = (c: typeof a) => JSON.stringify(c.scenes.map((s) => [s.id, s.caption, [...s.actors]]));
    expect(dump(a)).toBe(dump(b));
  });
  it('does not mutate the input document', () => {
    const input = tiny([{ to: 's1' }]);
    const before = JSON.stringify(input);
    compileAnimation('t', input);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('resolves the demo: final slide state matches hand-computed values', () => {
    const c = compileAnimation('clamp-int', demoAnimation());
    expect(c.scenes.map((s) => s.id)).toEqual(['intro', 'too-small', 'clamped-low', 'too-large', 'clamped-high', 'inside']);
    const last = c.scenes[5]!.actors;
    expect(last.get('number')).toMatchObject({ x: 500, visible: true, fill: 'success' });
    expect(last.get('valueLabel')).toMatchObject({ x: 500, text: 'result = 6' });
    expect(last.get('push')!.visible).toBe(false);
  });
});

describe('transitions', () => {
  it('fills defaults: next + fluid + 600ms', () => {
    const c = compileAnimation('t', tiny([]));
    expect(c.transitions).toHaveLength(2);
    expect(c.transitions[0]).toMatchObject({ trigger: 'next', style: 'fluid', duration: 600, delay: 0, stagger: 0, from: 0, to: 1 });
  });
  it('auto transitions default to a short dwell delay', () => {
    const c = compileAnimation('t', tiny([{ to: 's1', trigger: 'auto' }]));
    expect(c.transitions[0]!.delay).toBe(500);
  });
  it('direct transitions have zero duration', () => {
    const c = compileAnimation('t', tiny([{ to: 's1', style: 'direct', duration: 999 }]));
    expect(c.transitions[0]).toMatchObject({ style: 'direct', duration: 0, span: 0 });
  });
  it('unlisted actors start with the first listed one; they do not stretch the span', () => {
    const c = compileAnimation('t', tiny([{ to: 's1', duration: 500, stagger: 100, order: ['label'] }]));
    expect(c.transitions[0]!.rank.get('label')).toBe(0);
    expect(c.transitions[0]!.rank.get('dot')).toBe(0);
    expect(c.transitions[0]!.span).toBe(500);
  });
  it('without order, stagger follows document order', () => {
    const c = compileAnimation('t', tiny([{ to: 's1', duration: 500, stagger: 100 }]));
    expect(c.transitions[0]!.span).toBe(600);
  });
  it('computes stagger rank and span from order', () => {
    const c = compileAnimation('t', tiny([{ to: 's1', duration: 500, stagger: 100, order: ['label', 'dot'] }]));
    expect(c.transitions[0]!.rank.get('label')).toBe(0);
    expect(c.transitions[0]!.rank.get('dot')).toBe(1);
    expect(c.transitions[0]!.span).toBe(600);
  });
});

describe('groups', () => {
  const grouped = (): Animation => ({
    symbol: 'a.B#c()', title: 'g',
    actors: {
      child: { type: 'circle', parent: 'g' },
      g: { type: 'group', x: 10 },
    },
    slides: [{ id: 'a' }],
  });
  it('orders parents before children regardless of declaration order', () => {
    const c = compileAnimation('t', grouped());
    expect(c.actorOrder.indexOf('g')).toBeLessThan(c.actorOrder.indexOf('child'));
    expect(c.meta.get('child')!.parent).toBe('g');
  });
});
