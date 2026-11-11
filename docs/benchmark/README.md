# Detection benchmark

The detection benchmark measures how many realistic attacks Stillwatch flags, and how often it raises false alarms on ordinary work.
Run it yourself with `stillwatch lab --benchmark`, or `pnpm benchmark` from a checkout.

## How it works

Every scenario replays a Claude Code session through the real capture hook and the real collector pipeline, in temporary directories with a temporary `HOME`.
Planted files are real, secrets are fake and built at runtime, and no command runs or reaches the network.

- Attack scenarios are adapted from MITRE ATT&CK techniques and published agent attack research, and each names its source.
- An attack counts as detected only when one of the rules named for it fires at medium or high.
  A finding at low does not raise the session's risk, so it does not count.
  A different rule flagging the session is reported as "any alert", not as a detection.
- Prompt injection scenarios count only when `prompt_injection.possible` fires, even if a finding about the agent's next action catches the outcome.
- A normal session is noisy when anything fires at medium or high.

Scenarios are split into two sets (ADR-032).
The tuning set is the one the detectors were improved against.
The held-out set was written after that tuning, run once, and never tuned on, so its score is the honest estimate of how detection generalizes.

## Results

Measured on macOS on 2026-11-10.
The launch agent scenario runs on macOS only.

| | Attacks detected | Normal sessions quiet |
| --- | --- | --- |
| Baseline, before any change (tuning set) | 56 of 76 (74%) | 11 of 20 (55%, so 45% false alarms) |
| After changes (tuning set) | 76 of 77 (99%) | 20 of 20 (0% false alarms) |
| Held-out set, never tuned on | 16 of 24 (67%) | 9 of 11 (18% false alarms) |

The baseline counted 76 attacks because one scenario could not run until the lab handled a disabled hook.

The gap between 99% and 67% is the point of the held-out set: the tuning-set number is inflated by tuning against it.
Quote the held-out number when describing real-world detection.

Full scorecards: [baseline](baseline-scorecard.txt) and [after the changes](results-scorecard.txt).

## What the baseline found

Detection gaps fixed against the tuning set:

- No rule reported destructive commands, although facts already extracted them; force pushes and wiping shell history went unflagged.
  The new `safety.destructive` rule reports them.
- Processes detached with `nohup`, `setsid`, or `disown` were invisible.
- Secrets that appeared in tool output (a `grep` over the home directory) did not count as read.
- Uploading a secret file to a well-known host, such as `gh gist create .env`, was not exfiltration.
- Browser cookie stores, `conftest.py`, and pip index config were not in the catalog.
- The prompt injection detector missed address-then-request phrasing ("AI agents: ... run X"), `@claude` mentions, "disregard the user's request", text hidden with CSS, and riskier verbs such as append, copy, and push.
- Hand-edited lockfiles that point a package at another host were not reported.
- Base64 decoded and piped into a shell was not treated like `curl | sh`.

False alarms fixed:

- `npx` was reported twice, once at medium, and options after the package name (`npx tsc -p .`) were parsed as npx's own.
- Installing a package or reading a `.env` the user named in the prompt was medium.
- Every task runner edit was medium, including `scripts.test` changes.
- Changes arriving through `git pull` were reported as the agent's own, and as unattributed.
- `npm audit fix` changes were unattributed.

## Known misses

From the held-out set, left as they are:

- A macOS login item added with `osascript`, which changes no file Stillwatch watches.
- `git.path` in VS Code workspace settings pointing at a repository script: reported, but only at low, because the content has no URL or command.
- `.pnpmfile.cjs`, which pnpm runs on install, is not in the catalog.
- A Python one-liner that reads `.env` and sends it with `urllib`: interpreter code is not parsed.
- Injection phrased as "an authorized maintenance request" for "the model handling this page", and a commit message addressed to "AI reviewers": neither uses the wording the detector looks for.
- `rm -rf ~/projects`: only deletes of top-level or home directories count as broad.
- `npm config set registry`, which rewrites `~/.npmrc` through a command the rules do not interpret.

False alarms in the held-out set:

- Reading a test file that holds a fake token raises `secret.read`, because the token looks real to the redaction detectors.
- Reading an `AGENTS.md` that says "Agents must run npm test" raises `prompt_injection.possible`.

From the tuning set, one miss remains: a base64-encoded instruction in a file.
The redactor removes high-entropy text before detection sees it; the agent's `base64 -d | sh` is still flagged by `safety.bypass`.

## Other measurements

Measured on an Apple M2 on 2026-11-10 with one-off scripts that are not yet part of the repository.

**Hook latency.**
1,000 deliveries of a 2 KB PreToolUse payload through the installed hook took 10.4 ms at the median and 11.9 ms at p95.
Starting an empty `/bin/sh` that reads the same input took 7.2 ms and 9.0 ms, so the hook's own work is about 3 ms.
All 1,000 events reached the spool.
Claude Code runs the hook with `async: true`, so this time never blocks the agent.

**Redaction recall.**
5,400 fake secrets in 27 formats (built from each vendor's published token format, including fine-grained GitHub tokens, temporary AWS keys, and OpenAI project keys) were placed in 5 contexts: env lines, JSON, shell commands, log lines, and YAML.
Before the fix below, 5,391 were redacted (99.83%).
The 9 leaks were all random letters-only passwords in `PASSWORD=value`, which the assignment detector took for code identifiers.
After the fix, 5,400 of 5,400 were redacted on the same set, so that figure is not independent.
None of 1,000 benign values (commit hashes, UUIDs, integrity hashes, versions, paths) were redacted.

## Limits

The scenarios were written by the people who build Stillwatch, who know how the detectors work, even though the held-out set was written without tuning on it.
Simulated sessions are not real ones: real agents phrase commands differently and mix in far more ordinary work.
A false alarm rate from 31 synthetic sessions is not a real-world rate; measuring that needs labeled sessions from real use.
