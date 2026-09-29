export type CliIo = {
  stdout(message: string): void;
  stderr(message: string): void;
};

const HELP = `video-renderer <command> [options]

Commands:
  validate  Validate a portable render package
  studio    Preview a package in Remotion Studio
  render    Render a package to an atomic output directory
`;

export const runCli = async (
  argv: readonly string[],
  io: CliIo,
): Promise<number> => {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    io.stdout(HELP);
    return 0;
  }

  io.stderr(`Unknown command: ${argv[0] ?? ''}`);
  return 2;
};
