/**
 * Test-runner adapter: detects the project's framework, executes one test
 * run as a managed child process, and parses the output into structured
 * failures. Pure Node — the host process owns spawning policy; the optional
 * `ctx.subprocess` seam is used by the plugin entry when composed.
 * @module dsh-testgen/engine/runner
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TestgenError, ERROR_CODES } from '../errors.ts'
import type { TestFailure, TestRun, TestSummary, TestgenConfig } from '../types.ts'

export type ConcreteRunner = Exclude<TestgenConfig['runner'], 'auto'>

/** Spawn-shaped dependency, replaceable in tests. */
export interface SpawnHandle {
  kill(): void
  on(event: 'exit', listener: (code: number | null) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void }
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): void }
}

export type SpawnImpl = (command: string, argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnHandle

export interface RunnerOptions {
  cwd: string
  files: string[]
  framework: ConcreteRunner
  timeoutMs: number
  signal?: AbortSignal
  spawnImpl?: SpawnImpl
  killDelayMs?: number
}

const MAX_CAPTURE_BYTES = 256 * 1024
const MAX_OUTPUT_TAIL = 30000
const MAX_FAILURES = 50

/** Walk up from `cwd` to the nearest directory containing `package.json`. */
export function findProjectRoot(cwd: string): string {
  let dir = cwd
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}

function readPackage(dir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function dependencyNames(pkg: Record<string, unknown>): Set<string> {
  const names = new Set<string>()
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const section = pkg[key]
    if (section && typeof section === 'object') {
      for (const name of Object.keys(section as Record<string, unknown>)) names.add(name)
    }
  }
  return names
}

/** Detect the concrete framework for a project, honoring an explicit pin. */
export function detectFramework(cwd: string, requested: TestgenConfig['runner']): ConcreteRunner {
  if (requested !== 'auto') return requested
  const root = findProjectRoot(cwd)
  const deps = dependencyNames(readPackage(root))
  if (deps.has('vitest')) return 'vitest'
  if (deps.has('jest')) return 'jest'
  if (deps.has('mocha')) return 'mocha'
  return 'node-test'
}

/** Resolve the runner's entry file inside the nearest `node_modules`. */
export function resolveRunnerEntry(cwd: string, framework: ConcreteRunner): { argv: string[]; command: string } {
  if (framework === 'node-test') {
    return { argv: [], command: 'node --test' }
  }
  const pkg = framework === 'vitest' ? 'vitest' : framework === 'jest' ? 'jest' : 'mocha'
  const entryRel = framework === 'vitest' ? 'vitest.mjs' : framework === 'jest' ? 'bin/jest.js' : 'bin/mocha.js'
  let dir = findProjectRoot(cwd)
  for (;;) {
    const candidate = join(dir, 'node_modules', pkg, entryRel)
    if (existsSync(candidate)) return { argv: [candidate], command: `node ${candidate}` }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new TestgenError(
    `${pkg} is declared by the project but its package is not installed — run the project's install first`,
    ERROR_CODES.RUNNER_START_FAILED,
  )
}

/** Build the full argument vector for one run. */
export function buildRunArgv(framework: ConcreteRunner, entryArgv: string[], files: string[]): string[] {
  const base = [...entryArgv]
  switch (framework) {
    case 'node-test': return ['--test', ...files]
    case 'vitest': return [...base, 'run', ...files, '--reporter=basic']
    case 'jest': return [...base, ...files, '--runInBand']
    case 'mocha': return [...base, ...files]
  }
}

const defaultSpawn: SpawnImpl = (command, argv, options) => spawn(command, argv, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * Run one test pass and parse it. Resolves with a {@link TestRun}; rejects
 * with {@link TestgenError} only when the runner could not even start.
 */
export async function runTests(options: RunnerOptions): Promise<TestRun> {
  const started = Date.now()
  const { framework } = options
  const spawnImpl = options.spawnImpl ?? defaultSpawn
  const entry = resolveRunnerEntry(options.cwd, framework)
  const argv = buildRunArgv(framework, entry.argv, options.files)

  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', NODE_ENV: process.env.NODE_ENV ?? 'test' }
  let stdout = ''
  let stderr = ''

  const child = spawnImpl(process.execPath, argv, { cwd: options.cwd, env })
  child.stdout.on('data', (chunk) => {
    if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString()
  })

  const killDelay = options.killDelayMs ?? 5000
  let timedOut = false
  let killed = false
  const kill = (): void => {
    if (killed) return
    killed = true
    child.kill()
    // Escalate: hard-kill the whole tree if it survives the grace window.
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String((child as unknown as { pid?: number }).pid ?? ''), '/T', '/F'], { stdio: 'ignore' })
        } else {
          child.kill()
        }
      } catch {
        // best effort
      }
      clearTimeout(timer)
    }, killDelay)
    if (timer.unref) timer.unref()
  }

  const timer = setTimeout(() => {
    timedOut = true
    kill()
  }, options.timeoutMs)
  if (timer.unref) timer.unref()

  const onAbort = (): void => kill()
  options.signal?.addEventListener('abort', onAbort, { once: true })

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('exit', (code) => resolve(code))
    child.on('error', (error) => reject(new TestgenError(`failed to start ${framework} runner: ${error.message}`, ERROR_CODES.RUNNER_START_FAILED, { cause: error })))
  })

  clearTimeout(timer)
  options.signal?.removeEventListener('abort', onAbort)
  if (killed && exitCode !== null && exitCode !== 0 && !timedOut) {
    // Process observed a non-zero exit after a requested kill: report aborted.
    timedOut = options.signal?.aborted === true ? false : timedOut
  }

  const output = tail(`${stdout}\n${stderr}`.trim(), MAX_OUTPUT_TAIL)
  const parsed = parseRunnerOutput(framework, output, exitCode)
  return {
    iteration: 0,
    framework,
    command: displayCommand(framework, options.files),
    exitCode,
    timedOut,
    summary: parsed.summary,
    failures: parsed.failures,
    durationMs: Date.now() - started,
    output,
  }
}

