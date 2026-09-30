import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {compilePackage} from '../../src/compiler/compile-package.js';
import {prepareJobWorkspace} from '../../src/jobs/workspace.js';
import {probeRenderedVideo} from '../../src/render/media-report.js';
import {renderJob} from '../../src/render/renderer.js';
import {validatePackage} from '../../src/validation/validate-package.js';
import {createPackageFixture, validTimeline} from '../fixtures.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const prepareThreeSecondJob = async () => {
  const fixture = await createPackageFixture({
    durationMs: 3_000,
    timeline: {
      shots: [{...validTimeline.shots[0], endMs: 3_000}],
    },
  });
  cleanups.push(fixture.cleanup);
  const validated = await validatePackage(fixture.root);
  const compiled = compilePackage(validated);
  const workspace = await prepareJobWorkspace(validated, compiled);
  cleanups.push(workspace.cleanup);
  const parent = await mkdtemp(join(tmpdir(), 'video-renderer-output-'));
  cleanups.push(() => rm(parent, {recursive: true, force: true}));
  return {fixture, validated, compiled, workspace, outputDir: join(parent, 'render-output')};
};

describe('renderJob', () => {
  it('renders and atomically publishes a technically valid vertical H.264 MP4 and reports', async () => {
    const job = await prepareThreeSecondJob();
    const result = await renderJob({
      inputDir: job.fixture.root,
      outputDir: job.outputDir,
      workspace: job.workspace,
      compiled: job.compiled,
      validationReport: job.validated.report,
      warnings: job.validated.warnings,
      concurrency: 1,
    });

    expect(result.outputDir).toBe(job.outputDir);
    expect((await stat(join(job.outputDir, 'rough-cut.mp4'))).size).toBeGreaterThan(0);
    const media = await probeRenderedVideo(join(job.outputDir, 'rough-cut.mp4'));
    expect(media).toMatchObject({codec: 'h264', width: 1080, height: 1920});
    expect(media.fps).toBeCloseTo(30, 1);
    expect(media.durationMs).toBeCloseTo(3_000, -2);

    const renderReport = JSON.parse(await readFile(join(job.outputDir, 'render-report.json'), 'utf8'));
    const validationReport = JSON.parse(await readFile(join(job.outputDir, 'validation-report.json'), 'utf8'));
    expect(renderReport).toMatchObject({
      identity: job.compiled.identity,
      concurrency: 1,
      inputPackageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      output: {
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        codec: 'h264',
        width: 1080,
        height: 1920,
      },
    });
    expect(validationReport).toEqual(job.validated.report);
  }, 120_000);

  it('does not publish a final MP4 when the renderer fails', async () => {
    const job = await prepareThreeSecondJob();
    await expect(renderJob({
      inputDir: job.fixture.root,
      outputDir: job.outputDir,
      workspace: job.workspace,
      compiled: job.compiled,
      validationReport: job.validated.report,
      warnings: [],
      concurrency: 1,
      render: async () => {
        throw new Error('injected render failure');
      },
    })).rejects.toMatchObject({kind: 'render', exitCode: 6});

    await expect(stat(join(job.outputDir, 'rough-cut.mp4'))).rejects.toMatchObject({code: 'ENOENT'});
  });
});
