# Stillwatch: Phase 1 Task Plan

This plan breaks Phase 1 into tasks small enough to complete in a sitting or two.
Work through the stages in order, and tick each task when it meets the definition of done in the [Project Guideline](project-guideline.md).

Estimates are rough focused hours, and they total about 150 hours.
If you finish a stage early, don't add scope; move to the next gate.

Each task lists its ID, work, output, dependency, and estimate.

## Stage 0: Foundations

**Goal:** Create a clean project, confirm the hook data you depend on, and lock the shared formats.
*About 15 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S0-01 | Create the monorepo and folder structure | Repository skeleton | None | 2 |
| ☐ | S0-02 | Set up TypeScript, linting, formatting, and tests | Shared tool config | S0-01 | 2 |
| ☐ | S0-03 | Add CI for pull requests | Automated checks | S0-02 | 1 |
| ☐ | S0-04 | Capture real hook payloads in a throwaway test | Sample event notes | None | 3 |
| ☐ | S0-05 | Define the event, session, and finding schemas | `packages/schema` | S0-04 | 3 |
| ☐ | S0-06 | Create fake-data fixtures | `lab/fixtures` | S0-04 | 2 |
| ☐ | S0-07 | Write the first threat model | `docs/security/threat-model.md` | S0-05 | 2 |

**Exit gate:** a fresh clone installs, tests run in CI, and the schemas cover the captured payloads.

## Stage 1: Capture

**Goal:** Reliably capture every available event without slowing the agent.
*About 15 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S1-01 | Build the `stillwatch hook` handler | Hook command | S0-05 | 3 |
| ☐ | S1-02 | Append events to spool files with safe permissions | Durable spool | S1-01 | 3 |
| ☐ | S1-03 | Build `stillwatch install` with a settings backup | Install command | S1-01 | 3 |
| ☐ | S1-04 | Build `stillwatch uninstall` | Clean removal | S1-03 | 2 |
| ☐ | S1-05 | Build `stillwatch status` | Health check | S1-03 | 1 |
| ☐ | S1-06 | Measure hook delay | Timing results | S1-02 | 1 |
| ☐ | S1-07 | Test killed sessions, full disks, and missing folders | Failure tests | S1-02 | 2 |

