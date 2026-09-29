# Video Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, contract-first CLI that validates portable still-image render packages, previews them in Remotion Studio, and renders isolated 1080×1920 rough-cut MP4 jobs with reports.

**Architecture:** A typed package loader validates untrusted package data before a deterministic compiler converts milliseconds into Remotion-ready props. Each Studio or render invocation stages only validated assets in a job-specific workspace; the React composition consumes compiled JSON props, while Node-side orchestration owns locking, atomic publication, media probing, and stable exit-code mapping.

**Tech Stack:** Node.js 22+, TypeScript, React, Remotion 4 (all `remotion` and `@remotion/*` packages pinned to the same exact version), `@sinclair/typebox` + Ajv, `@remotion/captions`, Mediabunny with `@mediabunny/server`, Vitest, npm.

**Spec:** `docs/superpowers/specs/2026-09-29-video-renderer-design.md`

## Global Constraints

- Version 1 accepts only one WAV narration, one SRT file, PNG/JPEG still images, and a JSON timeline; it does not accept source videos or executable package code.
- Every manifest must use `schemaVersion: "1.0"`, `profile: "vertical-basic"`, `width: 1080`, `height: 1920`, and `fps: 30`.
- All package paths must be relative and remain inside the real package root after symlink resolution.
- Declared shot intervals are contiguous and non-overlapping; the first starts at `0`; the final end and the last subtitle may differ from audio duration by at most `100ms`.
- Supported motion presets are `none`, `slow-zoom-in`, `slow-zoom-out`, `pan-left`, and `pan-right`; supported transitions are `cut` and `crossfade`.
- A crossfade overlays the next image during the outgoing shot's final transition interval without shortening the declared timeline.
- The output directory must be absent or empty; version 1 never overwrites existing output implicitly.
- Two independent output directories may render concurrently; the same output directory must produce exit code `3` for the losing process.
- Normal validation and rendering perform no uploads or external service calls.
- Tests must be observed failing before implementation and each task ends in an independently reviewable commit.

## Review Focus

- A symlink inside a package that points outside the package root must fail as a path-confinement error; Task 2 adds this test.
- Millisecond boundaries that round to the same frame must not create zero-frame shots or transitions; Task 4 adds this test.
- An interrupted render must not publish `rough-cut.mp4` or leave a stale lock that blocks the next run; Task 7 adds this test.
- Two Studio processes using the same port must map the second startup failure to exit code `5`, while different ports remain independent; Task 8 adds this test.
- Chinese SRT text, BOM input, and CRLF line endings must parse without content loss; Task 3 adds this test.

---

## File Map

### Project configuration

- `package.json`: package metadata, exact dependencies, bin entry, and npm scripts.
- `package-lock.json`: reproducible dependency graph.
- `tsconfig.json`: Node/React TypeScript settings.
- `vitest.config.ts`: unit and integration test configuration.
- `.gitignore`: generated output, caches, and job workspaces.
- `src/index.ts`: executable entry that delegates to the CLI and sets `process.exitCode`.

### Contracts and validation

- `src/contracts/schema.ts`: TypeBox schemas and inferred external contract types.
- `src/contracts/types.ts`: validated internal types, reports, and stable issue shape.
- `src/contracts/errors.ts`: typed operational errors and exit-code mapping.
- `src/contracts/paths.ts`: realpath-based package confinement.
- `src/contracts/load-package.ts`: JSON loading and schema validation.
- `src/contracts/export-schemas.ts`: deterministic JSON Schema serialization.
- `contracts/render-package.schema.json`: committed manifest schema.
- `contracts/timeline.schema.json`: committed timeline schema.
- `src/validation/media.ts`: image decode and audio metadata inspection.
- `src/validation/subtitles.ts`: SRT parsing into Remotion `Caption[]`.
- `src/validation/validate-package.ts`: semantic and cross-file validation.

### Compilation and Remotion UI

