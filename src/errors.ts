/**
 * Stable machine-routable error taxonomy for the plugin.
 *
 * Codes are the contract: surfaces render {@link TestgenError.message} for
 * humans and route on `code` for machines. The class extends the shared
 * harness base so tool results and logs keep the failure class.
 * @module dsh-testgen/errors
 */

import { HarnessError, errorChain } from '@deepseek-ai/dsh-llm'

export const ERROR_CODES = {
  /** User input matched no source file under the include/exclude policy. */
  NO_TARGET: 'TESTGEN_NO_TARGET',
  /** The target's language has no deterministic template generator (LLM-only). */
  UNSUPPORTED_LANGUAGE: 'TESTGEN_UNSUPPORTED_LANGUAGE',
  /** No usable test runner could be detected or selected. */
  NO_RUNNER: 'TESTGEN_NO_RUNNER',
  /** The configured runner exists but the invocation itself failed to start. */
  RUNNER_START_FAILED: 'TESTGEN_RUNNER_START_FAILED',
  /** Generation was requested from the LLM but no LLM service is composed. */
  LLM_UNAVAILABLE: 'TESTGEN_LLM_UNAVAILABLE',
  /** The LLM call failed or produced nothing usable. */
  LLM_FAILED: 'TESTGEN_LLM_FAILED',
  /** A configured value failed validation. */
  INVALID_CONFIG: 'TESTGEN_INVALID_CONFIG',
} as const

export type TestgenErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** Plugin error with a stable code and optional cause chain. */
export class TestgenError extends HarnessError {
  constructor(message: string, code: TestgenErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'TestgenError'
  }
}

/** Narrow an arbitrary thrown value to a {@link TestgenError}. */
export function isTestgenError(value: unknown): value is TestgenError {
  return value instanceof TestgenError
}

/** Human-readable rendering of any thrown value, error chain included. */
export function renderError(value: unknown): string {
  if (value instanceof Error) return errorChain(value)
  return String(value)
}
