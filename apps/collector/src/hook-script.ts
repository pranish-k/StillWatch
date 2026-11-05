export type HookScriptOptions = {
  stillwatchHome: string;
  /** Node binary that starts the collector when it is not running. */
  nodePath: string;
  /** CLI entry script that accepts `start --quiet`. */
  cliPath: string;
};

/**
 * POSIX sh source of the capture hook (ADR-016). Invoked by Claude Code in
 * exec form as `/bin/sh <hook.sh> <agent> <EventName> [--ensure-collector]`
 * with the payload on stdin. It writes stdin to
 * `spool/tmp/<agent>.<Event>.XXXXXXXXXX` (mktemp, mode 0600), renames it into
 * `spool/new/`, optionally starts the collector in the background
 * (`STILLWATCH_HOME=<home> <node> <cli> start --quiet`, stdio to /dev/null),
 * and always exits 0 without writing to stdout. Agent and event arguments are
 * validated against [a-z0-9-] and [A-Za-z0-9]. Embedded paths are
 * single-quoted with proper escaping.
 */
export function renderHookScript(_options: HookScriptOptions): string {
  throw new Error('not implemented: renderHookScript');
}
