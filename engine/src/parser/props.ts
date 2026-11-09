import { LIMITS } from './limits';
import type { ActorState, ActorType } from '../scene/model';

export type PropSpec =
  | { kind: 'number'; min: number; max: number; int?: boolean }
  | { kind: 'boolean' }
  | { kind: 'color' }
  | { kind: 'text'; maxLen: number }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'points' };

const L = LIMITS.maxCoordinate;
const num = (min: number, max: number, int = false): PropSpec => ({ kind: 'number', min, max, int });

const COMMON: Record<string, PropSpec> = {
  x: num(-L, L),
  y: num(-L, L),
  rotation: num(-36_000, 36_000),
  scale: num(0, 100),
  opacity: num(0, 1),
  visible: { kind: 'boolean' },
  z: num(-1000, 1000, true),
};

const PAINT: Record<string, PropSpec> = {
  fill: { kind: 'color' },
  stroke: { kind: 'color' },
  strokeWidth: num(0, 100),
};

/** Properties that may appear on an actor declaration or in a slide's `changes`, per actor type. */
export const PROPS_BY_TYPE: Record<ActorType, Record<string, PropSpec>> = {
  rectangle: { ...COMMON, ...PAINT, width: num(0, L), height: num(0, L), cornerRadius: num(0, L) },
  circle: { ...COMMON, ...PAINT, radius: num(0, L) },
  ellipse: { ...COMMON, ...PAINT, width: num(0, L), height: num(0, L) },
  text: {
    ...COMMON,
    fill: { kind: 'color' },
    text: { kind: 'text', maxLen: LIMITS.maxTextLength },
    fontSize: num(1, 200),
    anchor: { kind: 'enum', values: ['start', 'middle', 'end'] },
  },
  line: { ...COMMON, stroke: { kind: 'color' }, strokeWidth: num(0, 100), width: num(-L, L), height: num(-L, L) },
  arrow: { ...COMMON, stroke: { kind: 'color' }, strokeWidth: num(0, 100), width: num(-L, L), height: num(-L, L) },
  polygon: { ...COMMON, ...PAINT, points: { kind: 'points' } },
  group: { ...COMMON },
};

/** Keys that only exist on declarations (they define structure and cannot change between slides). */
export const DECLARATION_ONLY = ['type', 'parent'] as const;

export const BASE_STATE: ActorState = Object.freeze({
  x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, visible: true, z: 0,
  width: 100, height: 60, radius: 20, cornerRadius: 0,
  fill: 'accent', stroke: 'none', strokeWidth: 2,
  text: '', fontSize: 24, anchor: 'middle' as const,
  points: Object.freeze([]) as ReadonlyArray<readonly [number, number]>,
});

/** Per-type default overrides (anything not listed uses BASE_STATE). */
export const TYPE_DEFAULTS: Record<ActorType, Partial<Record<keyof ActorState, unknown>>> = {
  rectangle: {},
  circle: {},
  ellipse: {},
  text: { fill: 'text' },
  line: { stroke: 'text', fill: 'none', width: 100, height: 0 },
  arrow: { stroke: 'text', fill: 'none', width: 100, height: 0 },
  polygon: {},
  group: {},
};

/** Theme color tokens usable anywhere a color is expected, in addition to #rgb / #rrggbb / #rrggbbaa. */
export const COLOR_TOKENS = [
  'none', 'text', 'muted', 'accent', 'accent2', 'success', 'warning', 'danger', 'surface',
] as const;

export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isColor(v: unknown): v is string {
  return typeof v === 'string' && (HEX_COLOR.test(v) || (COLOR_TOKENS as readonly string[]).includes(v));
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const RESERVED_IDS: readonly string[] = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
