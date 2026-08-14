#!/usr/bin/env node
/**
 * End-to-end demo: boots the plugin over the real cordis runtime, runs the
 * `/testgen` command against `examples/fixture` with the deterministic
 * template generator, and prints the exact command result. The test runner
 * (`node --test`) is a real child process — no mocks anywhere.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.mjs'

const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'fixture')
mkdirSync(join(fixture, 'src'), { recursive: true })
// Keep the demo idempotent: always start from an untested fixture.
rmSync(join(fixture, 'src', '__tests__'), { recursive: true, force: true })

const root = new Context()
root.reflect.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} }, () => true)
await root.plugin(CommandRuntime).await()
await root.plugin(ToolRuntime).await()
const pluginFiber = root.plugin(plugin, { generator: 'template' })
await pluginFiber.await()

const agent = {}
const definition = root.commands.find(agent, 'testgen')
if (!definition) {
  console.error('demo failed: /testgen command not registered')
  process.exit(1)
}

const originalCwd = process.cwd()
process.chdir(fixture)
try {
  const result = await definition.handler({
    commandId: 'demo-1',
    agent,
    rawInput: 'src/string-utils.ts',
    signal: new AbortController().signal,
  })
  console.log(result.text)
  if (result.kind !== 'success') process.exitCode = 1
} finally {
  process.chdir(originalCwd)
  await pluginFiber.dispose()
}
