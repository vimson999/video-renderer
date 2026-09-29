# Video Renderer — Contract-First CLI Design

Date: 2026-09-29  
Status: Design approved in conversation; awaiting written-spec review  
Repository: `https://github.com/vimson999/video-renderer.git`

## 1. Purpose

`video-renderer` is a machine-local, cross-project video rendering tool. Content projects provide a self-contained render package containing images, one narration track, subtitles, and a timeline. The tool validates the package, opens a Remotion Studio preview, and renders a vertical rough-cut MP4.

The renderer is independent from `pdf-to-tts` and from any individual channel. It may be used by health, finance, education, or future content projects through one stable CLI and one versioned input contract.

## 2. First-Release Success Criteria

The first release is successful when it can:

1. validate a portable render package without modifying it;
2. preview a valid package in Remotion Studio;
3. render a 1080×1920, 30fps MP4 from still images, narration, and SRT captions;
4. apply a small set of deterministic image-motion and transition presets;
5. produce machine-readable validation and render reports;
6. run two independent video jobs concurrently without shared-state corruption;
7. reject two jobs that attempt to write to the same output directory;
8. document an end-to-end invocation that works without reading source code.

## 3. Non-Goals for Version 1

Version 1 does not provide:

- an HTTP service, web dashboard, or central job queue;
- cloud rendering;
- video-source tracks;
- multiple narration or music tracks;
- automatic image generation, TTS generation, or transcription;
- content research, script writing, or health-claim verification;
- project-specific knowledge of `pdf-to-tts` or `60-srt-visual-director`;
- unlimited automatic job scheduling;
- a Jianying/CapCut project writer.

These exclusions keep the first release focused on a reliable local rendering boundary.

## 4. Repository and Runtime Boundary

Local path:

```text
/Users/v9/Documents/workspace/v9/code/video-renderer
```

Remote:

```text
https://github.com/vimson999/video-renderer.git
```

The repository owns its Node, React, Remotion, TypeScript, and test dependency versions through `package.json` and a committed lockfile. Remotion dependencies are project-local, not globally installed.

Content assets and real production runs remain in their source projects. This repository contains only reusable renderer code, schemas, documentation, and small test/example fixtures.

## 5. Architecture

```text
render-package
    ↓
CLI
    ↓
contract loader + validator
    ↓
timeline compiler
    ↓
Remotion composition + reusable components
    ↓
Studio preview or render worker
    ↓
MP4 + reports + optional evidence frames
```

Recommended repository structure:

```text
video-renderer/
├── src/
│   ├── cli/
│   ├── contracts/
│   ├── compiler/
│   ├── compositions/
│   ├── components/
│   └── profiles/
├── contracts/
│   ├── render-package.schema.json
│   └── timeline.schema.json
├── docs/
│   ├── cli.md
│   ├── render-package.md
│   └── troubleshooting.md
├── examples/
│   └── vertical-basic/
├── tests/
├── scripts/
├── package.json
├── tsconfig.json
└── README.md
```

Each module has one responsibility:

- `cli`: argument parsing, exit codes, and command orchestration;
- `contracts`: typed loading and validation of external inputs;
- `compiler`: conversion from validated timeline data into Remotion props;
- `compositions`: top-level Remotion compositions;
- `components`: image shots, captions, audio, and transitions;
- `profiles`: reusable visual defaults that do not contain channel content.

## 6. CLI Contract

Version 1 exposes three commands:

```bash
video-renderer validate --input /path/to/render-package

video-renderer studio \
  --input /path/to/render-package \
  --port 3101

video-renderer render \
  --input /path/to/render-package \
  --output /path/to/render-output \
  --concurrency 2
```

During repository development, the same commands may be invoked through an npm script:

```bash
npm run cli -- validate --input /path/to/render-package
```

No command relies on a global “current channel” or “current video”. Every invocation receives an explicit input package.

## 7. Input Package Contract

Version 1 accepts this portable layout:

```text
render-package/
├── manifest.json
├── timeline.json
├── narration.wav
├── subtitle.srt
└── assets/
    ├── shot-001.png
    └── shot-002.png
```

All file references are relative to the render-package root. The package can therefore be moved, archived, or transferred without preserving source-project directory structure.

### 7.1 Manifest

```json
{
  "schemaVersion": "1.0",
  "channelId": "xiaoshan-reading",
  "videoId": "anti-inflammatory-carrot-002",
  "runId": "2026-09-29-anti-inflammatory-carrot-002",
  "profile": "vertical-basic",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "timeline": "timeline.json",
  "audio": "narration.wav",
  "subtitles": "subtitle.srt"
}
```

Required identity fields:

- `channelId`: stable channel identity;
- `videoId`: stable content identity within the channel;
- `runId`: unique production attempt or revision;
- `schemaVersion`: contract compatibility gate.

The first release requires 1080×1920 and 30fps. Other values fail validation in version 1. The values remain explicit so reports and future compatible profiles can reproduce the render without changing version 1 semantics.

### 7.2 Timeline

```json
{
  "shots": [
    {
      "id": "shot-001",
      "startMs": 0,
      "endMs": 4200,
      "asset": "assets/shot-001.png",
      "fit": "cover",
      "motion": {
        "preset": "slow-zoom-in",
        "intensity": 0.08
      },
      "transitionOut": {
        "type": "crossfade",
        "durationMs": 300
      }
    }
  ]
}
```

Supported image-motion presets:

- `none`;
- `slow-zoom-in`;
- `slow-zoom-out`;
- `pan-left`;
- `pan-right`.

Supported transitions:

- `cut`;
- `crossfade`.

