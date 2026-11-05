# Stillwatch: Detailed Project Spec

This spec turns the [brief](project-brief.md) into a buildable first version for one developer on one computer.
Thresholds and technology choices started as proposals to test; the ones settled during the Phase 1 build are recorded in the [architecture decisions](../decisions/README.md), and [the architecture document](../architecture.md) describes the system as built.

## Product principles and scenarios

The app should give independent evidence, not just repeat what an agent says about itself.
These principles should guide every feature decision.

- **Local first:** data stays on the user's computer by default.
- **Observe before blocking:** earn trust by showing accurate information first.
- **Evidence over opinion:** every alert links to the event or file change behind it.
- **Rules before AI:** fixed checks decide risk, while AI only helps explain it.
- **Honest limits:** the app shows what it can't see and never claims full protection.
- **Quiet by default:** normal sessions stay in the background.

| Scenario | User need | What the app shows |
| --- | --- | --- |
| Morning review | Understand what ran overnight | A list of sessions, with risky ones first |
| Suspicious change | Find out why a file changed | The session, prompt, and tool call behind it |
| Dead session | See what stopped mid-task | Its last activity, unfinished work, and leftover files |
| Inherited notes | Know what influenced a new session | Which notes loaded and which session wrote them |
| Possible leak | Check whether a secret was exposed | Secret access, later network activity, and affected files |
| Team handoff | Share what happened | An exportable report with secrets redacted |

## MVP requirements

The first version is complete when a user can install it, run Claude Code normally, and review every session locally.
Codex support follows once this works well.

| Priority | Requirement | Acceptance test |
| --- | --- | --- |
| Must | One-command install and removal | Removal leaves user hook settings as they were |
| Must | Capture Claude Code sessions | Tool calls appear in the correct order |
| Must | Show a session timeline | A user can open any event and see its details |
| Must | Record file changes | The report matches `git diff` on test repositories |
| Must | Detect persistence | All planted test cases are flagged |
| Must | Detect secret access | Reads of test `.env` and SSH key files are flagged |
| Must | Redact stored secrets | Fake test secrets never appear in the database or UI |
| Must | Assign a risk level | Every medium or high result lists its reasons |
| Must | Generate a session report | It renders without any cloud service |
| Must | Show capture gaps | Missing or delayed data is visible in the report |
| Should | Summarize sessions in plain English | A reviewer can explain the session from the summary alone |
| Should | Link related sessions | Loaded notes trace back to the session that wrote them |
| Should | Find unfinished sessions | A killed test session is marked as interrupted |
| Could | Export a report | A redacted Markdown or PDF file is produced |
| Could | Support Codex | The same report format works for both agents |

In Phase 1 the plain-English summary is deterministic: it is built only from facts and findings, with no AI model.
AI summaries arrive in Phase 2, as the [Project Guideline](project-guideline.md) describes.

These are not in the MVP: blocking, cloud sync, user accounts, team dashboards, Windows support, and browser agents.

## System design

Use a small background service with separate adapters for each agent.
New agents can then be added without changing the analysis or report code.

