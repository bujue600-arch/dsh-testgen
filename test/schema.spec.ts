import { describe, expect, it } from 'vitest'
import { SettingsSchema, resolveConfig } from '../src/schema.ts'
import { TestgenError, ERROR_CODES } from '../src/errors.ts'

describe('Config schema', () => {
  it('fills every default when given an empty object', () => {
    const config = resolveConfig({})
    expect(config).toMatchObject({
      runner: 'auto',
      generator: 'auto',
      maxIterations: 3,
      timeoutSec: 120,
      autoRun: true,
      includeGlobs: ['**/*.{ts,tsx,js,jsx}'],
      testDir: '__tests__',
      maxSourceChars: 60000,
    })
    expect(config.excludeGlobs).toContain('**/node_modules/**')
    expect(config.excludeGlobs).toContain('**/*.test.*')
  })

  it('preserves explicit values', () => {
    const config = resolveConfig({ runner: 'vitest', generator: 'template', maxIterations: 0, timeoutSec: 30 })
    expect(config.runner).toBe('vitest')
    expect(config.generator).toBe('template')
    expect(config.maxIterations).toBe(0)
    expect(config.timeoutSec).toBe(30)
  })

  it('rejects invalid enum values loudly', () => {
    expect(() => resolveConfig({ runner: 'pytest' })).toThrow()
  })

  it('rejects out-of-range numeric values', () => {
    expect(() => resolveConfig({ maxIterations: -1 })).toThrow()
    expect(() => resolveConfig({ maxIterations: 99 })).toThrow()
    expect(() => resolveConfig({ timeoutSec: 0 })).toThrow()
  })

  it('accepts an optional model override', () => {
    const config = resolveConfig({ model: { provider: 'deepseek-official', model: 'deepseek-chat' } })
    expect(config.model).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
  })

  it('exposes the same shape for the settings namespace', () => {
    const parsed = SettingsSchema({ maxIterations: 5 } as never) as unknown as { maxIterations: number }
    expect(parsed.maxIterations).toBe(5)
  })
})

describe('TestgenError', () => {
  it('carries a stable code', () => {
    const error = new TestgenError('boom', ERROR_CODES.NO_TARGET)
    expect(error.code).toBe('TESTGEN_NO_TARGET')
    expect(error.name).toBe('TestgenError')
    expect(error).toBeInstanceOf(Error)
  })
})
