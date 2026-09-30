import type {Caption} from '@remotion/captions';

import {RendererError} from '../contracts/errors.js';
import type {Shot} from '../contracts/schema.js';
import type {RendererIdentity, ValidationIssue} from '../contracts/types.js';
import type {ValidatedPackage} from '../validation/validate-package.js';
import {msToFrame} from './frame-math.js';

export type CompiledMotion = Shot['motion'];

export type CompiledIncomingPreview = {
  from: number;
  durationInFrames: number;
  src: string;
  fit: Shot['fit'];
  motion: CompiledMotion;
};

export type CompiledShot = {
  id: string;
  from: number;
  durationInFrames: number;
  src: string;
  fit: Shot['fit'];
  motion: CompiledMotion;
  incomingPreview?: CompiledIncomingPreview;
};

export type CompiledVideoProps = {
  identity: RendererIdentity;
  width: 1080;
  height: 1920;
  fps: 30;
  durationInFrames: number;
  audioSrc: string;
  captions: Caption[];
  shots: CompiledShot[];
};

const frameIssue = (
  code: string,
  field: string,
  shotId: string,
  repair: string,
): ValidationIssue => ({
  code,
  file: 'timeline.json',
  field,
  shotId,
  repair,
});

export const compilePackage = (input: ValidatedPackage): CompiledVideoProps => {
  const {fps, width, height, audio} = input.loaded.manifest;
  const issues: ValidationIssue[] = [];
  const shots: CompiledShot[] = input.loaded.timeline.shots.map((shot, index, source) => {
    const from = msToFrame(shot.startMs, fps);
    const end = msToFrame(shot.endMs, fps);
    const durationInFrames = end - from;
    if (durationInFrames <= 0) {
      issues.push(frameIssue(
        'frame.zero_shot',
        `/shots/${index}/endMs`,
        shot.id,
        'Increase the shot duration so it occupies at least one frame at 30fps.',
      ));
    }

    const compiled: CompiledShot = {
      id: shot.id,
      from,
      durationInFrames,
      src: shot.asset,
      fit: shot.fit,
      motion: {...shot.motion},
    };
    const next = source[index + 1];
    if (next && shot.transitionOut.type === 'crossfade') {
      const transitionFrames = msToFrame(shot.transitionOut.durationMs, fps);
      if (transitionFrames <= 0) {
        issues.push(frameIssue(
          'frame.zero_transition',
          `/shots/${index}/transitionOut/durationMs`,
          shot.id,
          'Increase durationMs so the crossfade occupies at least one frame at 30fps.',
        ));
      } else {
        compiled.incomingPreview = {
          from: end - transitionFrames,
          durationInFrames: transitionFrames,
          src: next.asset,
          fit: next.fit,
          motion: {...next.motion},
        };
      }
    }
    return compiled;
  });

  if (issues.length > 0) {
    throw new RendererError({
      kind: 'validation',
      exitCode: 2,
      message: `Timeline has ${issues.length} frame conversion issue(s).`,
      issues,
      identity: input.identity,
    });
  }

  return {
    identity: {...input.identity},
    width,
    height,
    fps,
    durationInFrames: msToFrame(input.loaded.timeline.shots.at(-1)!.endMs, fps),
    audioSrc: audio,
    captions: input.captions.map((caption) => ({...caption})),
    shots,
  };
};
