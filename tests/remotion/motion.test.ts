import {describe, expect, it} from 'vitest';

import {
  getFitStyle,
  getMotionStyle,
} from '../../src/remotion/ShotLayer.js';

describe('getMotionStyle', () => {
  it('keeps the none preset static and clamps frames outside the shot', () => {
    expect(getMotionStyle('none', 0.1, -10, 31)).toEqual({scale: 1, translate: '0% 0%'});
    expect(getMotionStyle('none', 0.1, 100, 31)).toEqual({scale: 1, translate: '0% 0%'});
  });

  it.each([
    ['slow-zoom-in', {scale: 1, translate: '0% 0%'}, {scale: 1.1, translate: '0% 0%'}],
    ['slow-zoom-out', {scale: 1.1, translate: '0% 0%'}, {scale: 1, translate: '0% 0%'}],
    ['pan-left', {scale: 1.1, translate: '5% 0%'}, {scale: 1.1, translate: '-5% 0%'}],
    ['pan-right', {scale: 1.1, translate: '-5% 0%'}, {scale: 1.1, translate: '5% 0%'}],
  ] as const)('clamps %s at exact start and end styles', (preset, start, end) => {
    expect(getMotionStyle(preset, 0.1, -1, 31)).toEqual(start);
    expect(getMotionStyle(preset, 0.1, 30, 31)).toEqual(end);
    expect(getMotionStyle(preset, 0.1, 99, 31)).toEqual(end);
  });

  it('maps cover and contain to image object-fit styles', () => {
    expect(getFitStyle('cover')).toEqual({objectFit: 'cover'});
    expect(getFitStyle('contain')).toEqual({objectFit: 'contain'});
  });
});
