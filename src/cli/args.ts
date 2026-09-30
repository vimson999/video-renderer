import {RendererError} from '../contracts/errors.js';

export type CliCommand =
  | {kind: 'help'}
  | {kind: 'validate'; input: string; report?: string}
  | {kind: 'studio'; input: string; port: number}
  | {kind: 'render'; input: string; output: string; concurrency: number};

const argumentError = (message: string): RendererError =>
  new RendererError({kind: 'validation', exitCode: 2, message});

const readOptions = (
  values: readonly string[],
  allowed: ReadonlySet<string>,
): Map<string, string> => {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || !allowed.has(name)) {
      throw argumentError(`Unknown option or positional argument: ${name ?? ''}`);
    }
    if (!value || value.startsWith('--')) {
      throw argumentError(`Option ${name} requires a value.`);
    }
    if (options.has(name)) {
      throw argumentError(`Option ${name} may only be provided once.`);
    }
    options.set(name, value);
  }
  return options;
};

const required = (options: Map<string, string>, name: string): string => {
  const value = options.get(name);
  if (!value) {
    throw argumentError(`Missing required option: ${name}`);
  }
  return value;
};

const positiveInteger = (value: string, name: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw argumentError(`${name} must be a positive integer.`);
  }
  return parsed;
};

export const parseArgs = (argv: readonly string[]): CliCommand => {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return {kind: 'help'};
  }

  const [command, ...rest] = argv;
  if (command === 'validate') {
    const options = readOptions(rest, new Set(['--input', '--report']));
    const report = options.get('--report');
    return {
      kind: 'validate',
      input: required(options, '--input'),
      ...(report ? {report} : {}),
    };
  }
  if (command === 'studio') {
    const options = readOptions(rest, new Set(['--input', '--port']));
    return {
      kind: 'studio',
      input: required(options, '--input'),
      port: positiveInteger(required(options, '--port'), '--port'),
    };
  }
  if (command === 'render') {
    const options = readOptions(rest, new Set(['--input', '--output', '--concurrency']));
    return {
      kind: 'render',
      input: required(options, '--input'),
      output: required(options, '--output'),
      concurrency: positiveInteger(required(options, '--concurrency'), '--concurrency'),
    };
  }
  throw argumentError(`Unknown command: ${command ?? ''}`);
};