The hook handler became a POSIX shell script that writes one file per event ([ADR-016](../decisions/README.md#adr-016-the-capture-hook-is-a-posix-shell-script-that-only-spools-raw-payloads), [ADR-017](../decisions/README.md#adr-017-one-file-per-event-in-a-maildir-style-spool)).

**Exit gate:** real sessions produce complete spool records, failures never crash the agent, and removal restores the original settings.

## Stage 2: Store and timeline

**Goal:** Turn raw events into a safe, readable session history.
*About 15 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S2-01 | Create the database schema and migrations | `packages/storage` | S0-05 | 2 |
| ☐ | S2-02 | Build the Claude Code adapter | Normalized events | S0-06 | 2 |
| ☐ | S2-03 | Build the redaction package | Secret removal | S0-06 | 3 |
| ☐ | S2-04 | Build the collector import loop | Spool import | S2-01, S2-02, S2-03 | 2 |
| ☐ | S2-05 | Delete spool data after a safe import | Reduced data exposure | S2-04 | 1 |
| ☐ | S2-06 | Add the event hash chain | Tamper evidence | S2-04 | 1 |
| ☐ | S2-07 | Serve the dashboard with local token access | Secure local app | S2-04 | 1 |
| ☐ | S2-08 | Build the session list and timeline | Reviewable sessions | S2-07 | 2 |
| ☐ | S2-09 | Test with planted fake secrets | Redaction test results | S2-03 | 1 |

**Exit gate:** a past session can be reviewed in order, and automated searches find no planted secrets outside the protected spool.

## Stage 3: Change tracking

**Goal:** Compare what the agent reported with what actually changed.
*About 15 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S3-01 | Record the Git state at session start | Start snapshot | S2-04 | 3 |
| ☐ | S3-02 | Compute the final diff, including untracked files | Change list | S3-01 | 3 |
| ☐ | S3-03 | Show file changes in the session view | File activity panel | S3-02 | 2 |
| ☐ | S3-04 | Mark sessions as active, finished, or interrupted | Session status | S2-04 | 2 |
| ☐ | S3-05 | Record capture gaps | Visible missing data | S2-04 | 2 |
| ☐ | S3-06 | Flag changes missing from the tool log | Evidence mismatch check | S3-02 | 2 |
| ☐ | S3-07 | Test with deliberately killed sessions | Interrupted session fixtures | S3-04 | 1 |

**Exit gate:** file changes match Git on test repositories, and killed sessions are correctly identified.

## Stage 4: Detection

**Goal:** Identify sensitive access and anything likely to outlive the session.
*About 30 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S4-01 | Build the rule framework | Rule interface and runner | S2-04 | 3 |
| ☐ | S4-02 | Add secret access rules | Secret findings | S4-01 | 3 |
| ☐ | S4-03 | Add git hook and Git config rules | Persistence findings | S4-01 | 3 |
| ☐ | S4-04 | Add CI and task-runner rules | Delayed execution findings | S4-01 | 3 |
| ☐ | S4-05 | Add startup file and scheduled task rules | System persistence findings | S4-01 | 3 |
| ☐ | S4-06 | Add agent config and MCP rules | Configuration findings | S4-01 | 3 |
| ☐ | S4-07 | Add memory note rules | Inherited note findings | S4-01 | 3 |
| ☐ | S4-08 | Add safety bypass and interrupted-session rules | Behavior findings | S4-01, S3-04 | 3 |
| ☐ | S4-09 | Extract domains from tool calls | Partial network evidence | S2-02 | 2 |
| ☐ | S4-10 | Test every rule on normal fixtures | Noise baseline | S4-02 to S4-09 | 3 |
| ☐ | S4-11 | Build the findings view | Alerts with evidence links | S4-02 | 1 |

**Exit gate:** all planted cases are flagged, each finding explains itself, and normal fixtures stay within the noise target.

## Stage 5: Reports

**Goal:** Make a session understandable in about a minute.
*About 15 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S5-01 | Calculate session risk levels | Risk logic | S4-11 | 2 |
| ☐ | S5-02 | Build the What remains panel | Persistent change view | S4-11 | 3 |
| ☐ | S5-03 | Link notes to the sessions that wrote and loaded them | Session links | S4-07 | 3 |
| ☐ | S5-04 | Build the full session report | Dashboard report | S5-01, S5-02 | 3 |
| ☐ | S5-05 | Export a redacted Markdown report | `stillwatch report` | S5-04 | 2 |
| ☐ | S5-06 | Sort the session list by risk and time | Review queue | S5-01 | 1 |
| ☐ | S5-07 | Test reports against fixtures | Report tests | S5-05 | 1 |

**Exit gate:** you can explain a high-risk session within a minute, and each claim links to evidence.

## Stage 6: Hardening

**Goal:** Attack the app, fix what breaks, and make it installable by someone else.
*About 30 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S6-01 | Build the attack lab runner | `stillwatch lab` scorecard | S4-10 | 5 |
| ☐ | S6-02 | Add the first scenarios: poisoned README, fake key, and git hook | Baseline scenarios | S6-01 | 3 |
| ☐ | S6-03 | Add poisoned note, safety bypass, and fake MCP scenarios | Expanded scenarios | S6-01 | 4 |
| ☐ | S6-04 | Test malicious filenames and log content in the UI | UI security fixes | S5-04 | 3 |
| ☐ | S6-05 | Review local service access controls | Access test results | S2-07 | 2 |
| ☐ | S6-06 | Review dependencies | Dependency notes | S0-02 | 2 |
| ☐ | S6-07 | Add retention and `stillwatch delete-data` | Data controls | S2-04 | 2 |
| ☐ | S6-08 | Package for npm and test on a clean machine | Installable alpha | S1-04 | 3 |
| ☐ | S6-09 | Write setup, privacy, and limits documentation | Tester documents | S6-08 | 3 |
| ☐ | S6-10 | Fix critical findings and record accepted risks | Security review notes | S6-02 to S6-07 | 3 |

**Exit gate:** the scorecard meets its target, no critical issues remain open, and a clean-machine install takes under 5 minutes.

## Stage 7: Private alpha

**Goal:** Find out whether real users trust the app and keep opening it.
*About 15 hours.*

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S7-01 | Use it on your own real work for a week | Dogfooding log | S6-10 | 3 |
| ☐ | S7-02 | Tune noisy rules | Updated rule set | S7-01 | 3 |
| ☐ | S7-03 | Recruit three to five testers | Tester list | S6-09 | 1 |
| ☐ | S7-04 | Support tester installs | Install notes | S7-03 | 2 |
| ☐ | S7-05 | Interview each tester | Interview notes | S7-04 | 3 |
| ☐ | S7-06 | Fix the most important issues | Alpha fixes | S7-05 | 2 |
| ☐ | S7-07 | Write the alpha findings and decision | Go, change, or stop report | S7-05 | 1 |

**Ask testers:**

- Did the report show anything you didn't already know?
- Did you trust the alerts?
- What did you ignore?
- Would you notice if the app disappeared?
- What would stop you from using it at work?

**Exit gate:** the alpha findings support a clear decision to continue, change direction, or stop.

## Added during the build

These tasks were added while building Phase 1.
The [detailed spec](detailed-spec.md) lists these rules, but the original plan had no task for them, and two capture tasks came out of the architecture decisions.
Their hours are outside the original 150-hour estimate.
Each rule task includes its positive and normal-use tests.

| Done | ID | Task | Output | Needs | Hours |
| --- | --- | --- | --- | --- | --- |
| ☐ | S1-08 | Build the installer package that adds and removes only Stillwatch's hook entries | `packages/installer` | S1-03 | 3 |
| ☐ | S1-09 | Start the collector from the capture hook when it is not running | Collector auto-start (ADR-024) | S1-02 | 1 |
| ☐ | S4-12 | Add prompt injection signals and the possible prompt injection rule | Injection findings | S4-01, S4-09 | 3 |
| ☐ | S4-13 | Add the new package rule | Dependency findings | S4-01 | 2 |
| ☐ | S4-14 | Add the monitor tampering rule | Tampering findings | S4-01 | 2 |
| ☐ | S4-15 | Add the unattributed change rule | Evidence mismatch findings | S3-06, S4-01 | 2 |
| ☐ | S4-16 | Add the new domain rule | Network findings | S4-09 | 1 |
| ☐ | S4-17 | Add the background task rule | Leftover process findings | S4-01, S3-04 | 1 |

## After Phase 1

If the alpha is positive, Phase 2 should add AI summaries, task scope checks, and Codex support.
Don't begin that work until the Stage 7 decision is written.