- `src/compiler/frame-math.ts`: deterministic millisecond/frame conversion.
- `src/compiler/compile-package.ts`: validated package to `CompiledVideoProps`.
- `src/jobs/workspace.ts`: isolated staging of compiled props and assets.
- `src/remotion/index.ts`: Remotion root registration.
- `src/remotion/Root.tsx`: `VerticalRoughCut` composition registration.
- `src/remotion/VerticalRoughCut.tsx`: top-level audio, shots, transitions, and captions.
- `src/remotion/ShotLayer.tsx`: image fit and motion presets.
- `src/remotion/Captions.tsx`: SRT caption display.
- `src/profiles/vertical-basic.ts`: reusable visual constants.

### Execution and CLI

- `src/render/output-lock.ts`: output-scoped exclusive lock lifecycle.
- `src/render/renderer.ts`: Remotion bundle/select/render orchestration.
- `src/render/media-report.ts`: rendered MP4 probe and SHA-256 calculation.
- `src/render/reports.ts`: validation and render report construction.
- `src/render/publish.ts`: atomic output publication.
- `src/studio/start-studio.ts`: Studio child-process command and lifecycle.
- `src/cli/args.ts`: command-line parsing and help text.
- `src/cli/run-cli.ts`: validate/studio/render orchestration and exit codes.

### Fixtures, tests, and documentation

- `scripts/create-example-assets.ts`: deterministic small images and WAV fixture generation.
- `examples/vertical-basic/`: portable example render package.
- `tests/fixtures.ts`: disposable package/output builders.
- `tests/**/*.test.ts`: focused unit and integration tests.
- `README.md`: installation and shortest successful workflow.
- `docs/render-package.md`: contract reference.
- `docs/cli.md`: commands, options, exit codes, and concurrency.
- `docs/troubleshooting.md`: runtime and repair guidance.

### Task 1: Bootstrap the executable TypeScript project

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `src/cli/run-cli.ts`
- Test: `tests/cli/help.test.ts`

**Interfaces:**
- Produces: `runCli(argv: readonly string[], io: CliIo): Promise<number>` and `CliIo {stdout(message): void; stderr(message): void}`.
- Produces: executable npm bin `video-renderer` and scripts `build`, `typecheck`, `test`, `cli`, and `schemas`.

- [ ] **Step 1: Write the failing CLI help test**

Assert `runCli(["--help"], fakeIo)` returns `0`, writes all three command names, and writes no stderr output.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/cli/help.test.ts`
Expected: FAIL because the package, test runner, or `runCli` does not exist.

- [ ] **Step 3: Add project configuration and minimal CLI entry**

Pin every Remotion package to the same exact 4.x version selected at install time; set `engines.node` to `>=22`; make `src/index.ts` call `runCli(process.argv.slice(2), console-backed CliIo)` and assign the returned code to `process.exitCode`.

- [ ] **Step 4: Run focused and static checks**

Run: `npm test -- tests/cli/help.test.ts && npm run typecheck && npm run build`
Expected: PASS with a runnable `video-renderer --help` entry.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/index.ts src/cli/run-cli.ts tests/cli/help.test.ts
git commit -m "chore: bootstrap video renderer cli"
```

### Task 2: Load contracts and enforce package-root confinement

**Files:**
- Create: `src/contracts/schema.ts`
- Create: `src/contracts/types.ts`
- Create: `src/contracts/errors.ts`
- Create: `src/contracts/paths.ts`
- Create: `src/contracts/load-package.ts`
- Create: `src/contracts/export-schemas.ts`
- Create: `contracts/render-package.schema.json`
- Create: `contracts/timeline.schema.json`
- Create: `tests/fixtures.ts`
- Test: `tests/contracts/load-package.test.ts`
- Test: `tests/contracts/schema-files.test.ts`

**Interfaces:**
- Produces: `loadPackage(inputDir: string): Promise<LoadedPackage>`.
- Produces: `resolvePackageFile(rootRealPath: string, relativePath: string): Promise<string>`.
- Produces: `RendererError {kind, exitCode, message, issues}` where each `ValidationIssue` has `code`, `file`, `field`, optional `shotId`/`cueIndex`, and `repair`.
- Produces: `writeJsonSchemas(targetDir: string): Promise<void>`.

- [ ] **Step 1: Write failing contract-loader tests**

