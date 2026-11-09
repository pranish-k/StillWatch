# Developing Stillwatch

Read [the architecture document](architecture.md) first, then the working rules in [CLAUDE.md](../CLAUDE.md).

## Layout

| Path | What it is |
| --- | --- |
| `apps/cli` | The `stillwatch` command and the published npm package |
| `apps/collector` | Capture hook script, spool import, snapshots, analysis scheduling, local API |
| `apps/web` | React dashboard, built to static files |
| `packages/schema` | Shared types and pure helpers, the contracts every package uses |
| `packages/adapter-claude` | Claude Code hook spec, payload mapping, transcripts |
| `packages/installer` | Claude Code settings editing and install checks |
| `packages/redaction` | Secret redaction and data minimization |
| `packages/storage` | SQLite store and migrations |
| `packages/git-tracker` | Repository and persistence-surface snapshots |
| `packages/facts` | Event facts, shell parsing, sensitive-path catalog |
| `packages/rules` | Detection rules and session analysis |
| `packages/reports` | Report model, summaries, Markdown |
| `lab` | Attack lab scenarios and fixtures |

## Setup

You need Node.js 22.13 or newer (24 is recommended; see `.nvmrc`) and pnpm 12.

```sh
pnpm install
pnpm check
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm check` | Format check, lint, typecheck, and tests; must pass before every commit |
| `pnpm test` | All tests: the parallel suite, then the performance budgets alone |
| `pnpm test:perf` | Only the performance budget tests |
| `pnpm vitest run packages/<name>` | One package's tests |
| `pnpm lint` | ESLint with strict type-checked rules |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm format` | Prettier (Markdown is formatted by hand) |
| `pnpm build` | Builds the dashboard, then bundles the CLI into `apps/cli/dist/stillwatch.mjs` |
| `pnpm lab` | Builds and runs the attack lab |
| `VITE_STILLWATCH_MOCK=1 pnpm --filter @stillwatch/web dev` | Runs the dashboard with mock sessions and no collector; add `?mock=empty`, `?mock=offline`, or `?mock=signed-out` to see those states |

## Testing rules

- Tests sit next to the code as `*.test.ts`, or in a package's `test/` directory.
- Tests that assert a wall-clock budget are named `*.perf.test.ts` and live in a `test/` directory.
  They run one file at a time after the parallel suite, so other tests cannot slow them down and make them flaky.
- Tests set `HOME` and `STILLWATCH_HOME` to temporary directories and never touch real settings, crontab, or network.
- Never write a literal real-looking secret; build fake secrets at runtime by concatenation, so secret scanners do not flag the repository.
- Add a fixture whenever a parser or rule bug is fixed.
- Real Claude Code payloads live in `lab/fixtures/claude-code/`, with personal paths rewritten.

## Adding a rule

1. Add its id to `RULE_IDS` in `packages/schema`.
2. Add its definition to `RULES` in `packages/rules`, with a plain-English title, description, and default severity.
3. Implement it so every finding explains itself and cites its events, paths, or artifacts.
4. Add a positive test and a normal-use test.
5. Add a lab scenario if it covers an attack class.
6. Add it to the rules table in the [detailed spec](planning/detailed-spec.md).
7. Bump `ANALYSIS_VERSION` when the change alters stored analysis results.

## Adding an agent adapter

1. Add the agent to `AGENT_KINDS` in `packages/schema`.
2. Create `packages/adapter-<agent>` that maps the agent's events to `NormalizedEvent` and declares how its hooks are installed.
3. Capture real payloads, rewrite personal paths, and add them as fixtures.
4. Keep agent details inside the adapter; facts, rules, and reports must work unchanged.

## Release levels

| Release | Audience | Must be true |
| --- | --- | --- |
| `0.0.x` | You only | Stages 0 to 3 pass |
| `0.0.x` | You, on real work | Stages 4 and 5 pass, and redaction is proven |
| `0.1.0-alpha.N` | Three to five trusted testers | Stage 6 passes, and testers receive the limits document |
| `0.1.0` | Public open source | Alpha findings are resolved, and a license is chosen |

Pre-tester builds stay on `0.0.x`, because semver sorts `0.1.0-dev` after `0.1.0-alpha`.

## Publishing

The npm package is `apps/cli`, published as `stillwatch` ([ADR-031](decisions/README.md#adr-031-publish-one-npm-package-mit-licensed-with-alpha-versions-on-latest)).

1. Set the version in `apps/cli/package.json`, then run `pnpm check`.
2. Run `pnpm pack:cli`, which builds everything and writes `stillwatch-<version>.tgz` at the repository root.
   Packing fails if the build is missing the CLI bundle, the dashboard, or `THIRD_PARTY_NOTICES.md`.
3. Test the tarball in a sandbox with a temporary `HOME`, npm prefix, and npm cache, and a free `port` in the sandbox `config.json`: `npx <tarball> install`, delete the npm cache, and check that a hook event still starts the collector.
4. Run `pnpm --filter stillwatch publish --tag latest --access public`, which publishes the same files after npm login.
5. Tag the commit `v<version>` and push the tag.

## Dependencies

The published package has no runtime dependencies ([ADR-019](decisions/README.md#adr-019-zero-runtime-dependencies-in-one-bundled-file)).
Dependency install scripts are blocked through `allowBuilds` in `pnpm-workspace.yaml`.
Review every new development dependency before adding it.

## Continuous integration

CI runs on every push to `main` and every pull request, on Ubuntu and macOS with Node 22, 24, and 26.
It runs the format check and lint once, then typecheck, tests, the build, and a smoke test of the bundled CLI.
Actions are pinned to commit hashes.
