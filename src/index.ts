/**
 * dsh-testgen — automated unit-test generation for DeepSeek Harness.
 *
 * Composition: one bundle patch row (`cordis.patch.yml`) mounts this plugin,
 * which registers the `/testgen` slash command and the `generate_tests`
 * model tool over one shared pipeline. Configuration layers as schema
 * defaults → composition entry → hot-reloaded `testgen:` settings section.
 * @module dsh-testgen
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { registerCommand } from './command.ts'
import { runTestgen, type EngineDeps } from './engine/pipeline.ts'
import type { LlmHandle } from './engine/generate-llm.ts'
import { resolveConfig } from './schema.ts'
import { setupSettings } from './settings.ts'
import { registerTool } from './tool.ts'
import type { TestgenConfig, TestgenReport, TestgenRequest } from './types.ts'

export const name = 'testgen'
export const inject = ['commands', 'tools'] as const

export const version = '1.0.0'

export { Config, SettingsSchema } from './schema.ts'
export { TestgenError, ERROR_CODES, isTestgenError, renderError } from './errors.ts'
export { runTestgen, mergeRequest, countTests, type EngineDeps, type PipelineLogger } from './engine/pipeline.ts'
export { parseExports, stripNoise, renderTestFile, testFilePathFor, type ParsedSymbol } from './engine/template.ts'
export { detectFramework, runTests, parseRunnerOutput, type ConcreteRunner } from './engine/runner.ts'
export { resolveTargets, languageOf, walkFiles } from './engine/resolve.ts'
export type { SourceTarget } from './types.ts'
export type * from './types.ts'

/** Services the plugin consumes opportunistically (never hard-injected). */
export interface TestgenApplyDeps {
  /** Optional LLM seam; when absent the template generator takes over. */
  llm?: LlmHandle
}

/**
 * Cordis plugin entry. The loader imports this module by package name and
 * calls `apply` with the composition entry's config.
 */
export function apply(ctx: Context, rawConfig: unknown) {
  const config = resolveConfig(rawConfig)
  const logger = ctx.logger?.(name)
  logger?.info('dsh-testgen v%s loading', version)

  const settings = setupSettings(ctx, config)
  const active = new Set<AbortController>()

  const engineDeps = (): EngineDeps => ({
    logger,
    llm: ctx.get('llm') as LlmHandle | undefined,
  })

  /** Workspace root for the slash command (the invoking directory). */
  const commandCwd = (): string => process.cwd()

  /** Workspace root for the model tool (the agent session's cwd). */
  const toolCwd = (agent: Agent | undefined): string => agent?.session.header.cwd ?? process.cwd()

  /**
   * Run the pipeline under a dispose-aware abort: an in-flight test run can
   * never outlive the plugin's fiber.
   */
  const run = async (cwd: string, request: TestgenRequest, external?: AbortSignal): Promise<TestgenReport> => {
    const controller = new AbortController()
    active.add(controller)
    const onExternalAbort = (): void => controller.abort()
    external?.addEventListener('abort', onExternalAbort, { once: true })
    try {
      return await runTestgen(cwd, request, settings.effective(), engineDeps(), controller.signal)
    } finally {
      active.delete(controller)
      external?.removeEventListener('abort', onExternalAbort)
    }
  }

  const disposeCommand = registerCommand(ctx, {
    effective: () => settings.effective(),
    run: (cwd, request, signal) => run(cwd, request, signal),
    cwd: commandCwd,
  })
  const disposeTool = registerTool(ctx, {
    effective: () => settings.effective(),
    run: (cwd, request, signal) => run(cwd, request, signal),
    cwd: toolCwd,
  })

  // Dispose-time abort (fiber effect): in-flight test runs must not
  // outlive the plugin's fiber, and the registrations unwind cleanly.
  ctx.effect(() => () => {
    logger?.info('dsh-testgen disposing: aborting %d in-flight run(s)', active.size)
    for (const controller of active) controller.abort()
    disposeCommand()
    disposeTool()
  })

  logger?.info('dsh-testgen ready: /testgen command and generate_tests tool registered')
}

export type { TestgenConfig }
