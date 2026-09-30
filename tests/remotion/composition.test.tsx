import {Children, isValidElement, type ReactElement, type ReactNode} from 'react';
import {Audio} from '@remotion/media';
import {Composition, Sequence} from 'remotion';
import {describe, expect, it} from 'vitest';

import type {CompiledVideoProps} from '../../src/compiler/compile-package.js';
import {CaptionTrack, captionToFrameRange} from '../../src/remotion/Captions.js';
import {
  VerticalRoughCut,
  getCrossfadeOpacity,
} from '../../src/remotion/VerticalRoughCut.js';
import {RemotionRoot} from '../../src/remotion/Root.js';

const props: CompiledVideoProps = {
  identity: {channelId: 'health', videoId: 'carrot', runId: 'run-1'},
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 30,
  audioSrc: 'input/narration.wav',
  captions: [
    {text: '第一句', startMs: 0, endMs: 500, timestampMs: null, confidence: null},
    {text: '第二句', startMs: 500, endMs: 1_000, timestampMs: null, confidence: null},
  ],
  shots: [
    {
      id: 'shot-001',
      from: 0,
      durationInFrames: 15,
      src: 'input/assets/shot-001.png',
      fit: 'cover',
      motion: {preset: 'slow-zoom-in', intensity: 0.08},
      incomingPreview: {
        from: 12,
        durationInFrames: 3,
        src: 'input/assets/shot-002.png',
        fit: 'contain',
        motion: {preset: 'pan-left', intensity: 0.1},
      },
    },
    {
      id: 'shot-002',
      from: 15,
      durationInFrames: 15,
      src: 'input/assets/shot-002.png',
      fit: 'contain',
      motion: {preset: 'pan-left', intensity: 0.1},
    },
  ],
};

const directChildren = (node: ReactNode): ReactElement[] => {
  if (!isValidElement(node)) {
    return [];
  }
  const element = node as ReactElement<{children?: ReactNode}>;
  return Children.toArray(element.props.children).filter(isValidElement) as ReactElement[];
};

type SequenceProps = {
  name?: string;
  from: number;
  durationInFrames: number;
};

describe('VerticalRoughCut', () => {
  it('places shots and crossfade preview on compiled integer frames without shortening duration', () => {
    const children = directChildren(VerticalRoughCut(props));
    const sequences = children.filter(
      (child): child is ReactElement<SequenceProps> => child.type === Sequence,
    );

    expect(sequences.map((sequence) => sequence.props)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({name: 'shot:shot-001', from: 0, durationInFrames: 15}),
        expect.objectContaining({name: 'transition:shot-001', from: 12, durationInFrames: 3}),
        expect.objectContaining({name: 'shot:shot-002', from: 15, durationInFrames: 15}),
      ]),
    );
    expect(Math.max(...sequences.map((sequence) => sequence.props.from + sequence.props.durationInFrames))).toBe(30);
  });

  it('starts narration audio at frame zero', () => {
    const audio = directChildren(VerticalRoughCut(props)).find((child) => child.type === Audio);
    expect(audio?.props).toMatchObject({from: 0, src: expect.stringContaining('input/narration.wav')});
  });

  it('fades the incoming preview only across its own interval', () => {
    expect(getCrossfadeOpacity(-1, 3)).toBe(0);
    expect(getCrossfadeOpacity(0, 3)).toBe(0);
    expect(getCrossfadeOpacity(1, 3)).toBe(0.5);
    expect(getCrossfadeOpacity(2, 3)).toBe(1);
    expect(getCrossfadeOpacity(8, 3)).toBe(1);
  });
});

describe('RemotionRoot', () => {
  it('registers the fixed vertical composition with duration from input props', async () => {
    const composition = RemotionRoot() as ReactElement<Record<string, unknown>>;
    expect(composition.type).toBe(Composition);
    expect(composition.props).toMatchObject({
      id: 'VerticalRoughCut',
      width: 1080,
      height: 1920,
      fps: 30,
    });
    const calculateMetadata = composition.props.calculateMetadata as (input: {
      props: CompiledVideoProps;
    }) => Promise<Record<string, unknown>> | Record<string, unknown>;
    await expect(Promise.resolve(calculateMetadata({props}))).resolves.toMatchObject({
      durationInFrames: 30,
      width: 1080,
      height: 1920,
      fps: 30,
    });
  });
});

describe('CaptionTrack', () => {
  it('converts caption milliseconds to aligned sequence frames', () => {
    expect(captionToFrameRange(props.captions[0]!, 30)).toEqual({from: 0, durationInFrames: 15});
    expect(captionToFrameRange(props.captions[1]!, 30)).toEqual({from: 15, durationInFrames: 15});
    const sequences = directChildren(CaptionTrack({captions: props.captions, fps: 30}));
    expect(sequences.map((sequence) => sequence.props)).toEqual([
      expect.objectContaining({name: 'caption:0', from: 0, durationInFrames: 15}),
      expect.objectContaining({name: 'caption:1', from: 15, durationInFrames: 15}),
    ]);
  });
});
