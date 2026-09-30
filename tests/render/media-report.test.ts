import {describe, expect, it} from 'vitest';

import {
  assertRenderedMediaMatchesExpected,
  type RenderedMediaMetadata,
} from '../../src/render/media-report.js';

const validMedia: RenderedMediaMetadata = {
  codec: 'h264',
  width: 1080,
  height: 1920,
  fps: 30,
  durationMs: 3_000,
  sizeBytes: 123,
};

describe('rendered media contract', () => {
  it('accepts the requested dimensions, frame rate, and duration', () => {
    expect(() => assertRenderedMediaMatchesExpected(validMedia, {
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 3_000,
    })).not.toThrow();
  });

  it.each([
    ['width', {width: 720}],
    ['height', {height: 1280}],
    ['fps', {fps: 24}],
    ['duration', {durationMs: 2_500}],
  ])('rejects an unexpected %s', (_name, override) => {
    const media = {...validMedia, ...override};
    expect(() => assertRenderedMediaMatchesExpected(media, {
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 3_000,
    })).toThrowError(expect.objectContaining({kind: 'media', exitCode: 7}));
  });
});
