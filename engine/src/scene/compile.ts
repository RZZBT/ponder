import { BASE_STATE, TYPE_DEFAULTS } from '../parser/props';
import { LIMITS } from '../parser/limits';
import { resolveTransitionSettings, transitionInto } from './transitions';
import type {
  ActorMeta, ActorState, Animation, CompiledAnimation, CompiledTransition, Props, Scene,
} from './model';

const STATE_KEYS = Object.keys(BASE_STATE) as Array<keyof ActorState>;

function freezePoints(v: unknown): ReadonlyArray<readonly [number, number]> {
  const pts = (v as Array<[number, number]>).map((p) => Object.freeze([p[0], p[1]] as const));
  return Object.freeze(pts);
}

/** Applies a property bag on top of a state. Only known state keys are copied. */
function applyProps(base: ActorState, props: Props): ActorState {
  const next: Record<string, unknown> = { ...base };
  for (const k of STATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    const v = props[k];
    next[k] = k === 'points' ? freezePoints(v) : v;
  }
  return Object.freeze(next) as unknown as ActorState;
}

/** Orders actors so that every group precedes its children, otherwise preserving document order. */
function topologicalOrder(ids: string[], parentOf: ReadonlyMap<string, string | null>): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    const p = parentOf.get(id);
    if (p) visit(p);
    done.add(id);
    out.push(id);
  };
  ids.forEach(visit);
  return out;
}

/**
 * Compiles a validated animation. Scene k = defaults + declarations + changes of slides 0..k, so seeking and
 * stepping backwards never depend on playback history.
 */
export function compileAnimation(id: string, anim: Animation): CompiledAnimation {
  const ids = Object.keys(anim.actors).filter((k) => k !== '//');
  const meta = new Map<string, ActorMeta>();
  const parentOf = new Map<string, string | null>();
  for (const aid of ids) {
    const d = anim.actors[aid]!;
    meta.set(aid, { type: d.type, parent: d.parent ?? null });
    parentOf.set(aid, d.parent ?? null);
  }
  const order = topologicalOrder(ids, parentOf);

  // initial state = type defaults + declaration
  let current = new Map<string, ActorState>();
  for (const aid of order) {
    const d = anim.actors[aid]!;
    const typed = applyProps(BASE_STATE, TYPE_DEFAULTS[d.type] as Props);
    current.set(aid, applyProps(typed, d));
  }

  const scenes: Scene[] = anim.slides.map((slide, index) => {
    const next = new Map(current);
    for (const [aid, change] of Object.entries(slide.changes ?? {})) {
      const prev = next.get(aid);
      if (prev) next.set(aid, applyProps(prev, change));
    }
    current = next;
    return Object.freeze({ id: slide.id ?? `slide-${index + 1}`, caption: slide.caption ?? '', actors: next as ReadonlyMap<string, ActorState> });
  });

  const transitions: CompiledTransition[] = [];
  for (let i = 1; i < scenes.length; i++) {
    const decl = transitionInto(anim, i); // autoAdvance < transitions[] entry < fields on the slide
    const s = resolveTransitionSettings(decl);
    // order: only the listed actors are staggered (in that order); unlisted actors start together with the first.
    // No order: stagger follows document order.
    const rank = new Map<string, number>();
    const listed = [...new Set(decl?.order ?? [])];
    if (listed.length > 0) {
      for (const aid of order) rank.set(aid, 0);
      listed.forEach((aid, i) => rank.set(aid, i));
    } else {
      order.forEach((aid, i) => rank.set(aid, i));
    }
    const maxRank = Math.max(0, ...rank.values());
    const span = s.duration + s.stagger * maxRank;
    transitions.push(Object.freeze({ from: i - 1, to: i, ...s, rank, span }));
  }

  return Object.freeze({
    id,
    symbol: anim.symbol,
    title: anim.title,
    description: anim.description ?? '',
    width: anim.scene?.width ?? LIMITS.defaultSceneWidth,
    height: anim.scene?.height ?? LIMITS.defaultSceneHeight,
    background: anim.scene?.background ?? null,
    actorOrder: Object.freeze(order),
    meta,
    scenes: Object.freeze(scenes),
    transitions: Object.freeze(transitions),
  });
}
