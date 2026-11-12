import { LIMITS } from './limits';
import { isValidSymbolSyntax, normalizeSymbol } from './symbol';
import {
  PROPS_BY_TYPE, DECLARATION_ONLY, ID_PATTERN, RESERVED_IDS, isColor, COLOR_TOKENS, type PropSpec,
} from './props';
import { NAMED_EASINGS } from '../animation/easing';
import { ACTOR_TYPES, type ActorType, type Issue, type PonderDocument } from '../scene/model';
import { resolveTransitionSettings, transitionInto, TIMING_KEYS } from '../scene/transitions';
import type { Animation } from '../scene/model';

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  document?: PonderDocument;
  /** The file is meant for a newer Ponder (a newer format version, or features this version does not have). */
  needsUpdate?: boolean;
}

/**
 * Optional features a file can declare in `"requires"`. A file that requires a feature missing here is reported
 * with one clear "update Ponder" message instead of errors about properties this version does not know. Add a name
 * here when a feature ships; never remove one.
 */
export const PONDER_FEATURES: readonly string[] = [];
const FEATURE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Why [input] is meant for a newer Ponder, or null. Checked before anything else. */
function newerPonderNeeded(input: Record<string, unknown>): Issue | null {
  const v = input.version;
  if (typeof v === 'number' && Number.isInteger(v) && v > 1) {
    return { path: '$.version', message: `This file uses ponder.json format version ${v}, which is newer than this Ponder understands (version 1). Update Ponder to see this animation.` };
  }
  const r = input.requires;
  if (Array.isArray(r)) {
    const missing = r.filter((f): f is string => typeof f === 'string' && FEATURE_NAME.test(f) && !PONDER_FEATURES.includes(f));
    if (missing.length > 0) {
      return { path: '$.requires', message: `This file needs a newer Ponder: it uses ${missing.map((f) => `"${f}"`).join(', ')}, which this version does not have. Update Ponder to see this animation.` };
    }
  }
  return null;
}

const MAX_ISSUES = 100;

export const isValidSymbol = (s: string) => s.length <= LIMITS.maxSymbolLength && isValidSymbolSyntax(s);

const SYMBOL_HELP =
  'Examples: "com.example.MathUtils#clamp(int,int,int)" (Java/Kotlin, fully qualified parameter types), ' +
  '"py:mathutils.clamp", "js:math-utils#clamp", "dotnet:M:MathUtils.Clamp(System.Int32)", "go:example.com/m.Clamp", ' +
  '"rust:math_utils::clamp", "cpp:math::clamp(int)", or "sym:src/file.ext:Outer.name" for any other language.';

