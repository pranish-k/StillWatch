/**
 * Spool file naming, shared by the capture hook script (which creates the
 * files with mktemp) and the collector (which imports them).
 *
 * Name: `<agent>.<EventHint>.<random>`, for example
 * `claude-code.PreToolUse.a8Zk2Qp0xY`. The file content is the raw hook
 * payload exactly as the agent wrote it to the hook's stdin. The receive
 * time is the file's modification time. Names are untrusted input.
 */

const SPOOL_NAME = /^([a-z][a-z0-9-]{0,31})\.([A-Za-z][A-Za-z0-9]{0,39})\.([A-Za-z0-9]{6,32})$/;

export type SpoolName = { agent: string; eventHint: string; nonce: string };

export function parseSpoolName(name: string): SpoolName | null {
  const m = SPOOL_NAME.exec(name);
  if (!m) return null;
  const [, agent, eventHint, nonce] = m;
  if (agent === undefined || eventHint === undefined || nonce === undefined) return null;
  return { agent, eventHint, nonce };
}

/** The mktemp template the hook script uses inside `spool/tmp`. */
export function spoolTemplate(agent: string, eventHint: string): string {
  return `${agent}.${eventHint}.XXXXXXXXXX`;
}
