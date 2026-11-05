# Stillwatch: Project Guideline

Nov 3, 2026

## Purpose

This guideline is the plan to agree on before writing product code. Phase 1 ends with a private alpha: a local app that records Claude Code sessions, shows what changed, and flags what could outlive the session.

**The Phase 1 promise:** after any agent session, a developer can see what happened, what sensitive files were touched, and what remains.

The work is organized into three documents:

- **Guideline:** scope, stages, working rules, quality gates, and risks
- **Architecture decisions:** the technical choices and why they were made
- **Phase 1 task plan:** the task-level work for each stage

"Stillwatch" and the `stillwatch` command are working names. Check for naming conflicts before publishing.

The plan assumes one developer working about 15 hours a week on macOS or Linux. Durations are planning estimates, so use the stage order and gates as the real plan.

## Scope of work

Phase 1 covers Claude Code on one computer, with observation only. Anything that would make the app block actions, send data to the cloud, or manage several people waits until after the alpha.

**In scope**

- Capture of Claude Code sessions, tool calls, subagents, and configuration changes
- A durable local spool, so events survive when the app isn't running
- Secret redaction before events are stored
- A local SQLite database and a dashboard on `localhost`
- Session timelines and event details
- A snapshot of the repository at session start, plus a final file-change view
- Detection for secrets, persistence, safety bypasses, and interrupted sessions
- Rule-based risk levels and capture gap warnings
- Session reports in the dashboard and as Markdown
- A local attack lab using planted test cases
- Install, removal, status, and data deletion commands
- Documentation of what the app can and can't see

**Out of scope for Phase 1**

| Item | Why it waits | Earliest stage |
| --- | --- | --- |
| AI summaries | Fixed findings must be trustworthy first | Phase 2 |
| Codex support | One adapter should prove the design first | Phase 2 |
| Blocking actions | People must trust the alerts before enforcement | Later |
| Network capture | Requires a proxy or lower-level monitoring | Later |
| Team dashboards | Needs real single-user demand first | Later |
| Cloud sync and accounts | Conflicts with the local-first starting point | Later |
| Windows support | Adds platform work before the idea is proven | Later |
| Browser agents | Uses a different capture path | Later |

Phase 1 can still list domains that appear in tool calls, such as a `curl` command or web fetch. It must label this as partial evidence, not a full network log.

**Deliverables**

| ID | Deliverable | Completed when |
| --- | --- | --- |
| D1 | Private code repository | CI runs on every change |
| D2 | `stillwatch` command-line tool | Install, status, removal, and data deletion work |
| D3 | Local collector | Events are captured without noticeable delay |
| D4 | Local dashboard | A session can be reviewed end to end |
| D5 | Detection rule set | Each rule has positive and normal-use tests |
| D6 | Session report | Dashboard and Markdown versions match |
| D7 | Attack lab | One command produces a scorecard |
| D8 | Security review notes | Findings are fixed or formally accepted |
| D9 | User documentation | A new tester installs it without help |
| D10 | Alpha findings | Results support a go, change, or stop decision |

**Assumptions**

- Claude Code hooks remain available and broadly compatible during the build.
- Users work in Git repositories.
- The app runs with the user's own permissions.
- Agent sessions are started by one person.
- Testing uses fake secrets until redaction has passed its gate.

This plan differs from the brief in one way: it combines the brief's recorder and persistence phases, adds hardening, and moves AI summaries to Phase 2.

## Development stages

Build the evidence pipeline first, then detection, then reporting. Each stage must pass its gate before the next begins, because a detection rule is only as reliable as the data beneath it.

| Stage | Timing | Work | Gate |
| --- | --- | --- | --- |
| 0: Foundations | Week 1 | Repository, CI, schemas, and fixtures | Empty project passes CI |
| 1: Capture | Week 2 | Install hooks and write events to the spool | No event lost in tests |
| 2: Store and timeline | Week 3 | Redact, store, and show sessions | A session is reconstructed |
| 3: Change tracking | Week 4 | Snapshots, diffs, and interrupted sessions | Report matches git diff |
| 4: Detection | Weeks 5 to 6 | Secrets, persistence, and safety bypass rules | All planted cases flagged |
| 5: Reports | Week 7 | Risk levels and session reports | Findings link to evidence |
| 6: Hardening | Weeks 8 to 9 | Attack lab, security review, and packaging | No open critical issues |
| 7: Private alpha | Week 10 | Real use by you and a few testers | Go, change, or stop |

Stage 4 is the key stage, because detecting what remains is what separates this product from a transcript viewer.

## What each stage looks like

Every stage ends with something you can run and show. Use these descriptions to judge whether a stage is truly finished.

| Stage | What exists at the end | Demo | Exit gate |
| --- | --- | --- | --- |
| 0: Foundations | Repository, CI, shared schemas, sample fixtures | Tests run automatically on a pull request | Clean setup works on a new machine |
| 1: Capture | `stillwatch install`, hook handler, durable spool | Run an agent and watch events arrive in the spool | Every test event arrives, and removal restores settings |
| 2: Store and timeline | Redactor, importer, database, session list, timeline | Open a past session and step through it | Fake secrets never reach storage or the UI |
| 3: Change tracking | Start snapshot, final diff, file activity, session status | Kill an agent and see it marked as interrupted | Changes match `git diff` on test repositories |
| 4: Detection | Rule engine and the first rule set | Plant a git hook and see the alert with evidence | All planted cases are flagged, with acceptable noise |
| 5: Reports | Risk levels, What remains panel, session reports | Open a high-risk session and explain it in a minute | Every claim links to evidence |
| 6: Hardening | Attack lab, security fixes, packaging, documentation | Run one command and get a scorecard | No critical issue remains open |
| 7: Private alpha | Installed tester builds and a findings report | Review real sessions with testers | Clear go, change, or stop decision |

