import { describe, expect, it } from 'vitest'
import { extractCodeBlock, generateTestSource, resolveModel } from '../src/engine/generate-llm.ts'
import type { LlmHandle } from '../src/engine/generate-llm.ts'
import { ERROR_CODES, TestgenError } from '../src/errors.ts'
import { resolveConfig } from '../src/schema.ts'

const config = resolveConfig({ model: { provider: 'deepseek-official', model: 'deepseek-chat' } })

function llmWith(answer: string, failFinish = false): LlmHandle {
  const stream = async function* () {
    yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
    yield { type: 'text-delta' as const, index: 0, text: answer }
    yield { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text: answer } }
    yield failFinish
      ? { type: 'finish' as const, reason: { kind: 'error' as const, failure: { message: 'rate limited', code: 'RATE_LIMIT' } } }
      : { type: 'finish' as const, reason: { kind: 'stop' as const } }
  }
  return {
    listProviders: () => [{ id: 'deepseek-official' }],
    listModels: async () => [{ id: 'deepseek-chat' }],
    stream: () => stream(),
  }
}

describe('extractCodeBlock', () => {
  it('extracts a fenced block', () => {
    const { code, fenced } = extractCodeBlock('Sure, here:\n```ts\nimport x from "x"\n```\nDone')
    expect(fenced).toBe(true)
    expect(code).toBe('import x from "x"')
  })

  it('falls back to the whole trimmed text', () => {
    const { code, fenced } = extractCodeBlock('import x from "x"')
    expect(fenced).toBe(false)
    expect(code).toBe('import x from "x"')
  })
})

describe('resolveModel', () => {
  it('uses the configured override', async () => {
    const resolved = await resolveModel(llmWith(''), config)
    expect(resolved).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
  })

  it('resolves the first provider and model without a configured override', async () => {
    const base = resolveConfig({})
    const resolved = await resolveModel(llmWith(''), base)
    expect(resolved).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
  })

  it('falls back to deepseek-chat when models cannot be listed', async () => {
    const handle: LlmHandle = {
      listProviders: () => [{ id: 'provider-x' }],
      listModels: async () => {
        throw new Error('unavailable')
      },
      stream: async function* () {},
    }
    const resolved = await resolveModel(handle, resolveConfig({}))
    expect(resolved).toEqual({ provider: 'provider-x', model: 'deepseek-chat' })
  })

  it('throws LLM_UNAVAILABLE when no provider exists', async () => {
    const handle: LlmHandle = { listProviders: () => [], listModels: async () => [], stream: async function* () {} }
    await expect(resolveModel(handle, resolveConfig({}))).rejects.toThrowError(expect.objectContaining({ code: ERROR_CODES.LLM_UNAVAILABLE }))
  })
})

describe('generateTestSource', () => {
  it('streams, assembles, and extracts the generated test code', async () => {
    const source = await generateTestSource(
      llmWith('```ts\nit("a", () => {})\n```'),
      { provider: 'deepseek-official', model: 'deepseek-chat' },
      'vitest',
      { path: 'src/math.ts', language: 'typescript' },
      'export const x = 1',
      config,
    )
    expect(source).toBe('it("a", () => {})')
  })

  it('rejects an empty model answer', async () => {
    await expect(
      generateTestSource(llmWith('   '), { provider: 'deepseek-official', model: 'deepseek-chat' }, 'vitest', { path: 'a.ts', language: 'typescript' }, 'x', config),
    ).rejects.toThrowError(expect.objectContaining({ code: ERROR_CODES.LLM_FAILED }))
  })

  it('rejects a stream that finishes with an error', async () => {
    await expect(
      generateTestSource(llmWith('code', true), { provider: 'deepseek-official', model: 'deepseek-chat' }, 'vitest', { path: 'a.ts', language: 'typescript' }, 'x', config),
    ).rejects.toThrowError(TestgenError)
  })

  it('truncates oversized sources to maxSourceChars', async () => {
    const bigSource = 'x'.repeat(config.maxSourceChars + 100)
    const handle = llmWith('```ts\nit("a", () => {})\n```')
    let seen = ''
    const wrapped: LlmHandle = {
      ...handle,
      stream: (options) => {
        seen = (options.messages[0]!.content[0] as { text: string }).text
        return handle.stream(options)
      },
    }
    await generateTestSource(wrapped, { provider: 'deepseek-official', model: 'deepseek-chat' }, 'vitest', { path: 'a.ts', language: 'typescript' }, bigSource, config)
    expect(seen).toContain('source truncated')
    expect(seen.length).toBeLessThan(bigSource.length + 500)
  })
})
