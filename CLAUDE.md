# Working on Stillwatch

Stillwatch records what coding agents did, flags what could outlive a session, and keeps all data local.
Read `docs/architecture.md` before changing code.

## Commands

- `pnpm install` installs everything (pnpm 12; dependency build scripts are blocked).
- `pnpm check` runs format check, lint, typecheck, and tests; it must pass before any commit.
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm build`.
- `pnpm vitest run packages/<name>` runs one package's tests.
- `node apps/cli/dist/stillwatch.mjs <command>` runs the built CLI.

## Rules

- Never use the em dash character; use a plain dash or rewrite the sentence.
- In Markdown, put each full sentence on its own line.
- Import other packages only through their `src/index.ts`; signatures there and types in `packages/schema` are contracts.
- Shapes are `type` aliases, JSON-compatible, with `null` for absent values (no `undefined` in stored or API data).
- No runtime dependencies. Node built-ins only in shipped code; review any new dev dependency.
- Never start a process through a shell (`exec`, `shell: true`); use `execFile` or `spawn` with an argument array.
- Treat all session data as untrusted; never render it as HTML and never place it in a command.
- Redact before storing, logging, or displaying anything from a session.
- Tests use temporary `HOME` and `STILLWATCH_HOME` directories and never touch real settings, crontab, or network.
- Never write a literal real-looking secret in tests or fixtures; build fake secrets at runtime by concatenation.
- Every detection rule needs a positive test and a normal-use test.
- Database migrations are append-only; never edit one after it ships.
- Commit messages: `<area>: <imperative summary>`, no co-author trailers.
