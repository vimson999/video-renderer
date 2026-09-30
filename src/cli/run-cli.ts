import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

import {compilePackage} from '../compiler/compile-package.js';
import {RendererError} from '../contracts/errors.js';
import {prepareJobWorkspace} from '../jobs/workspace.js';
import {writeJson} from '../render/publish.js';
import type {RenderRequest, RenderResult} from '../render/renderer.js';
import {startStudio} from '../studio/start-studio.js';
import {validatePackage} from '../validation/validate-package.js';
import {parseArgs} from './args.js';

export type CliIo = {
  stdout(message: string): void;
  stderr(message: string): void;
};

export type CliDependencies = {
  validate: typeof validatePackage;
  compile: typeof compilePackage;
  prepareWorkspace: typeof prepareJobWorkspace;
  startStudio: typeof startStudio;
  render(request: RenderRequest): Promise<RenderResult>;
};

const defaultDependencies: CliDependencies = {
  validate: validatePackage,
  compile: compilePackage,
  prepareWorkspace: prepareJobWorkspace,
  startStudio,
  render: async (request) => (await import('../render/renderer.js')).renderJob(request),
};

export const HELP = `video-renderer <command> [options]

Commands:
  validate --input <package> [--report <file>]
  studio   --input <package> --port <positive-integer>
  render   --input <package> --output <directory> --concurrency <positive-integer>
`;

export const runCli = async (
  argv: readonly string[],
  io: CliIo,
  overrides: Partial<CliDependencies> = {},
): Promise<number> => {
  const dependencies = {...defaultDependencies, ...overrides};
  let command: ReturnType<typeof parseArgs> | undefined;
  try {
    command = parseArgs(argv);
    if (command.kind === 'help') {
      io.stdout(HELP);
      return 0;
    }
    if (command.kind === 'validate') {
      const validated = await dependencies.validate(command.input);
      if (command.report) {
        await mkdir(dirname(command.report), {recursive: true});
        await writeJson(command.report, validated.report);
      }
      io.stdout(JSON.stringify(validated.report));
      return 0;
    }

    const validated = await dependencies.validate(command.input);
    const compiled = dependencies.compile(validated);
    const workspace = await dependencies.prepareWorkspace(validated, compiled);
    if (command.kind === 'studio') {
      let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
      const onSigint = () => studio?.stop('SIGINT');
      const onSigterm = () => studio?.stop('SIGTERM');
      try {
        studio = await dependencies.startStudio({
          inputDir: command.input,
          workspace,
          port: command.port,
        });
        process.once('SIGINT', onSigint);
        process.once('SIGTERM', onSigterm);
        await studio.wait();
        io.stdout(JSON.stringify({ok: true, command: 'studio', port: command.port}));
        return 0;
      } finally {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
        await workspace.cleanup();
      }
    }

    try {
      const result = await dependencies.render({
        inputDir: command.input,
        outputDir: command.output,
        workspace,
        compiled,
        validationReport: validated.report,
        warnings: validated.warnings,
        concurrency: command.concurrency,
      });
      io.stdout(JSON.stringify({
        ok: true,
        outputDir: result.outputDir,
        media: result.media,
      }));
      return 0;
    } finally {
      await workspace.cleanup();
    }
  } catch (error) {
    if (error instanceof RendererError) {
      if (command?.kind === 'validate' && command.report) {
        try {
          await mkdir(dirname(command.report), {recursive: true});
          await writeJson(command.report, {
            schemaVersion: '1.0',
            valid: false,
            ...(error.identity ? {identity: error.identity} : {}),
            issueCount: error.issues.length,
            warningCount: 0,
            issues: error.issues,
            error: {kind: error.kind, message: error.message},
          });
        } catch {
          io.stderr(JSON.stringify({
            ok: false,
            error: {kind: 'internal', message: 'Could not write the validation report.'},
          }));
          return 1;
        }
      }
      io.stderr(JSON.stringify({
        ok: false,
        error: {
          kind: error.kind,
          message: error.message,
          ...(error.identity ? {identity: error.identity} : {}),
          ...(error.issues.length > 0 ? {issues: error.issues} : {}),
        },
      }));
      return error.exitCode;
    }
    io.stderr(JSON.stringify({
      ok: false,
      error: {kind: 'internal', message: 'Unexpected CLI failure.'},
    }));
    return 1;
  }
};
