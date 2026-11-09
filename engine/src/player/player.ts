import { makeEasing, type EasingFn } from '../animation/easing';
import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../animation/color';
import { frameAt, sceneFrame, type Frame } from '../animation/interpolate';
import { compileAnimation } from '../scene/compile';
import type { Animation, CompiledAnimation, CompiledTransition } from '../scene/model';

/** Draws frames. The player knows nothing about the DOM; the SVG renderer is one implementation. */
export interface Renderer {
  /** Called once per loaded animation, before the first render. */
  setAnimation(animation: CompiledAnimation): void;
  /** Optional: receives the theme palette (on load and whenever the theme changes). */
  setPalette?(palette: Palette): void;
  render(frame: Frame): void;
  destroy(): void;
}

export interface Scheduler {
  now(): number;
  request(cb: () => void): number;
  cancel(handle: number): void;
}

export type PlayerStatus = 'playing' | 'paused' | 'waiting' | 'finished';
export type ThemeName = 'dark' | 'light';

export interface PlayerOptions {
  /** Start playing automatically after `load` (default true). */
  autoplay?: boolean;
  /** Collapse every transition to an instant switch and disable auto-advance (prefers-reduced-motion). */
  reducedMotion?: boolean;
  theme?: ThemeName;
  scheduler?: Scheduler;
}

export interface PlayerSnapshot {
  readonly title: string;
  readonly slideId: string;
  readonly caption: string;
  /** Index of the slide last reached (the source slide while a transition runs). */
  readonly index: number;
  readonly slideCount: number;
  /** Fractional slide position, e.g. 1.4 = 40% of the way from slide 1 to slide 2. */
  readonly position: number;
  /** Overall progress in [0, 1]. */
  readonly progress: number;
  readonly status: PlayerStatus;
  readonly transitioning: boolean;
  /** True if the next step needs the user (a `next` transition) rather than a timer. */
  readonly awaitingUser: boolean;
}

/** Public player API. */
export interface PonderPlayer {
  load(animation: Animation, id?: string): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  replay(): void;
  /** Jumps to overall progress in [0, 1] and pauses; fluid transitions are shown mid-way. */
  seek(progress: number): void;
  setTheme(theme: ThemeName): void;
  getSnapshot(): PlayerSnapshot | null;
  onChange(listener: (s: PlayerSnapshot) => void): () => void;
  destroy(): void;
}

type Run =
  | { kind: 'delay'; to: number; remaining: number }
  | {
      kind: 'tween'; to: number; from: Frame; fromPos: number; toPos: number;
      trans: CompiledTransition; ease: EasingFn; elapsed: number; forced: boolean; reverse: boolean;
    };

const MAX_FRAME_DT = 100; // ms; a stalled tab must not fast-forward the animation

const browserScheduler = (): Scheduler => ({
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
});

export class Player implements PonderPlayer {
  private anim: CompiledAnimation | null = null;
  private trans: CompiledTransition[] = [];
  private eases: EasingFn[] = [];
  private frames: Frame[] = [];
  private frame: Frame = new Map();
  private position = 0;
  private current = 0;
  private run: Run | null = null;
  private paused = false;
  private destroyed = false;
  private theme: ThemeName;
  private palette: Palette;
  private readonly listeners = new Set<(s: PlayerSnapshot) => void>();
  private loopHandle: number | null = null;
  private lastTick = 0;
  private readonly scheduler: Scheduler;

  constructor(private readonly renderer: Renderer, private readonly options: PlayerOptions = {}) {
    this.theme = options.theme ?? 'dark';
    this.palette = this.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
    this.scheduler = options.scheduler ?? browserScheduler();
  }


