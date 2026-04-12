/**
 * `orca providers` — List and test configured providers.
 *
 * Usage:
 *   orca providers             List all configured providers with status
 *   orca providers test [id]   Test connectivity to a specific provider
 */

import { Command } from 'commander'
import { resolveConfig, listProviders, resolveProvider } from '../config.js'
import { formatContextWindow, formatPricing, getModelChoice } from '../model-catalog.js'
import { logInfo, logWarning } from '../logger.js'

export function createProvidersCommand(): Command {
  const cmd = new Command('providers')
    .description('List and test configured providers')

  // Default action: list all providers
  cmd.action(async () => {
    const config = resolveConfig({ cwd: process.cwd() })
    const providers = listProviders(config)
    logInfo('providers listed', { count: providers.length })

    // Detect which provider auto-detect would choose
    let activeId: string | undefined
    try {
      const resolved = resolveProvider(config)
      activeId = resolved.provider
    } catch { /* no valid provider */ }

    console.log()
    console.log('  \x1b[1mConfigured Providers\x1b[0m')
    console.log()

    if (providers.length === 0) {
      console.log('  \x1b[90m(none) — configure providers in ~/.orca/config.json\x1b[0m')
      console.log()
      return
    }

    // Header
    console.log(`  ${'ID'.padEnd(14)} ${'Model'.padEnd(28)} ${'Source'.padEnd(8)} ${'Key'.padEnd(6)} Status`)
    console.log(`  ${'─'.repeat(14)} ${'─'.repeat(28)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(10)}`)

    for (const p of providers) {
      const isActive = p.id === activeId
      const idStr = isActive ? `\x1b[32m${p.id.padEnd(14)}\x1b[0m` : p.id.padEnd(14)
      const modelStr = (p.model || '').slice(0, 28).padEnd(28)
      const sourceStr = p.source.padEnd(8)
      const keyStr = p.hasKey
        ? '\x1b[32m  yes \x1b[0m'
        : '\x1b[31m  no  \x1b[0m'
      const status = isActive
          ? '\x1b[32mactive\x1b[0m'
          : p.disabled
            ? '\x1b[90mdisabled\x1b[0m'
          : p.hasKey
            ? 'ready'
            : '\x1b[90mno key\x1b[0m'

      console.log(`  ${idStr} ${modelStr} ${sourceStr} ${keyStr} ${status}`)
      const choice = getModelChoice(p.model, p.id)
      const context = formatContextWindow(choice.contextWindow)
      const pricing = formatPricing(choice.pricing)
      const caution = choice.note ? ` · caution: ${choice.note}` : ''
      console.log(`  \x1b[90m${' '.repeat(16)}ctx ${context} · ${pricing}/1M in/out${caution}\x1b[0m`)
      if (choice.note) logWarning('provider model caution', { provider: p.id, model: p.model, warning: choice.note })
    }

    console.log()
    if (activeId) {
      console.log(`  \x1b[90mDefault provider: ${activeId}\x1b[0m`)
    }
    console.log(`  \x1b[90mConfig: ~/.orca/config.json\x1b[0m`)
    console.log()
  })

  // Subcommand: test connectivity
  cmd.command('test')
    .argument('[provider]', 'Provider ID to test (defaults to active)')
    .description('Test connectivity to a provider endpoint')
    .action(async (providerId?: string) => {
      const config = resolveConfig({ cwd: process.cwd() })

      let resolved
      try {
        if (providerId) {
          resolved = resolveProvider({ ...config, defaultProvider: providerId })
        } else {
          resolved = resolveProvider(config)
        }
      } catch (err) {
        console.error(`\x1b[31m  error: ${err instanceof Error ? err.message : String(err)}\x1b[0m`)
        process.exit(1)
      }

      console.log()
      console.log(`  Testing \x1b[1m${resolved.provider}\x1b[0m ...`)
      console.log(`  \x1b[90mEndpoint: ${resolved.baseURL || '(not set)'}\x1b[0m`)
      console.log(`  \x1b[90mModel: ${resolved.model}\x1b[0m`)
      const choice = getModelChoice(resolved.model, resolved.provider)
      console.log(`  \x1b[90mContext: ${formatContextWindow(choice.contextWindow)} · Pricing: ${formatPricing(choice.pricing)} per 1M in/out\x1b[0m`)
      if (choice.note) {
        console.log(`  \x1b[33mCaution: ${choice.note}\x1b[0m`)
        logWarning('provider test caution', { provider: resolved.provider, model: resolved.model, warning: choice.note })
      }

      if (!resolved.baseURL) {
        console.log(`  \x1b[31m  FAIL — no baseURL configured\x1b[0m`)
        process.exit(1)
      }

      // Quick connectivity test: list models endpoint
      const start = Date.now()
      try {
        const url = resolved.baseURL.replace(/\/+$/, '') + '/models'
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${resolved.apiKey}`,
          },
          signal: AbortSignal.timeout(10_000),
        })
        const elapsed = Date.now() - start

        if (resp.ok || resp.status === 401 || resp.status === 403 || resp.status === 405) {
          // 401/403/405 still means the endpoint is reachable
          const reachable = resp.ok ? 'OK' : `reachable (HTTP ${resp.status})`
          console.log(`  \x1b[32m  ${reachable} — ${elapsed}ms\x1b[0m`)
          logInfo('provider test completed', { provider: resolved.provider, model: resolved.model, status: reachable, elapsedMs: elapsed })
        } else {
          console.log(`  \x1b[31m  HTTP ${resp.status} — ${elapsed}ms\x1b[0m`)
          logWarning('provider test returned non-ok status', { provider: resolved.provider, model: resolved.model, status: resp.status, elapsedMs: elapsed })
        }
      } catch (err) {
        const elapsed = Date.now() - start
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  \x1b[31m  FAIL — ${msg} (${elapsed}ms)\x1b[0m`)
        logWarning('provider test failed', { provider: resolved.provider, model: resolved.model, elapsedMs: elapsed, error: msg })
      }
      console.log()
    })

  return cmd
}
