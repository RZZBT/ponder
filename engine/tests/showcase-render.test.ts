// @vitest-environment jsdom
// Every showcase animation renders with the real SVG renderer, at every slide and between slides (seek).
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/parser/validate';
import { Player } from '../src/player/player';
import { SvgRenderer } from '../src/renderer/svg';
import { FakeScheduler, demoText } from './helpers';

const doc = parseDocument(demoText()).document!;

describe('showcase rendering', () => {
  for (const [id, anim] of Object.entries(doc.animations)) {
    it(`${id} renders at every point`, () => {
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host')!;
      const player = new Player(new SvgRenderer(host), { scheduler: new FakeScheduler(), autoplay: false });
      player.load(anim, id);
      const n = anim.slides.length;
      for (let k = 0; k <= 4 * (n - 1); k++) player.seek(n > 1 ? k / (4 * (n - 1)) : 0);
      expect(host.querySelectorAll('svg')).toHaveLength(1);
      expect(player.getSnapshot()!.index).toBe(n - 1);
      player.destroy();
    });
  }
});
