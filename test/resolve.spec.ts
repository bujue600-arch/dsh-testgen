import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { languageOf, hasGlobMagic, resolveTargets, walkFiles, globRoot } from '../src/engine/resolve.ts'
import { ERROR_CODES, TestgenError } from '../src/errors.ts'
import { resolveConfig } from '../src/schema.ts'

let dir: string
let config: ReturnType<typeof resolveConfig>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-testgen-'))
  mkdirSync(join(dir, 'src', 'nested'), { recursive: true })
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'src', 'math.ts'), 'export const x = 1')
  writeFileSync(join(dir, 'src', 'nested', 'util.ts'), 'export const y = 1')
  writeFileSync(join(dir, 'src', 'math.test.ts'), 'import { it } from "vitest"')
  writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1')
  writeFileSync(join(dir, 'component.tsx'), 'export default () => null')
  config = resolveConfig({})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('languageOf', () => {
  it('classifies by extension', () => {
    expect(languageOf('a.ts')).toBe('typescript')
    expect(languageOf('a.tsx')).toBe('typescript-jsx')
    expect(languageOf('a.mjs')).toBe('javascript')
    expect(languageOf('a.py')).toBe('unknown')
  })
})

describe('hasGlobMagic', () => {
  it('detects glob syntax', () => {
    expect(hasGlobMagic('src/**/*.ts')).toBe(true)
    expect(hasGlobMagic('src/math.ts')).toBe(false)
    expect(hasGlobMagic('src/{a,b}.ts')).toBe(true)
  })
})

describe('walkFiles', () => {
  it('walks, prunes excluded directories, and reports truncation', () => {
    const result = walkFiles(dir, () => true, (rel) => rel.startsWith('node_modules'))
    expect(result.files).toContain('src/math.ts')
    expect(result.files).toContain('src/nested/util.ts')
    expect(result.files.some((file) => file.startsWith('node_modules'))).toBe(false)
    expect(result.truncated).toBe(false)
  })
})

describe('globRoot', () => {
  it('preserves POSIX leading separators and Windows drive letters', () => {
    expect(globRoot('/tmp/project/src/**/*.ts')).toBe('/tmp/project/src')
    expect(globRoot('C:/work/project/src/**/*.ts')).toBe('C:/work/project/src')
    expect(globRoot('C:\\work\\project\\**\\*.ts')).toBe('C:/work/project')
  })
})

describe('resolveTargets', () => {
  it('resolves an explicit file path', () => {
    const targets = resolveTargets(dir, 'src/math.ts', config)
    expect(targets).toHaveLength(1)
    expect(targets[0]!.path).toBe('src/math.ts')
    expect(targets[0]!.language).toBe('typescript')
  })

  it('expands globs under include/exclude policy', () => {
    const targets = resolveTargets(dir, 'src/**/*.ts', config)
    const paths = targets.map((target) => target.path)
    expect(paths).toContain('src/math.ts')
    expect(paths).toContain('src/nested/util.ts')
    expect(paths.some((path) => path.includes('.test.'))).toBe(false)
  })

  it('walks a directory argument', () => {
    const targets = resolveTargets(dir, 'src', config)
    expect(targets.map((target) => target.path)).toEqual(['src/math.ts', 'src/nested/util.ts'])
  })

  it('still honors excludeGlobs for explicit paths', () => {
    expect(() => resolveTargets(dir, 'src/math.test.ts', config)).toThrow(TestgenError)
  })

  it('classifies tsx targets', () => {
    const targets = resolveTargets(dir, 'component.tsx', config)
    expect(targets[0]!.language).toBe('typescript-jsx')
  })

  it('throws TESTGEN_NO_TARGET for empty input and missing files', () => {
    expect(() => resolveTargets(dir, '  ', config)).toThrowError(expect.objectContaining({ code: ERROR_CODES.NO_TARGET }))
    expect(() => resolveTargets(dir, 'does/not/exist.ts', config)).toThrowError(expect.objectContaining({ code: ERROR_CODES.NO_TARGET }))
    expect(() => resolveTargets(dir, '*.py', config)).toThrowError(expect.objectContaining({ code: ERROR_CODES.NO_TARGET }))
  })

  it('deduplicates overlapping inputs', () => {
    const targets = resolveTargets(dir, ['src/math.ts', 'src/**/*.ts'], config)
    expect(targets.filter((target) => target.path === 'src/math.ts')).toHaveLength(1)
  })
})
