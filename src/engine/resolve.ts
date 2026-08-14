/**
 * Target resolution: turns user input (paths and globs) into concrete
 * source files, classifying each by language. Pure functions — no cordis
 * types — so the whole module is trivially unit-testable.
 * @module dsh-testgen/engine/resolve
 */

import { readdirSync, statSync, type Dirent } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import picomatch from 'picomatch'
import { TestgenError, ERROR_CODES } from '../errors.ts'
import type { SourceTarget, TargetLanguage, TestgenConfig } from '../types.ts'

const LANGUAGE_BY_EXT: Record<string, TargetLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript-jsx',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript-jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
}

/** Hard cap on walked files per invocation: a workspace walk must stay bounded. */
export const MAX_WALKED_FILES = 20000

/** Detect the coarse language of a file path by extension. */
export function languageOf(path: string): TargetLanguage {
  return LANGUAGE_BY_EXT[extname(path).toLowerCase()] ?? 'unknown'
}

/** Whether the path contains glob magic. */
export function hasGlobMagic(path: string): boolean {
  return /[*?[\]{}!()@+]/u.test(path)
}

/**
 * Walk `dir` depth-first, collecting file paths (relative to `root`,
 * `/`-separated) that match `include` and not `exclude`. Bounded by
 * {@link MAX_WALKED_FILES}; returns `{ files, truncated }`.
 */
export function walkFiles(root: string, include: (rel: string) => boolean, exclude: (rel: string) => boolean): { files: string[]; truncated: boolean } {
  const out: string[] = []
  let truncated = false
  const visit = (dir: string, rel: string): void => {
    if (out.length >= MAX_WALKED_FILES) {
      truncated = true
      return
    }
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory: skip
    }
    for (const entry of entries) {
      if (out.length >= MAX_WALKED_FILES) {
        truncated = true
        return
      }
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        // Cheap prune: never descend into excluded directories.
        if (exclude(`${childRel}/`)) continue
        visit(join(dir, entry.name), childRel)
      } else if (entry.isFile()) {
        if (exclude(childRel)) continue
        if (include(childRel)) out.push(childRel)
      }
    }
  }
  visit(root, '')
  return { files: out, truncated }
}

/**
 * Resolve user input to concrete, deduplicated source targets.
 *
 * - A bare file path bypasses `includeGlobs` (the user named it explicitly)
 *   but still honors `excludeGlobs`.
 * - A directory walks recursively under the include/exclude policy.
 * - A glob expands under the include/exclude policy.
 *
 * @param cwd - workspace root; relative input resolves against it.
 * @param raw - one target or several, as the user/agent typed them.
 * @param config - effective configuration.
 * @returns sorted, deduplicated targets; throws {@link TestgenError} with
 *   code `TESTGEN_NO_TARGET` when nothing matches.
 */
export function resolveTargets(cwd: string, raw: string | string[], config: TestgenConfig): SourceTarget[] {
  const inputs = (Array.isArray(raw) ? raw : [raw]).map((value) => value.trim()).filter((value) => value.length > 0)
  if (inputs.length === 0) {
    throw new TestgenError('no target given: pass a file path, directory, or glob', ERROR_CODES.NO_TARGET)
  }
  const include = picomatch(config.includeGlobs, { dot: true })
  const exclude = picomatch(config.excludeGlobs, { dot: true })
  const matches = (matcher: ReturnType<typeof picomatch>, rel: string): boolean => Boolean(matcher(rel))
  const found = new Map<string, SourceTarget>()
  let truncated = false

  for (const input of inputs) {
    const absoluteInput = isAbsolute(input) ? input : resolve(cwd, input)
    if (hasGlobMagic(input)) {
      const root = globRoot(absoluteInput)
      // Walk from the glob's static root, so the pattern must be restated
      // relative to that root (picomatch matches root-relative paths).
      const rootRel = normalize(relative(cwd, root))
      let patternRel = input.replaceAll('\\', '/')
      if (rootRel !== '.' && rootRel !== '' && patternRel.startsWith(`${rootRel}/`)) {
        patternRel = patternRel.slice(rootRel.length + 1)
      }
      const matcher = picomatch(patternRel, { dot: true })
      const walk = walkFiles(root, (rel: string) => matches(matcher, rel) && matches(include, rel), (rel: string) => matches(exclude, rel))
      truncated ||= walk.truncated
      for (const rel of walk.files) {
        addTarget(found, cwd, join(root, rel))
      }
      continue
    }
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(absoluteInput)
    } catch {
      throw new TestgenError(`target not found: ${input}`, ERROR_CODES.NO_TARGET)
    }
    if (stat.isFile()) {
      addTarget(found, cwd, absoluteInput, (rel: string) => matches(exclude, rel))
    } else if (stat.isDirectory()) {
      const walk = walkFiles(absoluteInput, (rel: string) => matches(include, rel), (rel: string) => matches(exclude, rel))
      truncated ||= walk.truncated
      for (const rel of walk.files) {
        addTarget(found, cwd, join(absoluteInput, rel))
      }
    } else {
      throw new TestgenError(`target is not a regular file or directory: ${input}`, ERROR_CODES.NO_TARGET)
    }
  }

  if (found.size === 0) {
    throw new TestgenError(
      `no source files matched ${inputs.map((input) => JSON.stringify(input)).join(', ')} under the include/exclude policy (see /testgen --help)`,
      ERROR_CODES.NO_TARGET,
    )
  }
  return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function addTarget(found: Map<string, SourceTarget>, cwd: string, absolute: string, exclude?: (rel: string) => boolean): void {
  if (exclude) {
    const rel = normalize(relative(cwd, absolute))
    if (exclude(rel)) return
  }
  if (found.has(absolute)) return
  found.set(absolute, {
    path: normalize(relative(cwd, absolute)),
    absolute,
    language: languageOf(absolute),
    sizeBytes: safeSize(absolute),
  })
}

function safeSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * Root directory for a glob: the prefix before the first magic segment.
 * Preserves POSIX leading separators and Windows drive letters — `path.join`
 * silently drops both.
 */
export function globRoot(absoluteGlob: string): string {
  const segments = absoluteGlob.split(/[\\/]+/u).filter((segment) => segment.length > 0)
  const root: string[] = []
  for (const segment of segments) {
    if (hasGlobMagic(segment)) break
    root.push(segment)
  }
  if (root.length === 0) return resolve('.')
  const joined = root.join('/')
  if (absoluteGlob.startsWith('/')) return `/${joined}`
  if (/^[A-Za-z]:/u.test(absoluteGlob)) return joined
  return resolve(joined)
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/')
}
