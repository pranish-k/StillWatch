/** A shared time budget: every git call in one snapshot or diff draws from it. */
export class Deadline {
  private readonly end: number;

  constructor(budgetMs: number) {
    this.end = performance.now() + Math.max(0, budgetMs);
  }

  /** Milliseconds left, never negative. */
  remaining(): number {
    return Math.max(0, Math.floor(this.end - performance.now()));
  }
}
