import {access, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {getOutputLockPath} from '../../src/render/output-lock.js';
import {createPackageFixture, validManifest, validTimeline} from '../fixtures.js';
import {startCli, type RunningCli} from './process-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

const waitForPath = async (path: string): Promise<void> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for ${path}.`);
};

const stopHard = async (process: RunningCli): Promise<void> => {
  if (process.child.exitCode === null && process.child.signalCode === null) {
    process.child.kill('SIGKILL');
  }
  await process.completion;
};

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('interrupted render recovery', () => {
  it('does not publish a killed render and reclaims its dead-process lock on retry', async () => {
    const fixture = await createPackageFixture({
      durationMs: 10_000,
      manifest: {...validManifest, channelId: 'interrupted-channel', runId: 'interrupted-run'},
      timeline: {shots: [{...validTimeline.shots[0], endMs: 10_000}]},
    });
    cleanups.push(fixture.cleanup);
    const outputRoot = await mkdtemp(join(tmpdir(), 'video-renderer-interrupted-'));
    cleanups.push(() => rm(outputRoot, {recursive: true, force: true}));
    const output = join(outputRoot, 'output');
    const args = [
      'render', '--input', fixture.root, '--output', output, '--concurrency', '1',
    ] as const;
    const lockPath = await getOutputLockPath(output);

    const killed = startCli(args);
    await waitForPath(lockPath);
    await stopHard(killed);
    expect(killed.child.signalCode).toBe('SIGKILL');
    await expect(stat(join(output, 'rough-cut.mp4'))).rejects.toMatchObject({code: 'ENOENT'});

    const retry = startCli(args);
    const retryResult = await retry.completion;
    expect(retryResult.code, retryResult.stderr).toBe(0);
    await expect(stat(join(output, 'rough-cut.mp4'))).resolves.toMatchObject({size: expect.any(Number)});
  }, 180_000);
});
