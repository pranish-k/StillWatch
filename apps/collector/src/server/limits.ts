/**
 * Size, time, and rate limits of the local HTTP server. Tests pass smaller
 * values to the internal `startServer`; production uses `DEFAULT_LIMITS`.
 */
export type ServerLimits = {
  /** Largest accepted request body. */
  maxBodyBytes: number;
  /** Time allowed to receive a request body once handling started. */
  bodyTimeoutMs: number;
  /** Time allowed to receive the request headers. */
  headersTimeoutMs: number;
  /** Time allowed to receive the whole request. */
  requestTimeoutMs: number;
  /** Idle time before a keep-alive connection is closed. */
  keepAliveTimeoutMs: number;
  /** Login exchanges allowed per window. */
  exchangeLimit: number;
  exchangeWindowMs: number;
};

export const DEFAULT_LIMITS: ServerLimits = {
  maxBodyBytes: 16 * 1024,
  bodyTimeoutMs: 5_000,
  headersTimeoutMs: 5_000,
  requestTimeoutMs: 10_000,
  keepAliveTimeoutMs: 5_000,
  exchangeLimit: 20,
  exchangeWindowMs: 60_000,
};

/** Largest accepted request header block. */
export const MAX_HEADER_BYTES = 16 * 1024;

/** Longest accepted request target (path and query). */
export const MAX_TARGET_LENGTH = 2_048;
