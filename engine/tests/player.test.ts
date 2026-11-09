import { describe, expect, it, vi } from 'vitest';
import { DARK_PALETTE } from '../src/animation/color';
import { sceneFrame } from '../src/animation/interpolate';
import { Player } from '../src/player/player';
import { compileAnimation } from '../src/scene/compile';
import type { Animation } from '../src/scene/model';
import { FakeScheduler, RecordingRenderer, demoAnimation, tiny } from './helpers';

const LIN = 'linear' as const;
function setup(a: Animation, opts: ConstructorParameters<typeof Player>[1] = {}) {
  const renderer = new RecordingRenderer();
  const scheduler = new FakeScheduler();
  const player = new Player(renderer, { scheduler, ...opts });
  player.load(a, 't');
  const dotX = () => renderer.last.get('dot')!.x;
  return { renderer, scheduler, player, dotX, snap: () => player.getSnapshot()! };
}

/** s0 -auto(100ms dwell, 400ms fluid)-> s1 -next(400ms fluid)-> s2 */
const autoThenNext = () => tiny([
  { to: 's1', trigger: 'auto', delay: 100, duration: 400, easing: LIN },
  { to: 's2', trigger: 'next', duration: 400, easing: LIN },
]);

describe('automatic transitions', () => {
  it('waits for the delay, interpolates, then stops at a next-trigger', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    expect(snap()).toMatchObject({ index: 0, status: 'playing', awaitingUser: false });
    player.advance(99);
    expect(dotX()).toBe(0); // still dwelling
    player.advance(1 + 200); // delay over, 200 of 400 ms tweened
    expect(dotX()).toBeCloseTo(50, 6);
    expect(snap()).toMatchObject({ transitioning: true, status: 'playing' });
    player.advance(200);
    expect(dotX()).toBe(100);
    expect(snap()).toMatchObject({ index: 1, status: 'waiting', awaitingUser: true, transitioning: false });
    player.advance(60_000);
    expect(dotX()).toBe(100); // never moves on without the user
    expect(snap().index).toBe(1);
  });

  it('carries leftover time across chained auto transitions', () => {
    const a = tiny([
      { to: 's1', trigger: 'auto', delay: 0, duration: 100, easing: LIN },
      { to: 's2', trigger: 'auto', delay: 0, duration: 100, easing: LIN },
    ]);
    const { player, dotX, snap } = setup(a);
    player.advance(150); // 100 for the first, 50 into the second
    expect(snap().index).toBe(1);
    expect(dotX()).toBeCloseTo(100 + 0.5 * 200, 6);
    player.advance(50);
    expect(snap()).toMatchObject({ index: 2, status: 'finished' });
    expect(dotX()).toBe(300);
  });

  it('ends exactly on the target slide state (no interpolation residue)', () => {
    const c = compileAnimation('t', autoThenNext());
    const { player, renderer } = setup(autoThenNext());
    player.advance(100 + 400);
    const target = sceneFrame(c.scenes[1]!, DARK_PALETTE);
    expect([...renderer.last]).toEqual([...target]);
  });
});

describe('user-triggered transitions', () => {
  it('next() starts a fluid transition immediately and skips the dwell delay', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.next(); // during the 100 ms dwell
    expect(snap().transitioning).toBe(true);
    player.advance(200);
    expect(dotX()).toBeCloseTo(50, 6);
  });

  it('next() during a running transition completes it instantly', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.advance(100 + 100);
    expect(dotX()).toBeCloseTo(25, 6);
    player.next();
    expect(dotX()).toBe(100);
    expect(snap()).toMatchObject({ index: 1, transitioning: false });
  });

  it('a next-trigger transition waits, then animates when next() is pressed', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.advance(500);
    expect(snap().index).toBe(1);
    player.next();
    player.advance(200);
    expect(dotX()).toBeCloseTo(200, 6); // 100 -> 300, linear, halfway
    player.advance(200);
    expect(dotX()).toBe(300);
    expect(snap()).toMatchObject({ index: 2, status: 'finished' });
    player.next(); // nothing after the last slide
    expect(snap().index).toBe(2);
  });
});

describe('direct transitions', () => {
  it('switch instantly with no in-between frame', () => {
    const a = tiny([{ to: 's1', style: 'direct' }, { to: 's2', style: 'direct' }]);
    const { player, renderer, dotX, snap } = setup(a);
    const before = renderer.frames.length;
    player.next();
    expect(dotX()).toBe(100);
    expect(renderer.frames.length).toBe(before + 1); // exactly one render: the target
    expect(snap().transitioning).toBe(false);
  });
  it('an auto + direct transition still honours the dwell delay', () => {
    const a = tiny([{ to: 's1', trigger: 'auto', style: 'direct', delay: 300 }]);
    const { player, dotX } = setup(a);
    player.advance(299);
    expect(dotX()).toBe(0);
    player.advance(1);
    expect(dotX()).toBe(100);
  });
});

