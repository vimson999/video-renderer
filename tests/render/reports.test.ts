import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {createPackageFixture} from '../fixtures.js';
import {
  createRenderReport,
  hashInputPackage,
  sha256File,
} from '../../src/render/reports.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('render reports', () => {
  it('hashes package paths and contents deterministically', async () => {
    const fixture = await createPackageFixture();
    cleanups.push(fixture.cleanup);
    const first = await hashInputPackage(fixture.root);
    const second = await hashInputPackage(fixture.root);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);

    await writeFile(join(fixture.root, 'subtitle.srt'), 'changed\n');
    await expect(hashInputPackage(fixture.root)).resolves.not.toBe(first);
  });

  it('records reproducible identity, media, timing, validation, and hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-renderer-report-'));
    cleanups.push(() => rm(root, {recursive: true, force: true}));
    const mediaPath = join(root, 'rough-cut.mp4');
    await writeFile(mediaPath, 'rendered bytes');
    const outputSha256 = await sha256File(mediaPath);
    expect(outputSha256).toMatch(/^[a-f0-9]{64}$/);

    const report = createRenderReport({
      identity: {channelId: 'health', videoId: 'carrot', runId: 'run-1'},
      inputPackageSha256: 'a'.repeat(64),
      outputSha256,
      media: {
        codec: 'h264',
        width: 1080,
        height: 1920,
        fps: 30,
        durationMs: 3_000,
        sizeBytes: 14,
      },
      concurrency: 2,
      startedAt: '2026-09-30T00:00:00.000Z',
      finishedAt: '2026-09-30T00:00:02.500Z',
      validation: {
        schemaVersion: '1.0',
        valid: true,
        identity: {channelId: 'health', videoId: 'carrot', runId: 'run-1'},
        issueCount: 0,
        warningCount: 0,
        shotCount: 1,
        captionCount: 1,
        audioDurationMs: 3_000,
      },
      warnings: [],
    });

    expect(report).toMatchObject({
      rendererVersion: '0.1.0',
      contractVersion: '1.0',
      identity: {channelId: 'health', videoId: 'carrot', runId: 'run-1'},
      concurrency: 2,
      elapsedMs: 2_500,
      inputPackageSha256: 'a'.repeat(64),
      output: {sha256: outputSha256, codec: 'h264', width: 1080, height: 1920, fps: 30},
      validation: {valid: true, issueCount: 0, warningCount: 0},
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(await readFile(mediaPath, 'utf8')).toBe('rendered bytes');
  });
});
