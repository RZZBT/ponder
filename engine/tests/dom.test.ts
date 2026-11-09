// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { start, stop, mount as rawMount, type HostMessage, type PonderHandle } from '../src/index';
import { Player } from '../src/player/player';
import { SvgRenderer } from '../src/renderer/svg';
import type { Animation } from '../src/scene/model';
import { FakeScheduler, demoText, tiny } from './helpers';

let host: HTMLElement;
const handles: PonderHandle[] = [];
/** mount() that is always torn down after the test, so key handlers of one test never leak into another. */
const mount: typeof rawMount = (...args) => { const h = rawMount(...args); handles.push(h); return h; };
beforeEach(() => {
  document.body.innerHTML = '<div id="ponder-root"></div>';
  host = document.getElementById('ponder-root')!;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { handles.splice(0).forEach((h) => h.destroy()); stop(); vi.unstubAllGlobals(); });

describe('SvgRenderer', () => {
  const run = (a: Animation) => {
    const renderer = new SvgRenderer(host);
    const player = new Player(renderer, { scheduler: new FakeScheduler(), autoplay: false });
    player.load(a);
    return { renderer, player };
  };

  it('builds one <g> per actor inside a viewBox of the logical scene size', () => {
    run(tiny([]));
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 600');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelectorAll('g[transform]')).toHaveLength(2);
    expect(svg.querySelector('circle')!.getAttribute('r')).toBe('10');
  });

  it('draws the exact target state when a transition ends', () => {
    const { player } = run(tiny([{ to: 's1', duration: 400, easing: 'linear' }]));
    const g = () => host.querySelector('circle')!.parentElement!;
    expect(g().getAttribute('transform')).toContain('translate(0 100)');
    player.next();
    player.advance(200);
    expect(g().getAttribute('transform')).toContain('translate(50 100)');
    player.advance(200);
    expect(g().getAttribute('transform')).toContain('translate(100 100)');
    expect(host.querySelector('circle')!.getAttribute('fill')).toBe('rgb(255,0,0)');
  });

  it('renders author text strictly as text (no markup, no script, no handlers)', () => {
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';
    const a = tiny([]);
    (a.actors.label as unknown as { text: string }).text = evil;
    run(a);
    const t = host.querySelector('text')!;
    expect(t.textContent).toBe(evil);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.innerHTML).not.toContain('<img');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it('never writes NaN/Infinity into the DOM', () => {
    const a = tiny([]);
    (a.slides[0] as { changes?: unknown }).changes = { dot: { scale: 0 } };
    run(a);
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('honours z ordering, including inside groups', () => {
    const a: Animation = {
      symbol: 'a.B#c()', title: 'z',
      actors: {
        g: { type: 'group' },
        low: { type: 'circle', parent: 'g', z: 5 },
        high: { type: 'circle', parent: 'g', z: 1 },
        top: { type: 'circle', z: -1 },
      },
      slides: [{ id: 'a' }],
    };
    run(a);
    const g = [...host.querySelectorAll('g')].find((e) => e.children.length === 2 && e.parentElement!.tagName === 'g')!;
    // 'high'(z=1) is declared after 'low'(z=5) but sorts first
    expect(g.children[0]!.querySelector('circle')).not.toBeNull();
    const roots = [...host.querySelector('svg > g:last-of-type')!.children];
    expect(roots[0]!.querySelector('circle')).not.toBeNull(); // 'top' z=-1 comes first
    expect(roots).toHaveLength(2);
  });

  it('removes its DOM on destroy and rebuilds cleanly when another animation loads', () => {
    const { player } = run(tiny([]));
    player.load(tiny([]));
    expect(host.querySelectorAll('svg')).toHaveLength(1);
    player.destroy();
    expect(host.querySelectorAll('svg')).toHaveLength(0);
  });

  it('draws polygons and arrows', () => {
    const a: Animation = {
      symbol: 'a.B#c()', title: 'p',
      actors: { p: { type: 'polygon', points: [[0, 0], [50, 0], [0, 50]] }, ar: { type: 'arrow', width: 100, height: 0, strokeWidth: 4 } },
      slides: [{ id: 'a' }],
    };
    run(a);
    expect(host.querySelector('polygon')!.getAttribute('points')).toBe('0,0 50,0 0,50');
    expect(host.querySelector('path')!.getAttribute('d')).toMatch(/^M100 0 L/);
  });
});

describe('mount() shell', () => {
  const messages: HostMessage[] = [];
  const opts = { theme: 'dark' as const, autoplay: false, reducedMotion: false, onHostMessage: (m: HostMessage) => messages.push(m) };
  beforeEach(() => { messages.length = 0; });

  it('mounts the demo with title, caption, controls and progress dots', () => {
    const h = mount(host, demoText(), 'clamp-int', opts);
    expect(h.player).not.toBeNull();
    expect(host.querySelector('.ponder-title')!.textContent).toBe('How clamp() works');
    expect(host.querySelector('.ponder-caption')!.textContent).toContain('keeps a number inside a range');
    expect(host.querySelectorAll('.ponder-dot')).toHaveLength(6);
    expect(host.querySelectorAll('.ponder-controls button')).toHaveLength(5); // prev, play, next, replay, auto
    expect(messages).toEqual([{ type: 'ready' }]);
  });

  it('the "auto" toggle moves past slides that wait for Next', () => {
    vi.useFakeTimers();
    try {
      const h = mount(host, demoText(), 'clamp-int', { ...opts, autoplay: true });
      h.player!.advance(5000); // the demo's first transition is automatic, the second waits
      expect(h.player!.getSnapshot()).toMatchObject({ index: 1, status: 'waiting', awaitingUser: true });
      vi.advanceTimersByTime(10_000);
      expect(h.player!.getSnapshot()!.index).toBe(1); // off by default: nothing happens
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      const btn = host.querySelector('[aria-label^="Auto-advance"]')!;
      expect(btn.textContent).toBe('auto: on');
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      vi.advanceTimersByTime(1500); // pause, then Next by itself
      h.player!.advance(5000);
      expect(h.player!.getSnapshot()!.index).toBe(2);
      (btn as HTMLButtonElement).click(); // off again: stays
      vi.advanceTimersByTime(10_000);
      h.player!.advance(5000);
      expect(h.player!.getSnapshot()!.index).toBe(2);
      expect(btn.textContent).toBe('auto: off');
    } finally { vi.useRealTimers(); }
  });

  it('navigates with the keyboard and buttons', () => {
    const h = mount(host, demoText(), 'clamp-int', opts);
    const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowRight');
    h.player!.advance(5000);
    expect(h.player!.getSnapshot()!.index).toBe(1);
    key('ArrowLeft');
    h.player!.advance(5000);
    expect(h.player!.getSnapshot()!.index).toBe(0);
    key('End');
    expect(h.player!.getSnapshot()!.status).toBe('finished');
    key('r');
    expect(h.player!.getSnapshot()!.index).toBe(0);
    (host.querySelector('[aria-label^="Next"]') as HTMLButtonElement).click();
    h.player!.advance(5000);
    expect(h.player!.getSnapshot()!.index).toBe(1);
  });

  it('does not react to keys combined with modifiers (leaves IDE shortcuts alone)', () => {
    const h = mount(host, demoText(), 'clamp-int', opts);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', altKey: true, bubbles: true }));
    h.player!.advance(5000);
    expect(h.player!.getSnapshot()!.index).toBe(0);
  });

  it('posts close and expand messages to the host', () => {
    mount(host, demoText(), 'clamp-int', opts);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    expect(messages).toContainEqual({ type: 'close' });
    expect(messages).toContainEqual({ type: 'toggleExpand', expanded: true });
    expect(host.querySelector('.ponder')!.getAttribute('data-mode')).toBe('expanded');
  });

  it('shows a readable error panel for invalid files and reports it to the host', () => {
    const bad = '{"version":1,"library":{"group":"g","name":"n"},"animations":{"a":{"symbol":"nope","title":"t","actors":{},"slides":[]}}}';
    const h = mount(host, bad, 'a', opts);
    expect(h.player).toBeNull();
    expect(host.querySelector('.ponder-error')).not.toBeNull();
    expect(host.textContent).toContain('animations.a.symbol');
    expect(messages[0]).toMatchObject({ type: 'error' });
  });

  it('reports an unknown animation id', () => {
    mount(host, demoText(), 'nope', opts);
    expect(host.textContent).toContain('No animation with this id');
  });

  it('survives garbage input without throwing', () => {
    expect(() => mount(host, '{{{', 'x', opts)).not.toThrow();
    expect(() => mount(host, null, 'x', opts)).not.toThrow();
  });

  it('only accepts #hex IDE colors (no CSS injection)', () => {
    mount(host, demoText(), 'clamp-int', {
      ...opts, colors: { background: '#112233', foreground: 'red; background:url(http://evil)', accent: 'url(javascript:1)' },
    });
    const root = host.querySelector<HTMLElement>('.ponder')!;
    expect(root.style.getPropertyValue('--ponder-ide-background')).toBe('#112233');
    expect(root.style.getPropertyValue('--ponder-ide-foreground')).toBe('');
    expect(root.style.getPropertyValue('--ponder-ide-accent')).toBe('');
  });

  it('start() replaces the previous animation without leaking DOM or key handlers', () => {
    for (let i = 0; i < 20; i++) start(demoText(), 'clamp-int', opts);
    expect(host.querySelectorAll('.ponder')).toHaveLength(1);
    expect(host.querySelectorAll('svg.ponder-svg')).toHaveLength(1);
    const before = messages.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(messages.length - before).toBe(1); // exactly one live handler
    stop();
    expect(host.children).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(messages.length - before).toBe(1); // handler removed
  });

  it('reduced motion: no auto-advance and instant steps', () => {
    const h = mount(host, demoText(), 'clamp-int', { ...opts, reducedMotion: true, autoplay: true });
    h.player!.advance(60_000);
    expect(h.player!.getSnapshot()!.index).toBe(0);
    h.player!.next();
    expect(h.player!.getSnapshot()).toMatchObject({ index: 1, transitioning: false });
  });
});
