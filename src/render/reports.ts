import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join, relative} from 'node:path';

import type {RendererIdentity} from '../contracts/types.js';
import type {ValidationReport} from '../validation/validate-package.js';
import type {RenderedMediaMetadata} from './media-report.js';

const require = createRequire(import.meta.url);
const loadRendererVersion = (): string => {
  for (const packagePath of ['../../package.json', '../../../package.json']) {
    try {
      return (require(packagePath) as {version: string}).version;
    } catch {
      // The source and compiled module trees sit at different depths.
    }
  }
  throw new Error('Could not locate the renderer package metadata.');
};

export const RENDERER_VERSION = loadRendererVersion();
export const CONTRACT_VERSION = '1.0' as const;

const listFiles = async (root: string, directory = root): Promise<string[]> => {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(root, path);
    }
    return entry.isFile() ? [path] : [];
  }));
  return nested.flat().sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
};

export const hashInputPackage = async (root: string): Promise<string> => {
  const hash = createHash('sha256');
  for (const path of await listFiles(root)) {
    hash.update(relative(root, path).split('\\').join('/'));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
};

export const sha256File = async (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });

export type RenderReport = {
  rendererVersion: typeof RENDERER_VERSION;
  contractVersion: typeof CONTRACT_VERSION;
  identity: RendererIdentity;
  inputPackageSha256: string;
  concurrency: number;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  output: RenderedMediaMetadata & {sha256: string};
  validation: Pick<ValidationReport, 'valid' | 'issueCount' | 'warningCount' | 'shotCount' | 'captionCount'>;
  warnings: string[];
};

export const createRenderReport = (input: {
  identity: RendererIdentity;
  inputPackageSha256: string;
  outputSha256: string;
  media: RenderedMediaMetadata;
  concurrency: number;
  startedAt: string;
  finishedAt: string;
  validation: ValidationReport;
  warnings: string[];
}): RenderReport => ({
  rendererVersion: RENDERER_VERSION,
  contractVersion: CONTRACT_VERSION,
  identity: {...input.identity},
  inputPackageSha256: input.inputPackageSha256,
  concurrency: input.concurrency,
  startedAt: input.startedAt,
  finishedAt: input.finishedAt,
  elapsedMs: new Date(input.finishedAt).getTime() - new Date(input.startedAt).getTime(),
  output: {...input.media, sha256: input.outputSha256},
  validation: {
    valid: input.validation.valid,
    issueCount: input.validation.issueCount,
    warningCount: input.validation.warningCount,
    shotCount: input.validation.shotCount,
    captionCount: input.validation.captionCount,
  },
  warnings: [...input.warnings],
});