describe('pause / play', () => {
  it('freezes a running transition and resumes where it stopped', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.advance(100 + 100);
    player.pause();
    expect(snap().status).toBe('paused');
    player.advance(10_000);
    expect(dotX()).toBeCloseTo(25, 6);
    player.play();
    player.advance(100);
    expect(dotX()).toBeCloseTo(50, 6);
  });
  it('autoplay:false waits for play()', () => {
    const { player, dotX, snap } = setup(autoThenNext(), { autoplay: false });
    player.advance(5000);
    expect(dotX()).toBe(0);
    expect(snap().status).toBe('paused');
    player.play();
    player.advance(100 + 400);
    expect(dotX()).toBe(100);
  });
  it('a user-triggered step still plays while paused, but timers do not carry on afterwards', () => {
    const a = tiny([{ to: 's1', duration: 200, easing: LIN }, { to: 's2', trigger: 'auto', delay: 0, duration: 200, easing: LIN }]);
    const { player, dotX, snap } = setup(a);
    player.pause();
    player.next();
    player.advance(100);
    expect(dotX()).toBeCloseTo(50, 6);
    player.advance(100);
    expect(snap().index).toBe(1);
    player.advance(5000);
    expect(snap().index).toBe(1); // auto transition 1->2 is held back while paused
    player.play();
    player.advance(200);
    expect(snap().index).toBe(2);
  });
  it('play() while waiting for a user-triggered step continues with that step', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.advance(500);
    expect(snap()).toMatchObject({ index: 1, status: 'waiting' });
    player.play();
    player.advance(400);
    expect(dotX()).toBe(300);
    expect(snap().index).toBe(2);
  });
  it('play() at the end replays from the start', () => {
    const { player, dotX, snap } = setup(tiny([{ to: 's1', style: 'direct' }, { to: 's2', style: 'direct' }]));
    player.next(); player.next();
    expect(snap().status).toBe('finished');
    player.play();
    expect(snap().index).toBe(0);
    expect(dotX()).toBe(0);
  });
});

describe('previous / replay / seek', () => {
  it('previous() animates back to the earlier slide and pauses', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.advance(500); // slide 1
    player.next(); player.advance(400); // slide 2 (dot at 300)
    expect(snap().index).toBe(2);
    player.previous();
    player.advance(200);
    expect(dotX()).toBeGreaterThan(100);
    expect(dotX()).toBeLessThan(300);
    player.advance(200);
    expect(dotX()).toBe(100);
    expect(snap()).toMatchObject({ index: 1, status: 'paused' });
    player.advance(60_000);
    expect(snap().index).toBe(1);
  });
  it('previous() mid-transition returns to the source slide', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.advance(100 + 200); // 50% to slide 1
    player.previous();
    player.advance(1000);
    expect(dotX()).toBe(0);
    expect(snap()).toMatchObject({ index: 0, status: 'paused' });
  });
  it('previous() on the first slide is a no-op', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.previous();
    expect(dotX()).toBe(0);
    expect(snap().index).toBe(0);
  });
  it('replay() restarts from slide 0 and auto-advances again', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.advance(1000); player.next(); player.advance(1000);
    expect(snap().status).toBe('finished');
    player.replay();
    expect(dotX()).toBe(0);
    expect(snap()).toMatchObject({ index: 0, status: 'playing' });
    player.advance(500);
    expect(dotX()).toBe(100);
  });
  it('seek() renders in-between states deterministically and pauses', () => {
    const { player, dotX, snap } = setup(autoThenNext());
    player.seek(0.25); // halfway through the first of two transitions
    expect(dotX()).toBeCloseTo(50, 6);
    expect(snap()).toMatchObject({ status: 'paused', index: 0 });
    player.seek(0.75);
    expect(dotX()).toBeCloseTo(200, 6);
    player.seek(1);
    expect(dotX()).toBe(300);
    expect(snap().status).toBe('finished');
    player.seek(0);
    expect(dotX()).toBe(0);
    player.seek(0.25);
    expect(dotX()).toBeCloseTo(50, 6); // same input, same output
    player.seek(NaN);
    expect(dotX()).toBe(0);
  });
  it('play() after a mid-transition seek finishes that transition', () => {
    const { player, dotX } = setup(autoThenNext());
    player.seek(0.25);
    player.play();
    player.advance(1000);
    expect(dotX()).toBe(100);
  });
});

