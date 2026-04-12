import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getLogPath, logError, logInfo, logWarning } from '../src/logger.js'

describe('logger', () => {
  const previousOrcaHome = process.env.ORCA_HOME
  let orcaHome: string

  beforeEach(() => {
    orcaHome = join(tmpdir(), `orca-logs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(orcaHome, { recursive: true })
    process.env.ORCA_HOME = orcaHome
  })

  afterEach(() => {
    if (previousOrcaHome === undefined) delete process.env.ORCA_HOME
    else process.env.ORCA_HOME = previousOrcaHome
    try { rmSync(orcaHome, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('writes info/warn/error to agent log and warn/error to errors log', () => {
    logInfo('session started', { model: 'gpt-5.4' })
    logWarning('proxy warning')
    logError('request failed')

    const agentLog = readFileSync(getLogPath('agent'), 'utf-8')
    const errorLog = readFileSync(getLogPath('errors'), 'utf-8')

    expect(agentLog).toContain('[INFO] session started')
    expect(agentLog).toContain('[WARN] proxy warning')
    expect(agentLog).toContain('[ERROR] request failed')
    expect(errorLog).not.toContain('[INFO] session started')
    expect(errorLog).toContain('[WARN] proxy warning')
    expect(errorLog).toContain('[ERROR] request failed')
  })
})
