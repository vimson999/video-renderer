import {describe, expect, it} from 'vitest';

import {parseArgs} from '../../src/cli/args.js';

describe('parseArgs', () => {
  it('parses the three public commands', () => {
    expect(parseArgs(['validate', '--input', '/tmp/package'])).toEqual({
      kind: 'validate',
      input: '/tmp/package',
    });
    expect(parseArgs(['studio', '--input', '/tmp/package', '--port', '3101'])).toEqual({
      kind: 'studio',
      input: '/tmp/package',
      port: 3101,
    });
    expect(parseArgs([
      'render', '--input', '/tmp/package', '--output', '/tmp/output', '--concurrency', '2',
    ])).toEqual({
      kind: 'render',
      input: '/tmp/package',
      output: '/tmp/output',
      concurrency: 2,
    });
  });

  it('supports a validate report path and help', () => {
    expect(parseArgs(['validate', '--input', '/tmp/package', '--report', '/tmp/report.json'])).toEqual({
      kind: 'validate',
      input: '/tmp/package',
      report: '/tmp/report.json',
    });
    expect(parseArgs([])).toEqual({kind: 'help'});
    expect(parseArgs(['--help'])).toEqual({kind: 'help'});
  });

  it.each([
    ['validate'],
    ['studio', '--input', '/tmp/package'],
    ['render', '--input', '/tmp/package', '--output', '/tmp/output'],
    ['render', '--input', '/tmp/package', '--concurrency', '1'],
  ])('rejects missing required flags: %j', (...argv) => {
    expect(() => parseArgs(argv)).toThrow(expect.objectContaining({exitCode: 2}));
  });

  it.each([
    ['studio', '--input', '/tmp/package', '--port', '0'],
    ['studio', '--input', '/tmp/package', '--port', '3.5'],
    ['render', '--input', '/tmp/package', '--output', '/tmp/output', '--concurrency', '-1'],
    ['render', '--input', '/tmp/package', '--output', '/tmp/output', '--concurrency', 'two'],
  ])('rejects a non-positive integer numeric option: %j', (...argv) => {
    expect(() => parseArgs(argv)).toThrow(expect.objectContaining({exitCode: 2}));
  });

  it('rejects unknown commands, options, duplicate flags, and positional values', () => {
    expect(() => parseArgs(['unknown'])).toThrow(expect.objectContaining({exitCode: 2}));
    expect(() => parseArgs(['validate', '--input', '/tmp/package', '--wat', '1'])).toThrow();
    expect(() => parseArgs(['validate', '--input', '/tmp/a', '--input', '/tmp/b'])).toThrow();
    expect(() => parseArgs(['validate', '--input', '/tmp/package', 'extra'])).toThrow();
  });
});
