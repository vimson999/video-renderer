import {spawn as nodeSpawn, type ChildProcess} from 'node:child_process';
import {access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {RendererError} from '../contracts/errors.js';
import type {JobWorkspace} from '../jobs/workspace.js';

export type StudioRequest = {
  inputDir: string;
  workspace: JobWorkspace;
  port: number;
  spawn?: StudioSpawner;
};

export type StudioInvocation = {
  command: string;
  args: string[];
};

export type StudioSpawner = (
  command: string,
  args: readonly string[],
  options: {cwd: string; stdio: 'inherit'},
) => ChildProcess;

export type StudioProcess = {
  pid: number | undefined;
  wait(): Promise<number>;
  stop(signal?: NodeJS.Signals): void;
};

const require = createRequire(import.meta.url);

const resolveEntryPoint = async (): Promise<string> => {
  const candidates = [
    fileURLToPath(new URL('../remotion/index.ts', import.meta.url)),
    fileURLToPath(new URL('../remotion/index.js', import.meta.url)),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the source or compiled counterpart.
    }
  }
  throw new Error('Could not locate the Remotion entry point.');
};

export const buildStudioInvocation = async (
  request: Omit<StudioRequest, 'spawn'>,
): Promise<StudioInvocation> => {
  const cliPackage = require.resolve('@remotion/cli/package.json');
  return {
    command: process.execPath,
    args: [
      join(dirname(cliPackage), 'remotion-cli.js'),
      'studio',
      await resolveEntryPoint(),
      '--no-open',
      '--force-new',
      '--port',
      String(request.port),
      '--public-dir',
      request.workspace.publicDir,
      '--props',
      request.workspace.propsFile,
    ],
  };
};

const studioError = (message: string, cause?: unknown): RendererError =>
  new RendererError({kind: 'studio', exitCode: 5, message, cause});

export const startStudio = async (request: StudioRequest): Promise<StudioProcess> => {
  const invocation = await buildStudioInvocation(request);
  const spawner: StudioSpawner = request.spawn ?? ((command, args, options) =>
    nodeSpawn(command, [...args], options)
  );
  let stopping = false;
  let child: ChildProcess;
  try {
    child = spawner(invocation.command, invocation.args, {
      cwd: request.workspace.rootDir,
      stdio: 'inherit',
    });
  } catch (cause) {
    throw studioError(`Could not start Studio on port ${request.port}.`, cause);
  }

  const completion = new Promise<number>((resolve, reject) => {
    child.once('error', (cause) => {
      reject(studioError(`Studio process failed on port ${request.port}.`, cause));
    });
    child.once('close', (code, signal) => {
      if (stopping || code === 0) {
        resolve(0);
      } else {
        reject(studioError(
          `Studio exited before a clean shutdown on port ${request.port} (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`,
        ));
      }
    });
  });

  return {
    pid: child.pid,
    wait: () => completion,
    stop: (signal = 'SIGTERM') => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      stopping = true;
      child.kill(signal);
    },
  };
};
