# Stillwatch

A local flight recorder for coding agents: see what your agent did, what it touched, and what it left behind.

After each Claude Code session, Stillwatch answers three questions without making you read the transcript:

- What did the agent do?
- Did it touch anything sensitive?
- What did it leave behind that could run or be read later, such as a git hook, a shell profile change, or a scheduled job?

Everything stays on your computer.
Secrets are redacted before anything is stored, and the dashboard listens only on `127.0.0.1`.
Fixed rules decide risk, not an AI model, and every finding links to the evidence behind it.

## Install

You need macOS or Linux, Node.js 22.13 or newer, and Claude Code 2.1.139 or newer.

```sh
npm install -g stillwatch
stillwatch install
```

Or, without a global install:

```sh
npx stillwatch install
```

`stillwatch install` adds Stillwatch's hooks to your Claude Code settings, keeps a backup of the file, and starts a small background collector.
With `npx`, it also copies itself to `~/.stillwatch/app`, so the hooks keep working after npm cleans its cache.

## Use

1. Start a **new** Claude Code session and work as usual.
   Sessions that were already running are not recorded.
2. Run `stillwatch open` (or `npx stillwatch open`) to review the session in the dashboard.

Other commands:

| Command | What it does |
| --- | --- |
| `stillwatch status` | Checks the hooks, the collector, and what has been recorded. |
| `stillwatch sessions` | Lists recorded sessions, riskiest first. |
| `stillwatch report latest` | Prints a Markdown report of the latest session. |
| `stillwatch lab` | Runs built-in attack and normal scenarios to show what Stillwatch catches. |
| `stillwatch help` | Lists every command and option. |

## Remove

```sh
stillwatch uninstall --purge   # removes the hooks and every recorded session
npm uninstall -g stillwatch
```

Without `--purge`, the hooks are removed and your recorded sessions are kept in `~/.stillwatch`.

## Status

Pre-alpha: it works with Claude Code only, and it only observes, never blocking or changing what the agent does.
Feedback is welcome in [GitHub issues](https://github.com/pranish-k/StillWatch/issues).

## More

- [Project README](https://github.com/pranish-k/StillWatch#readme)
- [Setup guide and troubleshooting](https://github.com/pranish-k/StillWatch/blob/main/docs/setup.md)
- [How it works](https://github.com/pranish-k/StillWatch/blob/main/docs/architecture.md)
- [Privacy](https://github.com/pranish-k/StillWatch/blob/main/docs/security/privacy.md) and [limits](https://github.com/pranish-k/StillWatch/blob/main/docs/security/limits.md)

MIT licensed.
