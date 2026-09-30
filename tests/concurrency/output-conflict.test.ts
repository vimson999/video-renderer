import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {createPackageFixture} from '../fixtures.js';
import {startCli} from './process-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('same-output exclusion', () => {
  it('allows exactly one process to publish and rejects the other with exit code 3', async () => {
    const fixture = await createPackageFixture();
    cleanups.push(fixture.cleanup);
    const outputRoot = await mkdtemp(join(tmpdir(), 'video-renderer-conflict-'));
    cleanups.push(() => rm(outputRoot, {recursive: true, force: true}));
    const output = join(outputRoot, 'shared');
    const args = [
      'render', '--input', fixture.root, '--output', output, '--concurrency', '1',
    ] as const;

    const first = startCli(args);
    const second = startCli(args);
    const results = await Promise.all([first.completion, second.completion]);

    expect(results.map((result) => result.code).sort((a, b) => a - b)).toEqual([0, 3]);
    const report = JSON.parse(await readFile(join(output, 'render-report.json'), 'utf8'));
    expect(report.identity).toEqual({channelId: 'channel-a', videoId: 'video-a', runId: 'run-a'});
  }, 120_000);
});
