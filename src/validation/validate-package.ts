import type {Caption} from '@remotion/captions';

import {attachIdentity, RendererError} from '../contracts/errors.js';
import {loadPackage} from '../contracts/load-package.js';
import type {
  LoadedPackage,
  RendererIdentity,
  ValidationIssue,
} from '../contracts/types.js';
import {
  inspectNarration,
  inspectStill,
  type AudioMetadata,
  type ImageMetadata,
} from './media.js';
import {parseSubtitleFile} from './subtitles.js';

export type ValidationReport = {
  schemaVersion: '1.0';
  valid: true;
  identity: RendererIdentity;
  issueCount: 0;
  warningCount: number;
  shotCount: number;
  captionCount: number;
  audioDurationMs: number;
};

export type ValidatedPackage = {
  loaded: LoadedPackage;
  identity: RendererIdentity;
  audio: AudioMetadata;
  images: Map<string, ImageMetadata>;
  captions: Caption[];
  warnings: string[];
  report: ValidationReport;
};

const issue = (
  file: string,
  code: string,
  field: string,
  repair: string,
  shotId?: string,
  cueIndex?: number,
): ValidationIssue => ({
  code,
  file,
  field,
  repair,
  ...(shotId === undefined ? {} : {shotId}),
  ...(cueIndex === undefined ? {} : {cueIndex}),
});

const timelineIssues = (
  loaded: LoadedPackage,
  audioDurationMs: number,
): ValidationIssue[] => {
  const timelineIssue = (
    code: string,
    field: string,
    repair: string,
    shotId?: string,
  ): ValidationIssue => issue(loaded.manifest.timeline, code, field, repair, shotId);
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const {shots} = loaded.timeline;

  if (shots[0]?.startMs !== 0) {
    issues.push(timelineIssue(
      'timeline.first_start',
      '/shots/0/startMs',
      'Set the first shot startMs to 0.',
      shots[0]?.id,
    ));
  }

  shots.forEach((shot, index) => {
    const base = `/shots/${index}`;
    if (seenIds.has(shot.id)) {
      issues.push(timelineIssue(
        'timeline.duplicate_id',
        `${base}/id`,
        'Give every shot a unique id.',
        shot.id,
      ));
    }
    seenIds.add(shot.id);

    if (shot.endMs <= shot.startMs) {
      issues.push(timelineIssue(
        'timeline.reversed',
        `${base}/endMs`,
        'Set endMs greater than startMs.',
        shot.id,
      ));
    }

    const previous = shots[index - 1];
    if (previous && shot.startMs > previous.endMs) {
      issues.push(timelineIssue(
        'timeline.gap',
        `${base}/startMs`,
        `Set startMs to the previous shot endMs (${previous.endMs}).`,
        shot.id,
      ));
    } else if (previous && shot.startMs < previous.endMs) {
      issues.push(timelineIssue(
        'timeline.overlap',
        `${base}/startMs`,
        `Set startMs to the previous shot endMs (${previous.endMs}).`,
        shot.id,
      ));
    }

    const next = shots[index + 1];
    if (!next) {
      if (shot.transitionOut.type !== 'cut' || shot.transitionOut.durationMs !== 0) {
        issues.push(timelineIssue(
          'transition.final',
          `${base}/transitionOut`,
          'Set the final shot transitionOut to cut with durationMs 0.',
          shot.id,
        ));
      }
    } else if (shot.transitionOut.type === 'cut') {
      if (shot.transitionOut.durationMs !== 0) {
        issues.push(timelineIssue(
          'transition.cut_duration',
          `${base}/transitionOut/durationMs`,
          'Set a cut transition durationMs to 0.',
          shot.id,
        ));
      }
    } else {
      const outgoingDuration = shot.endMs - shot.startMs;
      const incomingDuration = next.endMs - next.startMs;
      const duration = shot.transitionOut.durationMs;
      if (duration <= 0 || duration >= outgoingDuration || duration > incomingDuration) {
        issues.push(timelineIssue(
          'transition.duration',
          `${base}/transitionOut/durationMs`,
          'Use a positive crossfade shorter than the outgoing shot and no longer than the incoming shot.',
          shot.id,
        ));
      }
    }
  });

  const finalEnd = shots.at(-1)?.endMs ?? 0;
  if (Math.abs(finalEnd - audioDurationMs) > 100) {
    issues.push(timelineIssue(
      'timeline.final_duration',
      `/shots/${Math.max(0, shots.length - 1)}/endMs`,
      `Set the final endMs within 100ms of narration duration ${audioDurationMs}ms.`,
      shots.at(-1)?.id,
    ));
  }
  return issues;
};

const subtitleIssues = (
  captions: Caption[],
  audioDurationMs: number,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  captions.forEach((caption, index) => {
    const previous = captions[index - 1];
    if (previous && caption.startMs < previous.startMs) {
      issues.push(issue('subtitle.srt',
        'subtitle.order',
        `/cues/${index}/startMs`,
        'Order SRT cues by ascending start time.',
        undefined,
        index,
      ));
    } else if (previous && caption.startMs < previous.endMs) {
      issues.push(issue('subtitle.srt',
        'subtitle.overlap',
        `/cues/${index}/startMs`,
        'End the previous cue before this cue starts.',
        undefined,
        index,
      ));
    }
  });
  const finalCue = captions.at(-1);
  if (finalCue && finalCue.endMs - audioDurationMs > 100) {
    issues.push(issue('subtitle.srt',
      'subtitle.duration',
      `/cues/${captions.length - 1}/endMs`,
      `End the final cue no more than 100ms after narration duration ${audioDurationMs}ms.`,
      undefined,
      captions.length - 1,
    ));
  }
  return issues;
};

export const validatePackage = async (inputDir: string): Promise<ValidatedPackage> => {
  const loaded = await loadPackage(inputDir);
  const identity = {
    channelId: loaded.manifest.channelId,
    videoId: loaded.manifest.videoId,
    runId: loaded.manifest.runId,
  };

  try {
    const [audio, captions, imageEntries] = await Promise.all([
      inspectNarration(loaded.files.audio),
      parseSubtitleFile(loaded.files.subtitles),
      Promise.all(
        loaded.timeline.shots.map(async (shot) => [
          shot.id,
          await inspectStill(loaded.files.assets.get(shot.id)!),
        ] as const),
      ),
    ]);
    const images = new Map(imageEntries);
    const issues = [
      ...timelineIssues(loaded, audio.durationMs),
      ...subtitleIssues(captions, audio.durationMs),
    ];
    if (issues.length > 0) {
      throw new RendererError({
        kind: 'validation',
        exitCode: 2,
        message: `Render package has ${issues.length} semantic validation issue(s).`,
        issues,
        identity,
      });
    }
    const warnings: string[] = [];
    return {
      loaded,
      identity,
      audio,
      images,
      captions,
      warnings,
      report: {
        schemaVersion: '1.0',
        valid: true,
        identity,
        issueCount: 0,
        warningCount: warnings.length,
        shotCount: loaded.timeline.shots.length,
        captionCount: captions.length,
        audioDurationMs: audio.durationMs,
      },
    };
  } catch (error) {
    throw attachIdentity(error, identity);
  }
};
