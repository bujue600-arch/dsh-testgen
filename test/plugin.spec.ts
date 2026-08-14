/**
 * Plugin lifecycle over the real cordis runtime: mount → services inject →
 * command and tool register → run the command handler end-to-end (against a
 * real fixture project and the real node:test runner) → unload →
 * registrations unwind.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { runTestgen } from '../src/engine/pipeline.ts'
import { resolveConfig } from '../src/schema.ts'

const fakeAgent = {} as Agent

async function boot() {
  const root = new Context()
  // ToolRuntime declares `static inject = ["systemPrompt"]`; provide a
  // minimal stand-in with an availability check so its service mounts.
  root.reflect.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} }, () => true)
  await root.plugin(CommandRuntime).await()
  await root.plugin(ToolRuntime).await()
  const fiber = root.plugin(plugin)
  await fiber.await()
  return { root, fiber }
}

describe('plugin lifecycle', () => {
  it('declares the cordis contract', () => {
    expect(plugin.name).toBe('testgen')
    expect(plugin.inject).toEqual(['commands', 'tools'])
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/u)
  })

  it('registers the command and tool on load, and unwinds both on unload', async () => {
    const { root, fiber } = await boot()
    const commands = root.commands.list(fakeAgent)
    expect(commands.map((command) => command.name)).toContain('testgen')
    expect(root.tools.get('generate_tests')).toBeDefined()

    await fiber.dispose()
    expect(root.commands.list(fakeAgent).map((command) => command.name)).not.toContain('testgen')
    expect(root.tools.get('generate_tests')).toBeUndefined()
  })

  it('runs the /testgen handler end-to-end through the registry', async () => {
    const { root, fiber } = await boot()
    const originalCwd = process.cwd()
    const dir = mkdtempSync(join(tmpdir(), 'dsh-testgen-e2e-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }))
    writeFileSync(join(dir, 'src', 'math.ts'), 'export function add(a: number, b: number) { return a + b }\n')
    process.chdir(dir)
    try {
      const definition = root.commands.find(fakeAgent, 'testgen')!
      const result = await definition.handler({
        commandId: 'cmd-1' as never,
        agent: fakeAgent,
        rawInput: 'src/math.ts',
        signal: new AbortController().signal,
      })
      expect(result.kind).toBe('success')
      if (result.kind === 'success') {
        expect(result.text).toContain('Testgen PASSED')
        expect(result.text).toContain('wrote src/__tests__/math.test.mts')
        expect(result.text).toContain('node-test')
      }
      const written = readFileSync(join(dir, 'src', '__tests__', 'math.test.mts'), 'utf8')
      expect(written).toContain(`it('exports add', () => {`)
    } finally {
      process.chdir(originalCwd)
      rmSync(dir, { recursive: true, force: true })
      await fiber.dispose()
    }
  }, 30000)

  it('reports usage errors as CommandResult errors', async () => {
    const { root, fiber } = await boot()
    try {
      const definition = root.commands.find(fakeAgent, 'testgen')!
      const result = await definition.handler({
        commandId: 'cmd-2' as never,
        agent: fakeAgent,
        rawInput: '',
        signal: new AbortController().signal,
      })
      expect(result.kind).toBe('error')
      if (result.kind === 'error') {
        expect(result.text).toContain('Usage: /testgen')
      }
    } finally {
      await fiber.dispose()
    }
  })

  it('validates its exported config through the schema', () => {
    const config = resolveConfig({ maxIterations: 7 })
    expect(config.maxIterations).toBe(7)
  })

  it('re-exports the engine entry points for advanced consumers', () => {
    expect(typeof runTestgen).toBe('function')
    expect(typeof plugin.parseExports).toBe('function')
    expect(typeof plugin.detectFramework).toBe('function')
  })
})
