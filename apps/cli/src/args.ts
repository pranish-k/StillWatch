import { parseArgs } from 'node:util';

/** Bad command-line usage; exits 2. */
export class UsageError extends Error {
  override name = 'UsageError';
  readonly command: string | null;

  constructor(message: string, command: string | null) {
    super(message);
    this.command = command;
  }
}

/** A command failed for a reason the user can act on; exits 1. */
export class CliError extends Error {
  override name = 'CliError';
}

type OptionSpec = { type: 'string' | 'boolean'; short?: string; multiple?: boolean };
type Options = Record<string, OptionSpec>;

/** `util.parseArgs` in strict mode, with friendly usage errors. */
export function parse<T extends Options>(
  command: string,
  args: string[],
  options: T,
  allowPositionals = false,
) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals });
  } catch (error) {
    throw new UsageError(friendlyParseError(error), command);
  }
}

function friendlyParseError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  const quoted = /'([^']*)'/.exec(error.message)?.[1] ?? '';
  const option = quoted.split(' ')[0] ?? quoted;
  switch (code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return `unknown option ${option}`;
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      return error.message.includes('does not take an argument')
        ? `option ${option} does not take a value`
        : `option ${option} needs a value`;
    case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
      return `unexpected argument '${quoted}'`;
    case undefined:
    default:
      return error.message;
  }
}

/** Parses a positive integer option value. */
export function positiveInt(command: string, name: string, value: string, max: number): number {
  if (!/^\d+$/.test(value))
    throw new UsageError(`--${name} must be a positive whole number`, command);
  const n = Number.parseInt(value, 10);
  if (n < 1 || n > max) throw new UsageError(`--${name} must be between 1 and ${max}`, command);
  return n;
}