Cover a valid package; unsupported schema/profile/dimensions/fps; missing required identity; absolute paths; `..` traversal; and a package symlink whose real target is outside the root. Assert invalid data throws `RendererError` with exit code `2`, precise field/file, and repair text.

- [ ] **Step 2: Run the loader tests to verify they fail**

Run: `npm test -- tests/contracts/load-package.test.ts`
Expected: FAIL because contract schemas and loader are missing.

- [ ] **Step 3: Implement schemas, typed errors, realpath confinement, and loader**

Use TypeBox as the single schema source and Ajv for JSON validation. Reject unknown enum values and paths that are absolute, escape lexically, or escape after symlink resolution. Loading remains read-only.

- [ ] **Step 4: Run loader tests to verify they pass**

Run: `npm test -- tests/contracts/load-package.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing committed-schema drift test**

Generate schemas into a temporary directory and assert byte equality with `contracts/render-package.schema.json` and `contracts/timeline.schema.json`.

- [ ] **Step 6: Run the schema drift test to verify it fails**

Run: `npm test -- tests/contracts/schema-files.test.ts`
Expected: FAIL because committed schema files are absent.

- [ ] **Step 7: Generate and verify committed JSON Schemas**

Run: `npm run schemas && npm test -- tests/contracts/schema-files.test.ts`
Expected: PASS and a second `npm run schemas` leaves `git diff --exit-code` clean.

- [ ] **Step 8: Commit**

```bash
git add src/contracts contracts tests/contracts tests/fixtures.ts package.json package-lock.json
git commit -m "feat: add render package contracts"
```

### Task 3: Inspect media, parse SRT, and perform semantic validation

**Files:**
- Create: `src/validation/media.ts`
- Create: `src/validation/subtitles.ts`
- Create: `src/validation/validate-package.ts`
- Test: `tests/validation/media.test.ts`
- Test: `tests/validation/subtitles.test.ts`
- Test: `tests/validation/validate-package.test.ts`

**Interfaces:**
- Consumes: `LoadedPackage`, `RendererError`, and `ValidationIssue` from Task 2.
- Produces: `inspectNarration(path: string): Promise<AudioMetadata>` with `durationMs`, sample rate, and channel count.
- Produces: `inspectStill(path: string): Promise<ImageMetadata>` with width, height, and decoded format.
- Produces: `parseSubtitleFile(path: string): Promise<Caption[]>`.
- Produces: `validatePackage(inputDir: string): Promise<ValidatedPackage>` where `ValidatedPackage` contains loaded contracts, resolved paths, media metadata, captions, warnings, and a `ValidationReport`.

- [ ] **Step 1: Write failing media and subtitle parser tests**

Assert valid WAV/image metadata; corrupt image maps to exit code `4`; corrupt/missing audio maps to exit code `4`; and Chinese SRT with UTF-8 BOM plus CRLF preserves Chinese text and millisecond timings.

- [ ] **Step 2: Run parser tests to verify they fail**

Run: `npm test -- tests/validation/media.test.ts tests/validation/subtitles.test.ts`
Expected: FAIL because inspection and parsing are absent.

- [ ] **Step 3: Implement local media inspection and SRT parsing**

Use Mediabunny `FilePathSource` with `@mediabunny/server` for narration duration and `@remotion/captions` `parseSrt()` for subtitles. Decode image metadata locally; do not invoke network services.

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `npm test -- tests/validation/media.test.ts tests/validation/subtitles.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing semantic-validation tests**

Cover missing assets; duplicate shot IDs; first start not zero; reversed, gapped, or overlapping shots; unsupported fit/motion/transition; invalid final transition; crossfade longer than an adjacent shot; final timeline beyond `100ms` audio tolerance; overlapping/out-of-order SRT; and SRT beyond `100ms` audio tolerance. Assert identity fields are retained in every report when manifest parsing succeeded.

- [ ] **Step 6: Run semantic tests to verify they fail**

Run: `npm test -- tests/validation/validate-package.test.ts`
Expected: FAIL because semantic validation is absent.

- [ ] **Step 7: Implement semantic validation and report construction**

Collect repairable issues in one deterministic report rather than stopping at the first semantic error; retain exit code `4` for unreadable media and `2` for contract/timing errors.

