/**
 * `PonderDocument`, `Animation`, ... mirror ponder.json. `CompiledAnimation` and `Scene` are what the player runs:
 * every slide compiled to a complete scene state.
 */

export const ACTOR_TYPES = [
  'rectangle', 'circle', 'ellipse', 'text', 'line', 'arrow', 'polygon', 'group',
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export type TextAnchor = 'start' | 'middle' | 'end';
export type Trigger = 'auto' | 'next';
export type Style = 'direct' | 'fluid';
export type EasingSpec = string | [number, number, number, number];

/** Property bag of an actor declaration or a slide change. Validation guarantees the keys are legal for the type. */
export type Props = Record<string, unknown>;

export interface ActorDecl extends Props {
  type: ActorType;
  parent?: string;
}

/** A step. The timing fields say how the slide is reached, like a `transitions` entry. */
export interface Slide {
  /** Optional; only needed when a `transitions` entry refers to the slide. */
  id?: string;
  caption?: string;
  changes?: Record<string, Props>;
  trigger?: Trigger;
  style?: Style;
  duration?: number;
  delay?: number;
  easing?: EasingSpec;
  stagger?: number;
  order?: string[];
}

export interface Transition {
  from?: string;
  to: string;
  trigger?: Trigger;
  style?: Style;
  duration?: number;
  delay?: number;
  easing?: EasingSpec;
  stagger?: number;
  order?: string[];
}

export interface SceneSettings {
  width?: number;
  height?: number;
  background?: string;
}

export interface Animation {
  symbol: string;
  aliases?: string[];
  title: string;
  description?: string;
  scene?: SceneSettings;
  actors: Record<string, ActorDecl>;
  /** true = every slide advances by itself after a short pause; a number = after that many milliseconds. */
  autoAdvance?: boolean | number;
  slides: Slide[];
  transitions?: Transition[];
}

export interface LibraryDecl {
  group?: string;
  name: string;
  version?: string;
}

export interface PonderDocument {
  version: 1;
  library: LibraryDecl;
  animations: Record<string, Animation>;
}

/** Complete visual state of one actor. Every field is always present (defaults are applied by the compiler). */
export interface ActorState {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly opacity: number;
  readonly visible: boolean;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly cornerRadius: number;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly text: string;
  readonly fontSize: number;
  readonly anchor: TextAnchor;
  readonly points: ReadonlyArray<readonly [number, number]>;
}

export type ActorStates = ReadonlyMap<string, ActorState>;

export interface Scene {
  readonly id: string;
  readonly caption: string;
  readonly actors: ActorStates;
}

export interface CompiledTransition {
  readonly from: number;
  readonly to: number;
  readonly trigger: Trigger;
  readonly style: Style;
  readonly duration: number;
  readonly delay: number;
  readonly easing: EasingSpec;
  readonly stagger: number;
  /** Rank of each actor in the stagger order (0 = first). Actors not listed come after, in document order. */
  readonly rank: ReadonlyMap<string, number>;
  /** Total running time of the tween: duration plus the stagger offset of the last actor. */
  readonly span: number;
}

export interface ActorMeta {
  readonly type: ActorType;
  readonly parent: string | null;
}

export interface CompiledAnimation {
  readonly id: string;
  readonly symbol: string;
  readonly title: string;
  readonly description: string;
  readonly width: number;
  readonly height: number;
  readonly background: string | null;
  /** Actor ids in document order (parents always precede their children). */
  readonly actorOrder: ReadonlyArray<string>;
  readonly meta: ReadonlyMap<string, ActorMeta>;
  readonly scenes: ReadonlyArray<Scene>;
  /** transitions[i] leads from scenes[i] to scenes[i + 1]. */
  readonly transitions: ReadonlyArray<CompiledTransition>;
}

export interface Issue {
  /** JSON-path-like location, e.g. `animations.clamp.slides[1].changes.number.x`. */
  path: string;
  message: string;
}
