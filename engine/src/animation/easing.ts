import type { EasingSpec } from '../scene/model';

/** Named easings, all expressed as CSS-style cubic béziers so there is a single implementation. */
export const NAMED_EASINGS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  'ease-in': [0.64, 0, 0.78, 0],
  'ease-out': [0.22, 1, 0.36, 1],
  'ease-in-out': [0.65, 0, 0.35, 1], // the default: gentle start and stop, no overshoot
  'back-out': [0.34, 1.56, 0.64, 1], // slight overshoot, settles exactly on the target
};

export const DEFAULT_EASING = 'ease-in-out';

export type EasingFn = (t: number) => number;

/** Builds an easing function mapping [0,1] -> [0,1] with f(0)=0 and f(1)=1 exactly. */
export function makeEasing(spec: EasingSpec | undefined): EasingFn {
  const pts = typeof spec === 'string' || spec === undefined
    ? NAMED_EASINGS[spec ?? DEFAULT_EASING] ?? NAMED_EASINGS[DEFAULT_EASING]!
    : spec;
  const [x1, y1, x2, y2] = pts;
  if (x1 === y1 && x2 === y2) return (t) => clamp01(t);

  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dsx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  const solveU = (x: number): number => {
    let u = x;
    for (let i = 0; i < 8; i++) { // Newton-Raphson
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-6) return u;
      const d = dsx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1; u = x; // bisection fallback
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sy(solveU(t));
  };
}

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
