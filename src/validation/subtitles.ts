import {readFile} from 'node:fs/promises';

import {parseSrt, type Caption} from '@remotion/captions';

import {mediaError} from '../contracts/errors.js';

export const parseSubtitleFile = async (path: string): Promise<Caption[]> => {
  try {
    const input = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
    return parseSrt({input}).captions;
  } catch (cause) {
    throw mediaError('Could not parse subtitle file.', {
      code: 'media.subtitle_unreadable',
      file: path,
      field: '/subtitles',
      repair: 'Replace the subtitle file with valid UTF-8 SRT content.',
    }, cause);
  }
};
