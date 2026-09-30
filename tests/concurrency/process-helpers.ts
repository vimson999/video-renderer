import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export type CliProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunningCli = {
  child: ReturnType<typeof spawn>;
  completion: Promise<CliProcessResult>;
};

export const startCli = (
  args: readonly string[],
  options: {delayMs?: number} = {},
): RunningCli => {
  const entry = join(process.cwd(), 'dist/src/index.js');
  const childArgs = options.delayMs
    ? [
        '--eval',
        `setTimeout(() => import(${JSON.stringify(pathToFileURL(entry).href)}), ${options.delayMs})`,
        '--',
        'video-renderer',
        ...args,
      ]
    : [entry, ...args];
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return {
    child,
    completion: new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({code: code ?? 1, stdout, stderr}));
    }),
  };
};
