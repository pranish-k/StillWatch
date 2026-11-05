/**
 * Sliding-window rate limiter. The server is local and single-user, so one
 * window is shared by all clients.
 */
export class SlidingWindowLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #hits: number[] = [];

  constructor(limit: number, windowMs: number, now: () => number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /**
   * Records one attempt. Returns 0 when it is allowed, otherwise the number of
   * whole seconds until the next attempt would be allowed.
   */
  take(): number {
    const now = this.#now();
    while (this.#hits.length > 0 && (this.#hits[0] ?? 0) <= now - this.#windowMs) {
      this.#hits.shift();
    }
    if (this.#hits.length >= this.#limit) {
      const oldest = this.#hits[0] ?? now;
      return Math.max(1, Math.ceil((oldest + this.#windowMs - now) / 1000));
    }
    this.#hits.push(now);
    return 0;
  }
}
