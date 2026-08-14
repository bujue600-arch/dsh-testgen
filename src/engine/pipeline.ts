/**
 * The pipeline: target resolution → generation → run → bounded fix loop →
 * report. One function drives the slash command and the model tool alike.
 * All side effects (file writes, runner spawns) are injectable so the whole
 * orchestration is unit-testable without a real project or LLM.
 * @module dsh-testgen/engine/pipeline
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { TestgenError, ERROR_CODES } from '../errors.ts'
import { detectFramework, runTests, type ConcreteRunner } from './runner.ts'
import { generateTestSource, fixTestSource, resolveModel, type LlmHandle } from './generate-llm.ts'
import { generateTemplateTest, testFilePathFor } from './template.ts'
import { resolveTargets } from './resolve.ts'
import type { GeneratedTest, TestgenConfig, TestgenReport, TestgenRequest, TestRun, TestgenStatus } from '../types.ts'

/** Logger-shaped dependency; cordis loggers satisfy it structurally. */
export interface PipelineLogger {
  info?(format: string, ...args: unknown[]): void
  warn?(format: string, ...args: unknown[]): void
  error?(format: string, ...args: unknown[]): void
}

/** Injectable side effects. */
export interface EngineDeps {
  logger?: PipelineLogger
  llm?: LlmHandle
  now?: () => number
  writeFile?: (path: string, data: string) => void
  fileExists?: (path: string) => boolean
  readSource?: (path: string) => string
  runTests?: typeof runTests
}

const realDeps: Required<Pick<EngineDeps, 'now' | 'writeFile' | 'fileExists' | 'readSource' | 'runTests'>> = {
  now: () => Date.now(),
  writeFile: (path, data) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data, 'utf8')
  },
  fileExists: (path) => existsSync(path),
  readSource: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  },
  runTests,
}

/** Normalize request overrides onto the effective config. */
export function mergeRequest(config: TestgenConfig, request: TestgenRequest): TestgenConfig {
  const merged: TestgenConfig = { ...config }
  if (request.runner !== undefined) merged.runner = request.runner
  if (request.generator !== undefined) merged.generator = request.generator
  if (request.maxIterations !== undefined) merged.maxIterations = request.maxIterations
  if (request.autoRun !== undefined) merged.autoRun = request.autoRun
  if (request.model !== undefined) {
    const slash = request.model.indexOf('/')
    if (slash === -1) {
      merged.model = { provider: merged.model?.provider ?? '', model: request.model }
    } else {
      merged.model = { provider: request.model.slice(0, slash), model: request.model.slice(slash + 1) }
    }
  }
  if (merged.maxIterations < 0 || !Number.isFinite(merged.maxIterations)) {
    throw new TestgenError(`invalid maxIterations: ${merged.maxIterations}`, ERROR_CODES.INVALID_CONFIG)
  }
  return merged
}

function relPath(cwd: string, absolute: string): string {
  return relative(cwd, absolute).replaceAll('\\', '/')
}

