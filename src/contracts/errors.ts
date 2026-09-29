import type {RendererExitCode, ValidationIssue} from './types.js';

export type RendererErrorKind =
  | 'validation'
  | 'lock'
  | 'media'
  | 'studio'
  | 'render'
  | 'output';

export class RendererError extends Error {
  public readonly kind: RendererErrorKind;
  public readonly exitCode: RendererExitCode;
  public readonly issues: readonly ValidationIssue[];

  public constructor(options: {
    kind: RendererErrorKind;
    exitCode: RendererExitCode;
    message: string;
    issues?: readonly ValidationIssue[];
    cause?: unknown;
  }) {
    super(options.message, {cause: options.cause});
    this.name = 'RendererError';
    this.kind = options.kind;
    this.exitCode = options.exitCode;
    this.issues = options.issues ?? [];
  }
}

export const contractError = (
  message: string,
  issue: ValidationIssue,
  cause?: unknown,
): RendererError =>
  new RendererError({
    kind: 'validation',
    exitCode: 2,
    message,
    issues: [issue],
    cause,
  });
