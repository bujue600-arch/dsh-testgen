# Input / output specification

`dsh-testgen` defines one canonical contract that every surface implements:
the slash command renders it for humans, the `generate_tests` tool exposes it
as a validated JSON schema, and the engine API (`runTestgen`) returns it
directly. All shapes live in [`src/types.ts`](../src/types.ts); the tool's
schema in [`src/tool.ts`](../src/tool.ts) is the JSON projection of
`TestgenReport`.

## Input

### Command: `/testgen`

Unstructured single-line input. Grammar owned by the plugin:

```
/testgen [options] <file-or-glob> [more targets…]
```

| Option | Value | Default | Meaning |
|---|---|---|---|
| `--runner` | `vitest` \| `jest` \| `node-test` \| `mocha` \| `auto` | `auto` | Framework to execute |
| `--generator` | `llm` \| `template` \| `auto` | `auto` | Generator strategy |
| `--iterations` | integer ≥ 0 | `3` | Fix-loop bound |
| `--model` | `provider/model` | — | Generation model override |
| `--no-run` | flag | off | Generate only, skip running |
| `--json` | flag | off | Emit the raw `TestgenReport` JSON |

Targets: a file path, a directory (walked recursively), or a glob. Explicit
paths bypass `includeGlobs` but honor `excludeGlobs`; globs and directories
apply both.

### Tool: `generate_tests`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | string | ✅ | File path, directory, or glob relative to the workspace root |
| `runner` | enum(string) | — | Framework override |
| `generator` | enum(string) | — | Generator override |
| `maxIterations` | integer | — | Fix-loop bound override |
| `autoRun` | boolean | — | Run after generation (default `true`) |
| `model` | string | — | `provider/model` override |

The tool is classified **never parallel** (`isConcurrencySafe: false`):
test runs mutate files. Cooperative timeout: `300000 ms`; the body honors
`exec.signal` and forwards it to the LLM stream and the runner process.

## Output

### Canonical value: `TestgenReport`

```ts
type TestgenStatus = 'passed' | 'fixed' | 'generated' | 'failed' | 'skipped'

interface TestgenReport {
  /** Terminal outcome of the pipeline. */
  status: TestgenStatus
  /** Resolved source targets that entered the pipeline. */
  targets: { path: string; language: TargetLanguage }[]
  /** Test files written by the pipeline. */
  generated: GeneratedTest[]
  /** Every runner pass, in execution order. */
  runs: TestRun[]
  /** Non-fatal observations (fallbacks, skipped targets, degradations). */
  warnings: string[]
  stats: {
    generatedFiles: number
    passed: number
    failed: number
    iterations: number
  }
  elapsedMs: number
}

interface GeneratedTest {
  path: string          // relative to the workspace root
  framework: 'vitest' | 'jest' | 'node-test' | 'mocha'
  generator: 'llm' | 'template'
  testCount: number     // `it(`/`test(` occurrences for llm; emitted cases for template
  contentBytes: number
}

interface TestRun {
  iteration: number     // zero-based; >0 only after fixes
  framework: string
  command: string       // informational command line
  exitCode: number | null
  timedOut: boolean
  summary?: { passed: number; failed: number; skipped?: number }
  failures: { testName?: string; file?: string; message: string }[]
  durationMs: number
  /** Runner output tail (kept for the fix loop; stripped from the tool's wire value). */
  output: string
}
```

### Status semantics

| Status | Meaning |
|---|---|
| `passed` | Generated and the first run exited 0 |
| `fixed` | At least one failing run, then a passing run (LLM fix loop) |
| `generated` | Files written, `autoRun: false` (no runs) |
| `failed` | Runs stayed red within `maxIterations`, or template mode cannot self-fix |
| `skipped` | Nothing generated (unsupported language, existing tests, empty selection) |

### Tool wire schema

The tool returns the same object **minus `run.output`** (bulky raw logs) —
`additionalProperties: false` is enforced by the registry, so the wire value
is exactly the schema. Failures are capped (50 per run, 500 chars per
message); the runner output tail is capped at 30 000 chars internally.

### Errors

Engine failures throw [`TestgenError`](../src/errors.ts), a `HarnessError`
with a stable machine-routable `code`. The slash command renders them as
`{ kind: 'error', text }`; the tool lets them propagate through the tools
pipeline so the session logs retain the failure class.

| Code | Meaning |
|---|---|
| `TESTGEN_NO_TARGET` | Input matched no source file under the include/exclude policy |
| `TESTGEN_UNSUPPORTED_LANGUAGE` | Target language has no generator (TS/JS only in v1) |
| `TESTGEN_NO_RUNNER` | No usable runner detected or selected |
| `TESTGEN_RUNNER_START_FAILED` | Runner declared but not installed, or spawn failed |
| `TESTGEN_LLM_UNAVAILABLE` | LLM pinned but no adapter composed |
| `TESTGEN_LLM_FAILED` | LLM stream errored or produced no code |
| `TESTGEN_INVALID_CONFIG` | A request override failed validation |
