import {copyFile, mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';

import type {CompiledVideoProps} from '../compiler/compile-package.js';
import {hashInputPackage} from '../render/reports.js';
import type {ValidatedPackage} from '../validation/validate-package.js';

export type JobWorkspace = {
  jobId: string;
  rootDir: string;
  publicDir: string;
  propsFile: string;
  inputPackageSha256: string;
  compiled: CompiledVideoProps;
  cleanup(): Promise<void>;
};

export type WorkspaceOptions = {
  tempRoot?: string;
};

const sanitize = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'job';

const publicAssetPath = (logicalPath: string): string => `input/${logicalPath}`;

const stageCompiledProps = (compiled: CompiledVideoProps): CompiledVideoProps => ({
  ...compiled,
  identity: {...compiled.identity},
  audioSrc: 'input/narration.wav',
  captions: compiled.captions.map((caption) => ({...caption})),
  shots: compiled.shots.map((shot) => ({
    ...shot,
    motion: {...shot.motion},
    src: publicAssetPath(shot.src),
    ...(shot.incomingPreview
      ? {
          incomingPreview: {
            ...shot.incomingPreview,
            motion: {...shot.incomingPreview.motion},
            src: publicAssetPath(shot.incomingPreview.src),
          },
        }
      : {}),
  })),
});

export const prepareJobWorkspace = async (
  validated: ValidatedPackage,
  compiled: CompiledVideoProps,
  options: WorkspaceOptions = {},
): Promise<JobWorkspace> => {
  const jobId = randomUUID();
  const tempRoot = options.tempRoot ?? join(tmpdir(), 'video-renderer-jobs');
  const rootDir = join(
    tempRoot,
    `${sanitize(validated.identity.channelId)}-${sanitize(validated.identity.runId)}-${jobId}`,
  );
  const publicDir = join(rootDir, 'public');
  const snapshotDir = join(rootDir, 'snapshot');
  const propsFile = join(publicDir, 'compiled.json');
  const staged = stageCompiledProps(compiled);
  let inputPackageSha256 = '';
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await rm(rootDir, {recursive: true, force: true});
  };

  try {
    await mkdir(publicDir, {recursive: true});
    await mkdir(snapshotDir, {recursive: true});
    const snapshotDestinations = new Set<string>();
    const snapshotFile = async (source: string, logicalPath: string): Promise<void> => {
      const destination = join(snapshotDir, logicalPath);
      if (snapshotDestinations.has(destination)) {
        return;
      }
      snapshotDestinations.add(destination);
      await mkdir(dirname(destination), {recursive: true});
      await copyFile(source, destination);
    };
    await snapshotFile(validated.loaded.files.manifest, 'manifest.json');
    await snapshotFile(validated.loaded.files.timeline, validated.loaded.manifest.timeline);
    await snapshotFile(validated.loaded.files.audio, validated.loaded.manifest.audio);
    await snapshotFile(validated.loaded.files.subtitles, validated.loaded.manifest.subtitles);
    for (const shot of validated.loaded.timeline.shots) {
      await snapshotFile(validated.loaded.files.assets.get(shot.id)!, shot.asset);
    }
    const copiedDestinations = new Set<string>();
    for (const shot of validated.loaded.timeline.shots) {
      const destination = join(publicDir, publicAssetPath(shot.asset));
      if (copiedDestinations.has(destination)) {
        continue;
      }
      copiedDestinations.add(destination);
      await mkdir(dirname(destination), {recursive: true});
      await copyFile(validated.loaded.files.assets.get(shot.id)!, destination);
    }
    const stagedAudio = join(publicDir, staged.audioSrc);
    await mkdir(dirname(stagedAudio), {recursive: true});
    await copyFile(validated.loaded.files.audio, stagedAudio);

    const temporaryProps = `${propsFile}.${jobId}.tmp`;
    await writeFile(temporaryProps, `${JSON.stringify(staged, null, 2)}\n`);
    await rename(temporaryProps, propsFile);
    inputPackageSha256 = await hashInputPackage(snapshotDir);
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {jobId, rootDir, publicDir, propsFile, inputPackageSha256, compiled: staged, cleanup};
};
