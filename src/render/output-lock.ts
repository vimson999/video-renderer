import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';

import {RendererError} from '../contracts/errors.js';

type LockOwner = {
  pid: number;
  jobId: string;
  createdAt: string;
  hostname?: string;
  token?: string;
};

export type OutputLock = {
  path: string;
  outputDir: string;
  owner: LockOwner;
  release(): Promise<void>;
};

export type OutputLockOptions = {
  jobId: string;
};

const canonicalizeProspectivePath = async (input: string): Promise<string> => {
  const absolute = resolve(input);
  let cursor = absolute;
  const suffix: string[] = [];
  while (true) {
    try {
      const canonical = await realpath(cursor);
      return join(canonical, ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw error;
      }
      suffix.push(basename(cursor));
      cursor = parent;
    }
  }
};

export const getOutputLockPath = async (outputDir: string): Promise<string> => {
  const canonicalOutput = await canonicalizeProspectivePath(outputDir);
  return join(dirname(canonicalOutput), `.${basename(canonicalOutput)}.video-renderer.lock`);
};

const outputConflict = (message: string): RendererError =>
  new RendererError({kind: 'output', exitCode: 3, message});

const lockConflict = (message: string): RendererError =>
  new RendererError({kind: 'lock', exitCode: 3, message});

const assertOutputIsAbsentOrEmpty = async (outputDir: string): Promise<void> => {
  try {
    const stat = await lstat(outputDir);
    if (!stat.isDirectory()) {
      throw outputConflict(`Output path exists and is not a directory: ${outputDir}`);
    }
    if ((await readdir(outputDir)).length > 0) {
      throw outputConflict(`Output directory is not empty: ${outputDir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

const readOwner = async (lockPath: string): Promise<LockOwner | null> => {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<LockOwner>;
    if (
      !Number.isInteger(parsed.pid) ||
      typeof parsed.jobId !== 'string' ||
      typeof parsed.createdAt !== 'string'
    ) {
      return null;
    }
    return parsed as LockOwner;
  } catch {
    return null;
  }
};

const processIsAliveOrUnverifiable = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

const existingLockCanBeReclaimed = async (lockPath: string): Promise<boolean> => {
  const owner = await readOwner(lockPath);
  if (!owner) {
    return false;
  }
  if (owner.hostname && owner.hostname !== hostname()) {
    return false;
  }
  return !processIsAliveOrUnverifiable(owner.pid);
};

const lockExists = async (lockPath: string): Promise<boolean> => {
  try {
    await lstat(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const createOwnedLock = async (
  lockPath: string,
  outputDir: string,
  owner: LockOwner,
): Promise<OutputLock> => {
  const handle = await open(lockPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  let released = false;
  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    const current = await readOwner(lockPath);
    if (current?.token === owner.token) {
      await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }
  };

  try {
    await assertOutputIsAbsentOrEmpty(outputDir);
  } catch (error) {
    await release();
    throw error;
  }
  return {path: lockPath, outputDir, owner, release};
};

export const acquireOutputLock = async (
  requestedOutputDir: string,
  options: OutputLockOptions,
): Promise<OutputLock> => {
  const prospectiveOutput = await canonicalizeProspectivePath(requestedOutputDir);
  try {
    await mkdir(dirname(prospectiveOutput), {recursive: true});
  } catch (cause) {
    throw new RendererError({
      kind: 'output',
      exitCode: 3,
      message: `Could not create output parent directory: ${dirname(prospectiveOutput)}`,
      cause,
    });
  }
  const outputDir = await canonicalizeProspectivePath(prospectiveOutput);
  const lockPath = await getOutputLockPath(outputDir);
  const recoveryPath = `${lockPath}.recovery`;
  const owner: LockOwner = {
    pid: process.pid,
    jobId: options.jobId,
    createdAt: new Date().toISOString(),
    hostname: hostname(),
    token: randomUUID(),
  };

  try {
    return await createOwnedLock(lockPath, outputDir, owner);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  let recoveryHandle;
  try {
    recoveryHandle = await open(recoveryPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw lockConflict(`Output lock recovery is already in progress: ${outputDir}`);
    }
    throw error;
  }
  try {
    await recoveryHandle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await recoveryHandle.sync();
    if (await lockExists(lockPath)) {
      if (!(await existingLockCanBeReclaimed(lockPath))) {
        throw lockConflict(`Output directory is locked: ${outputDir}`);
      }
      await unlink(lockPath);
    }
    try {
      return await createOwnedLock(lockPath, outputDir, owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw lockConflict(`Output directory is locked: ${outputDir}`);
      }
      throw error;
    }
  } finally {
    await recoveryHandle.close();
    await unlink(recoveryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
};
