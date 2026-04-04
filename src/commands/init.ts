/**
 * `forge init` — Initialize Armature configuration.
 *
 * Creates:
 *   - ~/.armature/config.json  (global, if missing)
 *   - .armature.json           (project-local)
 */

import { Command } from 'commander'
import { initGlobalConfig, initProjectConfig, getGlobalConfigPath } from '../config.js'
import { printSuccess, printInfo } from '../output.js'

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize forge configuration for this project')
    .option('--global-only', 'Only create global config, skip project config')
    .action(async (opts: { globalOnly?: boolean }) => {
      // Always ensure global config exists
      initGlobalConfig()
      printSuccess(`Global config: ${getGlobalConfigPath()}`)

      if (!opts.globalOnly) {
        const projectPath = initProjectConfig(process.cwd())
        printSuccess(`Project config: ${projectPath}`)
      }

      printInfo('')
      printInfo('Next steps:')
      printInfo('  1. Set your API key:')
      printInfo('     export ANTHROPIC_API_KEY=sk-ant-...')
      printInfo('     export OPENAI_API_KEY=sk-...')
      printInfo('')
      printInfo('  2. Start chatting:')
      printInfo('     forge chat "explain this codebase"')
      printInfo('')
      printInfo('  3. Run an agent task:')
      printInfo('     forge run "fix the failing tests"')
    })
}
