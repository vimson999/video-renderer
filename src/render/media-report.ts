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

export const probeRenderedVideo = async (path: string): Promise<RenderedMediaMetadata> => {
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
    return {
      codec: 'h264',
      width,
      height,
      fps: frameRate.bestGuessFrameRate,
      durationMs: Math.round(duration * 1_000),
      sizeBytes: file.size,
    };
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
