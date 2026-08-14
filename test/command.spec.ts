import { describe, expect, it } from 'vitest'
import { parseTestgenInput } from '../src/command.ts'

describe('parseTestgenInput', () => {
  it('parses a plain target', () => {
    const parsed = parseTestgenInput('src/math.ts')
    expect(parsed.error).toBeUndefined()
    expect(parsed.request).toEqual({ target: ['src/math.ts'] })
  })

  it('parses multiple targets', () => {
    const parsed = parseTestgenInput('src/math.ts src/util.ts')
    expect(parsed.request!.target).toEqual(['src/math.ts', 'src/util.ts'])
  })

  it('parses every option', () => {
    const parsed = parseTestgenInput('--runner vitest --generator llm --iterations 5 --model deepseek-official/deepseek-chat --no-run --json src/**')
    expect(parsed.request).toEqual({
      target: ['src/**'],
      runner: 'vitest',
      generator: 'llm',
      maxIterations: 5,
      model: 'deepseek-official/deepseek-chat',
      autoRun: false,
    })
    expect(parsed.json).toBe(true)
  })

  it('handles help without a target', () => {
    const parsed = parseTestgenInput('--help')
    expect(parsed.help).toBe(true)
    expect(parsed.request).toBeUndefined()
  })

  it('rejects unknown options and bad values', () => {
    expect(parseTestgenInput('--bogus x').error).toContain('unknown option')
    expect(parseTestgenInput('--runner pytest x').error).toContain('invalid --runner')
    expect(parseTestgenInput('--iterations -1 x').error).toContain('invalid --iterations')
    expect(parseTestgenInput('--model').error).toContain('missing value')
  })

  it('requires a target', () => {
    expect(parseTestgenInput('--json').error).toBe('no target given')
    expect(parseTestgenInput('').error).toBe('no target given')
  })
})
