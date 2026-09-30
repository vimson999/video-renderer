import {execFile as execFileCallback} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

import sharp from 'sharp';
import {afterEach, describe, expect, it} from 'vitest';

import {RendererError} from '../../src/contracts/errors.js';
import {inspectNarration, inspectStill} from '../../src/validation/media.js';
import {makePcmWav, onePixelPng} from '../fixtures.js';

const temporaryDirectories: string[] = [];
const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);

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

  it('accepts WAV and PNG content even when extensions are misleading', async () => {
    const audio = await temporaryFile('narration.mp3', makePcmWav());
    const image = await temporaryFile('shot.webp', onePixelPng);

    await expect(inspectNarration(audio)).resolves.toMatchObject({durationMs: 1_000});
    await expect(inspectStill(image)).resolves.toMatchObject({format: 'png'});
  });

  it('rejects decodable non-WAV narration content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-renderer-media-'));
    temporaryDirectories.push(directory);
    const wav = join(directory, 'source.wav');
    const mp3 = join(directory, 'narration.wav');
    await writeFile(wav, makePcmWav());
    const ffmpeg = require('ffmpeg-static') as string;
    await execFile(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
      '-codec:a', 'libmp3lame', '-f', 'mp3', mp3,
    ]);

    await expect(inspectNarration(mp3)).rejects.toMatchObject({
      kind: 'media',
      exitCode: 4,
      issues: [expect.objectContaining({code: 'media.audio_format'})],
    });
  });

  it('rejects decodable image content outside PNG and JPEG', async () => {
    const webp = await sharp({
      create: {width: 2, height: 2, channels: 3, background: '#ff0000'},
    }).webp().toBuffer();
    const path = await temporaryFile('shot.png', webp);

    await expect(inspectStill(path)).rejects.toMatchObject({
      kind: 'media',
      exitCode: 4,
      issues: [expect.objectContaining({code: 'media.image_format'})],
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
