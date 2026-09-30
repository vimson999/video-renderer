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

export const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export const makePcmWav = (options?: {
  durationMs?: number;
  sampleRate?: number;
  channelCount?: number;
}): Buffer => {
  const durationMs = options?.durationMs ?? 1_000;
  const sampleRate = options?.sampleRate ?? 8_000;
  const channelCount = options?.channelCount ?? 1;
  const bitsPerSample = 16;
  const sampleCount = Math.round((durationMs / 1_000) * sampleRate);
  const dataSize = sampleCount * channelCount * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * 2, 28);
  buffer.writeUInt16LE(channelCount * 2, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
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
    writeFile(join(root, 'narration.wav'), makePcmWav()),
    writeFile(
      join(root, 'subtitle.srt'),
      '1\n00:00:00,000 --> 00:00:01,000\n示例字幕\n',
    ),
    writeFile(join(root, 'assets/shot-001.png'), onePixelPng),
  ]);

  return {
    root,
    cleanup: () => rm(root, {recursive: true, force: true}),
  };
};
