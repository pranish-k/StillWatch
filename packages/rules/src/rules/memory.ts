/** Memory notes: files later sessions load as instructions. */
import { noteContentConcerns } from '../content';
import type { FindingDraft, RuleFn } from '../findings';
import { noteLoads } from '../links';
import { changeDraft, changesWith, contentOf, eventDraft, show, verb } from './common';

/** Low; medium when the content carries injection, hidden text, shell commands, or URLs. */
export const noteWritten: RuleFn = (ctx) =>
  changesWith(ctx, 'memory_note').map((c) => {
    const concerns: string[] = [];
    for (const w of c.writes) {
      for (const s of w.event.facts.signals) {
        if (s.source !== 'tool.input') continue;
        if (s.kind === 'prompt_injection' && !concerns.includes('instruction-like text')) {
          concerns.push('instruction-like text');
        }
        if (s.kind === 'hidden_text' && !concerns.includes('hidden text'))
          concerns.push('hidden text');
      }
    }
    const content = contentOf(c);
    if (content !== null) for (const k of noteContentConcerns(content)) concerns.push(k);
    const base = `The agent ${verb(c) === 'deleted' ? 'deleted' : 'wrote'} ${show(ctx, c.path)}, which later sessions load as instructions or memory.`;
    return changeDraft(ctx, c, {
      ruleId: 'memory.note_written',
      severity: concerns.length > 0 ? 'medium' : 'low',
      title:
        concerns.length > 0
          ? 'Memory note with instructions for later sessions'
          : `Memory note ${verb(c)}`,
      reason:
        concerns.length > 0
          ? `${base} The new content contains ${concerns.join(', ')} aimed at a later session.`
          : base,
    });
  });

/** Low: loading or reading a note an earlier, different session wrote. */
export const noteLoaded: RuleFn = (ctx) => {
  const out: FindingDraft[] = [];
  for (const load of noteLoads(ctx)) {
    out.push(
      eventDraft([load.event], {
        ruleId: 'memory.note_loaded',
        severity: 'low',
        title: 'Note from another session loaded',
        reason: `This session ${load.kind === 'note_loaded' ? 'loaded' : 'read'} ${show(ctx, load.path)}, which session ${load.writer.sessionId} wrote earlier. That session can influence this one through it.`,
        subject: load.path,
        paths: [load.path],
      }),
    );
  }
  return out;
};
