# Privacy

Stillwatch keeps everything on your computer.
It makes no network requests, sends no telemetry, and uses no cloud model in Phase 1.
Its local server listens on `127.0.0.1` only.

## Where data lives

Everything is under `~/.stillwatch`, or the directory in `STILLWATCH_HOME`.
Directories are mode 0700 and files are mode 0600, so other users on the computer cannot read them.

| Path | What it holds |
| --- | --- |
| `config.json` | Port, retention period, the auth secret, the redaction fingerprint key, and a record of what install changed |
| `stillwatch.db` | Redacted events, facts, findings, snapshots, and session reports |
| `spool/tmp/`, `spool/new/` | Raw hook payloads waiting for import |
| `bin/hook.sh` | The capture hook |
| `backups/` | Copies of your Claude Code settings file taken before install |
| `logs/collector.log` | Collector log lines with metadata only, never payload content |

## What is stored

- **Events**, after redaction and minimization: prompts, tool inputs, short previews of tool results, file paths, commands, and URLs.
- **Facts** about each event: files touched, commands, domains, packages, and suspicious signals.
- **Snapshots** of repository state and persistent locations, as hashes only, never file contents.
- **Findings and reports** derived from the above.

Raw spool payloads are not redacted, because the hook never parses them.
The collector deletes each spool file as soon as its event is stored, and deletes corrupt records instead of keeping them.

Settings backups are verbatim copies of your Claude Code settings file, which can include environment values, so they keep the same 0600 protection.

Stillwatch does not copy agent transcripts; it may read them where Claude Code keeps them.

## Redaction and minimization

Secrets are replaced before anything is stored, logged, or displayed.
Each one becomes a marker such as `[REDACTED:aws-access-key-id:1a2b3c4d]`, where the last part is a fingerprint from HMAC-SHA256 with a local key.
Equal fingerprints mean the same secret, so Stillwatch can tell that a secret it saw being read was later sent somewhere, without storing the secret.

After redaction, stored data is cut to fixed limits: 8 KiB for tool result strings, 16 KiB for prompts, and 64 KiB for each event ([ADR-027](../decisions/README.md#adr-027-redaction-fingerprints-and-data-minimization-limits)).
Redaction can miss unusual secret formats; see [limits](limits.md).

## Retention and deletion

Sessions are kept for 30 days by default, set by `retentionDays` in `config.json`.

| To delete | Run |
| --- | --- |
| One session | `stillwatch delete-data --session <id>`, or delete it from the dashboard |
| Sessions older than a number of days | `stillwatch delete-data --older-than <days>` |
| All recorded data | `stillwatch delete-data --all` |
| Everything, including hooks | `stillwatch uninstall --purge` |
