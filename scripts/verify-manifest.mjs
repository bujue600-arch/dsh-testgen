#!/usr/bin/env node
/**
 * Manifest verification: the release contract every `dsh plugin add`
 * depends on. Fails nonzero when any of the following break:
 *   - `dsh.bundle.patch` declares a patch file that exists on disk
 *   - `exports` maps the patch and the package.json themselves
 *   - `files` includes the built lib, the patch, README, and LICENSE
 *   - `prepare` builds so git-hosted installs (pnpm git deps) work
 * Run by `prepare` and CI.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let root = dirname(fileURLToPath(import.meta.url))
root = dirname(root)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const failures = []

const fail = (message) => failures.push(message)

// 1. dsh.bundle manifest
if (!pkg.dsh?.bundle || typeof pkg.dsh.bundle.patch !== 'string') {
  fail('package.json must declare `dsh.bundle.patch` (the profile composer resolves it, never code)')
} else {
  const patch = join(root, pkg.dsh.bundle.patch)
  if (!existsSync(patch)) fail(`dsh.bundle.patch points at ${pkg.dsh.bundle.patch}, which does not exist`)
}

// 2. exports map
for (const spec of ['./cordis.patch.yml', './package.json']) {
  if (pkg.exports?.[spec] !== spec) fail(`package.json exports must map ${JSON.stringify(spec)} to itself`)
}
if (!pkg.exports?.['.']?.types || !pkg.exports?.['.']?.default) {
  fail('package.json exports "." must provide `types` and `default` entries')
}

// 3. publish files
const files = pkg.files ?? []
for (const required of ['lib', 'cordis.patch.yml', 'LICENSE']) {
  if (!files.includes(required)) fail(`package.json files must include ${JSON.stringify(required)}`)
}
if (!files.includes('README.md') && !files.includes('README.zh.md')) {
  fail('package.json files must include at least one README')
}

// 4. prepare builds (git-hosted installs rely on it)
if (!pkg.scripts?.prepare) fail('package.json scripts must define `prepare` so git-hosted installs build')

// 5. engine + semver hygiene
if (pkg.engines?.node && !/^>=22/u.test(pkg.engines.node)) fail('engines.node must be >=22')
if (pkg.type !== 'module') fail('package.json type must be "module"')

if (failures.length > 0) {
  console.error('verify-manifest failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('verify-manifest ok')
