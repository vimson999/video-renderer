import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {RendererError} from '../../src/contracts/errors.js';
import {inspectNarration, inspectStill} from '../../src/validation/media.js';
import {makePcmWav, onePixelPng} from '../fixtures.js';

const temporaryDirectories: string[] = [];

const temporaryFile = async (name: string, contents: string | Buffer): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'video-renderer-media-'));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {recursive: true, force: true}),
    ),
  );
});

describe('media inspection', () => {
  it('reads duration, sample rate, and channel count from a local WAV', async () => {
    const path = await temporaryFile(
      'narration.wav',
      makePcmWav({durationMs: 1_000, sampleRate: 8_000, channelCount: 1}),
    );

    await expect(inspectNarration(path)).resolves.toEqual({
      durationMs: 1_000,
      sampleRate: 8_000,
      channelCount: 1,
    });
  });

  it('decodes image dimensions and format', async () => {
    const path = await temporaryFile('shot.png', onePixelPng);

    await expect(inspectStill(path)).resolves.toEqual({
      width: 1,
      height: 1,
      format: 'png',
    });
  });

  it('maps a corrupt still to media exit code 4', async () => {
    const path = await temporaryFile('broken.png', 'not an image');

    const error = await inspectStill(path).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RendererError);
    expect(error).toMatchObject({kind: 'media', exitCode: 4});
  });

  it.each([
    ['corrupt', async () => temporaryFile('broken.wav', 'not audio')],
    ['missing', async () => join(tmpdir(), 'video-renderer-does-not-exist.wav')],
  ])('maps %s narration to media exit code 4', async (_name, getPath) => {
    const error = await inspectNarration(await getPath()).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RendererError);
    expect(error).toMatchObject({kind: 'media', exitCode: 4});
  });
});
