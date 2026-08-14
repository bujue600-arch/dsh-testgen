/**
 * Hot-reloadable configuration: registers the `testgen` settings namespace
 * with the harness settings seam when a provider is composed. Layering is
 * schema defaults → composition entry → the user's `settings.yaml` section,
 * so edits take effect live without restarting dsh.
 * @module dsh-testgen/settings
 */

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'
import { SettingsSchema, resolveConfig } from './schema.ts'
import type { TestgenConfig } from './types.ts'

export const SETTINGS_NAMESPACE = 'testgen'

export interface SettingsSetup {
  /** Current effective configuration, resolved per call (hot-reload aware). */
  effective(): TestgenConfig
}

/**
 * Register the settings namespace opportunistically: when no settings
 * provider is composed the plugin still runs, resolving from the
 * composition entry alone — matching the dsh-settings seam contract.
 */
export function setupSettings(ctx: Context, config: TestgenConfig): SettingsSetup {
  let registered: { get(): unknown } | undefined

  ctx.inject(['settings'], (child) => {
    const scope = child.settings.register(settingsNamespace(SETTINGS_NAMESPACE), SettingsSchema, { base: config })
    registered = { get: () => scope.get() }
    child.effect(() => () => {
      if (registered?.get === scope.get) registered = undefined
    })
    child.logger?.('testgen').info('settings namespace %s registered (base = composition entry)', SETTINGS_NAMESPACE)
  })

  ctx.on('settings/updated', (ns, next, prev) => {
    if (String(ns) !== SETTINGS_NAMESPACE) return
    const changed = countChangedFields(prev, next)
    ctx.logger?.('testgen').info('settings hot-reloaded: %d field(s) changed, effective config applied on next invocation', changed)
  })

  return {
    effective() {
      return registered ? resolveConfig(registered.get()) : config
    },
  }
}

function countChangedFields(prev: unknown, next: unknown): number {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return 0
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  let count = 0
  for (const key of keys) {
    if (JSON.stringify((prev as Record<string, unknown>)[key]) !== JSON.stringify((next as Record<string, unknown>)[key])) count++
  }
  return count
}
