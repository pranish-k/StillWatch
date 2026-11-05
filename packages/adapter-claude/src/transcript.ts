/**
 * Defensive reader for Claude Code transcripts (JSONL, internal format).
 *
 * Observed in 2.1.318: one API message is split across several `assistant`
 * lines that share `message.id`, one content block per line. Subagent
 * transcripts mark every line `isSidechain: true`. Many other line types
 * (attachments, api requests, cost state) exist and are ignored.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { getRecord, getString, isRecord } from '@stillwatch/schema';

export type TranscriptSummary = {
  path: string;
  exists: boolean;
  /** tool_use ids found in assistant messages, in order. */
  toolUseIds: string[];
  /** Text of the most recent assistant message that has text, if any. */
  lastAssistantText: string | null;
  model: string | null;
  lines: number;
  parseErrors: number;
  /** True when the file was larger than `maxBytes` and only its tail was read. */
  truncated: boolean;
  mtimeMs: number | null;
};

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const NEWLINE = 0x0a;

type Thread = {
  seenAssistant: boolean;
  model: string | null;
  textMessageId: string | null;
  textParts: string[];
};

function newThread(): Thread {
  return { seenAssistant: false, model: null, textMessageId: null, textParts: [] };
}

class Collector {
  lines = 0;
  parseErrors = 0;
  private readonly toolIds = new Set<string>();
  private readonly main = newThread();
  private readonly side = newThread();

  add(rawLine: string): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') return;
    this.lines++;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      this.parseErrors++;
      return;
    }
    if (!isRecord(entry) || entry.type !== 'assistant') return;
    const message = getRecord(entry, 'message');
    if (message === null) return;
    const thread = entry.isSidechain === true ? this.side : this.main;
    thread.seenAssistant = true;
    const model = getString(message, 'model');
    if (model !== null && model.length > 0 && !model.startsWith('<')) thread.model = model;

    const texts: string[] = [];
    const content = message.content;
    if (typeof content === 'string') {
      texts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === 'tool_use') {
          const id = getString(block, 'id');
          if (id !== null && id.length > 0) this.toolIds.add(id);
        } else if (block.type === 'text') {
          const text = getString(block, 'text');
          if (text !== null) texts.push(text);
        }
      }
    }
    if (texts.length === 0) return;
    const messageId = getString(message, 'id');
    if (messageId === null || messageId !== thread.textMessageId) {
      thread.textMessageId = messageId;
      thread.textParts = [];
    }
    thread.textParts.push(...texts);
  }

  finish(base: TranscriptSummary): TranscriptSummary {
    const thread = this.main.seenAssistant ? this.main : this.side;
    return {
      ...base,
      toolUseIds: [...this.toolIds],
      lastAssistantText: thread.textParts.length > 0 ? thread.textParts.join('\n') : null,
      model: thread.model,
      lines: this.lines,
      parseErrors: this.parseErrors,
    };
  }
}

/** Streams lines from `start`; when `start > 0`, drops the partial line it lands in. */
async function streamLines(
  path: string,
  start: number,
  onLine: (line: string) => void,
): Promise<void> {
  // Read one byte early: if it is a newline, the line at `start` is complete.
  const readStart = start > 0 ? start - 1 : 0;
  let skipping = start > 0;
  let pending: Buffer[] = [];
  const stream = createReadStream(path, { start: readStart, highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) continue;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(NEWLINE, offset);
      if (newline === -1) {
        if (!skipping) pending.push(chunk.subarray(offset));
        break;
      }
      if (skipping) {
        skipping = false;
      } else {
        pending.push(chunk.subarray(offset, newline));
        onLine(Buffer.concat(pending).toString('utf8'));
        pending = [];
      }
      offset = newline + 1;
    }
  }
  if (!skipping && pending.length > 0) onLine(Buffer.concat(pending).toString('utf8'));
}

/**
 * Reads a Claude Code transcript (JSONL) defensively and summarizes it.
 * The format is internal to Claude Code and changes without notice: unknown
 * lines are skipped and counted, never fatal. Never throws.
 */
export async function readTranscriptSummary(
  path: string,
  options?: { maxBytes?: number },
): Promise<TranscriptSummary> {
  const base: TranscriptSummary = {
    path,
    exists: false,
    toolUseIds: [],
    lastAssistantText: null,
    model: null,
    lines: 0,
    parseErrors: 0,
    truncated: false,
    mtimeMs: null,
  };
  const requested = options?.maxBytes;
  const maxBytes =
    requested !== undefined && Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : DEFAULT_MAX_BYTES;
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return base;
    base.exists = true;
    base.mtimeMs = info.mtimeMs;
    size = info.size;
  } catch {
    return base;
  }
  const start = size > maxBytes ? size - maxBytes : 0;
  base.truncated = start > 0;
  const collector = new Collector();
  try {
    await streamLines(path, start, (line) => {
      collector.add(line);
    });
  } catch {
    // A read error mid-file keeps whatever was read so far.
  }
  return collector.finish(base);
}
