import {access, mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {compilePackage, type CompiledVideoProps} from '../../src/compiler/compile-package.js';
import {prepareJobWorkspace, type JobWorkspace} from '../../src/jobs/workspace.js';
import {validatePackage, type ValidatedPackage} from '../../src/validation/validate-package.js';
import {
  createPackageFixture,
  type PackageFixture,
  validManifest,
} from '../fixtures.js';

const fixtures: PackageFixture[] = [];
const workspaces: JobWorkspace[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})),
  );
});

const snapshotDirectory = async (root: string): Promise<string> => {
  const hash = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        hash.update(relative(root, path));
        hash.update(await readFile(path));
      }
    }
  };
  await visit(root);
  return hash.digest('hex');
};

const makeInput = async (
  channelId: string,
  runId: string,
): Promise<{fixture: PackageFixture; validated: ValidatedPackage; compiled: CompiledVideoProps}> => {
  const fixture = await createPackageFixture({
    manifest: {...validManifest, channelId, videoId: `${channelId}-video`, runId},
  });
  fixtures.push(fixture);
  const validated = await validatePackage(fixture.root);
  return {fixture, validated, compiled: compilePackage(validated)};
};

describe('prepareJobWorkspace', () => {
  it('stages two packages concurrently without shared files or source mutation', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'video-renderer-jobs-test-'));
    tempRoots.push(tempRoot);
    const [first, second] = await Promise.all([
      makeInput('health-channel', 'run-health'),
      makeInput('books-channel', 'run-books'),
    ]);
    const before = await Promise.all([
      snapshotDirectory(first.fixture.root),
      snapshotDirectory(second.fixture.root),
    ]);

    const [firstWorkspace, secondWorkspace] = await Promise.all([
      prepareJobWorkspace(first.validated, first.compiled, {tempRoot}),
      prepareJobWorkspace(second.validated, second.compiled, {tempRoot}),
    ]);
    workspaces.push(firstWorkspace, secondWorkspace);

    expect(firstWorkspace.jobId).not.toBe(secondWorkspace.jobId);
    expect(firstWorkspace.rootDir).not.toBe(secondWorkspace.rootDir);
    expect(firstWorkspace.publicDir).toBe(join(firstWorkspace.rootDir, 'public'));
    expect(firstWorkspace.propsFile).toBe(join(firstWorkspace.publicDir, 'compiled.json'));

    const firstProps = JSON.parse(await readFile(firstWorkspace.propsFile, 'utf8')) as CompiledVideoProps;
    const secondProps = JSON.parse(await readFile(secondWorkspace.propsFile, 'utf8')) as CompiledVideoProps;
    expect(firstProps.identity.channelId).toBe('health-channel');
    expect(secondProps.identity.channelId).toBe('books-channel');
    expect(firstProps.audioSrc).toBe('input/narration.wav');
    expect(firstProps.shots[0]?.src).toBe('input/assets/shot-001.png');
    expect(secondProps.shots[0]?.src).toBe('input/assets/shot-001.png');

    await expect(readFile(join(firstWorkspace.publicDir, firstProps.audioSrc))).resolves.toHaveLength(
      16_044,
    );
    await expect(
      readFile(join(firstWorkspace.publicDir, firstProps.shots[0]!.src)),
    ).resolves.toHaveLength(68);
    expect(await Promise.all([
      snapshotDirectory(first.fixture.root),
      snapshotDirectory(second.fixture.root),
    ])).toEqual(before);
  });

  it('cleans only its own job directory and cleanup is idempotent', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'video-renderer-jobs-test-'));
    tempRoots.push(tempRoot);
    const first = await makeInput('health-channel', 'run-one');
    const second = await makeInput('health-channel', 'run-two');
    const firstWorkspace = await prepareJobWorkspace(first.validated, first.compiled, {tempRoot});
    const secondWorkspace = await prepareJobWorkspace(second.validated, second.compiled, {tempRoot});
    workspaces.push(secondWorkspace);

    await firstWorkspace.cleanup();
    await firstWorkspace.cleanup();

    await expect(access(firstWorkspace.rootDir)).rejects.toThrow();
    await expect(access(secondWorkspace.propsFile)).resolves.toBeUndefined();
  });
});
