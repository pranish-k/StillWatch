/**
 * Small text and tool-input helpers shared by rules and derived outputs.
 * All inputs are untrusted session data; nothing here interprets it as code.
 */
import { isRecord, type ToolCall } from '@stillwatch/schema';

/** New file content a file tool call writes (Write content, Edit new_string, MultiEdit edits, NotebookEdit source). */
export function writtenContent(tool: ToolCall): string | null {
  const parts: string[] = [];
  for (const key of ['content', 'new_string', 'new_source']) {
    const value = tool.input[key];
    if (typeof value === 'string') parts.push(value);
  }
  const edits = tool.input.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (isRecord(edit) && typeof edit.new_string === 'string') parts.push(edit.new_string);
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/** True when a Write tool result says it created a new file. */
export function createdFile(tool: ToolCall): boolean {
  return isRecord(tool.response) && tool.response.type === 'create';
}

/** First line of `text`, trimmed and capped at `max` characters. */
export function firstLine(text: string, max = 120): string {
  const line = (text.split('\n', 1)[0] ?? '').trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/** Appends `item` to `list` unless already present. */
export function pushUnique<T>(list: T[], item: T): void {
  if (!list.includes(item)) list.push(item);
}

/** Lowercase hostname of an http(s) URL, or null. */
export function urlHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}