function displayCommand(framework: ConcreteRunner, files: string[]): string {
  const shown = files.map((file) => JSON.stringify(file)).join(' ')
  switch (framework) {
    case 'vitest': return `vitest run ${shown}`
    case 'jest': return `jest ${shown} --runInBand`
    case 'mocha': return `mocha ${shown}`
    case 'node-test': return `node --test ${shown}`
  }
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…(truncated)…\n${text.slice(-max)}`
}

export interface ParsedOutput {
  summary?: TestSummary
  failures: TestFailure[]
}

export function parseRunnerOutput(framework: ConcreteRunner, output: string, exitCode: number | null): ParsedOutput {
  let parsed: ParsedOutput
  switch (framework) {
    case 'vitest': parsed = parseVitest(output); break
    case 'jest': parsed = parseJest(output); break
    case 'mocha': parsed = parseMocha(output); break
    case 'node-test': parsed = parseNodeTest(output); break
  }
  parsed.failures = parsed.failures.slice(0, MAX_FAILURES)
  if (exitCode !== 0 && parsed.failures.length === 0) {
    parsed.failures.push({ message: `runner exited with code ${String(exitCode)}:\n${tail(output, 4000)}` })
  }
  return parsed
}

const VITEST_FAILURE_HEADER = /^\s*(?:[❯×✗]|×)\s+(.+?\.(?:test|spec)\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs))\s*>\s*(.+)$/u

function parseVitest(output: string): ParsedOutput {
  const failures: TestFailure[] = []
  let current: TestFailure | undefined
  const push = (): void => {
    if (current) failures.push(current)
    current = undefined
  }
  for (const line of output.split('\n')) {
    const header = VITEST_FAILURE_HEADER.exec(line)
    if (header) {
      push()
      current = { file: header[1], testName: header[2]!.trim(), message: '' }
      continue
    }
    if (current) {
      const trimmed = line.trim()
      if (/^(?:AssertionError|TypeError|RangeError|ReferenceError|Error|expected)/u.test(trimmed)) {
        current.message = trimmed.slice(0, 500)
      } else if (trimmed.length === 0) {
        push()
      } else if (!current.message && /:\d+:\d+/u.test(line)) {
        continue // source reference line
      } else if (current.message && trimmed.startsWith('❯') && /:\d+:\d+/u.test(line)) {
        push()
      }
    }
  }
  push()
  const summary = parseVitestSummary(output)
  return { summary, failures: failures.filter((failure) => failure.message !== '') }
}

function parseVitestSummary(output: string): TestSummary | undefined {
  const line = output.split('\n').find((value) => /^\s*Tests\s+\d+/u.test(value))
  if (!line) return undefined
  const failed = /Tests\s+(\d+)\s+failed/u.exec(line)
  const passed = /(\d+)\s+passed/u.exec(line)
  const skipped = /(\d+)\s+skipped/u.exec(line)
  if (!failed && !passed) return undefined
  return {
    failed: failed ? Number(failed[1]) : 0,
    passed: passed ? Number(passed[1]) : 0,
    skipped: skipped ? Number(skipped[1]) : undefined,
  }
}

function parseJest(output: string): ParsedOutput {
  const failures: TestFailure[] = []
  const lines = output.split('\n')
  let current: TestFailure | undefined
  const push = (): void => {
    if (current) failures.push(current)
    current = undefined
  }
  for (const line of lines) {
    const header = /^\s*[●●]\s+(.+)$/u.exec(line)
    if (header) {
      push()
      current = { testName: header[1]!.replaceAll('›', '>').trim(), message: '' }
      continue
    }
    if (current) {
      if (/^Tests:/u.test(line)) {
        push()
        continue
      }
      const trimmed = line.trim()
      if (trimmed.length > 0 && !trimmed.startsWith('at ')) {
        if (current.message.length < 500) current.message += `${current.message ? '\n' : ''}${trimmed}`
      }
    }
  }
  push()
  const summaryLine = lines.find((value) => /^Tests:/u.test(value))
  let summary: TestSummary | undefined
  if (summaryLine) {
    const failed = /(\d+)\s+failed/u.exec(summaryLine)
    const passed = /(\d+)\s+passed/u.exec(summaryLine)
    const skipped = /(\d+)\s+skipped/u.exec(summaryLine)
    summary = {
      failed: failed ? Number(failed[1]) : 0,
      passed: passed ? Number(passed[1]) : 0,
      skipped: skipped ? Number(skipped[1]) : undefined,
    }
  }
  return { summary, failures }
}

function parseNodeTest(output: string): ParsedOutput {
  const failures: TestFailure[] = []
  const lines = output.split('\n')
  let current: TestFailure | undefined
  let inErrorBlock = false
  // Node streams file-load diagnostics (`# (node:…) Warning …`, syntax
  // errors) BEFORE the `not ok` line; keep them pending and attach them to
  // the next failure.
  let pendingDiagnostics: string[] = []
  const push = (): void => {
    if (current) {
      if (current.message === '' && pendingDiagnostics.length > 0) {
        current.message = pendingDiagnostics.slice(0, 12).join('\n')
      }
      failures.push(current)
    }
    current = undefined
    inErrorBlock = false
    pendingDiagnostics = []
  }
  for (const line of lines) {
    const notOk = /^not ok\s+\d+\s+-\s+(.+)$/u.exec(line)
    if (notOk) {
      push()
      current = { testName: notOk[1]!.trim(), message: '' }
      continue
    }
    if (!current && /^#\s/u.test(line)) {
      const trimmed = line.replace(/^#\s?/u, '').trim()
      if (trimmed.length > 0) pendingDiagnostics.push(trimmed)
      continue
    }
    if (current && /^\s+(?:error|message):/u.test(line)) {
      inErrorBlock = true
      continue
    }
    if (current && inErrorBlock && /^\s{4,}/u.test(line)) {
      const trimmed = line.trim()
      if (trimmed.length > 0 && current.message.length < 500) current.message += `${current.message ? '\n' : ''}${trimmed}`
      continue
    }
    if (current && /^(?:ok\s+\d+|#\s|\d+\.\.\d+)/u.test(line)) push()
  }
  push()
  const count = (pattern: RegExp): number => {
    const line = lines.find((value) => pattern.test(value))
    const match = line ? pattern.exec(line) : undefined
    return match ? Number(match[1]) : 0
  }
  const tests = count(/^#\s+tests\s+(\d+)/u)
  const passed = count(/^#\s+pass\s+(\d+)/u)
  const failed = count(/^#\s+fail\s+(\d+)/u)
  const skipped = count(/^#\s+skip\s+(\d+)/u)
  return {
    summary: tests > 0 ? { passed, failed, skipped: skipped > 0 ? skipped : undefined } : undefined,
    failures,
  }
}

function parseMocha(output: string): ParsedOutput {
  const failures: TestFailure[] = []
  const lines = output.split('\n')
  let current: TestFailure | undefined
  const push = (): void => {
    if (current) failures.push(current)
    current = undefined
  }
  for (const line of lines) {
    // Two forms: `  1) suite: message` and the two-line `  1) suite` /
    // `       test name:` layout.
    const header = /^\s+\d+\)\s+(.+)$/u.exec(line)
    if (header) {
      push()
      current = { testName: header[1]!.trim().replace(/:$/, ''), message: '' }
      continue
    }
    if (current && current.message === '' && /^\s+.+:$/u.test(line)) {
      current.testName = `${current.testName} ${line.trim().replace(/:$/, '')}`
      continue
    }
    if (current) {
      if (/^\s+\d+\)\s/u.test(line)) {
        push()
        continue
      }
      const trimmed = line.trim()
      if (/^\d+\s+(?:passing|failing|pending)/u.test(trimmed)) {
        push()
        continue
      }
      if (trimmed.length > 0 && current.message.length < 500) current.message += `${current.message ? '\n' : ''}${trimmed}`
    }
  }
  push()
  const passing = /(\d+)\s+passing/u.exec(output)
  const failing = /(\d+)\s+failing/u.exec(output)
  const pending = /(\d+)\s+pending/u.exec(output)
  const summary: TestSummary | undefined = passing || failing
    ? {
        passed: passing ? Number(passing[1]) : 0,
        failed: failing ? Number(failing[1]) : 0,
        skipped: pending ? Number(pending[1]) : undefined,
      }
    : undefined
  return { summary, failures }
}
