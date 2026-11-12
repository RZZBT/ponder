import { Player, type PlayerSnapshot, type ThemeName } from '../player/player';
import { SvgRenderer } from '../renderer/svg';
import { compileAnimation } from '../scene/compile';
import { parseDocument, validateDocument } from '../parser/validate';
import type { Animation, Issue, PonderDocument } from '../scene/model';

/** Messages the page sends to the host (IDE or preview). The IDE side parses them in BridgeMessage.kt. */
export type HostMessage =
  | { type: 'ready' }
  | { type: 'close' }
  | { type: 'toggleExpand'; expanded: boolean }
  | { type: 'error'; message: string };

export interface IdeColors {
  background?: string;
  foreground?: string;
  muted?: string;
  accent?: string;
  border?: string;
}

export interface MountOptions {
  theme?: ThemeName | 'auto';
  autoplay?: boolean;
  /** Overrides prefers-reduced-motion detection (mainly for tests). */
  reducedMotion?: boolean;
  /** Host-provided chrome colors (only #hex values are accepted). */
  colors?: IdeColors;
  onHostMessage?: (msg: HostMessage) => void;
  /** Show the expand/compact and close buttons (used when hosted in a popup). Default true. */
  hostControls?: boolean;
  /**
   * Where the animation comes from, shown under the title (e.g. "from the library", "community index").
   * Plain text, at most 80 characters; anything else is ignored.
   */
  sourceLabel?: string;
}