**Phase 1 finished means:** a tester can install the app in under 5 minutes, use Claude Code as usual, and answer three questions without reading the raw transcript.

- What did the agent do?
- Did it touch anything sensitive?
- What did it leave behind?

## Working rules

These rules keep a solo project reviewable, especially if AI agents help write the code.

**Repository structure**

```text
stillwatch/
  apps/
    cli/            install, status, removal, and hook handler
    collector/      background import and analysis service
    web/            local dashboard
  packages/
    schema/         shared event and finding types
    adapter-claude/ Claude Code event mapping
    redaction/      secret removal
    storage/        SQLite access and migrations
    git-tracker/    snapshots and diffs
    rules/          detection rules
    reports/        report generation
  lab/
    fixtures/       saved and synthetic sessions
    scenarios/      planted attack tests
  docs/
    decisions/      architecture decision records
    security/       threat model and limits
```

**Development rules**

- Keep `main` releasable, and use short-lived branches.
- Link each pull request to a task ID from the task plan.
- Require passing CI before merging.
- Add a fixture when a parser or rule bug is fixed.
- Record architecture changes in `docs/decisions/`.
- Keep dependencies few, and review each new one.
- Use only fake secrets in tests and screenshots.
- Review all AI-written code yourself before merging.
- Commit database migrations, and never edit one after release.

**Definition of ready**

- The task has a clear outcome.
- Its dependencies are finished.
- Test cases are known.
- Security or privacy effects are noted.

**Definition of done**

- Code is merged, tested, and reviewed.
- User-visible behavior is documented.
- Failure cases are handled and logged.
- Sensitive data handling was checked.
- The stage demo still works.

## Quality and release gates

The app's value depends on trust, so accuracy and privacy gates matter more than feature count. These targets are starting points to adjust after real use.

| Area | Requirement | How to check |
| --- | --- | --- |
| Capture | No test events lost when the collector is stopped | Failure tests |
| Performance | Hook handler adds no noticeable delay | Timed test sessions |
| Accuracy | Planted cases detected at the agreed rate | Attack lab scorecard |
| Noise | No more than 1 high-risk false alarm per 20 normal sessions | Dogfooding log |
| Redaction | No fake test secret appears in storage, logs, or the UI | Automated search after each run |
| Evidence | Every finding links to its events | Report tests |
| Reliability | Corrupt or unknown records are skipped and reported | Fixture tests |
| Compatibility | Claude Code updates are checked before release | Scheduled fixture run |
| Privacy | No data leaves the computer in Phase 1 | Network check during tests |
| Removal | Uninstall restores hook settings and can delete all data | Install and removal test |

**Release levels**

| Release | Audience | Must be true |
| --- | --- | --- |
| `0.0.x` | You only | Stages 0 to 3 pass |
| `0.1.0-dev` | You, on real work | Stages 4 and 5 pass, and redaction is proven |
| `0.1.0-alpha` | Three to five trusted testers | Stage 6 passes, and testers receive the limits document |
| `0.1.0` | Public open source | Alpha findings are resolved, and a license is chosen |

Every release should include a changelog, tested Claude Code versions, known limits, and data migration notes.

## Risks and stop conditions

Check this register at the end of each stage. If one of the stop conditions occurs, pause and decide before spending more time.

| Risk | Likelihood | Impact | Response |
| --- | --- | --- | --- |
| Hook behavior changes | Medium | High | Pin tested versions, keep fixtures, and show capture gaps |
| Hooks miss subprocess activity | High | Medium | Compare logs with Git changes and document the limit |
| Rules are too noisy | High | High | Tune during dogfooding and remove weak rules |
| Secrets reach storage | Medium | High | Redact before storage and scan test output |
| Agent edits hook settings | Medium | High | Alert on config changes and verify hooks at startup |
| Agent tampers with local data | Medium | Medium | Add event hashes and state the limit clearly |
| Scope creep | High | High | Send new ideas to a Phase 2 list |
| Built-in feature overlap | Medium | High | Re-check Claude Code features at each gate |
| Testers don't return | Medium | High | Interview them before adding features |
| Solo burnout | Medium | High | Keep stages small and hold regular stop points |

**Stop or rethink if:**

- Hooks can't reliably capture the events the product depends on.
- Redaction can't be made dependable.
- Your own use shows the reports aren't worth opening.
- High-risk alerts remain mostly false after tuning.
- A built-in agent feature fully covers the same need.
- Testers try it once and don't come back.

## Before coding starts

These items should be settled first. Most take minutes, and they prevent rework later.

- [ ] Confirm the Phase 1 scope and out-of-scope list
- [ ] Choose the development computer and operating system
- [ ] Confirm Claude Code hooks work on that computer
- [ ] Create a separate test account with no real secrets
- [ ] Create two disposable test repositories
- [ ] Review the architecture decisions and mark any changes
- [ ] Choose a working project name and repository name
- [ ] Decide when the repository becomes public
- [ ] Set a weekly time budget
- [ ] Identify three to five alpha testers
- [ ] Write the top three questions you want the alpha to answer

After this checklist, begin with task S0-01 in the Phase 1 task plan.
