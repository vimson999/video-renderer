import type {Caption} from '@remotion/captions';
import {AbsoluteFill, Sequence} from 'remotion';

import {msToFrame} from '../compiler/frame-math.js';
import {verticalBasicProfile} from '../profiles/vertical-basic.js';

export const captionToFrameRange = (
  caption: Caption,
  fps: number,
): {from: number; durationInFrames: number} => {
  const from = msToFrame(caption.startMs, fps);
  return {
    from,
    durationInFrames: Math.max(1, msToFrame(caption.endMs, fps) - from),
  };
};

const CaptionCard = ({text}: {text: string}) => {
  const style = verticalBasicProfile.caption;
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: style.bottom}}>
      <div
        style={{
          maxWidth: style.maxWidth,
          padding: `${style.verticalPadding}px ${style.horizontalPadding}px`,
          borderRadius: style.borderRadius,
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: 700,
          lineHeight: style.lineHeight,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export type CaptionTrackProps = {
  captions: Caption[];
  fps: number;
};

export const CaptionTrack = ({captions, fps}: CaptionTrackProps) => (
  <>
    {captions.map((caption, index) => {
      const range = captionToFrameRange(caption, fps);
      return (
        <Sequence key={`${caption.startMs}-${index}`} name={`caption:${index}`} {...range}>
          <CaptionCard text={caption.text} />
        </Sequence>
      );
    })}
  </>
);
