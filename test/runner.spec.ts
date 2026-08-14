import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectFramework, resolveRunnerEntry, parseRunnerOutput, runTests, type SpawnImpl, type SpawnHandle } from '../src/engine/runner.ts'
import { ERROR_CODES } from '../src/errors.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-testgen-runner-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writePackage(deps: Record<string, string>) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: deps }))
}

describe('detectFramework', () => {
  it('honors an explicit pin', () => {
    expect(detectFramework(dir, 'mocha')).toBe('mocha')
  })

  it('detects by declared dependency', () => {
    writePackage({ vitest: '^3.0.0' })
    expect(detectFramework(dir, 'auto')).toBe('vitest')
    writePackage({ jest: '^29.0.0' })
    expect(detectFramework(dir, 'auto')).toBe('jest')
    writePackage({ mocha: '^11.0.0' })
    expect(detectFramework(dir, 'auto')).toBe('mocha')
  })

  it('falls back to node:test without any runner dependency', () => {
    writePackage({ typescript: '^5.0.0' })
    expect(detectFramework(dir, 'auto')).toBe('node-test')
  })
})

describe('resolveRunnerEntry', () => {
  it('resolves node-test without any filesystem requirement', () => {
    expect(resolveRunnerEntry(dir, 'node-test')).toEqual({ argv: [], command: 'node --test' })
  })

  it('fails loud when a declared runner package is not installed', () => {
    writePackage({ vitest: '^3.0.0' })
    expect(() => resolveRunnerEntry(dir, 'vitest')).toThrowError(expect.objectContaining({ code: ERROR_CODES.RUNNER_START_FAILED }))
  })
})

describe('parseRunnerOutput', () => {
  it('parses vitest basic reporter failures and summary', () => {
    const output = [
      ' ✓ src/math.test.ts (1 test) 4ms',
      ' ❯ src/math.test.ts > math > add (1)',
      'AssertionError: expected 2 to be 3',
      ' ❯ src/math.test.ts:8:12',
      '',
      ' Test Files  1 failed (1)',
      '      Tests  1 failed | 1 passed (2)',
    ].join('\n')
    const parsed = parseRunnerOutput('vitest', output, 1)
    expect(parsed.summary).toEqual({ failed: 1, passed: 1, skipped: undefined })
    expect(parsed.failures).toHaveLength(1)
    expect(parsed.failures[0]!.file).toBe('src/math.test.ts')
    expect(parsed.failures[0]!.testName).toBe('math > add (1)')
    expect(parsed.failures[0]!.message).toContain('expected 2 to be 3')
  })

  it('parses jest failures and summary', () => {
    const output = [
      ' FAIL  src/math.test.ts',
      '  ● math › add',
      '',
      '    expect(received).toBe(expected)',
      '',
      '      at Object.<anonymous> (src/math.test.ts:3:10)',
      '',
      'Tests:       1 failed, 2 passed, 3 total',
    ].join('\n')
    const parsed = parseRunnerOutput('jest', output, 1)
    expect(parsed.summary).toEqual({ failed: 1, passed: 2, skipped: undefined })
    expect(parsed.failures[0]!.testName).toBe('math > add')
    expect(parsed.failures[0]!.message).toContain('expect(received).toBe(expected)')
  })

  it('parses node:test TAP output', () => {
    const output = [
      'TAP version 13',
      'ok 1 - math > add',
      'not ok 2 - math > divide',
      '  ---',
      '  error: |-',
      '    expected 1 to be 2',
      '  ...',
      '1..2',
      '# tests 2',
      '# pass 1',
      '# fail 1',
    ].join('\n')
    const parsed = parseRunnerOutput('node-test', output, 1)
    expect(parsed.summary).toEqual({ passed: 1, failed: 1, skipped: undefined })
    expect(parsed.failures).toHaveLength(1)
    expect(parsed.failures[0]!.testName).toBe('math > divide')
    expect(parsed.failures[0]!.message).toContain('expected 1 to be 2')
  })

  it('parses mocha failures and summary', () => {
    const output = [
      '  1) math',
      '       add:',
      '     Error: boom',
      '',
      '  2 passing (10ms)',
      '  1 failing',
    ].join('\n')
    const parsed = parseRunnerOutput('mocha', output, 1)
    expect(parsed.summary).toEqual({ passed: 2, failed: 1, skipped: undefined })
    expect(parsed.failures[0]!.testName).toBe('math add')
    expect(parsed.failures[0]!.message).toContain('Error: boom')
  })

  it('synthesizes a failure when the runner fails without a parsable report', () => {
    const parsed = parseRunnerOutput('vitest', 'Killed by signal', null)
    expect(parsed.failures).toHaveLength(1)
    expect(parsed.failures[0]!.message).toContain('exited with code null')
  })

  it('reports a clean run', () => {
    const parsed = parseRunnerOutput('vitest', ' ✓ a.test.ts (2 tests)\n Tests  2 passed (2)', 0)
    expect(parsed.summary).toEqual({ failed: 0, passed: 2, skipped: undefined })
    expect(parsed.failures).toHaveLength(0)
  })
})

