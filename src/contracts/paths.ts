import {realpath} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep, win32} from 'node:path';

import {contractError} from './errors.js';

const remainsInside = (root: string, candidate: string): boolean => {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot));
};

export const resolvePackageFile = async (
  rootRealPath: string,
  relativePath: string,
): Promise<string> => {
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    relativePath.includes('\\')
  ) {
    throw contractError('Package references must use relative POSIX paths.', {
      code: 'path.invalid',
      file: relativePath,
      field: '/',
      repair: 'Use a non-empty forward-slash path relative to the package root.',
    });
  }

  const lexicalPath = resolve(rootRealPath, relativePath);
  if (!remainsInside(rootRealPath, lexicalPath)) {
    throw contractError('Package reference escapes the package root.', {
      code: 'path.escape',
      file: relativePath,
      field: '/',
      repair: 'Move the file into the package and reference it with a package-relative path.',
    });
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(lexicalPath);
  } catch (cause) {
    throw contractError('Referenced package file does not exist.', {
      code: 'path.missing',
      file: relativePath,
      field: '/',
      repair: 'Add the referenced file inside the package or correct the path.',
    }, cause);
  }

  if (!remainsInside(rootRealPath, resolvedPath)) {
    throw contractError('Resolved package reference escapes the package root.', {
      code: 'path.symlink_escape',
      file: relativePath,
      field: '/',
      repair: 'Replace the external symlink with a file stored inside the package.',
    });
  }

  return resolvedPath;
};
