import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

import {runCli} from '../../src/cli/run-cli.js';
import {RendererError} from '../../src/contracts/errors.js';
import type {JobWorkspace} from '../../src/jobs/workspace.js';
import {prepareJobWorkspace} from '../../src/jobs/workspace.js';
import {
  buildStudioInvocation,
  startStudio,
  type StudioSpawner,
} from '../../src/studio/start-studio.js';
import {createPackageFixture} from '../fixtures.js';

const workspace = {
  jobId: 'job-1',
  rootDir: '/tmp/job-1',
  publicDir: '/tmp/job-1/public',
  propsFile: '/tmp/job-1/public/compiled.json',
  compiled: {},
  cleanup: async () => undefined,
} as unknown as JobWorkspace;

describe('Studio process', () => {
  it('uses an explicit entry point, no browser opening, a new server, port, public dir, and props', async () => {
    const invocation = await buildStudioInvocation({
      inputDir: '/tmp/package',
      workspace,
      port: 3101,
    });
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args[0]).toContain('@remotion/cli/remotion-cli.js');
    expect(invocation.args).toEqual(expect.arrayContaining([
      'studio',
      expect.stringMatching(/remotion\/index\.(ts|js)$/),
      '--no-open',
      '--force-new',
      '--port',
      '3101',
      '--public-dir',
      workspace.publicDir,
      '--props',
      workspace.propsFile,
    ]));
  });

  it('allows two Studio processes on different explicit ports to stay live concurrently', async () => {
    const spawner: StudioSpawner = () => spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)']);
    const first = await startStudio({inputDir: '/tmp/a', workspace, port: 3101, spawn: spawner});
    const second = await startStudio({inputDir: '/tmp/b', workspace, port: 3102, spawn: spawner});
    expect(first.pid).toBeTypeOf('number');
    expect(second.pid).toBeTypeOf('number');
    expect(first.pid).not.toBe(second.pid);
    first.stop('SIGTERM');
    second.stop('SIGTERM');
    await expect(Promise.all([first.wait(), second.wait()])).resolves.toEqual([0, 0]);
  });

  it('maps a Studio startup failure to exit code 5', async () => {
    const spawner: StudioSpawner = () => spawn(process.execPath, ['--eval', 'process.exit(9)']);
    const studio = await startStudio({inputDir: '/tmp/a', workspace, port: 3101, spawn: spawner});
    await expect(studio.wait()).rejects.toMatchObject({
      kind: 'studio',
      exitCode: 5,
    } satisfies Partial<RendererError>);
  });

  it('keeps the staged workspace while Studio is live and cleans it after exit', async () => {
    const fixture = await createPackageFixture();
    let stagedRoot = '';
    try {
      const exitCode = await runCli([
        'studio', '--input', fixture.root, '--port', '3101',
      ], {stdout: () => undefined, stderr: () => undefined}, {
        prepareWorkspace: async (...args) => {
          const staged = await prepareJobWorkspace(...args);
          stagedRoot = staged.rootDir;
          return staged;
        },
        startStudio: async ({workspace: staged}) => ({
          pid: 123,
          stop: () => undefined,
          wait: async () => {
            await expect(stat(staged.rootDir)).resolves.toMatchObject({});
            return 0;
          },
        }),
      });
      expect(exitCode).toBe(0);
      await expect(stat(stagedRoot)).rejects.toMatchObject({code: 'ENOENT'});
    } finally {
      await fixture.cleanup();
    }
  });
});