describe('runTests', () => {
  it('runs node:test through a spawn and parses the result', async () => {
    const spawnImpl: SpawnImpl = (command, argv, options) => {
      expect(command).toBe(process.execPath)
      expect(argv).toEqual(['--test', 'a.test.ts'])
      expect(options.cwd).toBe(dir)
      const listeners: { exit: ((code: number | null) => void)[]; error: ((error: Error) => void)[] } = { exit: [], error: [] }
      const handle = {
        kill() {},
        on(event: 'exit' | 'error', listener: never) {
          (listeners as never as { exit: never[]; error: never[] })[event].push(listener)
          return undefined
        },
        stdout: {
          on(_event: 'data', listener: (chunk: Buffer) => void) {
            // Real runners emit output during the run, before exiting:
            // deliver the TAP report synchronously on subscribe.
            listener(Buffer.from('ok 1 - math > add\n# tests 1\n# pass 1\n# fail 0\n'))
            return undefined
          },
        },
        stderr: { on() { return undefined } },
      } as never as SpawnHandle
      setTimeout(() => listeners.exit.forEach((listener) => listener(0)), 1)
      return handle
    }
    const run = await runTests({ cwd: dir, files: ['a.test.ts'], framework: 'node-test', timeoutMs: 5000, spawnImpl })
    expect(run.exitCode).toBe(0)
    expect(run.summary).toEqual({ passed: 1, failed: 0, skipped: undefined })
    expect(run.failures).toHaveLength(0)
    expect(run.command).toBe('node --test "a.test.ts"')
  })

  it('rejects when the runner fails to start', async () => {
    const spawnImpl: SpawnImpl = () => {
      const handle = {
        kill() {},
        on(event: 'exit' | 'error', listener: never) {
          if (event === 'error') setTimeout(() => (listener as (error: Error) => void)(new Error('ENOENT')), 0)
          return undefined
        },
        stdout: { on() { return undefined } },
        stderr: { on() { return undefined } },
      } as never as SpawnHandle
      return handle
    }
    await expect(runTests({ cwd: dir, files: ['a.test.ts'], framework: 'node-test', timeoutMs: 5000, spawnImpl }))
      .rejects.toThrowError(expect.objectContaining({ code: ERROR_CODES.RUNNER_START_FAILED }))
  })

  it('times out and kills a hung run', async () => {
    const killed: string[] = []
    const spawnImpl: SpawnImpl = () => {
      const handle = {
        kill() {
          killed.push('kill')
        },
        on(event: 'exit' | 'error', listener: never) {
          if (event === 'exit') setTimeout(() => (listener as (code: number | null) => void)(null), 2000)
          return undefined
        },
        stdout: { on() { return undefined } },
        stderr: { on() { return undefined } },
      } as never as SpawnHandle
      return handle
    }
    const run = await runTests({ cwd: dir, files: ['a.test.ts'], framework: 'node-test', timeoutMs: 10, spawnImpl })
    expect(run.timedOut).toBe(true)
    expect(killed).toContain('kill')
  })
})
