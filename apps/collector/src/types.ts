export type LogFields = Record<string, string | number | boolean | null>;

/** Structured logger. Never log payload contents: metadata only. */
export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};
