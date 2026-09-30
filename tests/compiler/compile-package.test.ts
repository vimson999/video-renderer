import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {compilePackage} from '../../src/compiler/compile-package.js';
import {RendererError} from '../../src/contracts/errors.js';
import {validatePackage} from '../../src/validation/validate-package.js';
import {
  createPackageFixture,
  makePcmWav,
  type PackageFixture,
  validTimeline,
} from '../fixtures.js';

const fixtures: PackageFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

const createFixture = async (
  timeline: Record<string, unknown>,
  audioDurationMs = 1_000,
): Promise<PackageFixture> => {
  const created = await createPackageFixture({timeline});
  fixtures.push(created);
  await writeFile(
    join(created.root, 'narration.wav'),
    makePcmWav({durationMs: audioDurationMs}),
  );
  return created;
};

const crossfadeTimeline = (transitionDurationMs = 100): Record<string, unknown> => ({
  shots: [
    {
      ...validTimeline.shots[0],
      endMs: 500,
      motion: {preset: 'slow-zoom-in', intensity: 0.08},
      transitionOut: {type: 'crossfade', durationMs: transitionDurationMs},
    },
    {
      ...validTimeline.shots[0],
      id: 'shot-002',
      startMs: 500,
      motion: {preset: 'pan-left', intensity: 0.1},
    },
  ],
});

describe('compilePackage', () => {
  it('produces deterministic props with contiguous frames and preserved duration', async () => {
    const created = await createFixture(crossfadeTimeline());
    const validated = await validatePackage(created.root);

    const first = compilePackage(validated);
    const second = compilePackage(validated);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toMatchObject({
      identity: {channelId: 'channel-a', videoId: 'video-a', runId: 'run-a'},
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 30,
      audioSrc: 'narration.wav',
    });
    expect(first.shots).toEqual([
      {
        id: 'shot-001',
        from: 0,
        durationInFrames: 15,
        src: 'assets/shot-001.png',
        fit: 'cover',
        motion: {preset: 'slow-zoom-in', intensity: 0.08},
        incomingPreview: {
          from: 12,
          durationInFrames: 3,
          src: 'assets/shot-001.png',
          fit: 'cover',
          motion: {preset: 'pan-left', intensity: 0.1},
        },
      },
      {
        id: 'shot-002',
        from: 15,
        durationInFrames: 15,
        src: 'assets/shot-001.png',
        fit: 'cover',
        motion: {preset: 'pan-left', intensity: 0.1},
      },
    ]);
    expect(first.shots[0]!.from + first.shots[0]!.durationInFrames).toBe(
      first.shots[1]!.from,
    );
    expect(first.captions[0]).toMatchObject({
      text: '示例字幕',
      startMs: 0,
      endMs: 1_000,
    });
  });

  it('rejects a positive-duration shot that rounds to zero frames', async () => {
    const created = await createFixture(
      {shots: [{...validTimeline.shots[0], endMs: 16}]},
      16,
    );
    await writeFile(
      join(created.root, 'subtitle.srt'),
      '1\n00:00:00,000 --> 00:00:00,016\n短\n',
    );
    const validated = await validatePackage(created.root);

    const error = (() => {
      try {
        compilePackage(validated);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(RendererError);
    expect(error).toMatchObject({kind: 'validation', exitCode: 2});
    expect((error as RendererError).issues[0]).toMatchObject({
      code: 'frame.zero_shot',
      field: '/shots/0/endMs',
      shotId: 'shot-001',
    });
  });

  it('rejects a positive crossfade that rounds to zero frames', async () => {
    const created = await createFixture(crossfadeTimeline(10));
    const validated = await validatePackage(created.root);

    const error = (() => {
      try {
        compilePackage(validated);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(RendererError);
    expect((error as RendererError).issues[0]).toMatchObject({
      code: 'frame.zero_transition',
      field: '/shots/0/transitionOut/durationMs',
      shotId: 'shot-001',
    });
  });
});
