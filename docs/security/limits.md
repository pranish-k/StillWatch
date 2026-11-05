# What Stillwatch cannot see

Stillwatch is a recorder and detector, not complete protection.
A quiet report means Stillwatch found nothing in what it could see, not that nothing happened.
This page lists its blind spots in Phase 1 and why each exists.

## Activity it does not observe

- **Inside scripts and programs.**
  Hooks show the command an agent ran, not what that program did internally.
  Snapshots catch the files it changed in snapshotted repositories and in the persistence catalog, but nothing else.
- **Network traffic.**
  Stillwatch does not capture traffic.
  It lists only domains named in tool calls, such as WebFetch URLs and hosts in shell commands, and labels them as partial evidence.
  A script can contact any host without Stillwatch knowing.
- **Files mentioned with `@`.**
  Claude Code inserts files you reference with `@` in a prompt without any tool call, so no hook reports the read.
- **Changes outside what it snapshots.**
  Start and end snapshots cover the session's repositories and a catalog of persistent locations, such as shell profiles, scheduled tasks, and agent configuration.
  A change elsewhere is seen only when a tool call or a parsed command names the file.
- **Timing within a session.**
  Snapshots show that a file changed between session start and end, not when, unless a tool call explains it.
- **File contents.**
  Snapshots store hashes, so reports show which files changed and how, not content diffs.
- **MCP server side effects.**
  Stillwatch records MCP tool calls and their results, but not what the server did elsewhere.

## Sessions it does not record

- **Before install, after uninstall, or while hooks are off.**
  Sessions started with `--bare`, with `disableAllHooks` set, or under managed settings that allow only managed hooks run without Stillwatch's hooks.
- **Folders you have not trusted.**
  In interactive sessions, Claude Code holds back every hook until you accept the workspace trust dialog for the folder.
- **Cloud sessions.**
  Cloud sessions do not read your local `~/.claude/settings.json`.
- **Other agents.**
  Phase 1 supports Claude Code only.
- **Events lost to a full disk.**
  If the spool cannot be written, the hook drops the event rather than interrupt the agent.

## Gaps it reports but cannot fill

- **Start state when the collector was not running.**
  If Stillwatch could not take a start snapshot when a session began, it cannot tell which changes the session made, and the report says so.
- **Unusual secrets.**
  Redaction uses known patterns, assignments, and entropy checks, and can miss unusual secret formats.

## What an agent can do to Stillwatch

An agent runs with your user permissions, so it can edit or delete Stillwatch's data, its hook script, and your hook settings.
Stillwatch flags configuration changes and changes to its own files that it sees, and keeps a hash chain of events.
That is tamper evidence, not tamper proofing; see the [threat model](threat-model.md).
