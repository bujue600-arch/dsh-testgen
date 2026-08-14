/**
 * Configuration schemas: the composition entry (schemastery) and the
 * user-facing settings namespace layered on top of it.
 *
 * Layering is schema defaults → composition `base` → user section
 * (`$DSH_HOME/settings.yaml` under the `testgen:` key), hot-reloaded by
 * `dsh-settings-file`; see `docs/config.md`.
 * @module dsh-testgen/schema
 */

import z from '@deepseek-ai/schemastery'
import type { TestgenConfig } from './types.ts'

const RUNNERS = ['auto', 'vitest', 'jest', 'node-test', 'mocha'] as const
const GENERATORS = ['auto', 'llm', 'template'] as const

export const RUNNER_VALUES: readonly string[] = RUNNERS
export const GENERATOR_VALUES: readonly string[] = GENERATORS

/** Shared shape for both the entry config and the settings namespace. */
function baseSchema() {
  return z.object({
    runner: z
      .union([z.const('auto'), z.const('vitest'), z.const('jest'), z.const('node-test'), z.const('mocha')])
      .default('auto')
      .description('Test framework: auto-detect or pin one.'),
    generator: z
      .union([z.const('auto'), z.const('llm'), z.const('template')])
      .default('auto')
      .description('Generator: LLM when available, deterministic template, or auto.'),
    maxIterations: z.number().min(0).max(20).default(3).description('Upper bound of the generate → run → fix loop.'),
    timeoutSec: z.number().min(1).max(600).default(120).description('Per-run wall-clock timeout in seconds.'),
    autoRun: z.boolean().default(true).description('Run the test suite after generation.'),
    includeGlobs: z.array(z.string()).default(['**/*.{ts,tsx,js,jsx}']).description('Candidate source globs.'),
    excludeGlobs: z
      .array(z.string())
      .default(['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/*.test.*', '**/*.spec.*', '**/__tests__/**'])
      .description('Globs that are never targets.'),
    testDir: z.string().default('__tests__').description('Directory receiving generated test files, relative to the target.'),
    model: z
      .object({
        provider: z.string().description('Provider route for generation calls.'),
        model: z.string().description('Model id for generation calls.'),
      })
      .description('Optional provider/model override for generation requests.'),
    maxSourceChars: z.number().min(1000).max(200000).default(60000).description('Source characters fed to the LLM per target.'),
  })
}

/** Composition entry config: every field defaults, validated at load. */
export const Config = baseSchema()

/** Settings namespace schema: same shape, no requiredness beyond defaults. */
export const SettingsSchema = baseSchema()

/** Normalize a partially-overridden resolved section into a full config. */
export function resolveConfig(value: unknown): TestgenConfig {
  // Schemastery validates and fills defaults; the cast records the runtime
  // guarantee that every field is present after resolution.
  const parsed = Config(value as never) as unknown as TestgenConfig
  // Schemastery materializes an absent optional object as {}; normalize it
  // away so consumers can rely on `model === undefined` meaning "unset".
  if (parsed.model && !parsed.model.provider && !parsed.model.model) {
    parsed.model = undefined
  }
  return parsed
}
