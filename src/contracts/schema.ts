import {Type, type Static} from '@sinclair/typebox';

const PackagePathSchema = Type.String({minLength: 1});

export const ManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal('1.0'),
    channelId: Type.String({minLength: 1}),
    videoId: Type.String({minLength: 1}),
    runId: Type.String({minLength: 1}),
    profile: Type.Literal('vertical-basic'),
    width: Type.Literal(1080),
    height: Type.Literal(1920),
    fps: Type.Literal(30),
    timeline: PackagePathSchema,
    audio: PackagePathSchema,
    subtitles: PackagePathSchema,
  },
  {$id: 'https://vimson999.github.io/video-renderer/render-package.schema.json', additionalProperties: false},
);

export const MotionPresetSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('slow-zoom-in'),
  Type.Literal('slow-zoom-out'),
  Type.Literal('pan-left'),
  Type.Literal('pan-right'),
]);

export const ShotSchema = Type.Object(
  {
    id: Type.String({minLength: 1}),
    startMs: Type.Number({minimum: 0}),
    endMs: Type.Number({exclusiveMinimum: 0}),
    asset: PackagePathSchema,
    fit: Type.Union([Type.Literal('cover'), Type.Literal('contain')]),
    motion: Type.Object(
      {
        preset: MotionPresetSchema,
        intensity: Type.Number({minimum: 0, maximum: 1}),
      },
      {additionalProperties: false},
    ),
    transitionOut: Type.Object(
      {
        type: Type.Union([Type.Literal('cut'), Type.Literal('crossfade')]),
        durationMs: Type.Number({minimum: 0}),
      },
      {additionalProperties: false},
    ),
  },
  {additionalProperties: false},
);

export const TimelineSchema = Type.Object(
  {shots: Type.Array(ShotSchema, {minItems: 1})},
  {$id: 'https://vimson999.github.io/video-renderer/timeline.schema.json', additionalProperties: false},
);

export type Manifest = Static<typeof ManifestSchema>;
export type Timeline = Static<typeof TimelineSchema>;
export type Shot = Static<typeof ShotSchema>;
