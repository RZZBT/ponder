// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type PonderHandle } from '../src/index';
import { demoText } from './helpers';

let host: HTMLElement;
let handle: PonderHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root')!;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { handle?.destroy(); handle = null; vi.unstubAllGlobals(); });

const opts = { theme: 'dark' as const, autoplay: false, reducedMotion: false };

describe('source label', () => {
  it('shows where the animation comes from as plain text', () => {
    handle = mount(host, demoText(), 'clamp-int', { ...opts, sourceLabel: 'Community index · pypi/numpy' });
    const el = host.querySelector('.ponder-source')!;
    expect(el.textContent).toBe('Community index · pypi/numpy');
  });

  it('is absent when not given', () => {
    handle = mount(host, demoText(), 'clamp-int', opts);
    expect(host.querySelector('.ponder-source')).toBeNull();
  });

  it('never renders markup, strips control characters and is capped', () => {
    const evil = '<img src=x onerror=alert(1)>\u0000\u001b' + 'x'.repeat(200);
    handle = mount(host, demoText(), 'clamp-int', { ...opts, sourceLabel: evil });
    const el = host.querySelector('.ponder-source')!;
    expect(host.querySelector('img')).toBeNull();
    expect(el.textContent!.length).toBeLessThanOrEqual(80);
    expect(el.textContent).not.toMatch(/[\u0000-\u001f]/);
  });

  it('ignores non-string values', () => {
    handle = mount(host, demoText(), 'clamp-int', { ...opts, sourceLabel: { toString: () => 'x' } as unknown as string });
    expect(host.querySelector('.ponder-source')).toBeNull();
  });
});
