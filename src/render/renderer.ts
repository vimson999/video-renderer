import {access, chmod, copyFile, link, mkdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

import type {CompiledVideoProps} from '../compiler/compile-package.js';
import {RendererError} from '../contracts/errors.js';
import type {JobWorkspace} from '../jobs/workspace.js';
import type {ValidationReport} from '../validation/validate-package.js';
import {probeRenderedVideo, type RenderedMediaMetadata} from './media-report.js';
import {acquireOutputLock} from './output-lock.js';
import {publishCompletedDirectory, writeJson} from './publish.js';
import {
  createRenderReport,
  sha256File,
  type RenderReport,
} from './reports.js';

export type RenderImplementationOptions = {
  workspace: JobWorkspace;
  compiled: CompiledVideoProps;
  outputLocation: string;
  concurrency: number;
};

export type RenderImplementation = (options: RenderImplementationOptions) => Promise<void>;

export type RenderRequest = {
  inputDir: string;
  outputDir: string;
  workspace: JobWorkspace;
  compiled: CompiledVideoProps;
  validationReport: ValidationReport;
  warnings: string[];
  concurrency: number;
  render?: RenderImplementation;
};

export type RenderResult = {
  outputDir: string;
  media: RenderedMediaMetadata;
  report: RenderReport;
};

const require = createRequire(import.meta.url);

const stageExecutable = async (source: string, destination: string): Promise<void> => {
  try {
    await link(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      await chmod(destination, 0o755);
      return;
    }
    try {
      await copyFile(source, destination);
    } catch (copyError) {
      throw new Error(`Could not stage executable ${source}.`, {
        cause: new AggregateError([error, copyError], 'Hard-link and copy staging both failed.'),
      });
    }
    await chmod(destination, 0o755);
  }
};

const preparePinnedBinaries = async (workspace: JobWorkspace): Promise<string> => {
  const ffmpegPath = require('ffmpeg-static') as string | null;
  const ffprobePath = (require('ffprobe-static') as {path: string}).path;
  if (!ffmpegPath || !ffprobePath) {
    throw new Error('Pinned FFmpeg or FFprobe binary is unavailable for this platform.');
  }
  const binariesDirectory = join(workspace.rootDir, 'binaries');
  await mkdir(binariesDirectory, {recursive: true});
  await Promise.all([
    stageExecutable(ffmpegPath, join(binariesDirectory, 'ffmpeg')),
    stageExecutable(ffprobePath, join(binariesDirectory, 'ffprobe')),
  ]);
  return binariesDirectory;
};

const resolveEntryPoint = async (): Promise<string> => {
  const candidates = [
    fileURLToPath(new URL('../remotion/index.ts', import.meta.url)),
    fileURLToPath(new URL('../remotion/index.js', import.meta.url)),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the source or compiled counterpart.
    }
  }
  throw new Error('Could not locate the Remotion entry point.');
};

export const remotionRender: RenderImplementation = async ({
  workspace,
  compiled,
  outputLocation,
  concurrency,
}) => {
  const entryPoint = await resolveEntryPoint();
  const binariesDirectory = await preparePinnedBinaries(workspace);
  const serveUrl = await bundle(entryPoint, undefined, {
    publicDir: workspace.publicDir,
    outDir: join(workspace.rootDir, 'bundle'),
    webpackOverride: (configuration) => ({
      ...configuration,
      resolve: {
        ...configuration.resolve,
        extensionAlias: {
          ...configuration.resolve?.extensionAlias,
          '.js': ['.ts', '.tsx', '.js'],
        },
      },
    }),
  });
  const inputProps = {...compiled} as unknown as Record<string, unknown>;
  const composition = await selectComposition({
    serveUrl,
    id: 'VerticalRoughCut',
    inputProps,
    logLevel: 'warn',
    binariesDirectory,
  });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    outputLocation,
    codec: 'h264',
    audioCodec: 'mp3',
    pixelFormat: 'yuv420p',
    concurrency,
    overwrite: false,
    logLevel: 'warn',
    binariesDirectory,
  });
};

const assertConcurrency = (value: number): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RendererError({
      kind: 'render',
      exitCode: 6,
      message: `Render concurrency must be a positive integer, received ${value}.`,
    });
  }
};

export const renderJob = async (request: RenderRequest): Promise<RenderResult> => {
  assertConcurrency(request.concurrency);
  const lock = await acquireOutputLock(request.outputDir, {jobId: request.workspace.jobId});
  const startedAt = new Date().toISOString();
  const incompleteDir = join(
    dirname(lock.outputDir),
    `.${basename(lock.outputDir)}.incomplete-${request.workspace.jobId}`,
  );
  const videoPath = join(incompleteDir, 'rough-cut.mp4');

  try {
    await rm(incompleteDir, {recursive: true, force: true});
    await mkdir(incompleteDir, {recursive: true});
    try {
      await (request.render ?? remotionRender)({
        workspace: request.workspace,
        compiled: request.workspace.compiled,
        outputLocation: videoPath,
        concurrency: request.concurrency,
      });
    } catch (cause) {
      throw new RendererError({
        kind: 'render',
        exitCode: 6,
        message: 'Remotion render failed.',
        identity: request.compiled.identity,
        cause,
      });
    }

    const [media, outputSha256] = await Promise.all([
      probeRenderedVideo(videoPath, {
        width: request.compiled.width,
        height: request.compiled.height,
        fps: request.compiled.fps,
        durationMs: (request.compiled.durationInFrames / request.compiled.fps) * 1_000,
      }),
      sha256File(videoPath),
    ]);
    const finishedAt = new Date().toISOString();
    const report = createRenderReport({
      identity: request.compiled.identity,
      inputPackageSha256: request.workspace.inputPackageSha256,
      outputSha256,
      media,
      concurrency: request.concurrency,
      startedAt,
      finishedAt,
      validation: request.validationReport,
      warnings: request.warnings,
    });
    await Promise.all([
      writeJson(join(incompleteDir, 'validation-report.json'), request.validationReport),
      writeJson(join(incompleteDir, 'render-report.json'), report),
    ]);
    await publishCompletedDirectory(incompleteDir, lock.outputDir);
    return {outputDir: request.outputDir, media, report};
  } finally {
    await rm(incompleteDir, {recursive: true, force: true});
    await lock.release();
  }
};
