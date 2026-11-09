import type { Animation, Transition, Trigger, Style, EasingSpec } from './model';

/** Defaults applied to every transition field the author leaves out. Documented in docs/ponder-format.md. */
export const TRANSITION_DEFAULTS = {
  trigger: 'next' as Trigger,
  style: 'fluid' as Style,
  duration: 600,
  /** For `auto` transitions: dwell time on the source slide before moving on. `next` transitions have no delay. */
  autoDelay: 500,
  /** `"autoAdvance": true` dwells this long on each slide (a number sets it explicitly). */
  autoAdvanceDelay: 1500,
  stagger: 0,
  easing: 'ease-in-out' as EasingSpec,
};

/** Transition fields that may also be written directly on a slide (they describe how that slide is reached). */
export const TIMING_KEYS = ['trigger', 'style', 'duration', 'delay', 'easing', 'stagger', 'order'] as const;

export interface ResolvedTransitionSettings {
  trigger: Trigger;
  style: Style;
  duration: number;
  delay: number;
  easing: EasingSpec;
  stagger: number;
}

export function resolveTransitionSettings(t: Transition | undefined): ResolvedTransitionSettings {
  const trigger = t?.trigger ?? TRANSITION_DEFAULTS.trigger;
  const style = t?.style ?? TRANSITION_DEFAULTS.style;
  return {
    trigger,
    style,
    // a `direct` switch has no tween, so its duration is irrelevant
    duration: style === 'direct' ? 0 : t?.duration ?? TRANSITION_DEFAULTS.duration,
    delay: t?.delay ?? (trigger === 'auto' ? TRANSITION_DEFAULTS.autoDelay : 0),
    easing: t?.easing ?? TRANSITION_DEFAULTS.easing,
    stagger: style === 'direct' ? 0 : t?.stagger ?? TRANSITION_DEFAULTS.stagger,
  };
}

function pickTiming(o: Record<string, unknown> | undefined): Partial<Transition> {
  const out: Record<string, unknown> = {};
  if (o) for (const k of TIMING_KEYS) if (o[k] !== undefined) out[k] = o[k];
  return out as Partial<Transition>;
}

/** What `autoAdvance` contributes to every transition: `true` = auto with the default dwell, a number = auto with that dwell. */
export function autoAdvanceDefaults(v: unknown): Partial<Transition> {
  if (v === true) return { trigger: 'auto', delay: TRANSITION_DEFAULTS.autoAdvanceDelay };
  if (typeof v === 'number') return { trigger: 'auto', delay: v };
  return {};
}

/**
 * The effective transition into slide [index] (index >= 1), from lowest to highest priority:
 * the animation's `autoAdvance`, a `transitions` entry targeting the slide, the timing fields written on the slide itself.
 * Returns undefined when nothing was specified (all defaults apply).
 */
export function transitionInto(anim: Pick<Animation, 'slides' | 'transitions' | 'autoAdvance'>, index: number): Transition | undefined {
  const slide = anim.slides[index] as unknown as Record<string, unknown> | undefined;
  if (!slide) return undefined;
  const id = typeof slide.id === 'string' ? slide.id : undefined;
  const entry = id === undefined ? undefined : anim.transitions?.find((t) => t.to === id);
  const own = { ...pickTiming(entry as unknown as Record<string, unknown> | undefined), ...pickTiming(slide) };
  const merged: Partial<Transition> = { ...autoAdvanceDefaults(anim.autoAdvance), ...own };
  // a slide that opts out of autoAdvance ("trigger": "next") waits for the user, without the auto dwell time
  if (merged.trigger === 'next' && own.delay === undefined) delete merged.delay;
  return Object.keys(merged).length === 0 ? undefined : ({ to: id ?? `#${index}`, ...merged } as Transition);
}
