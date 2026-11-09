import type { PromptOrigin } from '@stillwatch/schema';

/**
 * Where a UserPromptSubmit prompt came from. Claude Code also fires the event
 * for background subagent reports (`<task-notification>`), cross-session
 * messages, and scheduled tasks. Only `user` prompts count as user requests.
 * Matching is exact and case-sensitive on known wrappers only: users paste XML.
 */
export function promptOrigin(prompt: string): PromptOrigin {
  const text = prompt.trimStart();
  if (text.startsWith('<task-notification>')) return 'task_notification';
  if (text.startsWith('<cross-session-message')) return 'cross_session';
  if (text.startsWith('<scheduled-task') || text.startsWith('<scheduled_task')) return 'scheduled';
  return 'user';
}
