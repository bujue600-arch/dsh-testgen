import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LlmHandle } from '../src/engine/generate-llm.ts'
import type { RunnerOptions } from '../src/engine/runner.ts'
import { countTests, mergeRequest, runTestgen } from '../src/engine/pipeline.ts'
import { ERROR_CODES } from '../src/errors.ts'
import { resolveConfig } from '../src/schema.ts'
import type { TestRun } from '../src/types.ts'

let dir: string
let config: ReturnType<typeof resolveConfig>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-testgen-pipe-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'math.ts'), 'export function add(a: number, b: number) { return a + b }\n')
  config = resolveConfig({})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeRun(overrides: Partial<TestRun>): TestRun {
  return {
    iteration: 0,
    framework: 'node-test',
    command: 'node --test',
    exitCode: 0,
    timedOut: false,
    summary: { passed: 1, failed: 0 },
    failures: [],
    durationMs: 5,
    output: '',
    ...overrides,
  }
}

describe('mergeRequest', () => {
  it('overlays request fields and parses provider/model', () => {
    const merged = mergeRequest(config, { target: 'x', runner: 'jest', generator: 'template', maxIterations: 0, autoRun: false, model: 'deepseek-official/deepseek-chat' })
    expect(merged.runner).toBe('jest')
    expect(merged.generator).toBe('template')
    expect(merged.maxIterations).toBe(0)
    expect(merged.autoRun).toBe(false)
    expect(merged.model).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
  })

  it('treats a bare model as the model id', () => {
    const merged = mergeRequest(config, { target: 'x', model: 'deepseek-chat' })
    expect(merged.model).toEqual({ provider: '', model: 'deepseek-chat' })
  })

  it('rejects invalid iteration bounds', () => {
    expect(() => mergeRequest(config, { target: 'x', maxIterations: -2 })).toThrowError(expect.objectContaining({ code: ERROR_CODES.INVALID_CONFIG }))
  })
})

describe('countTests', () => {
  it('counts it/test declarations', () => {
    expect(countTests('it("a", () => {})\nit("b", () => {})\ntest("c", () => {})')).toBe(3)
    expect(countTests('const x = 1')).toBe(0)
  })
})

describe('runTestgen — template generator', () => {
  it('generates smoke tests, runs them, and reports passed', async () => {
    const calls: RunnerOptions[] = []
    const report = await runTestgen(
      dir,
      { target: 'src/math.ts' },
      config,
      {
        runTests: async (options) => {
          calls.push(options)
          return makeRun({ summary: { passed: 2, failed: 0 }, exitCode: 0 })
        },
      },
    )
    expect(report.status).toBe('passed')
    expect(report.generated).toHaveLength(1)
    expect(report.generated[0]!.path).toBe('src/__tests__/math.test.mts')
    expect(report.generated[0]!.generator).toBe('template')
    expect(report.generated[0]!.framework).toBe('node-test')
    expect(report.stats).toEqual({ generatedFiles: 1, passed: 2, failed: 0, iterations: 1 })
    const written = readFileSync(join(dir, 'src', '__tests__', 'math.test.mts'), 'utf8')
    expect(written).toContain(`it('exports add', () => {`)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.files).toEqual(['src/__tests__/math.test.mts'])
  })

  it('reports failed without a fix loop in template mode', async () => {
    let calls = 0
    const report = await runTestgen(dir, { target: 'src/math.ts' }, config, {
      runTests: async () => {
        calls++
        return makeRun({ exitCode: 1, summary: { passed: 0, failed: 1 }, failures: [{ testName: 'math > add', message: 'boom' }] })
      },
    })
    expect(report.status).toBe('failed')
    expect(calls).toBe(1)
    expect(report.stats.iterations).toBe(1)
    expect(report.warnings.some((warning) => warning.includes('cannot self-fix'))).toBe(true)
  })

  it('skips generation when a test file already exists', async () => {
    mkdirSync(join(dir, 'src', '__tests__'), { recursive: true })
    writeFileSync(join(dir, 'src', '__tests__', 'math.test.mts'), '// user-authored')
    const report = await runTestgen(dir, { target: 'src/math.ts' }, config, {})
    expect(report.status).toBe('skipped')
    expect(report.generated).toHaveLength(0)
    expect(readFileSync(join(dir, 'src', '__tests__', 'math.test.mts'), 'utf8')).toBe('// user-authored')
  })

  it('honors autoRun: false', async () => {
    const report = await runTestgen(dir, { target: 'src/math.ts', autoRun: false }, config, {})
    expect(report.status).toBe('generated')
    expect(report.runs).toHaveLength(0)
  })

  it('skips unsupported languages with a warning', async () => {
    writeFileSync(join(dir, 'legacy.py'), 'def f():\n  pass\n')
    const report = await runTestgen(dir, { target: 'legacy.py' }, config, {})
    expect(report.status).toBe('skipped')
    expect(report.warnings.some((warning) => warning.includes('unsupported language'))).toBe(true)
  })

  it('propagates configuration errors', async () => {
    await expect(runTestgen(dir, { target: 'missing.ts' }, config, {})).rejects.toThrowError(expect.objectContaining({ code: ERROR_CODES.NO_TARGET }))
  })
})

