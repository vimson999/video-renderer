import {lstat, mkdir, readdir, rename, rmdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

import {RendererError} from '../contracts/errors.js';

export const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const publishCompletedDirectory = async (
  completedDir: string,
  outputDir: string,
): Promise<void> => {
  await mkdir(dirname(outputDir), {recursive: true});
  try {
    const output = await lstat(outputDir);
    if (!output.isDirectory() || (await readdir(outputDir)).length > 0) {
      throw new RendererError({
        kind: 'output',
        exitCode: 3,
        message: `Output became unavailable before publish: ${outputDir}`,
      });
    }
    await rmdir(outputDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  await rename(completedDir, outputDir);
};
