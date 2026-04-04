/**
 * Forge CLI program assembly.
 *
 * Creates the Commander program with all subcommands registered.
 */

import { Command } from 'commander'
import { createInitCommand } from './commands/init.js'
import { createChatCommand } from './commands/chat.js'
import { createRunCommand } from './commands/run.js'
import { createCouncilCommand, createRaceCommand, createPipelineCommand } from './commands/multi.js'

export function createProgram(): Command {
  const program = new Command()
    .name('forge')
    .version('0.1.0')
    .description(
      'Forge — provider-neutral agent runtime. 41 tools · 11 models · multi-model collaboration.\n\n' +
      'Commands:\n' +
      '  chat              Interactive REPL or one-shot query\n' +
      '  run               Execute an agent task\n' +
      '  council           Ask N models, judge synthesizes (multi-model)\n' +
      '  race              First model to answer wins (speed race)\n' +
      '  pipeline           Plan → Code → Review chain across models\n' +
      '  init              Initialize project configuration'
    )

  program.addCommand(createChatCommand())
  program.addCommand(createRunCommand())
  program.addCommand(createCouncilCommand())
  program.addCommand(createRaceCommand())
  program.addCommand(createPipelineCommand())
  program.addCommand(createInitCommand())

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
