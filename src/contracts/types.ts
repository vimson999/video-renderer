import type {Manifest, Timeline} from './schema.js';

export type RendererExitCode = 0 | 2 | 3 | 4 | 5 | 6 | 7;

export type ValidationIssue = {
  code: string;
  file: string;
  field: string;
  shotId?: string;
  cueIndex?: number;
  repair: string;
};

export type LoadedPackage = {
  root: string;
  manifest: Manifest;
  timeline: Timeline;
  files: {
    manifest: string;
    timeline: string;
    audio: string;
    subtitles: string;
    assets: Map<string, string>;
  };
};