/** Count `it(`/`test(` occurrences as a cheap emitted-test metric. */
export function countTests(source: string): number {
  const its = source.match(/\b(?:it|test)\(/gu)
  return its?.length ?? 0
}

/**
 * Execute the full pipeline. Never throws for runner/test failures — those
 * are report data; only configuration and LLM-availability problems throw
 * {@link TestgenError}.
 */
export async function runTestgen(
  cwd: string,
  request: TestgenRequest,
  baseConfig: TestgenConfig,
  deps: EngineDeps = {},
  signal?: AbortSignal,
): Promise<TestgenReport> {
  const start = (deps.now ?? realDeps.now)()
  const writeFile = deps.writeFile ?? realDeps.writeFile
  const fileExists = deps.fileExists ?? realDeps.fileExists
  const readSource = deps.readSource ?? realDeps.readSource
  const spawn = deps.runTests ?? realDeps.runTests
  const log = deps.logger
  const config = mergeRequest(baseConfig, request)

  const warnings: string[] = []
  const targets = resolveTargets(cwd, request.target, config)
  const framework: ConcreteRunner = detectFramework(cwd, config.runner)
  const supported = targets.filter((target) => target.language !== 'unknown')
  for (const skipped of targets.filter((target) => target.language === 'unknown')) {
    warnings.push(`skipped ${skipped.path}: unsupported language for this dsh-testgen version (TypeScript/JavaScript only)`)
  }
  // node:test cannot execute JSX; surface that before generating anything.
  const runnable = supported.filter((target) => !(framework === 'node-test' && (target.language === 'typescript-jsx' || target.language === 'javascript-jsx')))
  for (const skipped of supported.filter((target) => !runnable.includes(target))) {
    warnings.push(`skipped ${skipped.path}: node:test cannot execute JSX — pin a vitest or jest runner to test this target`)
  }
  if (runnable.length === 0) {
    return {
      status: 'skipped',
      targets: [],
      generated: [],
      runs: [],
      warnings,
      stats: { generatedFiles: 0, passed: 0, failed: 0, iterations: 0 },
      elapsedMs: (deps.now ?? realDeps.now)() - start,
    }
  }

  // ── generator decision ──────────────────────────────────────────────────
  let mode: 'llm' | 'template' = config.generator === 'template' ? 'template' : config.generator === 'llm' ? 'llm' : 'template'
  if (config.generator === 'llm' && !deps.llm) {
    throw new TestgenError('generator is pinned to `llm` but no LLM service is composed in this profile', ERROR_CODES.LLM_UNAVAILABLE)
  }
  if (config.generator === 'auto') {
    mode = deps.llm && deps.llm.listProviders().length > 0 ? 'llm' : 'template'
    if (mode === 'template') {
      warnings.push('no LLM adapter composed — using the deterministic template generator (structural smoke tests)')
    }
  }

  log?.info?.('testgen: %d target(s), framework %s, generator %s', runnable.length, framework, mode)

  // ── generation ──────────────────────────────────────────────────────────
  const generated: GeneratedTest[] = []
  const ownedPaths = new Set<string>()
  let resolved: Awaited<ReturnType<typeof resolveModel>> | undefined
  if (mode === 'llm' && deps.llm) {
    resolved = await resolveModel(deps.llm, config)
    log?.info?.('testgen: generating with %s/%s', resolved.provider, resolved.model)
  }

  for (const target of runnable) {
    const testPath = testFilePathFor(target, config.testDir, framework)
    if (fileExists(testPath) && !ownedPaths.has(testPath)) {
      warnings.push(`skipped ${target.path}: test file already exists at ${relPath(cwd, testPath)} (refusing to overwrite user code)`)
      continue
    }
    let source: string
    if (mode === 'template') {
      const result = generateTemplateTest(target, config.testDir, framework)
      source = result.source
      generated.push({
        path: relPath(cwd, result.path),
        framework,
        generator: 'template',
        testCount: result.testCount,
        contentBytes: Buffer.byteLength(result.source),
      })
    } else {
      source = await generateTestSource(deps.llm!, resolved!, framework, { path: target.path, language: target.language }, readSource(target.absolute), config, signal)
      if (source.length === 0) {
        warnings.push(`skipped ${target.path}: model returned empty test code`)
        continue
      }
      generated.push({
        path: relPath(cwd, testPath),
        framework,
        generator: 'llm',
        testCount: countTests(source),
        contentBytes: Buffer.byteLength(source),
      })
    }
    writeFile(testPath, source)
    ownedPaths.add(testPath)
    log?.info?.('testgen: wrote %s', relPath(cwd, testPath))
  }

  if (generated.length === 0) {
    return {
      status: 'skipped',
      targets: runnable.map((target) => ({ path: target.path, language: target.language })),
      generated: [],
      runs: [],
      warnings,
      stats: { generatedFiles: 0, passed: 0, failed: 0, iterations: 0 },
      elapsedMs: (deps.now ?? realDeps.now)() - start,
    }
  }

  // ── run / fix loop ──────────────────────────────────────────────────────
  const runs: TestRun[] = []
  let status: TestgenStatus = 'failed'
  const runFiles = generated.map((test) => test.path)

  if (!config.autoRun) {
    status = 'generated'
  } else {
    const maxIterations = config.maxIterations
    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      const run = await spawn({
        cwd,
        files: runFiles,
        framework,
        timeoutMs: config.timeoutSec * 1000,
        signal,
      })
      run.iteration = iteration
      runs.push(run)
      log?.info?.('testgen: run %d exit %s in %d ms', iteration, String(run.exitCode), run.durationMs)

      if (signal?.aborted) {
        warnings.push('aborted by the caller')
        status = 'failed'
        break
      }
      if (run.exitCode === 0) {
        status = iteration === 0 ? 'passed' : 'fixed'
        break
      }
      if (mode === 'template' || !deps.llm) {
        warnings.push('tests failed and the template generator cannot self-fix — switch to the LLM generator for behavioral fixups')
        status = 'failed'
        break
      }
      if (iteration >= maxIterations) {
        warnings.push(`iteration limit reached (maxIterations: ${maxIterations})`)
        status = 'failed'
        break
      }
      // Fix: regenerate each owned test file against the failures.
      for (const test of generated) {
        const absolute = resolve(cwd, test.path)
        const current = readSource(absolute)
        const fixed = await fixTestSource(deps.llm, resolved!, framework, test.path, current, run, config, signal)
        if (fixed.length > 0) {
          writeFile(absolute, fixed)
          log?.info?.('testgen: fixed %s', test.path)
        }
      }
    }
  }

  const last = runs.at(-1)
  return {
    status,
    targets: runnable.map((target) => ({ path: target.path, language: target.language })),
    generated,
    runs,
    warnings,
    stats: {
      generatedFiles: generated.length,
      passed: last?.summary?.passed ?? 0,
      failed: last?.summary?.failed ?? (status === 'failed' && last ? last.failures.length || 1 : 0),
      iterations: runs.length,
    },
    elapsedMs: (deps.now ?? realDeps.now)() - start,
  }
}
