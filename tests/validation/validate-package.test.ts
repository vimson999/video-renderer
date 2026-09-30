import {rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {RendererError} from '../../src/contracts/errors.js';
import {validatePackage} from '../../src/validation/validate-package.js';
import {
  createPackageFixture,
  type PackageFixture,
  validManifest,
  validTimeline,
} from '../fixtures.js';

const fixtures: PackageFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

const createFixture = async (
  options?: Parameters<typeof createPackageFixture>[0],
): Promise<PackageFixture> => {
  const created = await createPackageFixture(options);
  fixtures.push(created);
  return created;
};

const writeSrt = async (root: string, contents: string): Promise<void> => {
  await writeFile(join(root, 'subtitle.srt'), contents);
};

const expectValidationError = async (
  operation: Promise<unknown>,
  code: string,
): Promise<RendererError> => {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(RendererError);
  expect(error).toMatchObject({
    kind: 'validation',
    exitCode: 2,
    identity: {channelId: 'channel-a', videoId: 'video-a', runId: 'run-a'},
  });
  expect((error as RendererError).issues.some((issue) => issue.code === code)).toBe(true);
  expect((error as RendererError).issues.every((issue) => issue.repair.length > 0)).toBe(true);
  return error as RendererError;
};

const twoShots = (
  first: Record<string, unknown> = {},
  second: Record<string, unknown> = {},
): Record<string, unknown> => ({
  shots: [
    {
      ...validTimeline.shots[0],
      endMs: 500,
      transitionOut: {type: 'cut', durationMs: 0},
      ...first,
    },
    {
      ...validTimeline.shots[0],
      id: 'shot-002',
      startMs: 500,
      asset: 'assets/shot-001.png',
      ...second,
    },
  ],
});

describe('validatePackage', () => {
  it('returns media, captions, identity, warnings, and a valid report', async () => {
    const created = await createFixture();

    const validated = await validatePackage(created.root);

    expect(validated.audio.durationMs).toBe(1_000);
    expect(validated.images.get('shot-001')).toMatchObject({format: 'png'});
    expect(validated.captions).toHaveLength(1);
    expect(validated.warnings).toEqual([]);
    expect(validated.report).toMatchObject({
      valid: true,
      identity: {channelId: 'channel-a', videoId: 'video-a', runId: 'run-a'},
      issueCount: 0,
    });
  });

  it('retains identity when a referenced asset is missing', async () => {
    const created = await createFixture();
    await rm(join(created.root, 'assets/shot-001.png'));

    await expectValidationError(validatePackage(created.root), 'path.missing');
  });

  it('rejects duplicate shot IDs', async () => {
    const created = await createFixture({
      timeline: twoShots({}, {id: 'shot-001'}),
    });
    await expectValidationError(validatePackage(created.root), 'timeline.duplicate_id');
  });

  it.each([
    ['first start', {shots: [{...validTimeline.shots[0], startMs: 10}]}, 'timeline.first_start'],
    ['reversed timing', {shots: [{...validTimeline.shots[0], startMs: 700, endMs: 600}]}, 'timeline.reversed'],
    ['a gap', twoShots({endMs: 400}), 'timeline.gap'],
    ['an overlap', twoShots({endMs: 600}), 'timeline.overlap'],
  ])('rejects %s', async (_name, timeline, code) => {
    const created = await createFixture({timeline});
    await expectValidationError(validatePackage(created.root), code);
  });

  it.each([
    ['fit', {...validTimeline.shots[0], fit: 'stretch'}, '/shots/0/fit'],
    [
      'motion',
      {...validTimeline.shots[0], motion: {preset: 'shake', intensity: 0.1}},
      '/shots/0/motion/preset',
    ],
    [
      'transition',
      {...validTimeline.shots[0], transitionOut: {type: 'wipe', durationMs: 100}},
      '/shots/0/transitionOut/type',
    ],
  ])('rejects unsupported %s with identity', async (_name, shot, field) => {
    const created = await createFixture({timeline: {shots: [shot]}});
    const error = await validatePackage(created.root).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RendererError);
    expect(error).toMatchObject({
      exitCode: 2,
      identity: {channelId: 'channel-a', videoId: 'video-a', runId: 'run-a'},
    });
    expect((error as RendererError).issues[0]).toMatchObject({field});
  });

  it('rejects a transition on the final shot', async () => {
    const created = await createFixture({
      timeline: {
        shots: [
          {...validTimeline.shots[0], transitionOut: {type: 'crossfade', durationMs: 100}},
        ],
      },
    });
    await expectValidationError(validatePackage(created.root), 'transition.final');
  });

  it('rejects a crossfade longer than either adjacent shot', async () => {
    const created = await createFixture({
      timeline: twoShots({endMs: 200, transitionOut: {type: 'crossfade', durationMs: 300}}, {startMs: 200}),
    });
    await expectValidationError(validatePackage(created.root), 'transition.duration');
  });

  it('rejects timeline duration outside the 100ms audio tolerance', async () => {
    const created = await createFixture({
      timeline: {shots: [{...validTimeline.shots[0], endMs: 1_101}]},
    });
    await expectValidationError(validatePackage(created.root), 'timeline.final_duration');
  });

  it.each([
    [
      'overlap',
      '1\n00:00:00,000 --> 00:00:00,700\n甲\n\n2\n00:00:00,600 --> 00:00:00,900\n乙\n',
      'subtitle.overlap',
    ],
    [
      'out of order',
      '1\n00:00:00,600 --> 00:00:00,800\n乙\n\n2\n00:00:00,000 --> 00:00:00,500\n甲\n',
      'subtitle.order',
    ],
    [
      'beyond audio',
      '1\n00:00:00,000 --> 00:00:01,101\n超时\n',
      'subtitle.duration',
    ],
  ])('rejects subtitles that are %s', async (_name, srt, code) => {
    const created = await createFixture();
    await writeSrt(created.root, srt);
    await expectValidationError(validatePackage(created.root), code);
  });

  it('collects multiple repairable semantic issues in deterministic order', async () => {
    const created = await createFixture({
      timeline: twoShots({id: 'same', startMs: 10, endMs: 400}, {id: 'same', startMs: 500}),
    });

    const error = await validatePackage(created.root).catch((caught: unknown) => caught) as RendererError;

    expect(error.issues.map((issue) => issue.code)).toEqual([
      'timeline.first_start',
      'timeline.duplicate_id',
      'timeline.gap',
    ]);
  });
});
