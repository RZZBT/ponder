import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Frame } from '../src/animation/interpolate';
import type { Renderer, Scheduler } from '../src/player/player';
import type { Animation, CompiledAnimation, PonderDocument } from '../src/scene/model';

export const DEMO_PATH = resolve(__dirname, '../../examples/math-utils/src/main/resources/META-INF/ponder/ponder.json');
export const demoText = () => readFileSync(DEMO_PATH, 'utf8');
export const demoDoc = (): PonderDocument => JSON.parse(demoText());
export const demoAnimation = (): Animation => demoDoc().animations['clamp-int']!;

/** Scheduler that never fires by itself; counts outstanding requests so tests can assert no leaks. */
export class FakeScheduler implements Scheduler {
  time = 0; pending = new Map<number, () => void>(); next = 1; requested = 0; cancelled = 0;
  now() { return this.time; }
  request(cb: () => void) { const h = this.next++; this.pending.set(h, cb); this.requested++; return h; }
  cancel(h: number) { if (this.pending.delete(h)) this.cancelled++; }
  /** Runs one frame `ms` later. */
  step(ms: number) { this.time += ms; const cbs = [...this.pending.values()]; this.pending.clear(); cbs.forEach((c) => c()); }
}

export class RecordingRenderer implements Renderer {
  frames: Frame[] = []; anim: CompiledAnimation | null = null; destroyed = false;
  setAnimation(a: CompiledAnimation) { this.anim = a; }
  render(f: Frame) { this.frames.push(f); }
  destroy() { this.destroyed = true; }
  get last(): Frame { return this.frames[this.frames.length - 1]!; }
}

/** Small hand-written animation: one circle that moves, plus a text. */
export function tiny(transitions: Animation['transitions']): Animation {
  return {
    symbol: 'a.B#c()', title: 'tiny',
    actors: {
      dot: { type: 'circle', x: 0, y: 100, radius: 10, fill: '#ff0000' },
      label: { type: 'text', x: 50, y: 20, text: 'one' },
    },
    slides: [
      { id: 's0', caption: 'zero' },
      { id: 's1', caption: 'one', changes: { dot: { x: 100 }, label: { text: 'two' } } },
      { id: 's2', caption: 'two', changes: { dot: { x: 300, fill: '#0000ff' } } },
    ],
    transitions,
  };
}
