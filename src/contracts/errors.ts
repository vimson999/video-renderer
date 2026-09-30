import type {
  RendererExitCode,
  RendererIdentity,
  ValidationIssue,
} from './types.js';

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
  public readonly identity?: RendererIdentity;

  public constructor(options: {
    kind: RendererErrorKind;
    exitCode: RendererExitCode;
    message: string;
    issues?: readonly ValidationIssue[];
    identity?: RendererIdentity;
    cause?: unknown;
  }) {
    super(options.message, {cause: options.cause});
    this.name = 'RendererError';
    this.kind = options.kind;
    this.exitCode = options.exitCode;
    this.issues = options.issues ?? [];
    this.identity = options.identity;
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

export const attachIdentity = (
  error: unknown,
  identity: RendererIdentity,
): unknown => {
  if (!(error instanceof RendererError) || error.identity) {
    return error;
  }
  return new RendererError({
    kind: error.kind,
    exitCode: error.exitCode,
    message: error.message,
    issues: error.issues,
    identity,
    cause: error,
  });
};

export const mediaError = (
  message: string,
  issue: ValidationIssue,
  cause?: unknown,
): RendererError =>
  new RendererError({
    kind: 'media',
    exitCode: 4,
    message,
    issues: [issue],
    cause,
  });
