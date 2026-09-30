import type {CSSProperties} from 'react';
import {Img, interpolate, staticFile, useCurrentFrame} from 'remotion';

import type {CompiledMotion} from '../compiler/compile-package.js';
import type {Shot} from '../contracts/schema.js';

export const getFitStyle = (fit: Shot['fit']): CSSProperties => ({
  objectFit: fit,
});

export const getMotionStyle = (
  preset: CompiledMotion['preset'],
  intensity: number,
  localFrame: number,
  durationInFrames: number,
): CSSProperties => {
  const finalFrame = Math.max(0, durationInFrames - 1);
  const progress = interpolate(localFrame, [0, Math.max(1, finalFrame)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scaleUp = 1 + intensity;
  const pan = intensity * 50;
  switch (preset) {
    case 'slow-zoom-in':
      return {scale: 1 + intensity * progress, translate: '0% 0%'};
    case 'slow-zoom-out':
      return {scale: scaleUp - intensity * progress, translate: '0% 0%'};
    case 'pan-left':
      return {scale: scaleUp, translate: `${pan - 2 * pan * progress}% 0%`};
    case 'pan-right':
      return {scale: scaleUp, translate: `${-pan + 2 * pan * progress}% 0%`};
    case 'none':
      return {scale: 1, translate: '0% 0%'};
  }
};

export type ShotLayerProps = {
  src: string;
  fit: Shot['fit'];
  motion: CompiledMotion;
  durationInFrames: number;
};

export const ShotLayer = ({
  src,
  fit,
  motion,
  durationInFrames,
}: ShotLayerProps) => {
  const frame = useCurrentFrame();
  return (
    <Img
      src={staticFile(src)}
      style={{
        width: '100%',
        height: '100%',
        ...getFitStyle(fit),
        ...getMotionStyle(motion.preset, motion.intensity, frame, durationInFrames),
      }}
    />
  );
};
