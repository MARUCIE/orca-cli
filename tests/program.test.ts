import { describe, it, expect } from 'vitest'
import { createProgram } from '../src/program.js'

describe('program', () => {
  it('creates a program with orca name', () => {
    const program = createProgram()
    expect(program.name()).toBe('orca')
  })

  it('has version set', () => {
    const program = createProgram()
    expect(program.version()).toBe('0.2.0')
  })

  it('registers init command', () => {
    const program = createProgram()
    const commands = program.commands.map(c => c.name())
    expect(commands).toContain('init')
  })

  it('registers chat command', () => {
    const program = createProgram()
    const commands = program.commands.map(c => c.name())
    expect(commands).toContain('chat')
  })

  it('registers doctor command', () => {
    const program = createProgram()
    const commands = program.commands.map(c => c.name())
    expect(commands).toContain('doctor')
  })

  it('registers run command', () => {
    const program = createProgram()
    const commands = program.commands.map(c => c.name())
    expect(commands).toContain('run')
  })

  it('registers logs command', () => {
    const program = createProgram()
    const commands = program.commands.map(c => c.name())
    expect(commands).toContain('logs')
  })

  it('chat command has model option', () => {
    const program = createProgram()
    const chat = program.commands.find(c => c.name() === 'chat')!
    const options = chat.options.map(o => o.long)
    expect(options).toContain('--model')
    expect(options).toContain('--provider')
    expect(options).toContain('--api-key')
    expect(options).toContain('--json')
  })

  it('run command has dangerously option', () => {
    const program = createProgram()
    const run = program.commands.find(c => c.name() === 'run')!
    const options = run.options.map(o => o.long)
    expect(options).toContain('--dangerously')
    expect(options).toContain('--max-turns')
  })

  it('run command defaults max-turns to 50', () => {
    const program = createProgram()
    const run = program.commands.find(c => c.name() === 'run')!
    const maxTurns = run.options.find(o => o.long === '--max-turns')
    expect(maxTurns?.defaultValue).toBe('50')
  })
})
