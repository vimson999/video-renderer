import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {runCli, type CliIo} from '../../src/cli/run-cli.js';
import {createPackageFixture, validManifest} from '../fixtures.js';

const cleanups: Array<() => Promise<void>> = [];

const captureIo = (): {io: CliIo; stdout: string[]; stderr: string[]} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    stdout,
    stderr,
  };
};

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('validate command', () => {
  it('prints a machine-readable validation summary and optionally writes a report', async () => {
    const fixture = await createPackageFixture();
    cleanups.push(fixture.cleanup);
    const reportRoot = await mkdtemp(join(tmpdir(), 'video-renderer-cli-report-'));
    cleanups.push(() => rm(reportRoot, {recursive: true, force: true}));
    const report = join(reportRoot, 'validation-report.json');
    const captured = captureIo();

    const exitCode = await runCli([
      'validate', '--input', fixture.root, '--report', report,
    ], captured.io);

    expect(exitCode).toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(JSON.parse(captured.stdout.join('\n'))).toMatchObject({valid: true, issueCount: 0});
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({valid: true, issueCount: 0});
  });

  it('maps schema failures to exit code 2 without echoing package content', async () => {
    const fixture = await createPackageFixture({
      manifest: {...validManifest, width: 720},
    });
    cleanups.push(fixture.cleanup);
    const captured = captureIo();

    expect(await runCli(['validate', '--input', fixture.root], captured.io)).toBe(2);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr.join('\n')).toContain('validation');
    expect(captured.stderr.join('\n')).not.toContain('示例字幕');
  });

  it('maps unreadable media to exit code 4', async () => {
    const fixture = await createPackageFixture();
    cleanups.push(fixture.cleanup);
    await writeFile(join(fixture.root, 'narration.wav'), 'not a wav');
    const captured = captureIo();

    expect(await runCli(['validate', '--input', fixture.root], captured.io)).toBe(4);
    expect(captured.stderr.join('\n')).toContain('media');
  });
});
