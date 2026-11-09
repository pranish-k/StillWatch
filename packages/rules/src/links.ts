/**
 * Session links: this session loaded or read a memory note that an earlier,
 * different session wrote (from `prior.noteWriters`).
 */
import { pathKey, type SessionLink, type StoredEvent } from '@stillwatch/schema';
import type { RuleContext } from './context';

export type NoteLoad = {
  event: StoredEvent;
  path: string;
  kind: 'note_loaded' | 'note_read';
  writer: { sessionId: string; at: number };
};

/** Every load or read of a note another session wrote earlier, in event order. */
export function noteLoads(ctx: RuleContext): NoteLoad[] {
  const out: NoteLoad[] = [];
  const writerFor = (path: string, ts: number): NoteLoad['writer'] | null => {
    const writers = ctx.input.prior.noteWriters[pathKey(path)] ?? [];
    let found: NoteLoad['writer'] | null = null;
    for (const w of writers) {
      if (w.at < ts && w.sessionId !== ctx.sessionId && (found === null || w.at >= found.at)) {
        found = w;
      }
    }
    return found;
  };
  for (const event of ctx.events) {
    if (event.kind !== 'instructions.loaded') continue;
    const writer = writerFor(event.data.filePath, event.ts);
    if (writer !== null)
      out.push({ event, path: event.data.filePath, kind: 'note_loaded', writer });
  }
  for (const a of ctx.accesses) {
    if (
      !a.effective ||
      a.access.op !== 'read' ||
      !a.classification.classes.includes('memory_note')
    ) {
      continue;
    }
    const writer = writerFor(a.access.path, a.event.ts);
    if (writer !== null)
      out.push({ event: a.event, path: a.access.path, kind: 'note_read', writer });
  }
  return out.sort(
    (a, b) => (ctx.indexOf.get(a.event.id) ?? 0) - (ctx.indexOf.get(b.event.id) ?? 0),
  );
}

/** One link per source session, path, and kind, at the first load. */
export function buildLinks(ctx: RuleContext, loads: readonly NoteLoad[]): SessionLink[] {
  const seen = new Set<string>();
  const out: SessionLink[] = [];
  for (const load of loads) {
    const key = `${load.writer.sessionId}\n${pathKey(load.path)}\n${load.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceSessionId: load.writer.sessionId,
      targetSessionId: ctx.sessionId,
      path: load.path,
      kind: load.kind,
      eventId: load.event.id,
      at: load.event.ts,
    });
  }
  return out;
}
