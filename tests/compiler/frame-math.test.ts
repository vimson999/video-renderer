import {describe, expect, it} from 'vitest';

import {msToFrame} from '../../src/compiler/frame-math.js';

describe('msToFrame', () => {
  it.each([
    [0, 0],
    [16, 0],
    [17, 1],
    [500, 15],
    [1_000, 30],
    [1_016, 30],
    [1_017, 31],
  ])('rounds %ims to the nearest 30fps frame %i', (milliseconds, expected) => {
    expect(msToFrame(milliseconds, 30)).toBe(expected);
  });
});