Shot intervals are contiguous and non-overlapping: each shot after the first must start at the preceding shot's `endMs`. A `crossfade` is transition metadata rather than a declared timeline overlap: during the final `durationMs` of the outgoing shot, the renderer blends in the next shot. Its duration must be positive, no longer than either adjacent shot, and shorter than the outgoing shot. A final shot may only use `cut` with zero transition duration.

Version 1 does not accept video assets or arbitrary executable animation code in external packages.

## 8. Validation

Validation is deterministic and read-only. It checks:

- supported schema versions;
- required identity and media fields;
- referenced files exist and remain inside the package root;
- image files can be decoded;
- timeline shots are ordered, contiguous, non-overlapping, and have positive duration;
- the first shot starts at zero;
- the final shot's `endMs` differs from the probed narration duration by no more than 100ms;
- SRT cues are ordered, non-overlapping, and do not exceed the narration by more than 100ms;
- profile, motion, fit, and transition values are supported;
- transition duration is valid for its adjacent shots.

Validation writes `validation-report.json` only when the caller specifies an output/report location. It never rewrites the source package.

Every validation error identifies:

- `channelId`, `videoId`, and `runId` when available;
- the relevant file and JSON field;
- the shot or subtitle cue when applicable;
- a concise repair instruction.

## 9. Rendering and Atomic Output

The output directory must be absent or empty when rendering starts. Version 1 has no implicit overwrite mode. The render command performs:

```text
validate
→ acquire output-directory lock
→ create job-specific temporary directory
→ compile timeline to Remotion props
→ render MP4
→ probe output media
→ write render report
→ atomically publish successful output
→ release lock
```

A failed render must not leave a partial file named `rough-cut.mp4`. Temporary artifacts remain clearly marked as incomplete or are cleaned after diagnostic information has been written.

Successful output:

```text
render-output/
├── rough-cut.mp4
├── validation-report.json
├── render-report.json
└── frames/                  # optional evidence frames
```

`render-report.json` records:

- channel/video/run identity;
- renderer and contract versions;
- input-package content hash or stable file summary;
- resolution, fps, duration, codec, and render concurrency;
- start/end timestamps and elapsed render time;
- output size and SHA-256;
- warnings and validation summary.

## 10. Multi-Channel and Parallel Execution

The renderer is stateless between invocations. Parallelism is process-level in version 1:

```bash
video-renderer render --input /project-a/package --output /project-a/output
video-renderer render --input /project-b/package --output /project-b/output
```

The commands may run at the same time when their output directories differ.

Isolation requirements:

- job-specific temporary directories include `channelId`, `runId`, and a generated `jobId`;
- one job never mutates another job’s input, output, logs, or reports;
- locks are scoped to the output directory, not the whole renderer;
- two jobs targeting the same output directory cause one explicit lock-conflict failure;
- Studio sessions use explicit ports and can run concurrently on different ports;
- failure of one job does not cancel or corrupt another job.

Job-level parallelism is distinct from Remotion’s frame-render concurrency. Each render command may set `--concurrency`; documentation warns that multiple jobs share the same CPU and memory budget.

Version 1 guarantees correctness for two concurrent independent jobs. It does not provide a scheduler for many queued jobs.

## 11. Exit Codes

Stable CLI exit codes:

| Code | Meaning |
|---:|---|
| 0 | Success |
| 2 | Input or schema validation failure |
| 3 | Output-directory or lock conflict |
| 4 | Media asset read/decode failure |
| 5 | Studio startup failure |
| 6 | Remotion render failure |
| 7 | Rendered-file technical validation failure |

Unhandled internal errors still produce a concise diagnostic and nonzero exit status; they must not be mislabeled as input errors.

## 12. Testing Strategy

Implementation follows test-driven development. Behavior tests are written and observed failing before production code is added.

Required acceptance tests:

1. missing image asset fails validation;
2. reversed or illegally overlapping shot times fail validation;
3. SRT beyond the documented audio tolerance fails validation;
4. a valid example package compiles to deterministic Remotion props;
5. a short fixture renders a 1080×1920, 30fps MP4;
6. two distinct runs render concurrently without cross-contamination;
7. two jobs targeting one output directory produce an explicit lock conflict;
8. one failed parallel job does not damage the successful job;
9. render reports contain required identity, technical metadata, and output hash;
10. commands copied from the README execute successfully against the example package.

Unit tests cover schema validation, timeline compilation, timing conversion, path confinement, and error mapping. Integration tests cover CLI processes, locking, Studio command construction, Remotion render, and media probing.

## 13. Documentation Deliverables

The first release includes:

- `README.md`: installation and shortest successful workflow;
- `docs/render-package.md`: directory and field reference;
- `docs/cli.md`: commands, options, exit codes, and parallel invocation;
- `docs/troubleshooting.md`: missing assets, timing mismatch, ports, Chromium, and resource pressure;
- `examples/vertical-basic/`: a complete portable example package;
- JSON Schemas for machine validation.

Documentation is part of acceptance: a user must be able to validate, preview, and render the example by copying commands without inspecting source code.

## 14. Security and Data Handling

- Input paths are confined to the package root unless a future contract explicitly permits external paths.
- External packages cannot inject arbitrary JavaScript or React code.
- The renderer does not upload media or contact external services during normal validation/rendering.
- Real channel assets, private platform exports, credentials, and proprietary content are not committed to this repository.
- Reports avoid copying full subtitle or narration content unless explicitly requested.

## 15. Future Compatibility

Future versions may add video assets, music and multiple audio tracks, richer profiles, contract adapters for `60-srt-visual-director`, batch scheduling, or remote workers. Such additions require a new compatible schema version or an explicitly versioned migration; they must not silently change version 1 semantics.

The initial implementation should keep the compiler and renderer boundaries clean so that a later `60` adapter can produce the same validated internal timeline without coupling the renderer to the source repository.