- [ ] **Step 8: Run validation tests and commit**

Run: `npm test -- tests/validation`
Expected: PASS.

```bash
git add src/validation tests/validation package.json package-lock.json
git commit -m "feat: validate render package media and timing"
```

### Task 4: Compile validated milliseconds into deterministic frame props

**Files:**
- Create: `src/compiler/frame-math.ts`
- Create: `src/compiler/compile-package.ts`
- Test: `tests/compiler/frame-math.test.ts`
- Test: `tests/compiler/compile-package.test.ts`

**Interfaces:**
- Consumes: `ValidatedPackage` from Task 3.
- Produces: `msToFrame(ms: number, fps: number): number` using nearest-frame rounding for boundaries.
- Produces: `compilePackage(input: ValidatedPackage): CompiledVideoProps`.
- Produces: `CompiledVideoProps {identity, width, height, fps, durationInFrames, audioSrc, captions, shots}`; each compiled shot has integer `from`, `durationInFrames`, staged `src`, motion data, and optional incoming-preview transition data.

- [ ] **Step 1: Write failing frame-conversion and compiler tests**

Assert deterministic output for the example timeline, exact 30fps boundary conversion, no gaps after rounding shared boundaries, caption timing preservation, total duration from the final shot boundary, and crossfade metadata that does not shorten total duration.

- [ ] **Step 2: Add the review-focus rounding tests**

Assert a positive millisecond shot or transition that rounds to zero frames is rejected with a field-specific repair issue before a composition is produced.

- [ ] **Step 3: Run compiler tests to verify they fail**

Run: `npm test -- tests/compiler`
Expected: FAIL because compiler functions are missing.

- [ ] **Step 4: Implement frame math and pure compilation**

Keep compilation free of filesystem mutation and timestamps so identical validated input produces byte-equivalent JSON after stable serialization.

- [ ] **Step 5: Run compiler tests and commit**

Run: `npm test -- tests/compiler && npm run typecheck`
Expected: PASS.

```bash
git add src/compiler tests/compiler
git commit -m "feat: compile timelines into remotion props"
```

### Task 5: Stage isolated job workspaces

**Files:**
- Create: `src/jobs/workspace.ts`
- Test: `tests/jobs/workspace.test.ts`

**Interfaces:**
- Consumes: `ValidatedPackage` and `CompiledVideoProps` from Tasks 3–4.
- Produces: `prepareJobWorkspace(validated, compiled, options): Promise<JobWorkspace>` with unique `jobId`, `rootDir`, `publicDir`, `propsFile`, and `cleanup()`.
- Produces: staged public paths `input/assets/*`, `input/narration.wav`, and `compiled.json`; compiled props reference only public-relative `staticFile()` paths.

- [ ] **Step 1: Write failing workspace-isolation tests**

Create two packages with different channel/run IDs concurrently and assert distinct roots, props, assets, and cleanup behavior; assert the source packages remain byte-identical.

- [ ] **Step 2: Run workspace tests to verify they fail**

Run: `npm test -- tests/jobs/workspace.test.ts`
Expected: FAIL because staging is missing.

- [ ] **Step 3: Implement workspace staging**

Use OS temp storage with sanitized identity fragments plus a random `jobId`; copy or hard-link only files already resolved by validation; write compiled props atomically.

- [ ] **Step 4: Run workspace tests and commit**

Run: `npm test -- tests/jobs/workspace.test.ts`
Expected: PASS.

```bash
git add src/jobs tests/jobs
git commit -m "feat: isolate staged render workspaces"
```

### Task 6: Build the Remotion composition, motion presets, transitions, and captions

**Files:**
- Create: `src/remotion/index.ts`
- Create: `src/remotion/Root.tsx`
- Create: `src/remotion/VerticalRoughCut.tsx`
- Create: `src/remotion/ShotLayer.tsx`
- Create: `src/remotion/Captions.tsx`
- Create: `src/profiles/vertical-basic.ts`
- Test: `tests/remotion/composition.test.tsx`
- Test: `tests/remotion/motion.test.ts`

