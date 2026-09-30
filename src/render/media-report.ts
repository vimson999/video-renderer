import {stat} from 'node:fs/promises';

import {registerMediabunnyServer} from '@mediabunny/server';
import {ALL_FORMATS, FilePathSource, Input} from 'mediabunny';

import {RendererError} from '../contracts/errors.js';

registerMediabunnyServer();

export type RenderedMediaMetadata = {
  codec: 'h264';
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  sizeBytes: number;
};

export type RenderedMediaExpectation = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  durationToleranceMs?: number;
  fpsTolerance?: number;
};

export const assertRenderedMediaMatchesExpected = (
  media: RenderedMediaMetadata,
  expected: RenderedMediaExpectation,
): void => {
  const durationToleranceMs = expected.durationToleranceMs ?? 100;
  const fpsTolerance = expected.fpsTolerance ?? 0.1;
  const mismatches: string[] = [];
  if (media.width !== expected.width) {
    mismatches.push(`width ${media.width} (expected ${expected.width})`);
  }
  if (media.height !== expected.height) {
    mismatches.push(`height ${media.height} (expected ${expected.height})`);
  }
  if (Math.abs(media.fps - expected.fps) > fpsTolerance) {
    mismatches.push(`fps ${media.fps} (expected ${expected.fps} ± ${fpsTolerance})`);
  }
  if (Math.abs(media.durationMs - expected.durationMs) > durationToleranceMs) {
    mismatches.push(
      `duration ${media.durationMs}ms (expected ${expected.durationMs}ms ± ${durationToleranceMs}ms)`,
    );
  }
  if (mismatches.length > 0) {
    throw new RendererError({
      kind: 'media',
      exitCode: 7,
      message: `Rendered video does not match the requested technical contract: ${mismatches.join('; ')}.`,
    });
  }
};

export const probeRenderedVideo = async (
  path: string,
  expected?: RenderedMediaExpectation,
): Promise<RenderedMediaMetadata> => {
  const input = new Input({formats: ALL_FORMATS, source: new FilePathSource(path)});
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error('Rendered file has no video track.');
    }
    const [codec, width, height, duration, frameRate, file] = await Promise.all([
      track.getCodec(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      input.computeDuration([track]),
      track.computeFrameRateMetrics(),
      stat(path),
    ]);
    if (codec !== 'avc') {
      throw new Error(`Expected H.264/AVC video, received ${codec ?? 'unknown'}.`);
    }
    if (!Number.isFinite(duration) || duration <= 0 || file.size <= 0) {
      throw new Error('Rendered media has invalid duration or size.');
    }
    const media: RenderedMediaMetadata = {
      codec: 'h264',
      width,
      height,
      fps: frameRate.bestGuessFrameRate,
      durationMs: Math.round(duration * 1_000),
      sizeBytes: file.size,
    };
    if (expected) {
      assertRenderedMediaMatchesExpected(media, expected);
    }
    return media;
  } catch (cause) {
    throw new RendererError({
      kind: 'media',
      exitCode: 7,
      message: `Rendered video failed technical validation: ${path}`,
      cause,
    });
  } finally {
    input.dispose();
  }
};
