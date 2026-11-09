# Stillwatch threat model

This is the first threat model for Stillwatch (task S0-07).
It covers Phase 1: one user, one computer running macOS or Linux, Claude Code only, observation only.
Revisit it at every stage gate and whenever a decision record changes the design.

## Scope

Stillwatch records agent activity, so it holds sensitive data and sits next to an agent that may be manipulated.
This model asks two questions: how could Stillwatch leak or corrupt what it holds, and how could it be used against the user?
It does not try to defend the computer against someone who already controls the user's account.

## Assets

| Asset | Where | Why it matters |
| --- | --- | --- |
| Raw spool payloads | `~/.stillwatch/spool/` | Unredacted prompts, tool inputs, and tool output, possibly with secrets, until they are imported |
| Event database | `~/.stillwatch/stillwatch.db` | Redacted history of agent activity: prompts, commands, file paths, and findings |
| Config secrets | `~/.stillwatch/config.json` | The auth secret signs login links and tokens; the fingerprint key protects redaction fingerprints |
| Claude Code hook settings | `~/.claude/settings.json` and project settings | They decide whether capture happens at all |
| Dashboard token | Browser `localStorage` for `http://127.0.0.1:<port>` | It grants read and delete access to the local API |
| Settings backups | `~/.stillwatch/backups/` | Verbatim copies of settings files, which can hold environment values |
| Integrity of evidence | The per-session event hash chain | Users rely on the record being what happened |

## Actors

| Actor | Capability |
| --- | --- |
| Prompt injection in repository or web content | Text the agent reads, such as a README, a web page, or a tool result, that tries to steer the agent or Stillwatch |
| A misbehaving agent running as the user | Everything the user can do: edit files, settings, and Stillwatch's own data, run any program |
| Malicious local web pages | JavaScript in the user's browser that tries to reach the local API through DNS rebinding or cross-site requests |
| Other local users | Read access to world-readable files, and network access to `127.0.0.1` |
| A malicious dependency | Code that runs at build or install time, or ships inside the package |
| Someone with access to the user's account | Full control of the computer; out of scope to defend against |

## Trust boundaries

1. **Agent to hook.** Claude Code passes each payload to `hook.sh` on stdin.
   The payload is untrusted, so the hook never parses it, never prints to stdout, and always exits 0 ([ADR-016](../decisions/README.md#adr-016-the-capture-hook-is-a-posix-shell-script-that-only-spools-raw-payloads)).
2. **Spool to collector.** Spool files and their names are untrusted.
   The adapter parses defensively, records above the size limit are rejected, and corrupt records become capture gaps.
3. **Collector to browser.** The local API serves only authenticated requests on `127.0.0.1`, and the dashboard renders session data as text ([ADR-022](../decisions/README.md#adr-022-login-link-and-bearer-token-for-the-dashboard-not-cookies)).
4. **Collector to git.** Snapshots run git inside repositories an agent may have tampered with, so every git call disables configuration that runs programs ([ADR-021](../decisions/README.md#adr-021-start-and-end-snapshots-instead-of-a-live-file-watcher)).
5. **Stillwatch to Claude Code settings.** Install and uninstall edit a file the user owns ([ADR-028](../decisions/README.md#adr-028-user-scope-install-by-default)).

## Threats and mitigations

| ID | Threat | Mitigation | Reference |
| --- | --- | --- | --- |
| T1 | Stillwatch becomes a second copy of the secrets it sees | Redaction before storage, logs, and display; fingerprints instead of values; truncation only after redaction; raw spool files deleted after import; files 0600 and directories 0700 | ADR-009, ADR-027 |
| T2 | Prompt injection steers Stillwatch's judgment | Fixed rules decide risk, and no model reads session data in Phase 1; injection-like text becomes a signal, not an instruction | ADR-010, ADR-023 |
| T3 | Script injection in the dashboard through file names, commands, or tool output | Text-only rendering, a lint rule against `dangerouslySetInnerHTML`, a strict Content Security Policy, and escaped Markdown export | ADR-022 |
| T4 | A web page reads the local API through DNS rebinding | Listen on `127.0.0.1` only; reject any `Host` other than `127.0.0.1:<port>` or `localhost:<port>`; require a bearer token | ADR-013, ADR-022 |
| T5 | Cross-site requests or cookie leakage across local ports | No cookies; the token lives in `localStorage`, scoped to origin and port; `Origin` checked on state-changing requests | ADR-022 |
| T6 | Command injection through session data | No shell anywhere: processes start with `execFile` or `spawn` and argument arrays; hooks run in exec form; the hook never interprets the payload | ADR-016 |
| T7 | Repository configuration runs code when Stillwatch runs git (fsmonitor, filters, textconv, external diff, signature checks) | Every git call disables configuration-driven program execution and ignores in-tree attributes for filters | ADR-021 |
| T8 | An agent disables capture by editing hook settings or Stillwatch's files | `ConfigChange` events, snapshots of agent configuration and Stillwatch's files, the `agent.config_changed` and `monitor.tampering` rules, and `stillwatch status` hook checks | Residual risk R2 |
| T9 | An agent rewrites recorded history | Per-session hash chain checked by `stillwatch verify` | ADR-014 |
| T10 | The hook breaks or slows the agent | The hook never writes to stdout, always exits 0, runs async for frequent events, and costs about 9 ms | ADR-016, ADR-020 |
| T11 | Huge or endless payloads exhaust disk or memory | Per-record size limit, truncation limits, and retention | ADR-027 |
| T12 | Crafted content makes redaction regular expressions run for a very long time | Linear-time patterns and a 1 MiB cap on each string before redaction | ADR-027 |
| T13 | Other local users read Stillwatch's data | Directories 0700 and files 0600; the API requires a token | Security invariants in [the architecture document](../architecture.md#security-invariants) |
| T14 | A malicious dependency | Zero runtime dependencies, blocked install scripts, a lockfile, and CI actions pinned to commit hashes | ADR-015, ADR-019, ADR-029 |
| T15 | Install damages the user's settings | Settings are parsed, never edited as text; invalid JSON is refused; a backup is taken; writes are atomic; uninstall removes exactly Stillwatch's entries | ADR-028 |
| T16 | False confidence from a quiet dashboard | Capture gaps appear in every report, the [limits document](limits.md) lists blind spots, and Stillwatch never claims full protection | Detailed spec principles |

## Residual risks

These risks are accepted for Phase 1 and must be stated to testers.

- **R1: Same-user tampering.** An agent running as the user can change or delete Stillwatch's data, config, and hook script.
  Stillwatch detects some of this after the fact but cannot prevent it.
- **R2: Hook settings edits.** An agent can remove Stillwatch's hooks or set `disableAllHooks`.
  Stillwatch flags configuration changes it sees, but events after the change are not captured.
- **R3: Redaction misses.** Unusual secret formats can pass the detectors and reach storage.
- **R4: Rebuildable hash chain.** The hash chain is tamper evidence, not tamper proofing, because an agent running as the user can rebuild it.
- **R5: No network visibility.** Stillwatch sees only domains named in tool calls, not traffic.
- **R6: Dropped events.** If the spool cannot be written, for example on a full disk, the hook drops the event rather than interrupt the agent.
- **R7: Raw payloads on disk.** Unredacted payloads exist in the spool until the collector imports them, protected only by file permissions.

## Revisit in Phase 2

- Collect events as a separate system user or service, so the agent cannot change them.
- Anchor the hash chain outside the computer.
- Capture network activity through a proxy.
- Defend AI summaries against prompt injection and keep cloud models opt-in.
- Define a blocking policy before any action is blocked.
- Publish with two-factor authentication and package provenance.
