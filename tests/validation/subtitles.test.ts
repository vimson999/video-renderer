import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import {parseSubtitleFile} from '../../src/validation/subtitles.js';

describe('parseSubtitleFile', () => {
  it('preserves Chinese text and timing from BOM-prefixed CRLF SRT', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-renderer-srt-'));
    const path = join(directory, 'subtitle.srt');
    await writeFile(
      path,
      '\uFEFF1\r\n00:00:00,000 --> 00:00:00,600\r\n你好，世界\r\n\r\n2\r\n00:00:00,600 --> 00:00:01,000\r\n抗炎生活\r\n',
    );

    try {
      const captions = await parseSubtitleFile(path);
      expect(captions.map(({text, startMs, endMs}) => ({text, startMs, endMs}))).toEqual([
        {text: '你好，世界', startMs: 0, endMs: 600},
        {text: '抗炎生活', startMs: 600, endMs: 1_000},
      ]);
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