**Interfaces:**
- Consumes: `CompiledVideoProps` from Task 4 through Remotion input props.
- Produces: registered composition ID `VerticalRoughCut` with dynamic `durationInFrames` and fixed 1080×1920 at 30fps.
- Produces: `getMotionStyle(preset, intensity, localFrame, durationInFrames): React.CSSProperties`.
- Produces: `ShotLayer`, `CaptionTrack`, and `VerticalRoughCut` React components.

- [ ] **Step 1: Write failing motion and composition structure tests**

Assert all five presets clamp at start/end; `cover` and `contain` map correctly; shot sequences use compiled integer frames; crossfade preview opacity runs only in the outgoing tail and leaves total duration unchanged; audio starts at frame zero; caption sequences align to caption milliseconds.

- [ ] **Step 2: Run Remotion unit tests to verify they fail**

Run: `npm test -- tests/remotion`
Expected: FAIL because composition modules are missing.

- [ ] **Step 3: Implement the profile and Remotion components**

Use `useCurrentFrame()` and inline `interpolate()`-driven styles; use `Img`/`staticFile()` for staged stills and `Audio` for staged narration. Implement crossfade as an incoming-image overlay during the outgoing tail rather than `TransitionSeries`, preserving the contract duration.

- [ ] **Step 4: Run component tests and typecheck**

Run: `npm test -- tests/remotion && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remotion src/profiles tests/remotion package.json package-lock.json
git commit -m "feat: add vertical remotion composition"
```

### Task 7: Render atomically with output locks and machine-readable reports

**Files:**
- Create: `src/render/output-lock.ts`
- Create: `src/render/renderer.ts`
- Create: `src/render/media-report.ts`
- Create: `src/render/reports.ts`
- Create: `src/render/publish.ts`
- Test: `tests/render/output-lock.test.ts`
- Test: `tests/render/reports.test.ts`
- Test: `tests/render/render.integration.test.ts`

**Interfaces:**
- Consumes: `JobWorkspace` and `CompiledVideoProps`.
- Produces: `acquireOutputLock(outputDir: string): Promise<OutputLock>` where `release()` is idempotent.
- Produces: `renderJob(request: RenderRequest): Promise<RenderResult>` with input/output paths and integer Remotion concurrency.
- Produces: `probeRenderedVideo(path: string): Promise<RenderedMediaMetadata>`.
- Produces: successful files `rough-cut.mp4`, `validation-report.json`, and `render-report.json` published as one completed output directory; the render report includes a stable input-package hash and the MP4 SHA-256.

- [ ] **Step 1: Write failing lock and output-policy tests**

Assert absent/empty output is accepted, non-empty output is rejected with exit code `3`, and two acquisitions for the same canonical output allow exactly one holder.

- [ ] **Step 2: Run lock tests to verify they fail**

Run: `npm test -- tests/render/output-lock.test.ts`
Expected: FAIL because locks are missing.

- [ ] **Step 3: Implement canonical output locking and stale-owner detection**

Store PID, job ID, and creation time in a sibling lock file created with exclusive filesystem semantics. A dead local PID may be reclaimed; a live or unverifiable owner must not be stolen.

- [ ] **Step 4: Run lock tests to verify they pass**

