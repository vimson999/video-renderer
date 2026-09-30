import {stat} from 'node:fs/promises';
import {join} from 'node:path';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {RendererError} from '../../src/contracts/errors.js';
import {prepareJobWorkspace} from '../../src/jobs/workspace.js';
import {runCli, type CliIo} from '../../src/cli/run-cli.js';
import type {RenderRequest, RenderResult} from '../../src/render/renderer.js';
import {createPackageFixture} from '../fixtures.js';

const cleanups: Array<() => Promise<void>> = [];

const io = (): {value: CliIo; stdout: string[]; stderr: string[]} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    value: {stdout: (message) => stdout.push(message), stderr: (message) => stderr.push(message)},
    stdout,
    stderr,
  };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('render command', () => {
  it('forwards integer concurrency and cleans the staged workspace', async () => {
    const fixture = await createPackageFixture();
    cleanups.push(fixture.cleanup);
    let captured: RenderRequest | undefined;
    let stagedRoot: string | undefined;
    const capturedIo = io();

    const exitCode = await runCli([
      'render', '--input', fixture.root, '--output', join(fixture.root, '..', 'output'), '--concurrency', '2',
    ], capturedIo.value, {
      prepareWorkspace: async (...args) => {
        const workspace = await prepareJobWorkspace(...args);
        stagedRoot = workspace.rootDir;
        return workspace;
      },
      render: async (request) => {
        captured = request;
        return {
          outputDir: request.outputDir,
          media: {codec: 'h264', width: 1080, height: 1920, fps: 30, durationMs: 1_000, sizeBytes: 1},
          report: {identity: request.compiled.identity},
        } as unknown as RenderResult;
      },
    });

    expect(exitCode).toBe(0);
    expect(captured?.concurrency).toBe(2);
    expect(JSON.parse(capturedIo.stdout.join('\n'))).toMatchObject({ok: true, outputDir: expect.any(String)});
    await expect(stat(stagedRoot!)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it.each([
    ['render', 6],
    ['media', 7],
  ] as const)('maps %s failures to exit code %i', async (kind, exitCode) => {
    const fixture = await createPackageFixture();
    cleanups.push(fixture.cleanup);
    const capturedIo = io();
    const render = vi.fn(async () => {
      throw new RendererError({
        kind,
        exitCode,
        message: `${kind} failed`,
      });
    });

    expect(await runCli([
      'render', '--input', fixture.root, '--output', join(fixture.root, '..', `output-${kind}`), '--concurrency', '1',
    ], capturedIo.value, {render})).toBe(exitCode);
    expect(capturedIo.stderr.join('\n')).toContain(kind);
  });
});
