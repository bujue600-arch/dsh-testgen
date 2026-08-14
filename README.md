# dsh-testgen

> Automated unit-test generation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a `/testgen` command and a `generate_tests` tool that scaffold tests, run your project's test runner, and **fix failures until they pass** — bounded, observable, and honest about what it changed.

[![npm](https://img.shields.io/npm/v/dsh-testgen?color=4D6BFE)](https://www.npmjs.com/package/dsh-testgen)
[![license](https://img.shields.io/github/license/bujue600-arch/dsh-testgen)](./LICENSE)
[![CI](https://github.com/bujue600-arch/dsh-testgen/actions/workflows/ci.yml/badge.svg)](https://github.com/bujue600-arch/dsh-testgen/actions/workflows/ci.yml)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-4D6BFE?logo=deepseek&logoColor=white)](https://github.com/topics/dsh-plugin)

English | [中文](./README.zh.md)

---

## Why this plugin

DeepSeek Harness agents write code constantly — and leave it untested. `dsh-testgen` closes that loop **inside the harness**:

- **One command for humans** — `/testgen src/utils/math.ts` generates, runs, and fixes in a single step.
- **One tool for agents** — the agent itself can call `generate_tests` after writing code, keeping the loop in the session.
- **Two generators, no dead ends** — behavioral tests through your composed LLM when available; deterministic structural smoke tests (zero LLM, works offline) otherwise.
- **A real fix loop** — failures are parsed from vitest / jest / mocha / node:test output and fed back to the LLM, up to a bounded number of iterations, only ever rewriting the test files it generated.

No duplicated wheels: the ecosystem has git tools and eval harnesses, but no plugin that *generates, runs, and fixes* unit tests as a first-class harness surface.

## Features

| | |
|---|---|
| ⚡ `/testgen` slash command | `[options] <file-or-glob>`, `--json`, `--help`; rendered directly in the Web UI |
| 🛠️ `generate_tests` model tool | structured JSON input/output, cooperative cancellation, never runs in parallel |
| 🧠 LLM generator | streams through `ctx.llm`, honors your provider/model, bounded source truncation |
| 🧩 Template generator | zero-dependency smoke tests scaffolded from exported symbols — no API key needed |
| 🔁 Generate → run → fix loop | per-framework failure parsing, bounded by `maxIterations` |
| 🧪 Runner autodetect | vitest / jest / mocha detected from the project; `node --test` as the universal fallback |
| 🔥 Hot-reloaded config | `testgen:` section in `settings.yaml`; edits apply on the next invocation, no restart |
| 🧰 Lifecycle-clean | registrations and in-flight runs unwind with the plugin fiber; refuses to overwrite user tests |
| 📐 Typed end to end | TypeScript, schemastery config, stable error codes, 78 unit tests including a real end-to-end run |

## Demo

Terminal-style demo (deterministic template generator + real `node --test` run):

![dsh-testgen CLI demo](./assets/demo-cli.png)

In the Web UI, the plugin shows up in **Settings → Plugins → Plugin list** with an active status (real `dsh web` boot, 134 plugins loaded):

![dsh-testgen in the Web UI](./assets/demo-web.png)

## Installation

Requires Node ≥ 22 and `dsh` (DeepSeek Harness CLI).

```sh
# From npm (recommended)
dsh plugin --profile web add dsh-testgen

# Or straight from GitHub
dsh plugin --profile web add github:bujue600-arch/dsh-testgen
```

`dsh plugin add` installs the package into the profile and reconciles the bundle layer stack — the plugin declares a `dsh.bundle` manifest (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`), so no hand-editing is required. It works for any profile: `web`, `headless`, or your own.

> Note for git/file installs: pnpm exits non-zero on missing peers for linked dependencies; that is expected — the harness resolves the peer packages (`@deepseek-ai/dsh-*`, cordis) from the profile's own module fallback at boot. The plugin loads normally.

Verify it loaded (Web): **Settings → Plugins → Plugin list** shows the `testgen` entry with an active status dot.

## Usage

### Slash command

```
/testgen [options] <file-or-glob> [more targets…]

Options:
  --runner <vitest|jest|node-test|mocha|auto>  framework (default: auto)
  --generator <llm|template|auto>              generator (default: auto)
  --iterations <n>                             fix-loop bound (default: 3)
  --model <provider/model>                     generation model override
  --no-run                                     generate only, do not run
  --json                                       machine-readable report
  -h, --help                                   show this help
```

```sh
/testgen src/utils/math.ts
/testgen --runner vitest "src/**/*.ts"
/testgen --generator template --no-run src/app.ts
/testgen --model deepseek-official/deepseek-chat src/parser.ts
```

### Model tool

The agent can call it directly — same pipeline, structured result:

```
generate_tests({ target: "src/utils/math.ts", runner: "vitest", maxIterations: 3 })
```

### What gets written

For `src/utils/math.ts`, tests land in `src/utils/__tests__/math.test.ts` (framework-dependent; `node:test` uses `.test.mts`). Existing test files are **never overwritten** — a target that already has a test file is skipped with a warning.

## Configuration

All settings live under the `testgen:` key of your harness settings document (`$DSH_HOME/settings.yaml`) and are **hot-reloaded** — edit, save, done. Layering: schema defaults → composition entry (`cordis.patch.yml`) → your settings section.

```yaml
testgen:
  runner: auto            # auto | vitest | jest | node-test | mocha
  generator: auto         # auto | llm | template
  maxIterations: 3        # generate → run → fix loop bound (0 disables fixing)
  timeoutSec: 120         # per-run wall-clock timeout
  autoRun: true           # run the suite after generation
  includeGlobs:
    - '**/*.{ts,tsx,js,jsx}'
  excludeGlobs:
    - '**/node_modules/**'
    - '**/dist/**'
    - '**/*.test.*'
    - '**/*.spec.*'
    - '**/__tests__/**'
  testDir: __tests__      # generated tests land here, next to the target
  model:                  # optional provider/model override
    provider: deepseek-official
    model: deepseek-chat
  maxSourceChars: 60000   # source characters fed to the LLM per target
```

You can also override any of these per profile by patching the `testgen` row in the profile's `cordis.patch.yml` (a patch replaces the row's whole config). See [`docs/config.md`](./docs/config.md) for the full reference.

## Input / output specification

Every surface — command, tool, engine — speaks the same contract. The tool's canonical output schema is the JSON projection of `TestgenReport`; [`docs/io-spec.md`](./docs/io-spec.md) documents it in full.

```ts
interface TestgenReport {
  status: 'passed' | 'fixed' | 'generated' | 'failed' | 'skipped'
  targets: { path: string; language: string }[]
  generated: GeneratedTest[]        // path, framework, generator, testCount
  runs: TestRun[]                   // per-iteration exit code, summary, failures
  warnings: string[]
  stats: { generatedFiles: number; passed: number; failed: number; iterations: number }
  elapsedMs: number
}
```

## Architecture

Everything is a plugin, and this plugin stays inside its box:

```
dsh-testgen
├── src/
│   ├── index.ts            # cordis entry: name / inject / Config / apply
│   ├── schema.ts           # schemastery config + settings namespace schema
│   ├── settings.ts         # hot-reload aware effective-config resolution
│   ├── command.ts          # /testgen grammar + handler
│   ├── tool.ts             # generate_tests definition (input/output schemas)
│   ├── report.ts           # plain / markdown / JSON rendering
│   ├── errors.ts           # stable TESTGEN_* error codes (HarnessError)
│   └── engine/             # pure, framework-free core (fully unit-tested)
│       ├── resolve.ts      # path/glob → SourceTarget[], language detection
│       ├── template.ts     # deterministic smoke-test generator
│       ├── generate-llm.ts # ctx.llm streaming, prompt assembly, extraction
│       ├── runner.ts       # framework detect, spawn, output parsing
│       └── pipeline.ts     # generate → run → fix orchestration
├── cordis.patch.yml        # bundle patch: one `testgen` insert row
├── docs/                   # io-spec, config reference
├── examples/fixture/       # demo project
└── test/                   # 78 unit tests (vitest)
```

- **Non-invasive**: one insert row in the composition; no core patches, no monkey-patching. Removable with `dsh plugin --profile web remove dsh-testgen`.
- **Composable**: hard-injects only `commands` and `tools` (present in every shipped profile); `settings`, `llm`, and the agent session are consumed opportunistically, so a profile without a settings provider or LLM adapter still works.
- **Honest side effects**: writes test files only, refuses to overwrite existing ones, and fixes only files it generated. Test processes run with your project's runner, from the workspace root, with a tree-killing timeout and abort wiring.

## Development

```sh
pnpm install
pnpm run typecheck     # tsc --noEmit
pnpm run lint          # eslint
pnpm test              # vitest (78 tests)
pnpm run build         # tsdown → lib/
pnpm run verify:manifest  # dsh.bundle / exports / files contract
pnpm run demo          # end-to-end demo against examples/fixture
```

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Report bugs or propose features through the issue templates.

## FAQ

**Does it need an API key?** No. Without an LLM adapter, `generator: auto` uses the deterministic template generator — structural smoke tests that prove imports resolve and exports exist. With an LLM composed, `auto` prefers behavioral tests.

**Which projects work with `node --test`?** TypeScript targets need an ESM project (`"type": "module"` in package.json — the normal case) because Node strips types only from ESM files; JSX targets need vitest or jest (pin `runner`).

**Will it modify my source code?** Never. It writes test files only, and skips targets that already have a test file.

**What if the fix loop can't make it green?** It stops at `maxIterations` and reports `failed` with the last failures and warnings — no infinite retries.

## Changelog & versioning

[`CHANGELOG.md`](./CHANGELOG.md) — versions follow [SemVer](https://semver.org).

## License

[MIT](./LICENSE) © bujue600-arch and dsh-testgen contributors. This is a community project, not affiliated with DeepSeek.
