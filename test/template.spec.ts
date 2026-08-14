import { describe, expect, it } from 'vitest'
import { parseExports, stripNoise, renderTestFile, importSpecifierFor, testFilePathFor, testFileExtensionFor, generateTemplateTest } from '../src/engine/template.ts'
import type { SourceTarget } from '../src/types.ts'

const TARGET: SourceTarget = { path: 'src/math.ts', absolute: '/work/src/math.ts', language: 'typescript', sizeBytes: 0 }

describe('stripNoise', () => {
  it('removes line and block comments but keeps newlines', () => {
    const source = '// line comment\nexport function a() {} /* block */\nconst s = "// not a comment"\nexport const b = 1'
    const stripped = stripNoise(source)
    expect(stripped).not.toContain('line comment')
    expect(stripped).not.toContain('block')
    expect(stripped).toContain('export function a()')
    expect(stripped).not.toContain('not a comment')
    expect(stripped.split('\n')).toHaveLength(4)
  })

  it('handles escaped quotes and template literals', () => {
    const source = 'const a = "x \\" y"\nconst t = `t ${"inner"} end`\nexport const f = 1'
    const stripped = stripNoise(source)
    expect(stripped).toContain('export const f = 1')
    expect(stripped).not.toContain('inner')
  })
})

describe('parseExports', () => {
  it('finds functions, arrow consts, and classes; deduplicates', () => {
    const source = `
      export function add(a: number, b: number) { return a + b }
      export const double = (x: number) => x * 2
      export async function fetchIt(url: string) {}
      export class Widget {
        constructor(private name: string) {}
      }
      export default function main() {}
      // duplicate mention must not appear twice
      export { add }
    `
    const symbols = parseExports(source)
    expect(symbols.map((symbol) => symbol.name)).toEqual(['add', 'double', 'fetchIt', 'Widget', 'main'])
    expect(symbols[0]!.kind).toBe('function')
    expect(symbols[3]!.kind).toBe('class')
  })

  it('returns an empty list for files without exports (never throws)', () => {
    expect(parseExports('const hidden = 1\nfunction privateFn() {}')).toEqual([])
    expect(parseExports('')).toEqual([])
  })

  it('never throws on garbage input', () => {
    expect(() => parseExports('export \u0000\u0000 ??? [[')).not.toThrow()
  })
})

describe('renderTestFile', () => {
  it('emits framework-specific assertions', () => {
    const symbols = parseExports('export function add(a: number, b: number) { return a + b }')
    const vitest = renderTestFile(TARGET, symbols, 'vitest', '../math.ts')
    expect(vitest).toContain(`import { it, expect } from 'vitest'`)
    expect(vitest).toContain(`import * as mod from "../math.ts"`)
    expect(vitest).toContain(`it('exports add', () => {`)
    expect(vitest).toContain(`expect(typeof mod.add).toBe('function')`)

    const nodeTest = renderTestFile(TARGET, symbols, 'node-test', '../math.ts')
    expect(nodeTest).toContain(`import { it } from 'node:test'`)
    expect(nodeTest).toContain(`import assert from 'node:assert/strict'`)
    expect(nodeTest).toContain(`assert.equal(typeof mod.add, 'function')`)
  })

  it('emits a module-load smoke test when there are no exports', () => {
    const source = renderTestFile(TARGET, [], 'vitest', '../math.ts')
    expect(source).toContain(`it('module loads', () => {`)
  })
})

describe('paths', () => {
  it('computes test file paths next to the target under testDir', () => {
    expect(testFilePathFor(TARGET, '__tests__', 'vitest').replaceAll('\\', '/')).toBe('/work/src/__tests__/math.test.ts')
    expect(testFilePathFor(TARGET, '__tests__', 'node-test').replaceAll('\\', '/')).toBe('/work/src/__tests__/math.test.mts')
  })

  it('uses unconditionally-ESM extensions for node:test', () => {
    expect(testFileExtensionFor('node-test', 'typescript')).toBe('.test.mts')
    expect(testFileExtensionFor('node-test', 'javascript')).toBe('.test.mjs')
    expect(testFileExtensionFor('vitest', 'typescript')).toBe('.test.ts')
    expect(testFileExtensionFor('jest', 'typescript-jsx')).toBe('.test.tsx')
  })

  it('computes relative import specifiers', () => {
    expect(importSpecifierFor(TARGET, '/work/src/__tests__/math.test.ts')).toBe('../math.ts')
  })
})

describe('generateTemplateTest', () => {
  it('is pure for a missing source file', () => {
    const result = generateTemplateTest(TARGET, '__tests__', 'node-test')
    expect(result.testCount).toBe(1)
    expect(result.source).toContain(`it('module loads', () => {`)
  })
})
