import type { DetectorInfo } from '../index';

/** A secret's location in the scanned text: `text.slice(start, end)` is the secret. */
export type Span = { start: number; end: number };

/** A detector that scans one string. */
export type StringDetector = {
  info: DetectorInfo;
  /**
   * Cheap prefilter. `lower` is the lowercase form of the original input; it
   * may be stale after earlier replacements, which can only cause extra scans.
   */
  applies(text: string, lower: string): boolean;
  /** Returns secret spans in ascending order, without overlaps. Linear time. */
  find(text: string): Span[];
};
