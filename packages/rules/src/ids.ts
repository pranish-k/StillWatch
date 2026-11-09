/**
 * Deterministic identifiers. Re-analysis of the same session must produce the
 * same ids, so they derive from stable inputs, never from the clock or randomness.
 */
import { createHash } from 'node:crypto';

/** First 24 hex characters of sha256 over the parts joined with newlines. */
export function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);
}
