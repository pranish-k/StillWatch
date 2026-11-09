# Setting up Stillwatch

Stillwatch is an alpha, published to npm as [`stillwatch`](https://www.npmjs.com/package/stillwatch).

## Requirements

- macOS or Linux
- Node.js 22.13 or newer
- Claude Code 2.1.139 or newer
- git
- pnpm 12, only to build from source (`corepack enable` provides it; on Node 25 or newer, which no longer includes Corepack, run `npm install -g pnpm`)

## Install

```sh
npm install -g stillwatch
stillwatch install
```

To try it without a global install, run `npx stillwatch install`, and use `npx stillwatch` wherever this guide writes `stillwatch`.
Because npm may delete its `npx` cache at any time, install then copies the CLI and dashboard to `~/.stillwatch/app`, and the hook runs that copy.
Running `npx stillwatch install` again replaces the copy with the version you ran.

Install records the paths of the Node binary and the CLI that the hook uses to start the collector.
When the `node` on your `PATH` is the same binary that is running, it records that path, so a Homebrew upgrade of Node does not break the hook.

Start a new Claude Code session after installing.
In interactive sessions, Claude Code runs hooks only in folders you have trusted.

To upgrade, run `npm install -g stillwatch@latest`, then `stillwatch stop && stillwatch start` to restart the collector on the new version.

## Install from source

```sh
git clone https://github.com/pranish-k/StillWatch.git
cd StillWatch
corepack enable
pnpm install
pnpm build
npm install -g ./apps/cli
stillwatch install
```

`npm install -g ./apps/cli` links the `stillwatch` command to the built CLI in your clone, so a later `pnpm build` updates it.
Install records the paths of the Node binary and the built CLI, so keep the clone where it is, or run install again after moving it.
To skip the global install, run `node apps/cli/dist/stillwatch.mjs` wherever this guide writes `stillwatch`.

## What install changes

- It creates `~/.stillwatch` (or `$STILLWATCH_HOME`) with the config, the capture hook script, and the spool.
- When run with `npx` or `pnpm dlx`, it copies the CLI to `~/.stillwatch/app`.
- It checks your Claude Code version, and refuses versions older than 2.1.139 unless you pass `--force`.
- It backs up your Claude Code settings file into `~/.stillwatch/backups/`.
- It adds one hook entry per event to the settings file, and records what it added so uninstall can remove exactly that.

By default it edits the user settings file, `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), so every project is covered.
Each entry is its own matcher group, appended after yours, and runs the hook script without a shell:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/bin/sh",
            "args": ["/Users/you/.stillwatch/bin/hook.sh", "claude-code", "PreToolUse"],
            "async": true
          }
        ]
      }
    ]
  }
}
```

`SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, and `SessionEnd` run synchronously instead of in the background.
`SessionStart` and `UserPromptSubmit` also pass `--ensure-collector`, which starts the collector when it is not running.
The [detailed spec](planning/detailed-spec.md#event-capture-and-detection) lists every event and why some are never hooked.

Use `--dry-run` to see the change without writing it.

## Install scopes

| Scope | Settings file | Covers |
| --- | --- | --- |
| `user` (default) | `~/.claude/settings.json` | Every project |
| `project` | `<project>/.claude/settings.json` | One project, shared through the repository |
| `local` | `<project>/.claude/settings.local.json` | One project, on this computer only |

For `project` and `local`, pass the project with `--project-dir <dir>`.

## Check that it works

```sh
stillwatch status
```

Status reports whether the hooks are installed, whether the hook script is in place, whether the collector is running, how many events wait in the spool, database counts, and Claude Code compatibility.
Add `--json` for scripts.

## Review sessions

```sh
stillwatch open
```

This starts the collector if needed and opens the dashboard at `http://127.0.0.1:7391` with a single-use login link that is valid for 120 seconds.
Pass `--no-browser` to skip opening a browser.

The dashboard has three pages.

- **Sessions** lists sessions riskiest first.
  Filter by risk or status, search titles and projects, or switch to newest first; the filters stay in the address, so back and reload keep them.
- **A session** opens on its report: a summary, why it got its risk level, what remains after it ended, files changed, sensitive access, network, and capture gaps.
  Every finding links to the events behind it in the **Timeline** tab, where you can step through events with the arrow keys or `j` and `k`, and press Escape to close an event.
  From a session you can download the Markdown report, analyze it again, or delete it.
- **Status** shows whether the hooks are installed, whether the collector is keeping up, and where data is kept.

The dashboard shows all session data as plain text, so a hostile file name or command cannot run in your browser.

| Command | What it does |
| --- | --- |
| `stillwatch sessions [--json] [--limit <n>]` | Lists sessions, riskiest first |
| `stillwatch report <id\|latest> [--out <file>]` | Writes a redacted Markdown report |
| `stillwatch start`, `stillwatch stop` | Starts or stops the background collector |
| `stillwatch verify [--session <id>]` | Checks the event hash chains for edits |
| `stillwatch delete-data (--session <id> \| --older-than <days> \| --all) [--yes]` | Deletes recorded data |
| `stillwatch lab [--scenario <id>] [--json] [--keep]` | Runs the attack lab in temporary directories and prints a scorecard |

## Uninstall

```sh
stillwatch uninstall
npm uninstall -g stillwatch
```

Uninstall stops the collector and removes exactly the hook entries Stillwatch added, leaving the rest of your settings as they were.
Add `--purge` to also delete `~/.stillwatch`, including all recorded data.
Use the same `--scope` and `--project-dir` you installed with.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `stillwatch: command not found` | Run `npm install -g stillwatch`, or use `npx stillwatch`; from a clone, run `npm install -g ./apps/cli` |
| The collector is not running | Run `stillwatch start`; it prints why if it cannot start, and `~/.stillwatch/logs/collector.log` has details |
| Status lists missing hook events | Run `stillwatch install` again, then start a new Claude Code session |
| You switched Node versions, removed the global package, or moved the clone | Run `stillwatch install` again so the hook can start the collector; events are still captured meanwhile, because the hook itself does not need Node |
| Port 7391 is in use by another program | Change `port` in `~/.stillwatch/config.json` to a free port, then run `stillwatch start` |
| A report says the start state is unknown | The collector was not running when the session began; it starts automatically for later sessions |

See [privacy](security/privacy.md) for what is stored and [limits](security/limits.md) for what Stillwatch cannot see.
