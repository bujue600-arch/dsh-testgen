/**
 * LLM generator: prompt, stream, and extract complete test files from the
 * harness's `ctx.llm` seam. The LLM is optional — when it is absent the
 * deterministic template generator takes over; this module only defines the
 * LLM path and its error contract.
 * @module dsh-testgen/engine/generate-llm
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { TestgenError, ERROR_CODES } from '../errors.ts'
import type { TestgenConfig, TestRun } from '../types.ts'

/** The slice of `ctx.llm` the generator consumes (structurally compatible). */
export interface LlmHandle {
  listProviders(): readonly { id: string }[]
  listModels(provider: string): Promise<readonly { id: string }[]>
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** Resolved provider/model pair for generation calls. */
export interface ResolvedModel {
  provider: string
  model: string
}

function generationSystem(framework: string, role: 'generate' | 'fix'): string {
  const base = [
    'You are an expert unit-test author for a coding-agent harness.',
    `You write ${framework} test files. Rules:`,
    '- Emit ONE complete test file, nothing else.',
    '- Output the entire file inside a single fenced code block tagged with the file language (ts/js/tsx/jsx).',
    '- Cover exported APIs: happy paths, edge cases, and error paths where cheap.',
    '- Do not modify production source. Only the test file exists in your answer.',
    '- No prose outside the code block; no markdown headers.',
  ]
  if (role === 'fix') {
    base.push('- The runner reported failures: keep passing tests untouched and rewrite only what is wrong.')
  }
  return base.join('\n')
}

/** Resolve the provider/model used for generation, or throw when none exists. */
export async function resolveModel(llm: LlmHandle, config: TestgenConfig): Promise<ResolvedModel> {
  if (config.model?.model) {
    // A configured provider wins; a bare model id rides the first adapter.
    const provider = config.model.provider || llm.listProviders()[0]?.id
    if (!provider) {
      throw new TestgenError('no LLM adapter composed — the LLM generator cannot run', ERROR_CODES.LLM_UNAVAILABLE)
    }
    return { provider, model: config.model.model }
  }
  const providers = llm.listProviders()
  if (providers.length === 0) {
    throw new TestgenError('no LLM adapter composed — the LLM generator cannot run', ERROR_CODES.LLM_UNAVAILABLE)
  }
  const provider = providers[0]!.id
  let model = ''
  try {
    const models = await llm.listModels(provider)
    model = models[0]?.id ?? ''
  } catch {
    model = ''
  }
  return { provider, model: model || 'deepseek-chat' }
}

/** Extract one code block (or the whole text) from a model answer. */
export function extractCodeBlock(text: string): { code: string; fenced: boolean } {
  const fence = /```(?:ts|typescript|tsx|js|javascript|jsx)?\s*\r?\n([\s\S]*?)```/u.exec(text)
  if (fence?.[1]) return { code: fence[1].trim(), fenced: true }
  return { code: text.trim(), fenced: false }
}

async function streamText(llm: LlmHandle, options: GenerateOptions): Promise<string> {
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream(options)) {
    assembler.push(chunk)
  }
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new TestgenError(`generation request failed: ${finish.failure.message} (${finish.failure.code})`, ERROR_CODES.LLM_FAILED)
  }
  const text = assembler
    .blocks()
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
  if (text.length === 0) {
    throw new TestgenError('model returned no test code', ERROR_CODES.LLM_FAILED)
  }
  return text
}

/**
 * Generate one test file for a target through the LLM.
 * @returns the extracted test source.
 */
export async function generateTestSource(
  llm: LlmHandle,
  resolved: ResolvedModel,
  framework: string,
  target: { path: string; language: string },
  source: string,
  config: TestgenConfig,
  signal?: AbortSignal,
): Promise<string> {
  const truncated = source.length > config.maxSourceChars ? `${source.slice(0, config.maxSourceChars)}\n// … source truncated by dsh-testgen (maxSourceChars) …` : source
  const options: GenerateOptions = {
    provider: resolved.provider,
    model: resolved.model,
    system: generationSystem(framework, 'generate'),
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: `Target: ${target.path} (${target.language})\n\nWrite a complete ${framework} unit-test file for this module:\n\n${truncated}` }],
        source: { kind: 'user' },
      }),
    ],
    temperature: 0.2,
    signal,
  }
  const text = await streamText(llm, options)
  return extractCodeBlock(text).code
}

/**
 * Regenerate a failing test file through the LLM.
 * @returns the corrected test source.
 */
export async function fixTestSource(
  llm: LlmHandle,
  resolved: ResolvedModel,
  framework: string,
  testPath: string,
  currentSource: string,
  run: TestRun,
  config: TestgenConfig,
  signal?: AbortSignal,
): Promise<string> {
  const failureText = run.failures
    .slice(0, 20)
    .map((failure) => {
      const head = failure.testName ? `- ${failure.testName}` : '- (unnamed test)'
      return `${head}\n${failure.message}`
    })
    .join('\n\n')
  const options: GenerateOptions = {
    provider: resolved.provider,
    model: resolved.model,
    system: generationSystem(framework, 'fix'),
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: [
          `The test file ${testPath} failed under ${framework}.`,
          'Current test file:',
          '```',
          currentSource.slice(0, config.maxSourceChars),
          '```',
          'Runner failures:',
          failureText || `exit code ${String(run.exitCode)}`,
          '',
          'Return the corrected COMPLETE test file in one fenced code block.',
        ].join('\n') }],
        source: { kind: 'user' },
      }),
    ],
    temperature: 0.2,
    signal,
  }
  const text = await streamText(llm, options)
  return extractCodeBlock(text).code
}
