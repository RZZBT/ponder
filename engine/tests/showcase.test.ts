// Every animation of the showcase library (examples/math-utils) compiles and plays from start to finish.
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/parser/validate';
import { Player } from '../src/player/player';
import { compileAnimation } from '../src/scene/compile';
import { FakeScheduler, RecordingRenderer, demoText } from './helpers';

const doc = parseDocument(demoText()).document!;

describe('showcase library', () => {
  it('has the expected animations', () => {
    expect(Object.keys(doc.animations)).toEqual([
      'clamp-int', 'is-between', 'gcd', 'binary-search', 'palindrome', 'insertion-sort', 'factorial', 'stack-new', 'stack-push', 'stack-pop',
    ]);
  });

  for (const [id, anim] of Object.entries(doc.animations)) {
    it(`${id} compiles`, () => {
      const c = compileAnimation(id, anim);
      expect(c.scenes.length).toBe(anim.slides.length);
      expect(c.actorOrder).not.toContain('//');
    });

    it(`${id} plays to the end`, () => {
      const scheduler = new FakeScheduler();
      const player = new Player(new RecordingRenderer(), { scheduler });
      player.load(anim, id);
      for (let i = 0; i < 5000 && player.getSnapshot()!.status !== 'finished'; i++) {
        if (player.getSnapshot()!.awaitingUser) player.next();
        scheduler.step(50);
      }
      expect(player.getSnapshot()).toMatchObject({ status: 'finished', index: anim.slides.length - 1 });
    });
  }
});
