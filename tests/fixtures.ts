import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const validManifest = {
  schemaVersion: '1.0',
  channelId: 'channel-a',
  videoId: 'video-a',
  runId: 'run-a',
  profile: 'vertical-basic',
  width: 1080,
  height: 1920,
  fps: 30,
  timeline: 'timeline.json',
  audio: 'narration.wav',
  subtitles: 'subtitle.srt',
} as const;

export const validTimeline = {
  shots: [
    {
      id: 'shot-001',
      startMs: 0,
      endMs: 1_000,
      asset: 'assets/shot-001.png',
      fit: 'cover',
      motion: {preset: 'none', intensity: 0},
      transitionOut: {type: 'cut', durationMs: 0},
    },
  ],
} as const;

type JsonObject = Record<string, unknown>;

export type PackageFixture = {
  root: string;
  cleanup(): Promise<void>;
};

export const createPackageFixture = async (options?: {
  manifest?: JsonObject;
  timeline?: JsonObject;
}): Promise<PackageFixture> => {
  const root = await mkdtemp(join(tmpdir(), 'video-renderer-package-'));
  await mkdir(join(root, 'assets'));
  await Promise.all([
    writeFile(
      join(root, 'manifest.json'),
      `${JSON.stringify(options?.manifest ?? validManifest, null, 2)}\n`,
    ),
    writeFile(
      join(root, 'timeline.json'),
      `${JSON.stringify(options?.timeline ?? validTimeline, null, 2)}\n`,
    ),
    writeFile(join(root, 'narration.wav'), ''),
    writeFile(join(root, 'subtitle.srt'), ''),
    writeFile(join(root, 'assets/shot-001.png'), ''),
  ]);

  return {
    root,
    cleanup: () => rm(root, {recursive: true, force: true}),
  };
};
