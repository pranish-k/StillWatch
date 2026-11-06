/**
 * Per-session debounce for analysis: a session is analyzed `delayMs` after
 * its latest import, but at most `maxWaitMs` after the first unanalyzed one,
 * so a busy session still gets analyzed.
 */
type Pending = { timer: NodeJS.Timeout; firstAt: number };

export class DebounceScheduler {
  private readonly pending = new Map<string, Pending>();
  private closed = false;

  private readonly delayMs: number;
  private readonly maxWaitMs: number;
  private readonly fire: (key: string) => void;
  private readonly now: () => number;

  constructor(
    delayMs: number,
    maxWaitMs: number,
    fire: (key: string) => void,
    now: () => number = Date.now,
  ) {
    this.delayMs = delayMs;
    this.maxWaitMs = maxWaitMs;
    this.fire = fire;
    this.now = now;
  }

  schedule(key: string): void {
    if (this.closed) return;
    const now = this.now();
    const existing = this.pending.get(key);
    const firstAt = existing?.firstAt ?? now;
    if (existing) clearTimeout(existing.timer);
    const delay = Math.max(0, Math.min(this.delayMs, firstAt + this.maxWaitMs - now));
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.fire(key);
    }, delay);
    timer.unref();
    this.pending.set(key, { timer, firstAt });
  }

  cancel(key: string): void {
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    this.pending.delete(key);
  }

  close(): void {
    this.closed = true;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}