describe('lifecycle and resources', () => {
  it('loading another animation cancels the in-flight one', () => {
    const { player, scheduler, renderer, snap } = setup(autoThenNext());
    player.advance(300);
    player.load(tiny([{ to: 's1', trigger: 'next' }]), 'other');
    expect(snap()).toMatchObject({ index: 0, position: 0 });
    player.advance(60_000);
    expect(snap().index).toBe(0); // old auto transition must not fire
    expect(renderer.last.get('dot')!.x).toBe(0);
    expect(scheduler.pending.size).toBe(0);
  });
  it('destroy() releases the renderer, listeners and the animation loop', () => {
    const { player, scheduler, renderer } = setup(autoThenNext());
    expect(scheduler.pending.size).toBe(1); // loop running because an auto transition is pending
    let calls = 0;
    player.onChange(() => calls++);
    player.destroy();
    expect(renderer.destroyed).toBe(true);
    expect(scheduler.pending.size).toBe(0);
    const frames = renderer.frames.length;
    player.next(); player.play(); player.advance(1000); player.seek(0.5); player.replay(); player.load(autoThenNext());
    expect(renderer.frames.length).toBe(frames);
    expect(calls).toBe(0);
    expect(() => player.destroy()).not.toThrow();
  });
  it('repeated open/close leaves no scheduled callbacks behind', () => {
    const scheduler = new FakeScheduler();
    for (let i = 0; i < 50; i++) {
      const p = new Player(new RecordingRenderer(), { scheduler });
      p.load(autoThenNext());
      p.advance(10);
      if (i % 2) p.next();
      p.destroy();
    }
    expect(scheduler.pending.size).toBe(0);
  });
  it('drives itself from the scheduler and idles when waiting for the user', () => {
    const { player, scheduler, dotX, snap } = setup(autoThenNext());
    for (let i = 0; i < 40; i++) scheduler.step(16); // ~640 ms of frames
    expect(snap().index).toBe(1);
    expect(dotX()).toBe(100);
    expect(scheduler.pending.size).toBe(0); // waiting for Next: no animation frames requested
    player.next();
    expect(scheduler.pending.size).toBe(1);
  });
  it('caps a huge frame gap so a hidden tab does not fast-forward', () => {
    const { scheduler, snap } = setup(autoThenNext());
    scheduler.step(60_000); // one giant frame
    expect(snap().position).toBeLessThan(1); // advanced at most 100 ms, not 60 s
  });
  it('notifies listeners and survives a throwing listener', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { player, snap } = setup(autoThenNext());
    const seen: number[] = [];
    player.onChange(() => { throw new Error('boom'); });
    const off = player.onChange((s) => seen.push(s.index));
    player.advance(500);
    expect(seen.at(-1)).toBe(1);
    off();
    player.next();
    expect(snap().index).toBe(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('reduced motion', () => {
  it('turns every transition into an instant switch and disables auto-advance', () => {
    const { player, dotX, snap } = setup(autoThenNext(), { reducedMotion: true });
    player.advance(60_000);
    expect(snap().index).toBe(0); // nothing moves on its own
    player.play(); // "continue" = exactly one step, and it is instant
    expect(snap()).toMatchObject({ index: 1, transitioning: false });
    player.advance(60_000);
    expect(snap().index).toBe(1);
    player.previous();
    player.next();
    expect(dotX()).toBe(100); // instantly, no tween
    expect(snap().transitioning).toBe(false);
  });
});

describe('demo animation end to end', () => {
  it('plays all six slides with the documented trigger sequence', () => {
    const { player, snap, renderer } = setup(demoAnimation());
    const dotX = () => renderer.last.get('number')!.x;
    player.advance(1200 + 700); // auto: intro -> too-small
    expect(snap()).toMatchObject({ index: 1, awaitingUser: true });
    player.next(); player.advance(1000); // fluid
    expect(snap().index).toBe(2);
    expect(dotX()).toBe(350);
    player.next(); // direct switch to "too-large"
    expect(snap()).toMatchObject({ index: 3, transitioning: false });
    expect(dotX()).toBe(830);
    player.advance(1400 + 1000); // auto again
    expect(snap().index).toBe(4);
    expect(dotX()).toBe(650);
    player.next(); player.advance(800 + 140); // two staggered actors -> span 940 ms
    expect(snap()).toMatchObject({ index: 5, status: 'finished', progress: 1 });
    expect(dotX()).toBe(500);
  });
});