Run: `npm test -- tests/render/output-lock.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing report and render integration tests**

Render a three-second fixture and assert H.264 MP4, 1080×1920, 30fps, expected duration tolerance, nonzero size, SHA-256, identity/version/concurrency/timestamps, and validation summary. Inject a renderer failure and assert no published `rough-cut.mp4`.

- [ ] **Step 6: Add interrupted-render recovery tests**

Terminate a child render after lock acquisition, verify no final MP4 is published, then verify a new process can reclaim the dead-owner lock and render successfully.

- [ ] **Step 7: Run integration tests to verify they fail**

Run: `npm test -- tests/render/reports.test.ts tests/render/render.integration.test.ts`
Expected: FAIL because rendering/report publication is missing.

- [ ] **Step 8: Implement Remotion Node rendering, media probe, hashing, and atomic publish**

Use `bundle()`, `selectComposition()`, and `renderMedia()` with H.264/yuv420p. Probe the result through the project-pinned Remotion/Mediabunny tooling, never an assumed global binary. Render into a sibling job temp directory, remove the caller's output directory only when it was proven empty while the lock is held, and rename the completed directory into place before releasing the lock.

- [ ] **Step 9: Run render tests and commit**

Run: `npm test -- tests/render`
Expected: PASS.

```bash
git add src/render tests/render package.json package-lock.json
git commit -m "feat: render and publish atomic video outputs"
```

### Task 8: Implement validate, Studio, and render CLI orchestration

**Files:**
- Create: `src/cli/args.ts`
- Create: `src/studio/start-studio.ts`
- Modify: `src/cli/run-cli.ts`
- Modify: `src/index.ts`
- Test: `tests/cli/args.test.ts`
- Test: `tests/cli/validate.test.ts`
- Test: `tests/cli/studio.test.ts`
- Test: `tests/cli/render.test.ts`

**Interfaces:**
- Consumes: validators, staging, renderer, and `RendererError` from earlier tasks.
- Produces: `parseArgs(argv): CliCommand` for `validate`, `studio`, and `render`.
- Produces: `startStudio(request: StudioRequest): Promise<StudioProcess>` using explicit input, port, staged public directory, and props file.
- Completes: `runCli()` with stable exit codes `0`, `2`, `3`, `4`, `5`, `6`, and `7`.

- [ ] **Step 1: Write failing argument and validate-command tests**

Assert required flags, positive integer port/concurrency, unknown-option rejection, help output, successful validation summary, optional report path, and exact exit-code mapping for schema/media failures.

- [ ] **Step 2: Run focused CLI tests to verify they fail**

Run: `npm test -- tests/cli/args.test.ts tests/cli/validate.test.ts`
Expected: FAIL because command parsing/orchestration is incomplete.

- [ ] **Step 3: Implement argument parsing and validate orchestration**

Keep stdout machine-friendly and diagnostics on stderr; never print full subtitle or narration content.

- [ ] **Step 4: Run validate CLI tests to verify they pass**

Run: `npm test -- tests/cli/args.test.ts tests/cli/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing Studio and render command tests**

Assert Studio passes explicit entry point, `--no-open`, `--force-new`, `--port`, `--public-dir`, and `--props`; different ports can stay live concurrently; same-port startup maps to exit code `5`; render forwards concurrency and maps render/probe failures to `6`/`7`.

- [ ] **Step 6: Run Studio/render CLI tests to verify they fail**

Run: `npm test -- tests/cli/studio.test.ts tests/cli/render.test.ts`
Expected: FAIL because Studio/render commands are incomplete.

- [ ] **Step 7: Implement Studio child lifecycle and render orchestration**

Retain the staged Studio workspace until the child exits or receives SIGINT/SIGTERM; then clean it. Propagate signals, release render resources in `finally`, and preserve typed exit-code mapping.

- [ ] **Step 8: Run all CLI tests and commit**

Run: `npm test -- tests/cli && npm run typecheck`
Expected: PASS.

```bash
git add src/cli src/studio src/index.ts tests/cli
git commit -m "feat: expose validate studio and render commands"
```

### Task 9: Prove two-job isolation and failure independence

**Files:**
- Create: `tests/concurrency/parallel-renders.test.ts`
- Create: `tests/concurrency/output-conflict.test.ts`
- Modify: `tests/fixtures.ts`

**Interfaces:**
- Consumes: the built CLI as a child process.
- Proves: two-channel/two-video correctness, same-output exclusion, and failure isolation at the public process boundary.

- [ ] **Step 1: Write failing two-job process tests**

Start two renders concurrently with distinct channel/video/run IDs and outputs; assert both exit `0`, reports contain only their own identities/hashes, and output frames differ. Start two renders against one output and assert exactly one succeeds while the other exits `3`.

- [ ] **Step 2: Add failure-isolation test**

Run one valid job beside a package made invalid after process launch; assert the invalid job exits nonzero while the valid output remains complete and technically valid.

- [ ] **Step 3: Run concurrency tests to verify they fail before any repair**

Run: `npm test -- tests/concurrency`
Expected: FAIL if any shared state, lock race, or cleanup leak remains.

