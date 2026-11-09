/**
 * The per-session event hash chain (ADR-014).
 *
 *   seed     = sha256("stillwatch:" + sessionId)
 *   hash(e)  = sha256(prevHash + "\n" + canonicalJson(chainPayload(e)))
 *
 * The payload is the stored event: the NormalizedEvent fields plus `facts`
 * and `redactions`. Storage fields (`seq`, `orderTs`, `hash`) are excluded.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, type JsonObject } from '@stillwatch/schema';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The chain seed for a session. */
export function chainSeed(sessionId: string): string {
  return sha256(`stillwatch:${sessionId}`);
}

/** The hash of one chain payload given the previous hash. */
export function chainHash(prevHash: string, payload: JsonObject): string {
  return sha256(`${prevHash}\n${canonicalJson(payload)}`);
}

/** First 16 hex characters of sha256(projectRoot). */
export function projectIdFor(projectRoot: string): string {
  return sha256(projectRoot).slice(0, 16);
}
