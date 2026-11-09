import { clamp01, type EasingFn } from './easing';
import { resolveColor, type Palette, type Rgba } from './color';
import type { ActorState, CompiledTransition, Scene, TextAnchor } from '../scene/model';

/** What the renderer draws: an actor state with theme colors resolved and visibility folded into opacity. */
export interface VisualActor {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  /** Effective opacity: 0 when the actor is not visible. */
  readonly opacity: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly cornerRadius: number;
  readonly strokeWidth: number;
  readonly fontSize: number;
  readonly fill: Rgba;
  readonly stroke: Rgba;
  readonly text: string;
  readonly anchor: TextAnchor;
  readonly points: ReadonlyArray<readonly [number, number]>;
}

export type Frame = ReadonlyMap<string, VisualActor>;

export function toVisual(s: ActorState, palette: Palette): VisualActor {
  return {
    x: s.x, y: s.y, rotation: s.rotation, scale: s.scale,
    opacity: s.visible ? s.opacity : 0,
    z: s.z, width: s.width, height: s.height, radius: s.radius, cornerRadius: s.cornerRadius,
    strokeWidth: s.strokeWidth, fontSize: s.fontSize,
    fill: resolveColor(s.fill, palette), stroke: resolveColor(s.stroke, palette),
    text: s.text, anchor: s.anchor, points: s.points,
  };
}

export function sceneFrame(scene: Scene, palette: Palette): Frame {
  const m = new Map<string, VisualActor>();
  for (const [id, s] of scene.actors) m.set(id, toVisual(s, palette));
  return m;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpRgba(a: Rgba, b: Rgba, t: number): Rgba {
  // `none` (alpha 0) on one side: fade the other color instead of blending through black
  const from = a.a === 0 && b.a > 0 ? { ...b, a: 0 } : a;
  const to = b.a === 0 && a.a > 0 ? { ...a, a: 0 } : b;
  return { r: lerp(from.r, to.r, t), g: lerp(from.g, to.g, t), b: lerp(from.b, to.b, t), a: lerp(from.a, to.a, t) };
}

/**
 * Blends two actor states at eased progress `t`.
 *
 *  - numbers and colors interpolate linearly;
 *  - an actor that appears or disappears keeps its geometry and only fades;
 *  - text, z-order and anchor are discrete and switch at t = 0.5;
 *  - polygons morph point by point when the point counts match, otherwise switch at t = 0.5.
 *
 * t <= 0 returns `a` and t >= 1 returns `b` as is.
 */
export function blendActor(a: VisualActor, b: VisualActor, t: number): VisualActor {
  if (t <= 0) return a;
  if (t >= 1) return b;
  let from = a, to = b;
  if (a.opacity <= 0 && b.opacity > 0) from = { ...b, opacity: 0 };
  else if (b.opacity <= 0 && a.opacity > 0) to = { ...a, opacity: 0 };

  const late = t >= 0.5;
  const samePoints = from.points.length === to.points.length;
  return {
    x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t),
    rotation: lerp(from.rotation, to.rotation, t), scale: lerp(from.scale, to.scale, t),
    opacity: lerp(from.opacity, to.opacity, t),
    z: late ? to.z : from.z,
    width: lerp(from.width, to.width, t), height: lerp(from.height, to.height, t),
    radius: lerp(from.radius, to.radius, t), cornerRadius: lerp(from.cornerRadius, to.cornerRadius, t),
    strokeWidth: lerp(from.strokeWidth, to.strokeWidth, t), fontSize: lerp(from.fontSize, to.fontSize, t),
    fill: lerpRgba(from.fill, to.fill, t), stroke: lerpRgba(from.stroke, to.stroke, t),
    text: late ? to.text : from.text,
    anchor: late ? to.anchor : from.anchor,
    points: samePoints
      ? from.points.map((p, i) => [lerp(p[0], to.points[i]![0], t), lerp(p[1], to.points[i]![1], t)] as const)
      : late ? to.points : from.points,
  };
}

/**
 * Frame of a fluid transition `elapsed` ms after it started. Each actor gets its own local progress so
 * `stagger` can offset actors in the transition's order.
 */
export function frameAt(from: Frame, to: Frame, trans: CompiledTransition, ease: EasingFn, elapsed: number): Frame {
  const out = new Map<string, VisualActor>();
  for (const [id, target] of to) {
    const source = from.get(id) ?? target;
    const start = trans.stagger * (trans.rank.get(id) ?? 0);
    const local = trans.duration <= 0 ? (elapsed >= start ? 1 : 0) : clamp01((elapsed - start) / trans.duration);
    out.set(id, blendActor(source, target, ease(local)));
  }
  return out;
}
