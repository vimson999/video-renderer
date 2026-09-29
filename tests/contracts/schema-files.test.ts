import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

import {writeJsonSchemas} from '../../src/contracts/export-schemas.js';

describe('committed JSON Schemas', () => {
  it('match the deterministic schemas generated from TypeBox', async () => {
    const target = await mkdtemp(join(tmpdir(), 'video-renderer-schemas-'));

    try {
      await writeJsonSchemas(target);
      for (const name of [
        'render-package.schema.json',
        'timeline.schema.json',
      ]) {
        const generated = await readFile(join(target, name), 'utf8');
        const committed = await readFile(resolve('contracts', name), 'utf8');
        expect(generated).toBe(committed);
      }
    } finally {
      await rm(target, {recursive: true, force: true});
    }
  });
});
