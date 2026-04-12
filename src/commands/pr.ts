/**
 * `orca pr <number>` — Checkout a GitHub PR and run agent review.
 *
 * Usage:
 *   orca pr 123              Checkout PR #123 and start interactive review
 *   orca pr 123 "focus on security"   Review with custom prompt
 */

import { Command } from 'commander'
import { execSync } from 'node:child_process'
import { resolveConfig, resolveProvider } from '../config.js'
import { printBanner, printProviderInfo, printError } from '../output.js'

export function createPRCommand(): Command {
  return new Command('pr')
    .description('Checkout a GitHub PR and start agent review')
    .argument('<number>', 'PR number')
    .argument('[prompt...]', 'Custom review prompt')
    .option('-m, --model <model>', 'Model name')
    .option('-p, --provider <provider>', 'Provider')
    .action(async (prNumber: string, promptParts: string[], opts: { model?: string; provider?: string }) => {
      const num = parseInt(prNumber, 10)
      if (isNaN(num)) {
        printError(`Invalid PR number: ${prNumber}`)
        process.exit(1)
      }

      // Check gh CLI
      try {
        execSync('gh --version', { stdio: 'pipe' })
      } catch {
        printError('GitHub CLI (gh) not installed. Install: brew install gh')
        process.exit(1)
      }

      // Get PR info
      console.log()
      console.log(`\x1b[90m  Fetching PR #${num}...\x1b[0m`)

      let prTitle: string
      let prBody: string
      let prDiff: string
      try {
        prTitle = execSync(`gh pr view ${num} --json title -q .title`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
        prBody = execSync(`gh pr view ${num} --json body -q .body`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
        prDiff = execSync(`gh pr diff ${num}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
      } catch (err) {
        printError(`Failed to fetch PR #${num}: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }

      // Checkout PR branch
      console.log(`\x1b[90m  Checking out PR #${num}: ${prTitle}\x1b[0m`)
      try {
        execSync(`gh pr checkout ${num}`, { stdio: 'pipe' })
      } catch (err) {
        printError(`Failed to checkout PR #${num}: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }

      // Build review prompt
      const customPrompt = promptParts.join(' ').trim()
      const diffPreview = prDiff.length > 15000 ? prDiff.slice(0, 15000) + '\n...(truncated)' : prDiff

      const reviewPrompt = `Review this GitHub Pull Request.

## PR #${num}: ${prTitle}

### Description
${prBody || '(no description)'}

### Diff
\`\`\`diff
${diffPreview}
\`\`\`

${customPrompt
  ? `### Focus Area\n${customPrompt}`
  : `### Review Checklist
- Code quality and readability
- Potential bugs or edge cases
- Security concerns
- Performance implications
- Test coverage`
}`

      // Resolve provider and start chat
      const flags: Record<string, unknown> = {}
      if (opts.model) flags.model = opts.model
      if (opts.provider) flags.provider = opts.provider

      const config = resolveConfig({ cwd: process.cwd(), flags })
      const resolved = resolveProvider(config)

      printBanner()
      printProviderInfo(resolved.provider, resolved.model)
      console.log(`\x1b[35m  PR #${num}\x1b[0m \x1b[90m${prTitle}\x1b[0m`)
      console.log(`\x1b[90m  ${prDiff.split('\n').length} lines changed\x1b[0m`)
      console.log()

      // Delegate to chat command with the review prompt
      const args = ['node', 'orca', 'chat', reviewPrompt]
      if (opts.model) args.push('-m', opts.model)
      if (opts.provider) args.push('-p', opts.provider)

      // Import and run programmatically
      const { createProgram } = await import('../program.js')
      const program = createProgram()
      await program.parseAsync(args)
    })
}
