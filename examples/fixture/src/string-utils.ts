/**
 * Demo source: a few pure string utilities with no tests.
 * `dsh-testgen` scaffolds smoke tests for every export below.
 */

/** Convert a kebab-case or space-separated string to camelCase. */
export function camelCase(input: string): string {
  return input
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part.toLowerCase() : part[0]!.toUpperCase() + part.slice(1).toLowerCase()))
    .join('')
}

/** Convert free text into a URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

/** Truncate a string to `max` characters, appending an ellipsis when cut. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  const suffix = '…'
  return `${input.slice(0, Math.max(0, max - suffix.length))}${suffix}`
}

/** Parse common boolean spellings; throws on anything unrecognized. */
export function parseBool(input: string): boolean {
  switch (input.trim().toLowerCase()) {
    case 'true':
    case 'yes':
    case '1':
    case 'on': return true
    case 'false':
    case 'no':
    case '0':
    case 'off': return false
    default: throw new Error(`not a boolean: ${JSON.stringify(input)}`)
  }
}
