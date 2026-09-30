import {readFile, realpath} from 'node:fs/promises';
import {join} from 'node:path';

import {Ajv2020, type ErrorObject, type ValidateFunction} from 'ajv/dist/2020.js';

import {attachIdentity, contractError, RendererError} from './errors.js';
import {resolvePackageFile} from './paths.js';
import {
  ManifestSchema,
  TimelineSchema,
  type Manifest,
  type Timeline,
} from './schema.js';
import type {LoadedPackage, RendererIdentity, ValidationIssue} from './types.js';

const ajv = new Ajv2020({allErrors: true, strict: true});
const validateManifest = ajv.compile(ManifestSchema) as ValidateFunction<Manifest>;
const validateTimeline = ajv.compile(TimelineSchema) as ValidateFunction<Timeline>;

const fieldForError = (error: ErrorObject): string => {
  if (error.keyword === 'required') {
    return `${error.instancePath}/${String(error.params.missingProperty)}`;
  }
  return error.instancePath || '/';
};

const schemaIssues = (file: string, errors: ErrorObject[]): ValidationIssue[] =>
  errors.map((error) => ({
    code: `schema.${error.keyword}`,
    file,
    field: fieldForError(error),
    repair: `Update ${fieldForError(error)} so it satisfies the version 1 contract: ${error.message ?? 'invalid value'}.`,
  }));

const readJson = async (path: string, displayName: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (cause) {
    throw contractError(`Could not parse ${displayName}.`, {
      code: 'json.invalid',
      file: displayName,
      field: '/',
      repair: `Replace ${displayName} with valid UTF-8 JSON.`,
    }, cause);
  }
};

const identityFromValue = (value: unknown): RendererIdentity | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.channelId !== 'string'
    || typeof record.videoId !== 'string'
    || typeof record.runId !== 'string'
  ) {
    return undefined;
  }
  return {
    channelId: record.channelId,
    videoId: record.videoId,
    runId: record.runId,
  };
};

const assertSchema = <T>(
  value: unknown,
  validator: ValidateFunction<T>,
  file: string,
): T => {
  if (validator(value)) {
    return value;
  }
  const issues = schemaIssues(file, validator.errors ?? []);
  throw new RendererError({
    kind: 'validation',
    exitCode: 2,
    message: `${file} does not match the version 1 contract.`,
    issues,
  });
};

const resolveReference = async (
  root: string,
  relativePath: string,
  file: string,
  field: string,
  shotId?: string,
): Promise<string> => {
  try {
    return await resolvePackageFile(root, relativePath);
  } catch (error) {
    if (!(error instanceof RendererError)) {
      throw error;
    }
    throw new RendererError({
      kind: error.kind,
      exitCode: error.exitCode,
      message: error.message,
      cause: error,
      issues: error.issues.map((issue) => ({...issue, file, field, shotId})),
    });
  }
};

export const loadPackage = async (inputDir: string): Promise<LoadedPackage> => {
  let root: string;
  try {
    root = await realpath(inputDir);
  } catch (cause) {
    throw contractError('Render package directory does not exist.', {
      code: 'package.missing',
      file: 'manifest.json',
      field: '/',
      repair: 'Pass an existing render-package directory to --input.',
    }, cause);
  }

  const manifestPath = join(root, 'manifest.json');
  const rawManifest = await readJson(manifestPath, 'manifest.json');
  const manifestIdentity = identityFromValue(rawManifest);
  let manifest: Manifest;
  try {
    manifest = assertSchema(rawManifest, validateManifest, 'manifest.json');
  } catch (error) {
    throw manifestIdentity ? attachIdentity(error, manifestIdentity) : error;
  }
  const identity = {
    channelId: manifest.channelId,
    videoId: manifest.videoId,
    runId: manifest.runId,
  };
  try {
    const timelinePath = await resolveReference(
      root,
      manifest.timeline,
      'manifest.json',
      '/timeline',
    );
    const timeline = assertSchema(
      await readJson(timelinePath, manifest.timeline),
      validateTimeline,
      manifest.timeline,
    );

    const [audio, subtitles, assetEntries] = await Promise.all([
      resolveReference(root, manifest.audio, 'manifest.json', '/audio'),
      resolveReference(root, manifest.subtitles, 'manifest.json', '/subtitles'),
      Promise.all(
        timeline.shots.map(async (shot, index) => [
          shot.id,
          await resolveReference(
            root,
            shot.asset,
            manifest.timeline,
            `/shots/${index}/asset`,
            shot.id,
          ),
        ] as const),
      ),
    ]);

    return {
      root,
      manifest,
      timeline,
      files: {
        manifest: manifestPath,
        timeline: timelinePath,
        audio,
        subtitles,
        assets: new Map(assetEntries),
      },
    };
  } catch (error) {
    throw attachIdentity(error, identity);
  }
};
