import {mkdtemp, mkdir, symlink, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {RendererError} from '../../src/contracts/errors.js';
import {
  acquireOutputLock,
  getOutputLockPath,
} from '../../src/render/output-lock.js';

const cleanups: Array<() => Promise<void>> = [];

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'video-renderer-lock-'));
  cleanups.push(async () => {
    const {rm} = await import('node:fs/promises');
    await rm(root, {recursive: true, force: true});
  });
  return root;
};

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('acquireOutputLock', () => {
  it('accepts an absent or empty output directory and release is idempotent', async () => {
    const root = await makeRoot();
    const absent = join(root, 'absent-output');
    const first = await acquireOutputLock(absent, {jobId: 'job-absent'});
    await first.release();
    await first.release();

    const empty = join(root, 'empty-output');
    await mkdir(empty);
    const second = await acquireOutputLock(empty, {jobId: 'job-empty'});
    await second.release();
  });

  it('creates missing nested output parents before locking', async () => {
    const root = await makeRoot();
    const output = join(root, 'missing', 'nested', 'output');

    const lock = await acquireOutputLock(output, {jobId: 'nested-output'});

    expect(lock.outputDir).toContain(join('missing', 'nested', 'output'));
    await lock.release();
  });

  it('rejects a non-empty output directory with stable exit code 3', async () => {
    const root = await makeRoot();
    const output = join(root, 'output');
    await mkdir(output);
    await writeFile(join(output, 'existing.txt'), 'do not overwrite');

    await expect(acquireOutputLock(output, {jobId: 'job-conflict'})).rejects.toMatchObject({
      kind: 'output',
      exitCode: 3,
    } satisfies Partial<RendererError>);
  });

  it('allows exactly one holder for canonical aliases of the same output', async () => {
    const root = await makeRoot();
    const realParent = join(root, 'real');
    const aliasParent = join(root, 'alias');
    await mkdir(realParent);
    await symlink(realParent, aliasParent);

    const results = await Promise.allSettled([
      acquireOutputLock(join(realParent, 'output'), {jobId: 'job-a'}),
      acquireOutputLock(join(aliasParent, 'output'), {jobId: 'job-b'}),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      kind: 'lock',
      exitCode: 3,
    });
    await (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireOutputLock>>>).value.release();
  });

  it('reclaims a lock owned by a dead local process', async () => {
    const root = await makeRoot();
    const output = join(root, 'output');
    const lockPath = await getOutputLockPath(output);
    await writeFile(lockPath, `${JSON.stringify({pid: 2_147_483_647, jobId: 'dead', createdAt: '2020-01-01T00:00:00.000Z'})}\n`);

    const lock = await acquireOutputLock(output, {jobId: 'replacement'});
    expect(lock.path).toBe(lockPath);
    await lock.release();
  });

  it('allows exactly one winner when many contenders reclaim one stale lock', async () => {
    const root = await makeRoot();
    const output = join(root, 'output');
    const lockPath = await getOutputLockPath(output);
    await writeFile(lockPath, `${JSON.stringify({pid: 2_147_483_647, jobId: 'dead', createdAt: '2020-01-01T00:00:00.000Z'})}\n`);

    const results = await Promise.allSettled(
      Array.from({length: 10}, (_, index) =>
        acquireOutputLock(output, {jobId: `contender-${index}`})
      ),
    );
    const winners = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireOutputLock>>> =>
        result.status === 'fulfilled',
    );
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(9);
    await winners[0]!.value.release();
  });

  it('recovers after a lock-holding child process is interrupted', async () => {
    const root = await makeRoot();
    const output = join(root, 'output');
    const script = [
      `import('./src/render/output-lock.ts').then(async ({acquireOutputLock}) => {`,
      `  await acquireOutputLock(${JSON.stringify(output)}, {jobId: 'interrupted-child'});`,
      `  console.log('LOCKED');`,
      `  setInterval(() => {}, 1000);`,
      `});`,
    ].join('\n');
    const child = spawn(process.execPath, ['--import', 'tsx', '--eval', script], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Child did not acquire lock in time.')), 10_000);
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('LOCKED')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code !== null) {
            reject(new Error(`Child exited before acquiring lock with code ${code}.`));
          }
        });
      });
      child.kill('SIGKILL');
      await once(child, 'exit');

      const replacement = await acquireOutputLock(output, {jobId: 'replacement-after-interrupt'});
      await replacement.release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    }
  });
});
