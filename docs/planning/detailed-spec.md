# Stillwatch: Detailed Project Spec

This spec turns the brief into a buildable first version for one developer on one computer. Thresholds and technology choices are proposals to test, not final decisions.

## Product principles and scenarios

The app should give independent evidence, not just repeat what an agent says about itself. These principles should guide every feature decision.

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

The first version is complete when a user can install it, run Claude Code normally, and review every session locally. Codex support follows once this works well.

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

These are not in the MVP: blocking, cloud sync, user accounts, team dashboards, Windows support, and browser agents.

## System design

Use a small background service with separate adapters for each agent. New agents can then be added without changing the analysis or report code.

| Component | Responsibility | Suggested tool |
| --- | --- | --- |
| Hook receiver | Accepts agent events quickly | Small local HTTP service or command |
| Agent adapter | Converts agent-specific data to a shared format | TypeScript module per agent |
| Transcript reader | Fills in details from session logs | JSONL parser |
| File watcher | Tracks sensitive file changes | Chokidar |
| Git snapshotter | Records the starting commit and final diff | Git commands |
| Event store | Saves normalized events | SQLite |
| Redactor | Removes secrets before storage | Pattern checks plus entropy checks |
| Rule engine | Creates findings from events | TypeScript rules |
| Session linker | Connects notes, sessions, and subagents | SQL queries |
| Summarizer | Writes an optional plain-English summary | Local or opt-in cloud model |
| Local UI | Shows timelines and reports | React on localhost |

**Data model**

| Table | Key fields | Purpose |
| --- | --- | --- |
| `projects` | ID, path, repository | Groups sessions by repository |
| `sessions` | ID, project, agent, start, end, status, risk | Represents one run |
| `agents` | ID, session, parent, type | Tracks the main agent and subagents |
| `events` | ID, session, agent, time, type, redacted data | Stores the timeline |
| `artifacts` | ID, session, path, type, hash | Tracks files that remain after a session |
| `findings` | ID, session, rule, severity, reason, event IDs | Stores alerts and their evidence |
| `links` | Source session, target session, artifact, type | Records inherited notes and handoffs |
| `capture_gaps` | Session, source, start, end, reason | Records what the app may have missed |

Keep raw transcripts in the agent's existing location where possible, and store references in the database. This reduces the amount of sensitive data the app holds.

## Event capture and detection

Claude Code's [hooks](https://code.claude.com/docs/en/hooks) provide most of what the first version needs. Hook logic must stay fast, so hooks should hand events to the collector and let analysis happen separately.

| Claude Code event | What the app records |
| --- | --- |
| `SessionStart`, `SessionEnd` | Session boundaries and how the session started or ended |
| `UserPromptSubmit` | The user's request, used for scope checks |
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure` | Tool calls, inputs, and outcomes |
| `PermissionRequest`, `PermissionDenied` | Prompts and denied actions |
| `SubagentStart`, `SubagentStop` | Which subagent did the work |
| `InstructionsLoaded` | Instruction files loaded into a session |
| `ConfigChange` | Changes to agent configuration |
| `FileChanged` | Changes to selected watched files |

A session with no `SessionEnd` event and no recent activity should be marked as interrupted. This is how the first version detects dead sessions.

**First detection rules**

| Rule | Trigger | Default severity |
| --- | --- | --- |
| Secret read | Access to `.env`, SSH keys, or cloud credentials | Medium |
| Possible exfiltration | Secret access followed by a new outbound domain | High |
| Git hook changed | A file in `.git/hooks` or `core.hooksPath` changes | High |
| CI changed | A workflow or pipeline file changes without being requested | High |
| Scheduled task added | A cron, launchd, or systemd entry is added | High |
| Startup file changed | A shell profile changes | High |
| Agent config changed | Hooks, permissions, or MCP settings change | High |
| Memory note written | A file used as agent memory changes | Low, or medium if it contains commands |
| Inherited note loaded | A note from an earlier session enters a new one | Low |
| Interrupted session left changes | A session stops with uncommitted or persistent changes | Medium |
| Safety bypass | A command skips checks or disables a sandbox | High |
| New package | A dependency or install script is added | Medium |
| Possible prompt injection | Untrusted content contains instructions aimed at an agent | Medium |
| Outside scope | An action goes beyond the user's request | Medium, based on fixed checks first |

Every rule needs a positive test and a normal-use test. A rule that fires too often should be fixed or removed.

## Risk levels and session reports

Use rule-based levels rather than a numeric score. A person can understand "high because CI changed" faster than "73 out of 100." The session takes the level of its highest finding.

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

The summary should appear first, but each claim should link to its evidence. If the AI summary and fixed findings disagree, the report should show the findings.

## Privacy and security requirements

A tool that records agent activity becomes a sensitive target, so it must be held to the same standard it asks of agents.

- Bind the local service to `127.0.0.1`, and require a local access token.
- Redact secrets before storage, and test this with fake credentials.
- Keep cloud summaries off by default, and show what would be sent.
- Set a default retention period, such as 30 days, and allow one-click deletion.
- Treat logs, transcripts, and file contents as untrusted input.
- Escape all session data in the UI to prevent script injection.
- Never place raw session data into a command.
- Add a hash chain to events, so later edits become detectable.
- Warn when hook settings change or the collector stops receiving events.
- Publish a clear list of what the app can't see.

A local app can't fully defend itself from an agent running with the same user permissions. Stronger protection requires a separate system user or service, which belongs in a later version.

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
- [ ] Should the first install apply to one project or all projects?
- [ ] What network activity can be captured without a proxy?
- [ ] Which files count as agent memory across different tools?
- [ ] Should summaries use a local model, the user's API key, or both?
- [ ] How long should events be retained by default?
- [ ] Which open-source license fits the project?
- [ ] Will developers review reports daily, or only after something goes wrong?
