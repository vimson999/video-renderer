import {registerMediabunnyServer} from '@mediabunny/server';
import {ALL_FORMATS, FilePathSource, Input} from 'mediabunny';
import sharp from 'sharp';

import {mediaError} from '../contracts/errors.js';

registerMediabunnyServer();

export type AudioMetadata = {
  durationMs: number;
  sampleRate: number;
  channelCount: number;
};

export type ImageMetadata = {
  width: number;
  height: number;
  format: string;
};

export const inspectNarration = async (path: string): Promise<AudioMetadata> => {
  const input = new Input({formats: ALL_FORMATS, source: new FilePathSource(path)});
  try {
    const track = await input.getPrimaryAudioTrack();
    if (track === null) {
      throw new Error('The file has no audio track.');
    }
    const [durationSeconds, sampleRate, channelCount] = await Promise.all([
      input.computeDuration([track]),
      track.getSampleRate(),
      track.getNumberOfChannels(),
    ]);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('The audio duration is not positive.');
    }
    return {
      durationMs: Math.round(durationSeconds * 1_000),
      sampleRate,
      channelCount,
    };
  } catch (cause) {
    throw mediaError('Could not decode narration audio.', {
      code: 'media.audio_unreadable',
      file: path,
      field: '/audio',
      repair: 'Replace the narration with a valid, readable WAV file.',
    }, cause);
  } finally {
    input.dispose();
  }
};

export const inspectStill = async (path: string): Promise<ImageMetadata> => {
  try {
    const metadata = await sharp(path).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new Error('Image metadata is incomplete.');
    }
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    };
  } catch (cause) {
    throw mediaError('Could not decode still image.', {
      code: 'media.image_unreadable',
      file: path,
      field: '/asset',
      repair: 'Replace the asset with a valid PNG or JPEG image.',
    }, cause);
  }
};
