import {Audio} from '@remotion/media';
import {AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';

import type {
  CompiledIncomingPreview,
  CompiledVideoProps,
} from '../compiler/compile-package.js';
import {verticalBasicProfile} from '../profiles/vertical-basic.js';
import {CaptionTrack} from './Captions.js';
import {ShotLayer} from './ShotLayer.js';

export const getCrossfadeOpacity = (
  localFrame: number,
  durationInFrames: number,
): number =>
  interpolate(localFrame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const IncomingPreview = ({preview}: {preview: CompiledIncomingPreview}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity: getCrossfadeOpacity(frame, preview.durationInFrames)}}>
      <ShotLayer
        src={preview.src}
        fit={preview.fit}
        motion={preview.motion}
        durationInFrames={preview.durationInFrames}
        frameOverride={0}
      />
    </AbsoluteFill>
  );
};

export const VerticalRoughCut = (props: CompiledVideoProps) => (
  <AbsoluteFill style={{backgroundColor: verticalBasicProfile.backgroundColor}}>
    {props.shots.map((shot) => (
      <Sequence
        key={`shot-${shot.id}`}
        name={`shot:${shot.id}`}
        from={shot.from}
        durationInFrames={shot.durationInFrames}
      >
        <ShotLayer
          src={shot.src}
          fit={shot.fit}
          motion={shot.motion}
          durationInFrames={shot.durationInFrames}
        />
      </Sequence>
    ))}
    {props.shots.flatMap((shot) =>
      shot.incomingPreview
        ? [
            <Sequence
              key={`transition-${shot.id}`}
              name={`transition:${shot.id}`}
              from={shot.incomingPreview.from}
              durationInFrames={shot.incomingPreview.durationInFrames}
            >
              <IncomingPreview preview={shot.incomingPreview} />
            </Sequence>,
          ]
        : [],
    )}
    <Audio from={0} src={staticFile(props.audioSrc)} />
    <CaptionTrack captions={props.captions} fps={props.fps} />
  </AbsoluteFill>
);
