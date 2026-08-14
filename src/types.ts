/**
 * Public value types: the plugin's input/output specification.
 *
 * Every surface (slash command, model tool, engine API) reads and produces
 * exactly these shapes. The tool's canonical output schema in `tool.ts` is
 * the JSON projection of {@link TestgenReport}; `docs/io-spec.md` documents
 * the same contract for humans.
 * @module dsh-testgen/types
 */

/** Test frameworks the runner adapter can drive. */
export type TestRunner = 'auto' | 'vitest' | 'jest' | 'node-test' | 'mocha'

/** Which generator produces the test source. */
export type GeneratorMode = 'auto' | 'llm' | 'template'

/** Coarse source language classification, decided by file extension. */
export type TargetLanguage = 'typescript' | 'typescript-jsx' | 'javascript' | 'javascript-jsx' | 'unknown'

/** Plugins-level configuration (composition entry + settings namespace). */
export interface TestgenConfig {
  /** Test framework to run; `auto` detects from the project. */
  runner: TestRunner
  /** Generator strategy; `auto` prefers the LLM and falls back to the deterministic template. */
  generator: GeneratorMode
  /** Upper bound of the generate → run → fix loop; `0` disables fixing. */
  maxIterations: number
  /** Per-run wall-clock timeout in seconds. */
  timeoutSec: number
  /** Whether the engine runs the test suite after generation. */
  autoRun: boolean
  /** Glob patterns selecting candidate source files. */
  includeGlobs: string[]
  /** Glob patterns never selected as targets. */
  excludeGlobs: string[]
  /** Directory (relative to the target's location) that receives generated test files. */
  testDir: string
  /** Optional provider/model override for generation requests. */
  model?: { provider: string; model: string }
  /** Cap on source characters fed to the LLM per target. */
  maxSourceChars: number
}

/** One target resolved from user input (path or glob). */
export interface SourceTarget {
  /** Path relative to the workspace root, `/`-separated. */
  path: string
  /** Absolute filesystem path. */
  absolute: string
  /** Detected language. */
  language: TargetLanguage
  /** Source size in bytes (informational). */
  sizeBytes: number
}

/** One generated (or regenerated) test file. */
export interface GeneratedTest {
  /** Test file path relative to the workspace root. */
  path: string
  /** Framework the emitted source targets. */
  framework: Exclude<TestRunner, 'auto'>
  /** Which generator produced it. */
  generator: GeneratorMode
  /** Number of test cases emitted. */
  testCount: number
  /** Written content size in bytes. */
  contentBytes: number
}

/** One failure extracted from a runner output. */
export interface TestFailure {
  /** Failing test or suite name, when the reporter disclosed one. */
  testName?: string
  /** Test file the failure belongs to, when the reporter disclosed one. */
  file?: string
  /** Failure message (possibly multiline). */
  message: string
}

/** Parsed count summary of one test run, when the reporter disclosed counts. */
export interface TestSummary {
  passed: number
  failed: number
  skipped?: number
}

/** One executed runner pass. */
export interface TestRun {
  /** Zero-based iteration inside the fix loop. */
  iteration: number
  /** Framework that ran. */
  framework: Exclude<TestRunner, 'auto'>
  /** Command line used (informational). */
  command: string
  /** Exit code; `null` when the process was terminated without one. */
  exitCode: number | null
  /** Whether the configured timeout killed the run. */
  timedOut: boolean
  /** Parsed counts, when available. */
  summary?: TestSummary
  /** Structured failures extracted from the output. */
  failures: TestFailure[]
  /** Wall-clock duration in milliseconds. */
  durationMs: number
  /** Runner output tail (bounded; kept for the fix loop and diagnostics). */
  output: string
}

/** Terminal status of one `generate_tests` / `/testgen` execution. */
export type TestgenStatus = 'passed' | 'fixed' | 'generated' | 'failed' | 'skipped'

/** Full result of one pipeline execution (the canonical output value). */
export interface TestgenReport {
  status: TestgenStatus
  /** Resolved source targets that entered the pipeline. */
  targets: { path: string; language: TargetLanguage }[]
  /** Test files the pipeline wrote. */
  generated: GeneratedTest[]
  /** Every runner pass, in execution order. */
  runs: TestRun[]
  /** Non-fatal observations (fallbacks, skipped targets, degradations). */
  warnings: string[]
  /** Aggregate counters for quick consumption. */
  stats: {
    generatedFiles: number
    passed: number
    failed: number
    iterations: number
  }
  /** Total wall-clock duration in milliseconds. */
  elapsedMs: number
}

/** User-facing request, shared by the tool arguments and the command parser. */
export interface TestgenRequest {
  /** One target path or glob, or several. */
  target: string | string[]
  /** Framework override. */
  runner?: TestRunner
  /** Generator override. */
  generator?: GeneratorMode
  /** Fix-loop bound override. */
  maxIterations?: number
  /** Skip the run phase and only generate. */
  autoRun?: boolean
  /** Provider/model override, `provider/model` syntax. */
  model?: string
}