export interface PonderHandle {
  readonly player: Player | null;
  destroy(): void;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
/** Pause on a waiting slide before the viewer's "auto" toggle moves on. */
const AUTO_ADVANCE_MS = 1500;

const LABELS = {
  prev: '< prev',
  next: 'next >',
  play: 'play',
  pause: 'pause',
  replay: 'replay',
  expand: 'expand',
  compact: 'compact',
  close: 'close',
} as const;
type LabelName = keyof typeof LABELS;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, name: LabelName, cls = ''): HTMLButtonElement {
  const b = el(doc, 'button', `ponder-btn ${cls}`.trim(), LABELS[name]);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

function resolveTheme(t: MountOptions['theme'], win: Window): ThemeName {
  if (t === 'dark' || t === 'light') return t;
  return win.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function showErrors(container: HTMLElement, title: string, issues: Issue[], theme: ThemeName): void {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const root = el(doc, 'div', 'ponder ponder-error');
  root.dataset.theme = theme;
  root.appendChild(el(doc, 'h2', 'ponder-title', title));
  const ul = el(doc, 'ul', 'ponder-issues');
  for (const i of issues.slice(0, 12)) {
    const li = el(doc, 'li');
    li.appendChild(el(doc, 'code', undefined, i.path));
    li.appendChild(doc.createTextNode(`: ${i.message}`));
    ul.appendChild(li);
  }
  if (issues.length > 12) ul.appendChild(el(doc, 'li', undefined, `...and ${issues.length - 12} more.`));
  root.appendChild(ul);
  container.appendChild(root);
}

/**
 * Mounts a full Ponder player (stage, caption, progress, controls) into `container`.
 * `source` is either raw ponder.json text or an already-parsed document. Invalid input renders a
 * readable error panel instead of throwing.
 */
export function mount(
  container: HTMLElement,
  source: string | unknown,
  animationId: string,
  options: MountOptions = {},
): PonderHandle {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const theme = resolveTheme(options.theme, win);
  const post = (m: HostMessage) => { try { options.onHostMessage?.(m); } catch (e) { console.error(e); } };

  const result = typeof source === 'string' ? parseDocument(source) : validateDocument(source);
  const animation: Animation | undefined = (result.document as PonderDocument | undefined)?.animations[animationId];
  if (!result.ok || !animation) {
    const issues = result.ok ? [{ path: `animations.${animationId}`, message: 'No animation with this id in the file.' }] : result.errors;
    showErrors(container, 'This Ponder animation could not be loaded', issues, theme);
    post({ type: 'error', message: issues[0] ? `${issues[0].path}: ${issues[0].message}` : 'invalid document' });
    return { player: null, destroy: () => container.replaceChildren() };
  }

  const compiled = compileAnimation(animationId, animation);

  container.replaceChildren();
  const root = el(doc, 'div', 'ponder');
  root.dataset.theme = theme;
  root.dataset.mode = 'compact';
  root.tabIndex = 0;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', `Ponder: ${compiled.title}`);
  for (const [k, v] of Object.entries(options.colors ?? {})) {
    if (typeof v === 'string' && HEX.test(v)) root.style.setProperty(`--ponder-ide-${k}`, v);
  }

  const header = el(doc, 'header', 'ponder-header');
  const titles = el(doc, 'div', 'ponder-titles');
  titles.appendChild(el(doc, 'h1', 'ponder-title', compiled.title));
  if (compiled.description) titles.appendChild(el(doc, 'p', 'ponder-desc', compiled.description));
  const label = typeof options.sourceLabel === 'string' ? options.sourceLabel.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
  if (label) titles.appendChild(el(doc, 'p', 'ponder-source', label));
  header.appendChild(titles);
  const actions = el(doc, 'div', 'ponder-actions');
  const expandBtn = button(doc, 'Expand (E)', 'expand');
  const closeBtn = button(doc, 'Close (Esc)', 'close');
  if (options.hostControls !== false) actions.append(expandBtn, closeBtn);
  header.appendChild(actions);

  const stage = el(doc, 'div', 'ponder-stage');
  const caption = el(doc, 'p', 'ponder-caption');
  caption.setAttribute('aria-live', 'polite');

  const progress = el(doc, 'div', 'ponder-progress');
  const slider = el(doc, 'input', 'ponder-slider');
  slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.step = '1'; slider.value = '0';
  slider.setAttribute('aria-label', 'Animation progress');
  const dots = el(doc, 'div', 'ponder-dots');
  const dotEls = compiled.scenes.map((s, i) => {
    const d = el(doc, 'button', 'ponder-dot', String(i + 1));
    d.type = 'button';
    d.setAttribute('aria-label', `Step ${i + 1} of ${compiled.scenes.length}`);
    d.title = s.caption || `Step ${i + 1}`;
    d.addEventListener('click', () => player.seek(compiled.scenes.length > 1 ? i / (compiled.scenes.length - 1) : 0));
    dots.appendChild(d);
    return d;
  });
  progress.append(dots, slider);

  const controls = el(doc, 'footer', 'ponder-controls');
  const prevBtn = button(doc, 'Previous step (Left)', 'prev');
  const playBtn = button(doc, 'Pause (Space)', 'pause', 'ponder-primary');
  const nextBtn = button(doc, 'Next step (Right)', 'next');
  const replayBtn = button(doc, 'Replay (R)', 'replay');
  const autoBtn = el(doc, 'button', 'ponder-btn', 'auto: off');
  autoBtn.type = 'button';
  autoBtn.title = 'Move on by itself instead of waiting for Next (A)';
  autoBtn.setAttribute('aria-label', 'Auto-advance (A)');
  autoBtn.setAttribute('aria-pressed', 'false');
  const status = el(doc, 'span', 'ponder-status');
  controls.append(prevBtn, playBtn, nextBtn, replayBtn, autoBtn, status);

  root.append(header, stage, caption, progress, controls);
  container.appendChild(root);

  const reduced = options.reducedMotion ?? win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const renderer = new SvgRenderer(stage);
  const player = new Player(renderer, { theme, reducedMotion: reduced, autoplay: options.autoplay !== false && !reduced });

  let expanded = false;
  const setExpanded = (v: boolean, notify: boolean) => {
    expanded = v;
    root.dataset.mode = v ? 'expanded' : 'compact';
    expandBtn.textContent = v ? LABELS.compact : LABELS.expand;
    expandBtn.title = expandBtn.ariaLabel = v ? 'Compact (E)' : 'Expand (E)';
    if (notify) post({ type: 'toggleExpand', expanded: v });
  };

  const swapIcon = (b: HTMLButtonElement, name: LabelName, label: string) => {
    if (b.dataset.icon === name) return;
    b.dataset.icon = name;
    b.textContent = LABELS[name];
    b.title = label;
    b.setAttribute('aria-label', label);
  };

  // Viewer-side auto-advance: when on, a slide that waits for Next moves on by itself after AUTO_ADVANCE_MS.
  let autoOn = false;
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  const clearAuto = () => { if (autoTimer !== null) { clearTimeout(autoTimer); autoTimer = null; } };
  const scheduleAuto = (s: PlayerSnapshot) => {
    if (!autoOn || s.status !== 'waiting' || !s.awaitingUser) { clearAuto(); return; }
    if (autoTimer !== null) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      const now = player.getSnapshot();
      if (autoOn && now?.status === 'waiting' && now.awaitingUser) player.next();
    }, AUTO_ADVANCE_MS);
  };
  const setAuto = (v: boolean) => {
    autoOn = v;
    autoBtn.textContent = v ? 'auto: on' : 'auto: off';
    autoBtn.setAttribute('aria-pressed', String(v));
    root.dataset.auto = String(v);
    const s = player.getSnapshot();
    if (s) { scheduleAuto(s); status.textContent = statusText(s); }
  };
  const statusText = (s: PlayerSnapshot) => {
    const step = `step ${Math.round(s.position) + 1}/${s.slideCount}`;
    const state = s.status === 'finished' ? 'done'
      : s.awaitingUser && s.status === 'waiting' ? (autoOn ? 'auto' : 'waiting, press next')
      : s.status === 'paused' ? 'paused' : 'playing';
    return `${step}  ${state}`;
  };

  const unsubscribe = player.onChange((s: PlayerSnapshot) => {
    if (caption.textContent !== s.caption) caption.textContent = s.caption;
    slider.value = String(Math.round(s.progress * 1000));
    dotEls.forEach((d, i) => {
      d.classList.toggle('active', i === Math.round(s.position));
      d.classList.toggle('done', i < Math.round(s.position));
    });
    const running = s.status === 'playing';
    swapIcon(playBtn, running ? 'pause' : 'play', running ? 'Pause (Space)' : s.status === 'finished' ? 'Replay (Space)' : s.awaitingUser && s.status === 'waiting' ? 'Continue (Space)' : 'Play (Space)');
    prevBtn.disabled = s.position <= 0;
    nextBtn.disabled = s.index >= s.slideCount - 1 && Number.isInteger(s.position);
    status.textContent = statusText(s);
    root.dataset.status = s.status;
    scheduleAuto(s);
  });

  playBtn.addEventListener('click', () => {
    const s = player.getSnapshot();
    if (s?.status === 'playing') player.pause(); else player.play();
  });
  nextBtn.addEventListener('click', () => player.next());
  prevBtn.addEventListener('click', () => player.previous());
  replayBtn.addEventListener('click', () => player.replay());
  autoBtn.addEventListener('click', () => setAuto(!autoOn));
  expandBtn.addEventListener('click', () => setExpanded(!expanded, true));
  closeBtn.addEventListener('click', () => post({ type: 'close' }));
  slider.addEventListener('input', () => player.seek(Number(slider.value) / 1000));

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onSlider = e.target === slider;
    const onButton = e.target instanceof HTMLButtonElement;
    switch (e.key) {
      case 'ArrowRight': if (onSlider) return; e.preventDefault(); player.next(); break;
      case 'ArrowLeft': if (onSlider) return; e.preventDefault(); player.previous(); break;
      case 'n': case 'N': case 'PageDown': player.next(); break;
      case 'p': case 'P': case 'PageUp': player.previous(); break;
      case 'r': case 'R': player.replay(); break;
      case 'e': case 'E': setExpanded(!expanded, true); break;
      case 'a': case 'A': setAuto(!autoOn); break;
      case 'Home': if (onSlider) return; e.preventDefault(); player.seek(0); break;
      case 'End': if (onSlider) return; e.preventDefault(); player.seek(1); break;
      case ' ': case 'k': case 'K':
        if (onButton && e.key === ' ') return; // let a focused button handle its own activation
        e.preventDefault();
        if (player.getSnapshot()?.status === 'playing') player.pause(); else player.play();
        break;
      case 'Escape': post({ type: 'close' }); break;
      default: return;
    }
  };
  doc.addEventListener('keydown', onKey);

  const mq = win.matchMedia?.('(prefers-color-scheme: light)');
  const onScheme = () => { if (options.theme === 'auto' || options.theme === undefined) { const t = resolveTheme('auto', win); root.dataset.theme = t; player.setTheme(t); } };
  mq?.addEventListener?.('change', onScheme);

  player.load(animation, animationId);
  setExpanded(false, false);
  post({ type: 'ready' });
  root.focus({ preventScroll: true });

  return {
    player,
    destroy() {
      clearAuto();
      doc.removeEventListener('keydown', onKey);
      mq?.removeEventListener?.('change', onScheme);
      unsubscribe();
      player.destroy();
      container.replaceChildren();
    },
  };
}
