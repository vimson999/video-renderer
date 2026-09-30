import {registerMediabunnyServer} from '@mediabunny/server';
import {ALL_FORMATS, FilePathSource, Input, WAVE} from 'mediabunny';
import sharp from 'sharp';

import {mediaError, RendererError} from '../contracts/errors.js';

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
    const format = await input.getFormat();
    if (format !== WAVE) {
      throw mediaError('Narration must contain WAV audio.', {
        code: 'media.audio_format',
        file: path,
        field: '/audio',
        repair: 'Convert the narration content to a valid PCM WAV file.',
      });
    }
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
    if (cause instanceof RendererError) {
      throw cause;
    }
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
    if (metadata.format !== 'png' && metadata.format !== 'jpeg') {
      throw mediaError('Still image must contain PNG or JPEG data.', {
        code: 'media.image_format',
        file: path,
        field: '/asset',
        repair: 'Convert the still image content to PNG or JPEG.',
      });
    }
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    };
  } catch (cause) {
    if (cause instanceof RendererError) {
      throw cause;
    }
    throw mediaError('Could not decode still image.', {
      code: 'media.image_unreadable',
      file: path,
      field: '/asset',
      repair: 'Replace the asset with a valid PNG or JPEG image.',
    }, cause);
  }
};
