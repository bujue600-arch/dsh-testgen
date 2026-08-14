/**
 * The `/testgen` slash command: human-facing grammar over the pipeline.
 * Command results render directly in the UI and never enter model history;
 * the `generate_tests` tool is the model-facing twin.
 * @module dsh-testgen/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { TestgenError, renderError } from './errors.ts'
import type { EngineDeps } from './engine/pipeline.ts'
import { renderReportJson, renderReportPlain } from './report.ts'
import { GENERATOR_VALUES, RUNNER_VALUES } from './schema.ts'
import type { TestgenConfig, TestgenReport, TestgenRequest } from './types.ts'

export type { EngineDeps }

export const USAGE = [
  'Usage: /testgen [options] <file-or-glob> [more targets…]',
  '',
  'Generate unit tests for the given files, run the project test runner,',
  'and fix failures until they pass (bounded by maxIterations).',
  '',
  'Options:',
  '  --runner <vitest|jest|node-test|mocha|auto>  framework (default: auto)',
  '  --generator <llm|template|auto>              generator (default: auto)',
  '  --iterations <n>                             fix-loop bound (default: 3)',
  '  --model <provider/model>                     generation model override',
  '  --no-run                                     generate only, do not run',
  '  --json                                       machine-readable report',
  '  -h, --help                                   show this help',
  '',
  'Examples:',
  '  /testgen src/utils/math.ts',
  '  /testgen --runner vitest "src/**/*.ts"',
  '  /testgen --generator template --no-run src/app.ts',
].join('\n')

export interface ParsedTestgenInput {
  help: boolean
  json: boolean
  request?: TestgenRequest
  error?: string
}

/** Parse the command's own grammar; unknown options and bad values fail loud. */
export function parseTestgenInput(rawInput: string): ParsedTestgenInput {
  const tokens = rawInput.trim().split(/\s+/u).filter((token) => token.length > 0)
  const target: string[] = []
  const request: Partial<TestgenRequest> = {}
  let help = false
  let json = false
  let noRun = false

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    switch (token) {
      case '--help':
      case '-h':
        help = true
        break
      case '--json':
        json = true
        break
      case '--no-run':
        noRun = true
        break
      case '--runner': {
        const value = tokens[++i]
        if (value === undefined || !RUNNER_VALUES.includes(value)) {
          return { help: false, json: false, error: `invalid --runner value: ${value ?? '(missing)'}; expected one of ${RUNNER_VALUES.join(', ')}` }
        }
        request.runner = value as TestgenRequest['runner']
        break
      }
      case '--generator': {
        const value = tokens[++i]
        if (value === undefined || !GENERATOR_VALUES.includes(value)) {
          return { help: false, json: false, error: `invalid --generator value: ${value ?? '(missing)'}; expected one of ${GENERATOR_VALUES.join(', ')}` }
        }
        request.generator = value as TestgenRequest['generator']
        break
      }
      case '--iterations': {
        const value = tokens[++i]
        const parsed = value === undefined ? Number.NaN : Number(value)
        if (!Number.isInteger(parsed) || parsed < 0) {
          return { help: false, json: false, error: `invalid --iterations value: ${value ?? '(missing)'}; expected a non-negative integer` }
        }
        request.maxIterations = parsed
        break
      }
      case '--model': {
        const value = tokens[++i]
        if (value === undefined) {
          return { help: false, json: false, error: 'missing value after --model; expected provider/model' }
        }
        request.model = value
        break
      }
      default:
        if (token.startsWith('--')) {
          return { help: false, json: false, error: `unknown option: ${token}` }
        }
        target.push(token)
    }
  }

  if (noRun) request.autoRun = false
  if (help) return { help: true, json: false }
  if (target.length === 0) return { help: false, json: false, error: 'no target given' }
  return { help: false, json, request: { target, ...request } }
}

export interface CommandDeps {
  effective(): TestgenConfig
  run(cwd: string, request: TestgenRequest, signal?: AbortSignal): Promise<TestgenReport>
  cwd(): string
}

/** Register the global `/testgen` command; returns the exact disposer. */
export function registerCommand(ctx: Context, deps: CommandDeps): () => void {
  return ctx.commands.register({
    name: 'testgen',
    description: 'Generate unit tests for a file or glob, run them, and fix failures until they pass.',
    input: { hint: '[options] <file-or-glob>' },
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const parsed = parseTestgenInput(invocation.rawInput)
      if (parsed.help) return { kind: 'success', text: USAGE }
      if (parsed.error || !parsed.request) return { kind: 'error', text: `${parsed.error ?? 'missing target'}\n\n${USAGE}` }
      const logger = ctx.logger?.('testgen')
      logger?.info('/testgen %s', invocation.rawInput.trim())
      try {
        const report = await deps.run(deps.cwd(), parsed.request, invocation.signal)
        logger?.info('/testgen finished: %s (%d file(s), %d run(s))', report.status, report.stats.generatedFiles, report.stats.iterations)
        return { kind: 'success', text: parsed.json ? renderReportJson(report) : renderReportPlain(report) }
      } catch (error) {
        if (error instanceof TestgenError) {
          return { kind: 'error', text: `${error.message}\n\n${USAGE}` }
        }
        logger?.error('/testgen failed: %s', renderError(error))
        return { kind: 'error', text: renderError(error) }
      }
    },
  })
}
