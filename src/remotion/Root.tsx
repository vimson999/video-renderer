import {Composition, type CalculateMetadataFunction} from 'remotion';

import type {CompiledVideoProps} from '../compiler/compile-package.js';
import {VerticalRoughCut} from './VerticalRoughCut.js';

const defaultProps: CompiledVideoProps = {
  identity: {channelId: 'preview', videoId: 'preview', runId: 'preview'},
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 1,
  audioSrc: 'input/narration.wav',
  captions: [],
  shots: [],
};

const calculateMetadata: CalculateMetadataFunction<CompiledVideoProps> = ({props}) => ({
  durationInFrames: props.durationInFrames,
  width: props.width,
  height: props.height,
  fps: props.fps,
  props,
  defaultOutName: `${props.identity.channelId}-${props.identity.videoId}-${props.identity.runId}`,
  defaultCodec: 'h264',
});

export const RemotionRoot = () => (
  <Composition
    id="VerticalRoughCut"
    component={VerticalRoughCut}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={1}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
  />
);