function fakeLlm(answers: string[], calls: string[]): LlmHandle {
  let index = 0
  const stream = async function* () {
    const answer = answers[Math.min(index++, answers.length - 1)]!
    calls.push(answer)
    yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
    yield { type: 'text-delta' as const, index: 0, text: answer }
    yield { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text: answer } }
    yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
  }
  return {
    listProviders: () => [{ id: 'deepseek-official' }],
    listModels: async () => [{ id: 'deepseek-chat' }],
    stream: () => stream(),
  }
}

describe('runTestgen — LLM generator', () => {
  const passing = '```ts\nimport { it, expect } from "vitest"\nit("works", () => { expect(1).toBe(1) })\n```'
  const failing = '```ts\nimport { it, expect } from "vitest"\nit("broken", () => { expect(1).toBe(2) })\n```'

  it('fixes a failing suite within the iteration bound', async () => {
    const llmCalls: string[] = []
    const runs: TestRun[] = [
      makeRun({ exitCode: 1, failures: [{ testName: 'broken', message: 'expected 1 to be 2' }] }),
      makeRun({ exitCode: 0, summary: { passed: 1, failed: 0 } }),
    ]
    let runIndex = 0
    const report = await runTestgen(
      dir,
      { target: 'src/math.ts', generator: 'llm' },
      config,
      {
        llm: fakeLlm([failing, passing], llmCalls),
        runTests: async () => runs[runIndex++]!,
        writeFile: (path, data) => {
          mkdirSync(join(path, '..'), { recursive: true })
          writeFileSync(path, data)
        },
      },
    )
    expect(report.status).toBe('fixed')
    expect(report.stats.iterations).toBe(2)
    expect(llmCalls).toHaveLength(2)
    expect(llmCalls[1]).toContain('expect(1).toBe(1)')
  })

  it('stops at the iteration limit and reports failed', async () => {
    const report = await runTestgen(dir, { target: 'src/math.ts', generator: 'llm', maxIterations: 2 }, config, {
      llm: fakeLlm([failing, failing], []),
      runTests: async () => makeRun({ exitCode: 1, failures: [{ testName: 'broken', message: 'nope' }] }),
      writeFile: () => {},
      fileExists: (path) => !path.endsWith('math.test.mts'),
    })
    expect(report.status).toBe('failed')
    expect(report.stats.iterations).toBe(3)
    expect(report.warnings.some((warning) => warning.includes('iteration limit'))).toBe(true)
  })

  it('throws when pinned to llm with no LLM composed', async () => {
    await expect(runTestgen(dir, { target: 'src/math.ts', generator: 'llm' }, config, {})).rejects.toThrowError(
      expect.objectContaining({ code: ERROR_CODES.LLM_UNAVAILABLE }),
    )
  })

  it('falls back to template in auto mode with a warning when no LLM is composed', async () => {
    const report = await runTestgen(dir, { target: 'src/math.ts' }, config, { runTests: async () => makeRun({}) })
    expect(report.status).toBe('passed')
    expect(report.generated[0]!.generator).toBe('template')
    expect(report.warnings.some((warning) => warning.includes('template generator'))).toBe(true)
  })
})
