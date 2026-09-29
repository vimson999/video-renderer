import {describe, expect, it} from 'vitest';

import {runCli, type CliIo} from '../../src/cli/run-cli.js';

describe('CLI help', () => {
  it('lists the three public commands without writing an error', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    };

    const exitCode = await runCli(['--help'], io);

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('validate');
    expect(stdout.join('\n')).toContain('studio');
    expect(stdout.join('\n')).toContain('render');
    expect(stderr).toEqual([]);
  });
});
