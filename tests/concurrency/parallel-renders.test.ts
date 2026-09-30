import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import sharp from 'sharp';
import {afterEach, describe, expect, it} from 'vitest';

import {probeRenderedVideo} from '../../src/render/media-report.js';
import {createPackageFixture, validManifest} from '../fixtures.js';
import {startCli} from './process-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const coloredPng = (color: {r: number; g: number; b: number}) =>
  sharp({create: {width: 32, height: 32, channels: 3, background: color}}).png().toBuffer();

describe('parallel CLI renders', () => {
  it('keeps two channel/video jobs isolated through reports, hashes, and outputs', async () => {
    const [red, blue] = await Promise.all([
      createPackageFixture({
        manifest: {...validManifest, channelId: 'channel-red', videoId: 'video-red', runId: 'run-red'},
        asset: await coloredPng({r: 255, g: 0, b: 0}),
      }),
      createPackageFixture({
        manifest: {...validManifest, channelId: 'channel-blue', videoId: 'video-blue', runId: 'run-blue'},
        asset: await coloredPng({r: 0, g: 0, b: 255}),
      }),
    ]);
    cleanups.push(red.cleanup, blue.cleanup);
    const outputRoot = await mkdtemp(join(tmpdir(), 'video-renderer-parallel-'));
    cleanups.push(() => rm(outputRoot, {recursive: true, force: true}));
    const redOutput = join(outputRoot, 'red');
    const blueOutput = join(outputRoot, 'blue');

    const redProcess = startCli([
      'render', '--input', red.root, '--output', redOutput, '--concurrency', '1',
    ]);
    const blueProcess = startCli([
      'render', '--input', blue.root, '--output', blueOutput, '--concurrency', '1',
    ]);
    const [redResult, blueResult] = await Promise.all([redProcess.completion, blueProcess.completion]);

    expect(redResult.code, redResult.stderr).toBe(0);
    expect(blueResult.code, blueResult.stderr).toBe(0);
    const redReport = JSON.parse(await readFile(join(redOutput, 'render-report.json'), 'utf8'));
    const blueReport = JSON.parse(await readFile(join(blueOutput, 'render-report.json'), 'utf8'));
    expect(redReport.identity).toEqual({channelId: 'channel-red', videoId: 'video-red', runId: 'run-red'});
    expect(blueReport.identity).toEqual({channelId: 'channel-blue', videoId: 'video-blue', runId: 'run-blue'});
    expect(redReport.inputPackageSha256).not.toBe(blueReport.inputPackageSha256);
    expect(redReport.output.sha256).not.toBe(blueReport.output.sha256);
  }, 120_000);

  it('lets a valid job complete when a neighboring delayed job becomes invalid', async () => {
    const valid = await createPackageFixture({
      manifest: {...validManifest, channelId: 'channel-valid', videoId: 'video-valid', runId: 'run-valid'},
    });
    const invalid = await createPackageFixture({
      manifest: {...validManifest, channelId: 'channel-invalid', videoId: 'video-invalid', runId: 'run-invalid'},
    });
    cleanups.push(valid.cleanup, invalid.cleanup);
    const outputRoot = await mkdtemp(join(tmpdir(), 'video-renderer-failure-isolation-'));
    cleanups.push(() => rm(outputRoot, {recursive: true, force: true}));
    const validOutput = join(outputRoot, 'valid');
    const invalidOutput = join(outputRoot, 'invalid');

    const validProcess = startCli([
      'render', '--input', valid.root, '--output', validOutput, '--concurrency', '1',
    ]);
    const invalidProcess = startCli([
      'render', '--input', invalid.root, '--output', invalidOutput, '--concurrency', '1',
    ], {delayMs: 400});
    await writeFile(join(invalid.root, 'narration.wav'), 'corrupted after process launch');
    const [validResult, invalidResult] = await Promise.all([
      validProcess.completion,
      invalidProcess.completion,
    ]);

    expect(validResult.code, validResult.stderr).toBe(0);
    expect(invalidResult.code).toBe(4);
    await expect(probeRenderedVideo(join(validOutput, 'rough-cut.mp4'))).resolves.toMatchObject({
      codec: 'h264', width: 1080, height: 1920,
    });
    await expect(stat(join(invalidOutput, 'rough-cut.mp4'))).rejects.toMatchObject({code: 'ENOENT'});
  }, 120_000);
});
