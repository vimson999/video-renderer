import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {RendererError} from '../../src/contracts/errors.js';
import {loadPackage} from '../../src/contracts/load-package.js';
import {
  createPackageFixture,
  type PackageFixture,
  validManifest,
  validTimeline,
} from '../fixtures.js';

const fixtures: PackageFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const fixture = async (
  options?: Parameters<typeof createPackageFixture>[0],
): Promise<PackageFixture> => {
  const created = await createPackageFixture(options);
  fixtures.push(created);
  return created;
};

const expectContractError = async (
  operation: Promise<unknown>,
  expected: {file: string; field: string},
): Promise<void> => {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(RendererError);
  expect(error).toMatchObject({kind: 'validation', exitCode: 2});
  const issue = (error as RendererError).issues[0];
  expect(issue).toMatchObject(expected);
  expect(issue?.repair.length).toBeGreaterThan(0);
};

describe('loadPackage', () => {
  it('loads a valid package and resolves every referenced file', async () => {
    const created = await fixture();

    const loaded = await loadPackage(created.root);

    expect(loaded.root).toBe(await import('node:fs/promises').then(({realpath}) => realpath(created.root)));
    expect(loaded.manifest.channelId).toBe('channel-a');
    expect(loaded.timeline.shots).toHaveLength(1);
    expect(loaded.files.audio).toBe(join(loaded.root, 'narration.wav'));
    expect(loaded.files.assets.get('shot-001')).toBe(
      join(loaded.root, 'assets/shot-001.png'),
    );
  });

  it.each([
    ['schemaVersion', {...validManifest, schemaVersion: '2.0'}],
    ['profile', {...validManifest, profile: 'unknown'}],
    ['width', {...validManifest, width: 720}],
    ['height', {...validManifest, height: 1280}],
    ['fps', {...validManifest, fps: 24}],
  ])('rejects unsupported manifest %s', async (field, manifest) => {
    const created = await fixture({manifest});
    await expectContractError(loadPackage(created.root), {
      file: 'manifest.json',
      field: `/${field}`,
    });
  });

  it('rejects a missing required identity with a repair instruction', async () => {
    const {channelId: _removed, ...manifest} = validManifest;
    const created = await fixture({manifest});

    await expectContractError(loadPackage(created.root), {
      file: 'manifest.json',
      field: '/channelId',
    });
  });

  it('rejects an absolute referenced path', async () => {
    const created = await fixture({
      manifest: {...validManifest, audio: '/tmp/outside.wav'},
    });

    await expectContractError(loadPackage(created.root), {
      file: 'manifest.json',
      field: '/audio',
    });
  });

  it('rejects lexical traversal outside the package', async () => {
    const created = await fixture({
      timeline: {
        shots: [{...validTimeline.shots[0], asset: '../outside.png'}],
      },
    });

    await expectContractError(loadPackage(created.root), {
      file: 'timeline.json',
      field: '/shots/0/asset',
    });
  });

  it('rejects a symlink whose real target is outside the package', async () => {
    const created = await fixture();
    const outsideDir = await mkdtemp(join(tmpdir(), 'video-renderer-outside-'));
    fixtures.push({
      root: outsideDir,
      cleanup: () => rm(outsideDir, {recursive: true, force: true}),
    });
    const outsideAsset = join(outsideDir, 'outside.png');
    await writeFile(outsideAsset, 'outside');
    await rm(join(created.root, 'assets/shot-001.png'));
    await symlink(outsideAsset, join(created.root, 'assets/shot-001.png'));

    await expectContractError(loadPackage(created.root), {
      file: 'timeline.json',
      field: '/shots/0/asset',
    });
  });
});
