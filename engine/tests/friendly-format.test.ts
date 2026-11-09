// The authoring shortcuts: "//" comments, autoAdvance, slides without ids, timing written on slides.
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../src/parser/validate';
import { Player } from '../src/player/player';
import { compileAnimation } from '../src/scene/compile';
import type { Animation } from '../src/scene/model';
import { FakeScheduler, RecordingRenderer } from './helpers';

const fixture = resolve(__dirname, '../../schema/fixtures/valid-friendly-format.json');
const text = readFileSync(fixture, 'utf8');
const doc = () => parseDocument(text).document!;

describe('friendly format', () => {
  it('is valid for the engine validator and the JSON schema', () => {
    expect(parseDocument(text).errors).toEqual([]);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = ajv.compile(JSON.parse(readFileSync(resolve(__dirname, '../../schema/ponder.schema.json'), 'utf8')));
    expect(schema(JSON.parse(text)), JSON.stringify(schema.errors)).toBe(true);
  });

  it('merges timing: autoAdvance < transitions[] entry < fields on the slide', () => {
    const c = compileAnimation('a', doc().animations.a!);
    expect(c.scenes.map((s) => s.id)).toEqual(['slide-1', 'slide-2', 'slide-3', 'last']);
    // slide 2: autoAdvance (auto, 1.5 s dwell) + its own duration
    expect(c.transitions[0]).toMatchObject({ trigger: 'auto', delay: 1500, duration: 400, style: 'fluid' });
    // slide 3 opts out: waits for the user, and does not inherit the auto dwell
    expect(c.transitions[1]).toMatchObject({ trigger: 'next', delay: 0, style: 'direct' });
    // "last": autoAdvance + the transitions[] entry
    expect(c.transitions[2]).toMatchObject({ trigger: 'auto', delay: 1500, easing: 'ease-out' });
  });

  it('autoAdvance with a number sets the pause on every slide', () => {
    const c = compileAnimation('b', doc().animations.b!);
    expect(c.transitions[0]).toMatchObject({ trigger: 'auto', delay: 2500 });
  });

  it('an autoAdvance animation plays to the end with no clicks', () => {
    const anim: Animation = {
      symbol: 'a.B#c()', title: 't', autoAdvance: 300,
      actors: { dot: { type: 'circle', x: 0 } },
      slides: [{ caption: 'a' }, { caption: 'b', changes: { dot: { x: 10 } } }, { caption: 'c', changes: { dot: { x: 20 } } }],
    };
    const scheduler = new FakeScheduler();
    const player = new Player(new RecordingRenderer(), { scheduler });
    player.load(anim, 't');
    for (let i = 0; i < 200 && player.getSnapshot()!.status !== 'finished'; i++) scheduler.step(50);
    expect(player.getSnapshot()).toMatchObject({ index: 2, status: 'finished' });
  });

  it('without autoAdvance the same animation waits for Next', () => {
    const anim: Animation = {
      symbol: 'a.B#c()', title: 't',
      actors: { dot: { type: 'circle', x: 0 } },
      slides: [{ caption: 'a' }, { caption: 'b', changes: { dot: { x: 10 } } }],
    };
    const scheduler = new FakeScheduler();
    const player = new Player(new RecordingRenderer(), { scheduler });
    player.load(anim, 't');
    for (let i = 0; i < 200; i++) scheduler.step(50);
    expect(player.getSnapshot()).toMatchObject({ index: 0, status: 'waiting', awaitingUser: true });
  });
});
