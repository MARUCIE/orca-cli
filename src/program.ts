/**
 * Forge CLI program assembly.
 *
 * Creates the Commander program with all subcommands registered.
 */

import { Command } from 'commander'
import { createInitCommand } from './commands/init.js'
import { createChatCommand } from './commands/chat.js'
import { createRunCommand } from './commands/run.js'

export function createProgram(): Command {
  const program = new Command()
    .name('forge')
    .version('0.1.0')
    .description(
      'Forge — provider-neutral agent runtime with Claude Code depth.\n\n' +
      'Run any model through the same 50-tool, MCP-native, multi-agent engine.'
    )

  program.addCommand(createInitCommand())
  program.addCommand(createChatCommand())
  program.addCommand(createRunCommand())

  // Default action: if no subcommand, show help
  program.action(() => {
    program.help()
  })

  return program
}

export async function run(argv?: string[]): Promise<void> {
  const program = createProgram()
  await program.parseAsync(argv || process.argv)
}