| Component | Responsibility | Tool |
| --- | --- | --- |
| Hook receiver | Copies each hook payload into the spool and exits | POSIX `sh` script writing a maildir-style spool ([ADR-016](../decisions/README.md#adr-016-the-capture-hook-is-a-posix-shell-script-that-only-spools-raw-payloads), [ADR-017](../decisions/README.md#adr-017-one-file-per-event-in-a-maildir-style-spool)) |
| Agent adapter | Converts agent-specific data to a shared format | TypeScript module per agent (`packages/adapter-claude`) |
| Transcript reader | Fills in details from session logs | JSONL reader in the adapter |
| Snapshotter | Records repository state and the persistence surface at session start and end, as hashes | Git commands and file hashes (`packages/git-tracker`, [ADR-021](../decisions/README.md#adr-021-start-and-end-snapshots-instead-of-a-live-file-watcher)) |
| Event store | Saves normalized events | SQLite through `node:sqlite` (`packages/storage`) |
| Redactor | Removes secrets before storage | Pattern, assignment, and entropy checks (`packages/redaction`) |
| Facts extractor | Turns each event into files, commands, domains, packages, and signals | Shell parser and sensitive-path catalog (`packages/facts`) |
| Rule engine | Creates findings from facts and snapshots | TypeScript rules (`packages/rules`) |
| Session linker | Connects notes, sessions, and subagents | Part of the rule engine's session analysis |
| Installer | Adds and removes only Stillwatch's hook entries in Claude Code settings | `packages/installer` |
| Summarizer | Writes a plain-English summary | Phase 1: deterministic sentences (`packages/reports`); Phase 2: local or opt-in cloud model |
| Local UI | Shows timelines and reports | React on `127.0.0.1` (`apps/web`) |

Phase 1 uses start and end snapshots instead of a live file watcher.
Comparing the two snapshots catches changes made inside scripts that hooks cannot see into, without keeping a copy of file contents.

**Data model**

These tables describe the logical model; the migrations in `packages/storage` are the authoritative schema.

| Table | Key fields | Purpose |
| --- | --- | --- |
| `meta` | Key, value | Schema version and store-wide settings |
| `sessions` | ID, agent, project ID, root, and name, start, end, last event, status, risk and reasons, title, summary, counts, chain head | Represents one run |
| `agents` | Session, agent ID, type, start, stop, transcript | Tracks the main agent and subagents |
| `events` | Sequence, ID, source record, session, agent, prompt, time, display order, kind, redacted event, facts, redaction records, hash | Stores the timeline and its hash chain |
| `snapshots` | Session, kind (start or end), time, hashes | Records repository state and the persistence surface |
| `findings` | ID, session, rule, severity, title, reason, subject, evidence, requested | Stores alerts and their evidence |
| `file_changes` | Session, path, change kind, line counts, path classes, attribution, events | Records what actually changed and what explains it |
| `artifacts` | ID, session, kind, path, change, source, events | Tracks what remains after a session |
| `links` | Source session, target session, path, kind, event | Records inherited notes and handoffs |
| `domains` | Session, domain, first event, count, new or seen before | Holds partial network evidence from tool calls |
| `capture_gaps` | ID, session, source, severity, time range, reason | Records what the app may have missed |

Keep raw transcripts in the agent's existing location where possible, and store references in the database.
This reduces the amount of sensitive data the app holds.
Stored events are redacted, then cut to fixed size limits ([ADR-027](../decisions/README.md#adr-027-redaction-fingerprints-and-data-minimization-limits)).

## Event capture and detection

Claude Code's [hooks](https://code.claude.com/docs/en/hooks) provide most of what the first version needs.
Hook logic must stay fast, so the hook only copies each payload into the spool, and analysis happens later in the collector.

Stillwatch installs these hook events (`CLAUDE_HOOK_EVENTS` in `packages/adapter-claude`).
Async hooks run in the background, so the agent never waits for them.
Sync hooks mark ordering boundaries, and `claude -p` kills async hooks that are still running at teardown, so the events that end a turn or a session stay sync ([ADR-020](../decisions/README.md#adr-020-async-hooks-for-frequent-events-sync-hooks-for-turn-and-session-boundaries)).

| Claude Code event | Mode | What the app records |
| --- | --- | --- |
| `SessionStart` | Sync | Session boundaries and how the session started; also starts the collector if it is not running |
| `UserPromptSubmit` | Sync | The user's request, used for scope checks; also starts the collector if it is not running |
| `UserPromptExpansion` | Async | Slash commands and skills the user invoked |
| `PreToolUse` | Async | Tool calls and their inputs |
| `PostToolUse` | Async | Tool results |
| `PostToolUseFailure` | Async | Failed tool calls |
| `PostToolBatch` | Async | Batch boundaries, which resolve calls that never got a result, such as denied ones |
| `PermissionRequest` | Async | Permission prompts |
| `PermissionDenied` | Async | Auto mode denials |
| `Notification` | Async | Waiting for input and other notifications |
| `SubagentStart` | Async | Which subagent did the work |
| `SubagentStop` | Async | Subagent results and transcripts |
| `TaskCreated` | Async | Planned work, for unfinished-work tracking |
| `TaskCompleted` | Async | Completed work |
| `Stop` | Sync | Turn end, final message, background tasks, and session crons |
| `StopFailure` | Sync | Turns that ended on an API error |
| `InstructionsLoaded` | Async | Instruction and memory files loaded into a session |
| `ConfigChange` | Async | Changes to agent configuration during a session |
| `CwdChanged` | Async | Working directory changes, for path resolution |
| `DirectoryAdded` | Async | Extra working directories added with `/add-dir` |
| `FileChanged` | Async | Changes to files that the user's own configuration watches |
| `PreCompact` | Async | Context compaction |
| `PostCompact` | Async | Context compaction results |
| `PostModelSwitch` | Async | Model changes during a session |
| `SessionEnd` | Sync | Session end and its reason |

`SessionEnd` gets no `timeout` field, because any value raises the shared 1.5 second budget for every `SessionEnd` hook.

Some events change Claude Code's behavior as soon as a hook is attached, so Stillwatch never installs them (`NEVER_INSTALL_EVENTS`).

| Event | Why Stillwatch never hooks it |
| --- | --- |
| `WorktreeCreate` | A hook replaces git worktree creation. |
| `WorktreeRemove` | A hook takes over worktree removal. |
| `PreModelSwitch` | A hook that times out blocks the model switch. |
| `Elicitation` | A hook can answer or decline MCP input requests. |
| `ElicitationResult` | A hook can change MCP input responses. |
| `MessageDisplay` | It fires while text streams, so it is too frequent and only affects display. |
| `TeammateIdle` | Exit codes keep teammates working, and it adds little for Phase 1. |
| `Setup` | It only runs for `--init` and `--maintenance`, not for sessions. |

The minimum supported Claude Code version is 2.1.139, the first with exec-form hooks ([ADR-026](../decisions/README.md#adr-026-minimum-claude-code-version-21139)).
Since 2.1.101, an unknown hook event name no longer invalidates a settings file.

Real payloads captured with Claude Code 2.1.318 (`lab/fixtures/claude-code/real-session-2.1.318.json`) showed these facts:

- `InstructionsLoaded` can arrive before `SessionStart`, so any event may be a session's first.
- A background subagent reporting back arrives as `UserPromptSubmit` with a prompt starting `<task-notification>`; only user-typed prompts count as requests.
- A permission-denied call has a `PreToolUse` and no `PostToolUse`; `PostToolBatch` resolves it.
- `Read`, `Write`, and `Edit` results embed whole file contents, so stored copies are minimized.
- Subagent tool events carry `agent_id` and `agent_type`.

A session is marked interrupted when its last turn never finished (a prompt with no later `Stop` or `StopFailure`, or a tool call with no result) and it has been quiet for 30 minutes.
A session that sits between turns for 24 hours without `SessionEnd` is closed as finished, with the reason `no_session_end`.
Any later event makes the session active again.
This is how the first version detects dead sessions.

**First detection rules**

| Rule | Trigger | Default severity |
| --- | --- | --- |
| `secret.read` | Access to `.env` files, SSH keys, or cloud credentials, or a command that prints credentials | Medium |
| `secret.exfiltration` | A redacted secret appears in a network command or fetch, or a secret read is followed by a new outbound domain | High (Medium for a new domain after a secret read) |
| `persistence.git_hook` | A file in `.git/hooks` or `core.hooksPath` changes, or the hooks path is set | High (Medium when requested) |
| `persistence.git_config` | Git config gains filters, aliases, fsmonitor, sshCommand, pager, or credential helper settings | High |
| `persistence.ci` | A CI pipeline file changes | High (Medium when requested) |
| `persistence.task_runner` | `package.json` scripts, `.vscode/tasks.json`, devcontainer, Makefile, or `.envrc` changes | Medium (High for code that runs on install or on folder open) |
| `persistence.scheduled_task` | A cron, launchd, systemd, or `at` entry is added or changed | High |
| `persistence.startup_file` | A shell profile, ssh `rc`, ssh config, or `authorized_keys` changes | High |
| `agent.config_changed` | Agent settings, hooks, permissions, MCP servers, agents, commands, or skills change | High (Medium when requested) |
| `memory.note_written` | A file that agents load as memory changes | Low (Medium if it contains commands or instructions) |
| `memory.note_loaded` | A note an earlier session wrote is loaded into this one | Low |
| `session.interrupted_with_changes` | An interrupted session left changes | Medium |
| `safety.bypass` | Checks are skipped, the sandbox is disabled, TLS verification is turned off, or network content is piped to a shell | High |
| `package.new` | A dependency or global package is added | Medium |
| `prompt_injection.possible` | Untrusted content contains instructions aimed at an agent, or hidden text | Medium (High when a high-risk action follows) |
| `evidence.unattributed_change` | A file changed and no recorded action explains it | Low (Medium for persistent locations) |
| `network.new_domain` | A domain that no earlier session contacted | Low |
| `monitor.tampering` | Stillwatch's own files, hooks, or processes are touched | High |
| `background.left_running` | A background task was still running when the session ended | Low |

Every rule needs a positive test and a normal-use test.
A rule that fires too often should be fixed or removed.

**Scope checks in Phase 1**

Rules such as "CI changed without being requested" and a general "outside scope" check need to compare actions with the user's request.
Phase 1 uses a fixed keyword check of the user's own prompts, ignoring system-generated prompts such as background task notifications.
When the user's prompts ask for the kind of change a rule flags, the finding drops one severity level and says that it was requested.
Full task scope checks are Phase 2 work.

## Risk levels and session reports

Use rule-based levels rather than a numeric score.
A person can understand "high because CI changed" faster than "73 out of 100."
The session takes the level of its highest finding.
With no medium or high finding, a critical capture gap makes the level Unknown.

| Level | Meaning | How it appears |
| --- | --- | --- |
| Low | Normal activity with no notable findings | One line in the timeline |
| Medium | Worth a quick look | Highlighted with reasons |
| High | Could have lasting impact or expose data | Moved to the top, with a notification |
| Unknown | Important data is missing | Marked with the capture gap |

This sample uses invented data to show the intended format.

```markdown
Session: Fix login timeout
Agent: Claude Code, with 2 subagents
Status: Interrupted
Risk: High

Summary
The agent changed the login timeout and added tests.
It stopped before finishing the deployment notes.

Why this is high risk
- A GitHub Actions workflow changed, but it was not requested.
- A new git hook was added.

Files changed
- src/auth/session.ts
- tests/auth/session.test.ts
- .github/workflows/deploy.yml

Sensitive access
- Read .env.test

Network
- registry.npmjs.org
- api.example.com (new)

What remains
- .git/hooks/pre-push
- NOTES.md, contains a next-step instruction

Unfinished work
- Deployment notes

Related sessions
- Session 13 loaded NOTES.md
```

The summary should appear first, but each claim should link to its evidence.
In Phase 1 the summary is built only from facts and findings, so it cannot disagree with them.
When AI summaries arrive in Phase 2 and an AI summary disagrees with the fixed findings, the report should show the findings.

## Privacy and security requirements

A tool that records agent activity becomes a sensitive target, so it must be held to the same standard it asks of agents.

- Bind the local service to `127.0.0.1` only.
- Require a bearer token for the API, obtained by exchanging a single-use signed login link from `stillwatch open` ([ADR-022](../decisions/README.md#adr-022-login-link-and-bearer-token-for-the-dashboard-not-cookies)).
- Reject requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding.
- Redact secrets before storage, and test this with fake credentials.
- Keep cloud summaries off by default, and show what would be sent.
- Keep data for 30 days by default, and allow one-click deletion.
- Treat logs, transcripts, and file contents as untrusted input.
- Escape all session data in the UI and serve a strict Content Security Policy to prevent script injection.
- Never place raw session data into a command.
- Add a hash chain to events, so later edits become detectable.
- Warn when hook settings change or the collector stops receiving events.
- Publish a clear list of what the app can't see ([limits](../security/limits.md)).

A local app can't fully defend itself from an agent running with the same user permissions.
Stronger protection requires a separate system user or service, which belongs in a later version.
The [threat model](../security/threat-model.md) lists the threats and mitigations in detail.

## Testing, metrics, and first tasks

Test with planted attacks and real sessions, because rules that work on examples can still be noisy in daily use.

| Test type | What it covers |
| --- | --- |
| Unit tests | Parsers, redaction, rules, and risk levels |
| Fixture tests | Saved logs from each supported agent version |
| Attack lab | Planted notes, hooks, secrets, and prompt injections |
| Dogfooding | At least two weeks of your own real agent use |
| Failure tests | Killed sessions, stopped collectors, and missing logs |
| UI security tests | Malicious filenames and log content |

| Metric | First target |
| --- | --- |
| Install to first report | Under 5 minutes |
| Planted attacks detected | At least 90% of supported cases |
| High-risk false alarms | No more than 1 per 20 normal sessions |
| Event capture overhead | Not noticeable during normal work |
| Time to review a normal session | Under 1 minute |
| Weekly active testers | 10 developers using it without reminders |

**First two weeks**

- [ ] Create the repository and basic TypeScript project
- [ ] Install a test hook and save raw Claude Code events
- [ ] Define the shared event format
- [ ] Create the SQLite database
- [ ] Record each session's starting commit and final diff
- [ ] Show sessions and events on a local page
- [ ] Add detection for one fake secret and one git hook
- [ ] Generate the first Markdown session report
- [ ] Run it on five real sessions and write down what felt useful or noisy

## Open questions

- [ ] Does the app need the terminal, desktop, or IDE version of Claude Code first?
- [x] Should the first install apply to one project or all projects?
  Decided: all projects (user scope) by default, with project and local scopes available ([ADR-028](../decisions/README.md#adr-028-user-scope-install-by-default)).
- [x] What network activity can be captured without a proxy?
  Decided: only domains named in tool calls, such as WebFetch URLs and hosts in shell commands, always labeled as partial evidence.
- [x] Which files count as agent memory across different tools?
  Decided: the sensitive-path catalog in `packages/facts` defines them.
- [ ] Should summaries use a local model, the user's API key, or both?
- [x] How long should events be retained by default?
  Decided: 30 days, configurable.
- [ ] Which open-source license fits the project?
- [ ] Will developers review reports daily, or only after something goes wrong?