- [ ] **Step 4: Make only the isolation fixes exposed by the tests**

Keep all mutable state scoped to the invocation/job workspace; do not introduce a global queue or global current package.

- [ ] **Step 5: Run concurrency and full regression suites**

Run: `npm test -- tests/concurrency && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/concurrency tests/fixtures.ts src
git commit -m "test: verify parallel render isolation"
```

### Task 10: Ship the portable example and operator documentation

**Files:**
- Create: `scripts/create-example-assets.ts`
- Create: `examples/vertical-basic/manifest.json`
- Create: `examples/vertical-basic/timeline.json`
- Create: `examples/vertical-basic/subtitle.srt`
- Create: `examples/vertical-basic/narration.wav`
- Create: `examples/vertical-basic/assets/shot-001.png`
- Create: `examples/vertical-basic/assets/shot-002.png`
- Create: `README.md`
- Create: `docs/render-package.md`
- Create: `docs/cli.md`
- Create: `docs/troubleshooting.md`
- Test: `tests/acceptance/readme-commands.test.ts`

**Interfaces:**
- Consumes: public CLI and schemas.
- Produces: a complete, redistributable example package and copy-paste workflows for install, validate, Studio, render, and two parallel jobs.

- [ ] **Step 1: Write the failing README/example acceptance test**

Extract the marked quick-start commands, run schema generation and validation against `examples/vertical-basic`, render its three-second MP4, and assert the documented output files exist. Assert docs list every exit code and explain job-level versus frame-level concurrency.

- [ ] **Step 2: Run acceptance test to verify it fails**

Run: `npm test -- tests/acceptance/readme-commands.test.ts`
Expected: FAIL because example assets and docs are missing.

- [ ] **Step 3: Add deterministic example assets and complete documentation**

Document Node/Chrome requirements, installation, all contract fields, the `100ms` tolerance, path confinement, output policy, ports, Chromium troubleshooting, resource pressure, stale-lock recovery, report contents, and the fact that real channel assets stay outside this repository.

- [ ] **Step 4: Run acceptance and complete verification**

Run: `npm run schemas && git diff --exit-code contracts && npm test && npm run typecheck && npm run build`
Expected: PASS with no schema drift.

- [ ] **Step 5: Manually smoke-test the public commands**

Run:

```bash
npm run cli -- validate --input examples/vertical-basic
npm run cli -- render --input examples/vertical-basic --output /tmp/video-renderer-example-output --concurrency 2
```

Expected: both exit `0`; the output contains a playable `rough-cut.mp4`, `validation-report.json`, and `render-report.json`.

- [ ] **Step 6: Commit**

```bash
git add scripts examples README.md docs tests/acceptance package.json package-lock.json
git commit -m "docs: add portable example and operator guide"
```

### Task 11: Final requirement audit and branch handoff

**Files:**
- Modify only files required by failures found during the audit.

**Interfaces:**
- Proves every success criterion, acceptance test, deliverable, exit code, and non-goal in the design spec against current repository evidence.

- [ ] **Step 1: Run the full automated gate**

Run: `npm ci && npm run schemas && git diff --exit-code contracts && npm test && npm run typecheck && npm run build`
Expected: PASS from a clean dependency installation.

- [ ] **Step 2: Run public CLI and media checks**

Validate and render the example; inspect the MP4 metadata and report hash; run the two-job concurrency test once without test mocks; launch Studio on an unused port and confirm the `VerticalRoughCut` composition loads.

- [ ] **Step 3: Audit spec coverage explicitly**

Record evidence for all eight success criteria, ten required acceptance tests, four documentation deliverables, seven exit codes, security constraints, and version-1 non-goals. Treat missing evidence as incomplete work and repair before proceeding.

- [ ] **Step 4: Inspect repository hygiene**

Run: `git status --short && git log --oneline --decorate -12`
Expected: no generated media, real channel assets, credentials, or uncommitted changes.

- [ ] **Step 5: Commit any audit repairs**

```bash
git add <only-files-repaired-by-audit>
git commit -m "fix: close final renderer audit gaps"
```

Skip this commit when no repairs were necessary.
