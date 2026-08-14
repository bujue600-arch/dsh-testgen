# Configuration reference

Every knob resolves through the DeepSeek Harness settings seam: **schema
defaults → composition entry → user settings section**. The settings section
is hot-reloaded: a watcher publishes external edits, and the plugin re-reads
the resolved value on every invocation — no restart required.

## Sources and precedence

| Layer | Where | Precedence |
|---|---|---|
| Schema defaults | [`src/schema.ts`](../src/schema.ts) | lowest |
| Composition entry | the `testgen` row in [`cordis.patch.yml`](../cordis.patch.yml), overridable per profile by patching the same row id | middle |
| User section | `testgen:` in `$DSH_HOME/settings.yaml` (or `settings.json`) | highest |

A patch replaces the row's **whole config** — profile overrides must restate
every field they keep. The settings section merges per field; an absent key
re-inherits the layer below.

## Fields

| Field | Type | Default | Constraints | Meaning |
|---|---|---|---|---|
| `runner` | enum | `auto` | `auto` \| `vitest` \| `jest` \| `node-test` \| `mocha` | Framework to execute; `auto` detects from the project's declared dependencies, falling back to `node:test` |
| `generator` | enum | `auto` | `auto` \| `llm` \| `template` | `auto` prefers the LLM when an adapter is composed and degrades to the deterministic template; pin `llm` to fail loudly when no adapter exists |
| `maxIterations` | number | `3` | 0–20 | Bound of the generate → run → fix loop; `0` disables fixing entirely |
| `timeoutSec` | number | `120` | 1–600 | Per-run wall-clock timeout; a hung runner is killed tree-wide |
| `autoRun` | boolean | `true` | — | Run the suite after generation; `false` reports `generated` without runs |
| `includeGlobs` | string[] | `['**/*.{ts,tsx,js,jsx}']` | — | Candidate patterns for glob/directory expansion (explicit file paths bypass this list) |
| `excludeGlobs` | string[] | `node_modules`, `dist`, `build`, `.git`, test files, `__tests__` | — | Never selected; applied to explicit paths too |
| `testDir` | string | `__tests__` | — | Directory (relative to the target) receiving generated test files |
| `model.provider` | string | first composed adapter | — | Provider route for generation calls |
| `model.model` | string | first listed model, else `deepseek-chat` | — | Model id for generation calls |
| `maxSourceChars` | number | `60000` | 1000–200000 | Source characters fed to the LLM per target (and per fix prompt); longer sources are truncated with a marker |

## Example: settings.yaml

```yaml
testgen:
  runner: vitest
  generator: llm
  maxIterations: 5
  timeoutSec: 180
  testDir: tests
  model:
    provider: deepseek-official
    model: deepseek-chat
```

Changes land on the **next invocation** — an in-flight run keeps the config
it started with (per-call snapshotting, matching the harness settings
contract).

## Request-level overrides

Each execution may override config per call: `/testgen --runner jest`,
`--generator template`, `--iterations 5`, `--model p/m`, `--no-run`; the tool
accepts the same fields as arguments. Overrides never persist.

## Validation

Invalid stored sections keep the namespace's last good value and warn (the
harness seam's boot/reload contract); invalid request overrides fail the
invocation with `TESTGEN_INVALID_CONFIG` before any file is written.
