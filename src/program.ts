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

  // Default: no subcommand → enter interactive REPL (like `claude` without args)
  program.argument('[prompt...]', 'Prompt text (omit for interactive REPL)')
  program.option('-m, --model <model>', 'Model name')
  program.option('-p, --provider <provider>', 'Provider (poe, anthropic, openai, google)')
  program.option('-k, --api-key <key>', 'API key')
  program.option('--safe', 'Enable permission prompts')
  program.option('--effort <level>', 'Thinking effort: low, medium, high, max')
  program.action(async (prompt: string[], opts: Record<string, string | boolean | undefined>) => {
    // Delegate to chat command: forge "prompt" → forge chat "prompt"
    const args = ['node', 'forge', 'chat']
    if (prompt.length > 0) args.push(prompt.join(' '))
    if (opts.model) args.push('-m', String(opts.model))
    if (opts.provider) args.push('-p', String(opts.provider))
    if (opts.apiKey) args.push('-k', String(opts.apiKey))
    if (opts.safe) args.push('--safe')
    if (opts.effort) args.push('--effort', String(opts.effort))
    await program.parseAsync(args)
  })

  return program
}

export async function run(argv?: string[]): Promise<void> {
  const program = createProgram()
  await program.parseAsync(argv || process.argv)
}
