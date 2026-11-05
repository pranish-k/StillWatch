/**
 * @stillwatch/adapter-claude
 *
 * Everything Claude Code specific lives here (ADR-006):
 * - which hook events Stillwatch installs and how (`CLAUDE_HOOK_EVENTS`),
 * - converting raw hook payloads from the spool into `NormalizedEvent`,
 * - reading Claude Code transcripts (ADR-004: transcripts are a backup source).
 */
export { CLAUDE_HOOK_EVENTS, MIN_CLAUDE_CODE_VERSION, NEVER_INSTALL_EVENTS } from './hook-spec';
export type { HookEventSpec } from './hook-spec';
export { compareVersions, parseClaudeVersion } from './version';
export { adaptClaudeRecord } from './adapt';
export type { AdaptOptions, AdaptResult, SpoolRecord } from './adapt';
export { classifyClaudeTool, minimizeToolResponse } from './tools';
export { promptOrigin } from './prompt';
export { readTranscriptSummary } from './transcript';
export type { TranscriptSummary } from './transcript';