class Ctx {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  error(path: string, message: string) {
    if (this.errors.length < MAX_ISSUES) this.errors.push({ path, message });
  }
  warn(path: string, message: string) {
    if (this.warnings.length < MAX_ISSUES) this.warnings.push({ path, message });
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const describe = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'string' ? `the string ${JSON.stringify(v.length > 30 ? v.slice(0, 30) + '...' : v)}` : `${typeof v === 'object' ? 'an object' : `the ${typeof v} ${String(v)}`}`;

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

function suggest(word: string, options: readonly string[]): string {
  let best = '', bestD = 3;
  for (const o of options) {
    const d = distance(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) { bestD = d; best = o; }
  }
  return best ? ` Did you mean "${best}"?` : '';
}

/** `"//"` holds a comment and is allowed in every object. */
export const COMMENT_KEY = '//';
const MAX_COMMENT_LENGTH = 1000;

const MAX_COMMENT_LINES = 50;

function checkComment(ctx: Ctx, path: string, v: unknown) {
  if (!Array.isArray(v)) {
    if (typeof v !== 'string') ctx.error(path, `Expected a string (or a list of strings) but found ${describe(v)}.`);
    else checkString(ctx, path, v, MAX_COMMENT_LENGTH);
    return;
  }
  if (v.length > MAX_COMMENT_LINES) { ctx.error(path, `A comment may have at most ${MAX_COMMENT_LINES} lines.`); return; }
  v.forEach((line, i) => checkString(ctx, `${path}[${i}]`, line, MAX_COMMENT_LENGTH));
}

function checkKeys(ctx: Ctx, path: string, obj: Record<string, unknown>, allowed: readonly string[]) {
  for (const k of Object.keys(obj)) {
    if (k === COMMENT_KEY) { checkComment(ctx, `${path}.${k}`, obj[k]); continue; }
    if (!allowed.includes(k)) ctx.error(`${path}.${k}`, `Unknown property "${k}".${suggest(k, allowed)}`);
  }
}

function checkId(ctx: Ctx, path: string, id: string, what: string): boolean {
  if (id.length > LIMITS.maxIdLength) { ctx.error(path, `${what} id is longer than ${LIMITS.maxIdLength} characters.`); return false; }
  if (!ID_PATTERN.test(id)) { ctx.error(path, `${what} id "${id}" may only contain letters, digits, "_", "-" and "." and must start with a letter or digit.`); return false; }
  if (RESERVED_IDS.includes(id)) { ctx.error(path, `"${id}" is a reserved name and cannot be used as ${what} id.`); return false; }
  return true;
}

function checkString(ctx: Ctx, path: string, v: unknown, max: number, required = true): v is string {
  if (v === undefined) { if (required) ctx.error(path, 'Required property is missing.'); return false; }
  if (typeof v !== 'string') { ctx.error(path, `Expected a string but found ${describe(v)}.`); return false; }
  if (v.length > max) { ctx.error(path, `Text is too long (${v.length} characters, maximum ${max}).`); return false; }
  return true;
}

function checkNumber(ctx: Ctx, path: string, v: unknown, min: number, max: number, int = false): v is number {
  if (typeof v !== 'number') { ctx.error(path, `Expected a number but found ${describe(v)}.`); return false; }
  if (!Number.isFinite(v)) { ctx.error(path, 'Number must be finite.'); return false; }
  if (v < min || v > max) { ctx.error(path, `${v} is out of range (allowed ${min} to ${max}).`); return false; }
  if (int && !Number.isInteger(v)) { ctx.error(path, `${v} must be a whole number.`); return false; }
  return true;
}

function checkProp(ctx: Ctx, path: string, spec: PropSpec, v: unknown) {
  switch (spec.kind) {
    case 'number': checkNumber(ctx, path, v, spec.min, spec.max, spec.int); break;
    case 'boolean': if (typeof v !== 'boolean') ctx.error(path, `Expected true or false but found ${describe(v)}.`); break;
    case 'color':
      if (!isColor(v)) ctx.error(path, `Expected a color (#rgb, #rrggbb, #rrggbbaa or one of ${COLOR_TOKENS.join(', ')}) but found ${describe(v)}.`);
      break;
    case 'text': checkString(ctx, path, v, spec.maxLen); break;
    case 'enum':
      if (typeof v !== 'string' || !spec.values.includes(v)) ctx.error(path, `Expected one of ${spec.values.map((s) => `"${s}"`).join(', ')} but found ${describe(v)}.${typeof v === 'string' ? suggest(v, spec.values) : ''}`);
      break;
    case 'points': {
      if (!Array.isArray(v)) { ctx.error(path, `Expected a list of [x, y] points but found ${describe(v)}.`); break; }
      if (v.length < 3) ctx.error(path, `A polygon needs at least 3 points (found ${v.length}).`);
      if (v.length > LIMITS.maxPolygonPoints) { ctx.error(path, `A polygon may have at most ${LIMITS.maxPolygonPoints} points (found ${v.length}).`); break; }
      v.forEach((p, i) => {
        if (!Array.isArray(p) || p.length !== 2) { ctx.error(`${path}[${i}]`, 'Each point must be a pair [x, y].'); return; }
        checkNumber(ctx, `${path}[${i}][0]`, p[0], -LIMITS.maxCoordinate, LIMITS.maxCoordinate);
        checkNumber(ctx, `${path}[${i}][1]`, p[1], -LIMITS.maxCoordinate, LIMITS.maxCoordinate);
      });
      break;
    }
  }
}

function checkEasing(ctx: Ctx, path: string, v: unknown) {
  if (typeof v === 'string') {
    if (!(v in NAMED_EASINGS)) ctx.error(path, `Unknown easing "${v}".${suggest(v, Object.keys(NAMED_EASINGS))} Use one of ${Object.keys(NAMED_EASINGS).join(', ')} or [x1, y1, x2, y2].`);
  } else if (Array.isArray(v) && v.length === 4) {
    v.forEach((n, i) => checkNumber(ctx, `${path}[${i}]`, n, i % 2 === 0 ? 0 : -2, i % 2 === 0 ? 1 : 3));
  } else ctx.error(path, `Expected an easing name or a cubic-bezier [x1, y1, x2, y2] but found ${describe(v)}.`);
}

const ANIMATION_KEYS = ['symbol', 'aliases', 'title', 'description', 'scene', 'autoAdvance', 'actors', 'slides', 'transitions'] as const;
const SLIDE_KEYS = ['id', 'caption', 'changes', ...TIMING_KEYS] as const;
const TRANSITION_KEYS = ['from', 'to', ...TIMING_KEYS] as const;

function checkTiming(ctx: Ctx, p: string, t: Record<string, unknown>, actorIds: readonly string[]) {
  if (t.trigger !== undefined && t.trigger !== 'auto' && t.trigger !== 'next') ctx.error(`${p}.trigger`, `Expected "auto" or "next" but found ${describe(t.trigger)}.${typeof t.trigger === 'string' ? suggest(t.trigger, ['auto', 'next']) : ''}`);
  if (t.style !== undefined && t.style !== 'direct' && t.style !== 'fluid') ctx.error(`${p}.style`, `Expected "direct" or "fluid" but found ${describe(t.style)}.${typeof t.style === 'string' ? suggest(t.style, ['direct', 'fluid']) : ''}`);
  if (t.duration !== undefined) checkNumber(ctx, `${p}.duration`, t.duration, 0, LIMITS.maxDurationMs);
  if (t.delay !== undefined) checkNumber(ctx, `${p}.delay`, t.delay, 0, LIMITS.maxDelayMs);
  if (t.stagger !== undefined) checkNumber(ctx, `${p}.stagger`, t.stagger, 0, LIMITS.maxStaggerMs);
  if (t.easing !== undefined) checkEasing(ctx, `${p}.easing`, t.easing);
  if (t.order !== undefined) {
    if (!Array.isArray(t.order)) ctx.error(`${p}.order`, `Expected a list of actor ids but found ${describe(t.order)}.`);
    else t.order.forEach((id, j) => {
      if (typeof id !== 'string' || !actorIds.includes(id)) ctx.error(`${p}.order[${j}]`, `Unknown actor ${describe(id)}.${typeof id === 'string' ? suggest(id, actorIds) : ''}`);
    });
  }
}

function validateAnimation(ctx: Ctx, path: string, a: unknown, seenSymbols: Map<string, string>) {
  if (!isObj(a)) { ctx.error(path, `Expected an object but found ${describe(a)}.`); return; }
  const errorsBefore = ctx.errors.length;
  checkKeys(ctx, path, a, ANIMATION_KEYS);
  if (a.autoAdvance !== undefined && typeof a.autoAdvance !== 'boolean') {
    if (typeof a.autoAdvance !== 'number') ctx.error(`${path}.autoAdvance`, `Expected true, false or a number of milliseconds but found ${describe(a.autoAdvance)}.`);
    else checkNumber(ctx, `${path}.autoAdvance`, a.autoAdvance, 0, LIMITS.maxDelayMs);
  }

  const symbolOk = (p: string, s: unknown) => {
    if (!checkString(ctx, p, s, LIMITS.maxSymbolLength)) return;
    if (!isValidSymbol(s)) {
      ctx.error(p, `"${s}" is not a valid symbol. ${SYMBOL_HELP}`);
      return;
    }
    const key = normalizeSymbol(s);
    const prev = seenSymbols.get(key);
    if (prev) ctx.error(p, `Symbol "${s}" is already bound by ${prev}. Each symbol may have only one animation.`);
    else seenSymbols.set(key, p);
  };
  symbolOk(`${path}.symbol`, a.symbol);
  if (a.aliases !== undefined) {
    if (!Array.isArray(a.aliases)) ctx.error(`${path}.aliases`, `Expected a list of symbols but found ${describe(a.aliases)}.`);
    else if (a.aliases.length > LIMITS.maxAliases) ctx.error(`${path}.aliases`, `At most ${LIMITS.maxAliases} aliases are allowed.`);
    else a.aliases.forEach((s, i) => symbolOk(`${path}.aliases[${i}]`, s));
  }
  checkString(ctx, `${path}.title`, a.title, LIMITS.maxTitleLength);
  if (a.description !== undefined) checkString(ctx, `${path}.description`, a.description, LIMITS.maxDescriptionLength, false);

  // scene
  if (a.scene !== undefined) {
    if (!isObj(a.scene)) ctx.error(`${path}.scene`, `Expected an object but found ${describe(a.scene)}.`);
    else {
      checkKeys(ctx, `${path}.scene`, a.scene, ['width', 'height', 'background']);
      for (const k of ['width', 'height'] as const)
        if (a.scene[k] !== undefined) checkNumber(ctx, `${path}.scene.${k}`, a.scene[k], LIMITS.minSceneSize, LIMITS.maxSceneSize, true);
      if (a.scene.background !== undefined && !isColor(a.scene.background)) ctx.error(`${path}.scene.background`, `Expected a color but found ${describe(a.scene.background)}.`);
    }
  }

  // actors
  const actorTypes = new Map<string, ActorType>();
  const parents = new Map<string, string>();
  if (!isObj(a.actors)) {
    ctx.error(`${path}.actors`, a.actors === undefined ? 'Required property is missing.' : `Expected an object of actors but found ${describe(a.actors)}.`);
  } else {
    if (a.actors[COMMENT_KEY] !== undefined) checkComment(ctx, `${path}.actors.${COMMENT_KEY}`, a.actors[COMMENT_KEY]);
    const ids = Object.keys(a.actors).filter((k) => k !== COMMENT_KEY);
    if (ids.length === 0) ctx.error(`${path}.actors`, 'An animation needs at least one actor.');
    if (ids.length > LIMITS.maxActors) ctx.error(`${path}.actors`, `Too many actors (${ids.length}, maximum ${LIMITS.maxActors}).`);
    else {
      for (const id of ids) {
        const p = `${path}.actors.${id}`;
        const decl = a.actors[id];
        checkId(ctx, p, id, 'actor');
        if (!isObj(decl)) { ctx.error(p, `Expected an object but found ${describe(decl)}.`); continue; }
        const type = decl.type;
        if (typeof type !== 'string' || !(ACTOR_TYPES as readonly string[]).includes(type)) {
          ctx.error(`${p}.type`, type === undefined ? `Required property is missing. Use one of ${ACTOR_TYPES.join(', ')}.` : `Unknown actor type ${describe(type)}.${typeof type === 'string' ? suggest(type, ACTOR_TYPES) : ''} Use one of ${ACTOR_TYPES.join(', ')}.`);
          continue;
        }
        actorTypes.set(id, type as ActorType);
        const specs = PROPS_BY_TYPE[type as ActorType];
        for (const [k, v] of Object.entries(decl)) {
          if (k === 'type') continue;
          if (k === COMMENT_KEY) { checkComment(ctx, `${p}.${k}`, v); continue; }
          if (k === 'parent') {
            if (typeof v !== 'string') ctx.error(`${p}.parent`, `Expected the id of a group actor but found ${describe(v)}.`);
            else parents.set(id, v);
            continue;
          }
          const spec = specs[k];
          if (!spec) ctx.error(`${p}.${k}`, `"${k}" is not a property of ${type} actors.${suggest(k, [...Object.keys(specs), 'parent'])}`);
          else checkProp(ctx, `${p}.${k}`, spec, v);
        }
        if (type === 'polygon' && decl.points === undefined) ctx.error(`${p}.points`, 'A polygon actor needs "points": [[x, y], [x, y], [x, y], ...].');
      }
      for (const [id, parent] of parents) {
        const p = `${path}.actors.${id}.parent`;
        if (!actorTypes.has(parent)) ctx.error(p, `Parent "${parent}" is not a declared actor.${suggest(parent, [...actorTypes.keys()])}`);
        else if (actorTypes.get(parent) !== 'group') ctx.error(p, `Parent "${parent}" is a ${actorTypes.get(parent)}, but only "group" actors can contain other actors.`);
      }
      // cycles + nesting depth
      for (const id of parents.keys()) {
        let depth = 0, cur: string | undefined = id;
        const seen = new Set<string>();
        while (cur !== undefined && parents.has(cur)) {
          if (seen.has(cur)) { ctx.error(`${path}.actors.${id}.parent`, `Group nesting forms a cycle through "${cur}".`); break; }
          seen.add(cur);
          cur = parents.get(cur);
          if (++depth > LIMITS.maxGroupDepth) { ctx.error(`${path}.actors.${id}.parent`, `Groups are nested deeper than ${LIMITS.maxGroupDepth} levels.`); break; }
        }
      }
    }
  }

  // slides
  const slideIds: Array<string | undefined> = []; // per index; undefined = slide without an id
  const inlineTiming = new Set<number>();          // slides that say how they are reached
  if (!Array.isArray(a.slides)) {
    ctx.error(`${path}.slides`, a.slides === undefined ? 'Required property is missing.' : `Expected a list of slides but found ${describe(a.slides)}.`);
  } else if (a.slides.length === 0) {
    ctx.error(`${path}.slides`, 'An animation needs at least one slide.');
  } else if (a.slides.length > LIMITS.maxSlides) {
    ctx.error(`${path}.slides`, `Too many slides (${a.slides.length}, maximum ${LIMITS.maxSlides}).`);
  } else {
    a.slides.forEach((s: unknown, i: number) => {
      const p = `${path}.slides[${i}]`;
      if (!isObj(s)) { ctx.error(p, `Expected an object but found ${describe(s)}.`); return; }
      checkKeys(ctx, p, s, SLIDE_KEYS);
      let sid: string | undefined;
      if (s.id !== undefined) {
        if (typeof s.id !== 'string') ctx.error(`${p}.id`, `Expected a string but found ${describe(s.id)}.`);
        else if (checkId(ctx, `${p}.id`, s.id, 'slide')) {
          if (slideIds.includes(s.id)) ctx.error(`${p}.id`, `Duplicate slide id "${s.id}".`);
          sid = s.id;
        }
      }
      slideIds.push(sid);
      const timing = TIMING_KEYS.filter((k) => s[k] !== undefined);
      if (timing.length > 0) {
        if (i === 0) ctx.error(`${p}.${timing[0]}`, `The first slide is shown as soon as the animation starts, so it cannot have "${timing[0]}". Put timing on the slides that follow.`);
        else { inlineTiming.add(i); checkTiming(ctx, p, s, [...actorTypes.keys()]); }
      }
      if (s.caption !== undefined) checkString(ctx, `${p}.caption`, s.caption, LIMITS.maxCaptionLength, false);
      if (s.changes !== undefined) {
        if (!isObj(s.changes)) { ctx.error(`${p}.changes`, `Expected an object mapping actor ids to property changes but found ${describe(s.changes)}.`); return; }
        for (const [actorId, change] of Object.entries(s.changes)) {
          const cp = `${p}.changes.${actorId}`;
          if (actorId === COMMENT_KEY) { checkComment(ctx, cp, change); continue; }
          const type = actorTypes.get(actorId);
          if (!type) { ctx.error(cp, `Unknown actor "${actorId}".${suggest(actorId, [...actorTypes.keys()])} Declare it in "actors" first.`); continue; }
          if (!isObj(change)) { ctx.error(cp, `Expected an object of properties but found ${describe(change)}.`); continue; }
          const specs = PROPS_BY_TYPE[type];
          for (const [k, v] of Object.entries(change)) {
            if (k === COMMENT_KEY) { checkComment(ctx, `${cp}.${k}`, v); continue; }
            if ((DECLARATION_ONLY as readonly string[]).includes(k)) { ctx.error(`${cp}.${k}`, `"${k}" is fixed when the actor is declared and cannot change between slides.`); continue; }
            const spec = specs[k];
            if (!spec) ctx.error(`${cp}.${k}`, `"${k}" is not a property of ${type} actors.${suggest(k, Object.keys(specs))}`);
            else checkProp(ctx, `${cp}.${k}`, spec, v);
          }
        }
      }
    });
  }

  // transitions
  const targeted = new Set<string>();
  const namedIds = slideIds.filter((s): s is string => s !== undefined);
  if (a.transitions !== undefined) {
    if (!Array.isArray(a.transitions)) ctx.error(`${path}.transitions`, `Expected a list but found ${describe(a.transitions)}.`);
    else if (a.transitions.length > LIMITS.maxTransitions) ctx.error(`${path}.transitions`, `Too many transitions (maximum ${LIMITS.maxTransitions}).`);
    else a.transitions.forEach((t: unknown, i: number) => {
      const p = `${path}.transitions[${i}]`;
      if (!isObj(t)) { ctx.error(p, `Expected an object but found ${describe(t)}.`); return; }
      checkKeys(ctx, p, t, TRANSITION_KEYS);
      if (typeof t.to !== 'string') { ctx.error(`${p}.to`, t.to === undefined ? 'Required property is missing.' : `Expected a slide id but found ${describe(t.to)}.`); return; }
      const toIdx = slideIds.indexOf(t.to);
      if (toIdx < 0) ctx.error(`${p}.to`, `Unknown slide "${t.to}".${suggest(t.to, namedIds)}`);
      else if (toIdx === 0) ctx.error(`${p}.to`, 'Nothing transitions into the first slide; it is shown as soon as the animation starts.');
      else {
        if (targeted.has(t.to)) ctx.error(`${p}.to`, `More than one transition leads to slide "${t.to}".`);
        else if (inlineTiming.has(toIdx)) ctx.error(`${p}.to`, `Slide "${t.to}" already sets its own timing (trigger, duration, ...). Keep it in one place: on the slide or here.`);
        targeted.add(t.to);
        if (t.from !== undefined) {
          if (typeof t.from !== 'string' || !namedIds.includes(t.from)) ctx.error(`${p}.from`, `Unknown slide ${describe(t.from)}.${typeof t.from === 'string' ? suggest(t.from, namedIds) : ''}`);
          else if (slideIds.indexOf(t.from) !== toIdx - 1) ctx.error(`${p}.from`, `Ponder plays slides in order, so "${t.to}" can only be reached from the slide just before it${slideIds[toIdx - 1] ? ` ("${slideIds[toIdx - 1]}")` : ''}, not "${t.from}".`);
        }
      }
      checkTiming(ctx, p, t, [...actorTypes.keys()]);
    });
  }

  // total running time, defaults included; only checked when the rest is valid
  if (ctx.errors.length === errorsBefore && Array.isArray(a.slides) && a.slides.length > 1) {
    const anim = a as unknown as Animation;
    let total = 0;
    for (let i = 1; i < anim.slides.length; i++) {
      const decl = transitionInto(anim, i);
      const s = resolveTransitionSettings(decl);
      const staggered = decl?.order && decl.order.length > 0 ? decl.order.length : actorTypes.size;
      total += s.delay + s.duration + s.stagger * Math.max(0, staggered - 1);
    }
    if (total > LIMITS.maxTotalMs) ctx.error(`${path}.transitions`, `Total animation time is ${Math.round(total / 1000)}s, longer than the ${LIMITS.maxTotalMs / 1000}s limit.`);
  }
}

/** Validates an already-parsed JSON value. Never throws. */
export function validateDocument(input: unknown): ValidationResult {
  const ctx = new Ctx();
  try {
    if (!isObj(input)) {
      ctx.error('$', `A ponder.json file must contain a JSON object, but found ${describe(input)}.`);
    } else {
      const newer = newerPonderNeeded(input);
      if (newer) return { ok: false, errors: [newer], warnings: [], needsUpdate: true };
      checkKeys(ctx, '$', input, ['$schema', 'version', 'requires', 'library', 'animations']);
      if (input.requires !== undefined) {
        if (!Array.isArray(input.requires) || input.requires.length > 16) {
          ctx.error('$.requires', 'Expected a list of at most 16 feature names, e.g. "requires": [].');
        } else {
          input.requires.forEach((f, i) => {
            if (typeof f !== 'string' || !FEATURE_NAME.test(f)) ctx.error(`$.requires[${i}]`, `Expected a feature name (lower-case letters, digits and dashes) but found ${describe(f)}.`);
          });
        }
      }
      if (input.version !== 1) {
        ctx.error('$.version', input.version === undefined
          ? 'Required property is missing. Add "version": 1.'
          : `Unsupported format version ${describe(input.version)}. This Ponder understands version 1 only.`);
      }
      if (!isObj(input.library)) {
        ctx.error('$.library', 'Required property is missing. Add "library": { "name": "..." }.');
      } else {
        checkKeys(ctx, '$.library', input.library, ['group', 'name', 'version']);
        if (input.library.group !== undefined) checkString(ctx, '$.library.group', input.library.group, 200);
        checkString(ctx, '$.library.name', input.library.name, 200);
        if (input.library.version !== undefined) checkString(ctx, '$.library.version', input.library.version, 100, false);
      }
      if (!isObj(input.animations)) {
        ctx.error('$.animations', input.animations === undefined ? 'Required property is missing.' : `Expected an object of animations but found ${describe(input.animations)}.`);
      } else {
        const ids = Object.keys(input.animations);
        if (ids.length === 0) ctx.error('$.animations', 'The file defines no animations.');
        if (ids.length > LIMITS.maxAnimations) ctx.error('$.animations', `Too many animations (${ids.length}, maximum ${LIMITS.maxAnimations}).`);
        else {
          const seen = new Map<string, string>();
          for (const id of ids) {
            checkId(ctx, `$.animations.${id}`, id, 'animation');
            validateAnimation(ctx, `$.animations.${id}`, input.animations[id], seen);
          }
        }
      }
    }
  } catch (e) {
    ctx.error('$', `Internal validation failure: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ok = ctx.errors.length === 0;
  return { ok, errors: ctx.errors, warnings: ctx.warnings, document: ok ? (input as PonderDocument) : undefined };
}

/** Parses + validates raw file text. Enforces the size limit before parsing. */
export function parseDocument(raw: string): ValidationResult {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // Windows editors save UTF-8 with a byte order mark
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  if (bytes > LIMITS.maxFileBytes) {
    return { ok: false, errors: [{ path: '$', message: `File is too large (${bytes} bytes, maximum ${LIMITS.maxFileBytes}).` }], warnings: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '$', message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` }], warnings: [] };
  }
  return validateDocument(json);
}
