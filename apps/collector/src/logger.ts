/**
 * Collector logging: JSON lines in logs/collector.log (mode 0600), rotated at
 * 5 MB with one previous file kept as collector.log.1. Optionally mirrored to
 * stderr when running in the foreground. Log metadata only, never payload
 * contents. Logging never throws.
 */
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  openSync,
  renameSync,
  writeSync,
} from 'node:fs';
import type { LogFields, Logger } from './types';

export const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export type FileLoggerOptions = {
  file: string;
  /** Also write each line to stderr. */
  stderr?: boolean;
  /** Rotation threshold in bytes (tests lower it). */
  rotateBytes?: number;
  /** Lowest level written. Default "info". */
  level?: Level;
  now?: () => number;
};

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type FileLogger = Logger & { close(): void };

export function createFileLogger(options: FileLoggerOptions): FileLogger {
  const rotateBytes = options.rotateBytes ?? LOG_ROTATE_BYTES;
  const minLevel = LEVEL_ORDER[options.level ?? 'info'];
  const now = options.now ?? Date.now;
  let fd: number | null = null;
  let size = 0;

  const openLog = (): void => {
    try {
      fd = openSync(
        options.file,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND,
        0o600,
      );
      fchmodSync(fd, 0o600);
      size = fstatSync(fd).size;
    } catch {
      fd = null;
    }
  };

  const closeLog = (): void => {
    if (fd === null) return;
    try {
      closeSync(fd);
    } catch {
      // Already closed.
    }
    fd = null;
  };

  const rotate = (): void => {
    closeLog();
    try {
      renameSync(options.file, `${options.file}.1`);
    } catch {
      // Keep appending to the current file when rotation fails.
    }
    openLog();
  };

  const write = (level: Level, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < minLevel) return;
    const line = `${JSON.stringify({ ts: new Date(now()).toISOString(), level, msg: message, ...fields })}\n`;
    if (options.stderr === true) {
      try {
        process.stderr.write(line);
      } catch {
        // stderr may be closed.
      }
    }
    if (fd === null) openLog();
    if (fd === null) return;
    try {
      const bytes = Buffer.from(line, 'utf8');
      writeSync(fd, bytes);
      size += bytes.length;
      if (size >= rotateBytes) rotate();
    } catch {
      closeLog();
    }
  };

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    close: closeLog,
  };
}

/** A logger that drops everything. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