  load(animation: Animation, id = 'animation'): void {
    if (this.destroyed) return;
    this.stopLoop();
    this.run = null;
    const compiled = compileAnimation(id, animation);
    this.anim = compiled;
    const reduced = this.options.reducedMotion === true;
    this.trans = compiled.transitions.map((t) =>
      reduced ? { ...t, style: 'direct' as const, trigger: 'next' as const, duration: 0, delay: 0, stagger: 0, span: 0 } : t);
    this.eases = this.trans.map((t) => makeEasing(t.easing));
    this.rebuildFrames();
    this.renderer.setPalette?.(this.palette);
    this.renderer.setAnimation(compiled);
    this.paused = this.options.autoplay === false;
    this.settle(0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    this.run = null;
    this.listeners.clear();
    this.renderer.destroy();
    this.anim = null;
  }

  setTheme(theme: ThemeName): void {
    if (this.destroyed || theme === this.theme) return;
    this.theme = theme;
    this.palette = theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
    this.renderer.setPalette?.(this.palette);
    if (!this.anim) return;
    // colors inside a running tween were resolved with the old palette: finish it, then re-resolve
    const target = this.run && this.run.kind === 'tween' ? this.run.to : null;
    this.rebuildFrames();
    if (target !== null) this.settle(target);
    else { this.frame = this.frameForPosition(this.position); this.renderer.render(this.frame); this.emit(); }
  }


  play(): void {
    if (!this.anim || this.destroyed) return;
    if (this.current >= this.last && !this.run && this.position >= this.last) { this.replay(); return; }
    this.paused = false;
    if (!this.run) {
      // after seek() we may sit between two slides: finish that transition, whatever its trigger
      if (!Number.isInteger(this.position)) { this.startToward(Math.ceil(this.position), false); return; }
      // "Play" while waiting for a user-triggered step means "continue": take that step
      if (this.current < this.last && this.trans[this.current]!.trigger === 'next') { this.startToward(this.current + 1, true); return; }
      this.beginAuto();
    }
    this.ensureLoop();
    this.emit();
  }

  pause(): void {
    if (!this.anim || this.destroyed) return;
    this.paused = true;
    this.emit();
  }

  next(): void {
    if (!this.anim || this.destroyed) return;
    const run = this.run;
    if (run?.kind === 'tween') { this.settle(run.to); return; } // skip the running animation
    if (run?.kind === 'delay') { this.startToward(run.to, true); return; } // don't wait out the dwell time
    const target = Math.floor(this.position + 1e-9) + 1;
    if (target <= this.last) this.startToward(target, true);
  }

  previous(): void {
    if (!this.anim || this.destroyed) return;
    const run = this.run;
    if (run?.kind === 'tween' && run.reverse) { this.settle(run.to); this.paused = true; this.emit(); return; }
    this.paused = true; // stepping backwards is inspection: don't let timers carry on
    const target = Math.max(0, Math.ceil(this.position - 1e-9) - 1);
    if (run?.kind === 'tween') { this.startToward(run.to - 1, true); return; }
    this.run = null;
    if (target === this.position) { this.emit(); return; }
    this.startToward(target, true);
  }

  replay(): void {
    if (!this.anim || this.destroyed) return;
    this.stopLoop();
    this.run = null;
    this.paused = false;
    this.settle(0);
  }

  seek(progress: number): void {
    if (!this.anim || this.destroyed) return;
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    this.run = null;
    this.stopLoop();
    this.paused = true;
    const pos = p * this.last;
    this.position = pos;
    this.current = Math.min(Math.floor(pos + 1e-9), this.last);
    this.frame = this.frameForPosition(pos);
    this.renderer.render(this.frame);
    this.emit();
  }


  getSnapshot(): PlayerSnapshot | null {
    const a = this.anim;
    if (!a) return null;
    const idx = this.current;
    const scene = a.scenes[Math.min(this.position >= this.current + 0.5 ? this.current + 1 : this.current, this.last)]!;
    const settled = !this.run && Number.isInteger(this.position);
    const t = this.trans[Math.floor(this.position + 1e-9)];
    const awaitingUser = settled && this.current < this.last && (t?.trigger === 'next' || this.paused);
    let status: PlayerStatus;
    if (settled && this.current >= this.last) status = 'finished';
    else if (this.paused && !(this.run?.kind === 'tween' && this.run.forced)) status = 'paused';
    else if (awaitingUser) status = 'waiting';
    else status = 'playing';
    return {
      title: a.title,
      slideId: scene.id,
      caption: scene.caption,
      index: idx,
      slideCount: a.scenes.length,
      position: this.position,
      progress: this.last === 0 ? 1 : this.position / this.last,
      status,
      transitioning: this.run?.kind === 'tween',
      awaitingUser,
    };
  }

  onChange(listener: (s: PlayerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Advances the playback clock by `dtMs`. The animation loop calls this every frame; tests call it
   * directly, which makes every transition deterministic without a browser.
   */
  advance(dtMs: number): void {
    if (!this.anim || this.destroyed) return;
    let left = Math.max(0, dtMs);
    let changed = false;
    for (let guard = 0; left > 0 && this.run && guard < 10_000; guard++) {
      const run = this.run;
      if (this.paused && !(run.kind === 'tween' && run.forced)) break;
      changed = true;
      if (run.kind === 'delay') {
        if (left >= run.remaining) { left -= run.remaining; this.startToward(run.to, false); }
        else { run.remaining -= left; left = 0; }
      } else {
        const need = run.trans.span - run.elapsed;
        if (left >= need) { left -= need; this.settle(run.to); }
        else {
          run.elapsed += left; left = 0;
          const f = run.elapsed / run.trans.span;
          this.position = run.fromPos + (run.toPos - run.fromPos) * f;
          this.frame = frameAt(run.from, this.frames[run.to]!, run.trans, run.ease, run.elapsed);
          this.renderer.render(this.frame);
        }
      }
    }
    if (changed) this.emit();
  }


  private get last(): number { return (this.anim?.scenes.length ?? 1) - 1; }

  private rebuildFrames(): void {
    this.frames = this.anim ? this.anim.scenes.map((s) => sceneFrame(s, this.palette)) : [];
  }

  /** The frame shown at a (possibly fractional) slide position, using the transition's easing. */
  private frameForPosition(pos: number): Frame {
    const i = Math.min(Math.floor(pos + 1e-9), this.last);
    const f = pos - i;
    if (f < 1e-9 || i >= this.last) return this.frames[i]!;
    const t = this.trans[i]!;
    if (t.style === 'direct') return this.frames[i]!; // a direct switch has no in-between state
    return frameAt(this.frames[i]!, this.frames[i + 1]!, t, this.eases[i]!, f * t.span);
  }

  /** Lands exactly on slide `i` (no interpolation residue) and schedules whatever comes next. */
  private settle(i: number): void {
    this.run = null;
    this.current = i;
    this.position = i;
    this.frame = this.frames[i]!;
    this.renderer.render(this.frame);
    this.beginAuto();
    this.ensureLoop();
    this.emit();
  }

  private beginAuto(): void {
    if (this.paused || this.run || this.current >= this.last) return;
    if (!Number.isInteger(this.position)) return;
    const t = this.trans[this.current]!;
    if (t.trigger !== 'auto') return;
    if (t.delay <= 0) { this.startToward(this.current + 1, false); return; }
    this.run = { kind: 'delay', to: this.current + 1, remaining: t.delay };
  }

  /** Starts moving from the *currently displayed* frame to slide `target` (forward or backward). */
  private startToward(target: number, forced: boolean): void {
    const reverse = target < this.position;
    const idx = reverse ? target : target - 1; // the transition that links the two slides
    const t = this.trans[idx];
    if (!t || t.style === 'direct' || t.span <= 0) { this.settle(target); return; }
    this.run = {
      kind: 'tween', to: target, from: this.frame, fromPos: this.position, toPos: target,
      trans: t, ease: this.eases[idx]!, elapsed: 0, forced, reverse,
    };
    this.ensureLoop();
    this.emit();
  }

  private ensureLoop(): void {
    if (this.destroyed || this.loopHandle !== null || !this.run) return;
    if (this.paused && !(this.run.kind === 'tween' && this.run.forced)) return;
    this.lastTick = this.scheduler.now();
    this.loopHandle = this.scheduler.request(this.tick);
  }

  private stopLoop(): void {
    if (this.loopHandle !== null) { this.scheduler.cancel(this.loopHandle); this.loopHandle = null; }
  }

  private readonly tick = (): void => {
    this.loopHandle = null;
    if (this.destroyed) return;
    const now = this.scheduler.now();
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    this.advance(dt);
    this.ensureLoop();
  };

  private emit(): void {
    if (this.listeners.size === 0) return;
    const s = this.getSnapshot();
    if (!s) return;
    for (const l of [...this.listeners]) {
      try { l(s); } catch (e) { console.error('Ponder listener failed', e); }
    }
  }
}
