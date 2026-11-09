/**
 * Public entry point. The bundle is an IIFE that exposes `window.Ponder`:
 *
 *   Ponder.start(jsonText, animationId, options)   // IDE / preview entry: (re)mounts into #ponder-root
 *   Ponder.mount(container, source, animationId, options)
 *   Ponder.Player / Ponder.SvgRenderer / Ponder.parseDocument / Ponder.compileAnimation ...
 */
import { mount, type HostMessage, type MountOptions, type PonderHandle } from './ui/shell';

export { Player } from './player/player';
export type { PonderPlayer, PlayerSnapshot, PlayerOptions, PlayerStatus, Renderer, Scheduler, ThemeName } from './player/player';
export { SvgRenderer } from './renderer/svg';
export { parseDocument, validateDocument, isValidSymbol } from './parser/validate';
export type { ValidationResult } from './parser/validate';
export { compileAnimation } from './scene/compile';
export { LIMITS } from './parser/limits';
export { parseSymbol, isValidSymbolSyntax, normalizeSymbol, SYMBOL_SCHEMES } from './parser/symbol';
export type { SymbolScheme } from './parser/symbol';
export { frameAt, blendActor, sceneFrame } from './animation/interpolate';
export { makeEasing, NAMED_EASINGS } from './animation/easing';
export { mount } from './ui/shell';
export type { MountOptions, PonderHandle, HostMessage, IdeColors } from './ui/shell';
export type * from './scene/model';

let active: PonderHandle | null = null;

/** Default host channel: the IDE injects `window.__ponderPost(jsonString)` (a JBCefJSQuery); absent in a plain browser. */
function postToHost(msg: HostMessage): void {
  const post = (window as unknown as { __ponderPost?: (s: string) => void }).__ponderPost;
  if (typeof post === 'function') post(JSON.stringify(msg));
}

/** Mounts into `#ponder-root`, first destroying any previous animation (no leaks when switching). */
export function start(source: string, animationId: string, options: MountOptions = {}): PonderHandle | null {
  active?.destroy();
  active = null;
  const root = document.getElementById('ponder-root');
  if (!root) return null;
  active = mount(root, source, animationId, { onHostMessage: postToHost, ...options });
  return active;
}

export function stop(): void {
  active?.destroy();
  active = null;
}

export function current(): PonderHandle | null {
  return active;
}
