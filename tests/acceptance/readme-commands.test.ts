import {exec as execCallback} from 'node:child_process';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

import {afterEach, describe, expect, it} from 'vitest';

const exec = promisify(execCallback);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const extractQuickStartCommands = (readme: string): string[] => {
  const marked = readme.match(/<!-- quick-start:start -->([\s\S]*?)<!-- quick-start:end -->/);
  if (!marked?.[1]) {
    throw new Error('README quick-start markers are missing.');
  }
  const fence = marked[1].match(/```bash\n([\s\S]*?)```/);
  if (!fence?.[1]) {
    throw new Error('README quick-start bash block is missing.');
  }
  return fence[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
};

describe('documented quick start', () => {
  it('generates schemas, validates the portable example, and renders documented outputs', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'video-renderer-readme-'));
    cleanups.push(() => rm(outputRoot, {recursive: true, force: true}));
    const outputDir = join(outputRoot, 'output');
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');
    const commands = extractQuickStartCommands(readme);
    expect(commands).toHaveLength(3);

    for (const command of commands) {
      await exec(command.replaceAll('{{OUTPUT_DIR}}', outputDir), {
        cwd: process.cwd(),
        timeout: 120_000,
        maxBuffer: 5 * 1024 * 1024,
      });
    }

    for (const filename of ['rough-cut.mp4', 'validation-report.json', 'render-report.json']) {
      expect((await stat(join(outputDir, filename))).size).toBeGreaterThan(0);
    }
  }, 120_000);

  it('documents all exit codes and distinguishes job from frame concurrency', async () => {
    const [cli, troubleshooting] = await Promise.all([
      readFile(join(process.cwd(), 'docs/cli.md'), 'utf8'),
      readFile(join(process.cwd(), 'docs/troubleshooting.md'), 'utf8'),
    ]);
    for (const code of [0, 2, 3, 4, 5, 6, 7]) {
      expect(cli).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`));
    }
    expect(`${cli}\n${troubleshooting}`).toContain('任务级并行');
    expect(`${cli}\n${troubleshooting}`).toContain('帧级并发');
  });
});
