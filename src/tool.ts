/**
 * The `generate_tests` model tool: the agent-facing twin of `/testgen`.
 * Same pipeline, structured JSON output, cooperative cancellation, and an
 * explicit "never parallel" concurrency classification (test runs mutate
 * files).
 * @module dsh-testgen/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { renderError } from './errors.ts'
import { renderReportPlain } from './report.ts'
import { GENERATOR_VALUES, RUNNER_VALUES } from './schema.ts'
import type { TestgenConfig, TestgenReport, TestgenRequest } from './types.ts'

/** Canonical output schema — the JSON projection of {@link TestgenReport}. */
const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['passed', 'fixed', 'generated', 'failed', 'skipped'] },
    targets: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          language: { type: 'string', required: true },
        },
      },
    },
    generated: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          framework: { type: 'string', required: true },
          generator: { type: 'string', required: true },
          testCount: { type: 'integer', required: true },
          contentBytes: { type: 'integer', required: true },
        },
      },
    },
    runs: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          iteration: { type: 'integer', required: true },
          framework: { type: 'string', required: true },
          command: { type: 'string', required: true },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          timedOut: { type: 'boolean', required: true },
          summary: {
            type: 'object',
            additionalProperties: false,
            properties: {
              passed: { type: 'integer', required: true },
              failed: { type: 'integer', required: true },
              skipped: { type: 'integer' },
            },
          },
          failures: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                testName: { type: 'string' },
                file: { type: 'string' },
                message: { type: 'string', required: true },
              },
            },
          },
          durationMs: { type: 'integer', required: true },
        },
      },
    },
    warnings: { type: 'array', required: true, items: { type: 'string' } },
    stats: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        generatedFiles: { type: 'integer', required: true },
        passed: { type: 'integer', required: true },
        failed: { type: 'integer', required: true },
        iterations: { type: 'integer', required: true },
      },
    },
    elapsedMs: { type: 'integer', required: true },
  },
} satisfies ValueSchemaSpec

type ToolReport = {
  status: string
  targets: { path: string; language: string }[]
  generated: { path: string; framework: string; generator: string; testCount: number; contentBytes: number }[]
  runs: {
    iteration: number
    framework: string
    command: string
    exitCode: number | null
    timedOut: boolean
    summary?: { passed: number; failed: number; skipped?: number }
    failures: { testName?: string; file?: string; message: string }[]
    durationMs: number
  }[]
  warnings: string[]
  stats: { generatedFiles: number; passed: number; failed: number; iterations: number }
  elapsedMs: number
}

/** Drop the bulky raw runner output before the value crosses the wire. */
function sanitizeReport(report: TestgenReport): ToolReport {
  return {
    status: report.status,
    targets: report.targets,
    generated: report.generated,
    runs: report.runs.map((run) => ({
      iteration: run.iteration,
      framework: run.framework,
      command: run.command,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      summary: run.summary,
      failures: run.failures,
      durationMs: run.durationMs,
    })),
    warnings: report.warnings,
    stats: report.stats,
    elapsedMs: report.elapsedMs,
  }
}

export interface ToolDeps {
  effective(): TestgenConfig
  run(cwd: string, request: TestgenRequest, signal?: AbortSignal): Promise<TestgenReport>
  cwd(agent: Agent | undefined): string
}

/** Register the `generate_tests` tool; returns the exact disposer. */
export function registerTool(ctx: Context, deps: ToolDeps): () => void {
  const logger = ctx.logger?.('testgen')
  return ctx.tools.register(defineTool({
    name: 'generate_tests',
    description: [
      'Generate unit tests for source files in the agent workspace. Scaffolds test files (behavioral tests through the LLM when available, deterministic structural smoke tests otherwise), runs the project test runner, and fixes failures up to maxIterations. Returns a structured report; does not modify production source.',
    ].join(' '),
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'File path, directory, or glob relative to the workspace root, e.g. "src/utils/math.ts" or "src/**/*.ts".',
      },
      runner: {
        type: 'string',
        enum: [...RUNNER_VALUES],
        description: 'Test framework to run; default auto-detects from the project (vitest, jest, mocha, else node:test).',
      },
      generator: {
        type: 'string',
        enum: [...GENERATOR_VALUES],
        description: 'llm (behavioral tests), template (deterministic smoke tests), or auto.',
      },
      maxIterations: {
        type: 'integer',
        description: 'Upper bound of the generate-run-fix loop; defaults to the configured value.',
      },
      autoRun: {
        type: 'boolean',
        description: 'Whether to run the suite after generation; defaults to true.',
      },
      model: {
        type: 'string',
        description: 'Provider/model override for generation calls, e.g. "deepseek-official/deepseek-chat".',
      },
    },
    output: {
      schema: REPORT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderReportPlain(value as unknown as TestgenReport) }],
    },
    timeoutMs: 300000,
    isConcurrencySafe: () => false,
    presentCall: (args) => ({ card: 'generic', title: 'Generate tests', kind: 'other', rawInput: args.target }),
    async execute(args, exec) {
      const request: TestgenRequest = {
        target: args.target,
        runner: args.runner as TestgenRequest['runner'],
        generator: args.generator as TestgenRequest['generator'],
        maxIterations: args.maxIterations,
        autoRun: args.autoRun,
        model: args.model,
      }
      logger?.info('generate_tests(%s) from agent workspace', args.target)
      try {
        const report = await deps.run(deps.cwd(exec.agent), request, exec.signal)
        logger?.info('generate_tests finished: %s', report.status)
        return sanitizeReport(report)
      } catch (error) {
        logger?.error('generate_tests failed: %s', renderError(error))
        throw error
      }
    },
  }))
}
