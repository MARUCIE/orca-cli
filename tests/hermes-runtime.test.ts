/**
 * Hermes-inspired runtime capability tests.
 *
 * Covers:
 * 1. Tool argument coercion for model-sent string values
 * 2. Oversized tool result persistence to artifact files
 * 3. Background completion notifications for detached jobs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeTool } from '../src/tools.js'
import { consumeCompletedBackgroundJobs } from '../src/background-jobs.js'

const testDir = join(tmpdir(), `orca-hermes-${Date.now()}`)
const orcaHome = join(tmpdir(), `orca-hermes-home-${Date.now()}`)
const previousOrcaHome = process.env.ORCA_HOME

beforeAll(() => {
  process.env.ORCA_HOME = orcaHome
  mkdirSync(join(testDir, 'src'), { recursive: true })
  mkdirSync(orcaHome, { recursive: true })
  writeFileSync(join(testDir, 'src', 'sample.ts'), 'line1\nline2\nline3\n')
  writeFileSync(
    join(testDir, 'src', 'large.ts'),
    Array.from({ length: 420 }, (_, line) => `export const line${line} = ${line}`).join('\n'),
  )

  for (let i = 0; i < 30; i++) {
    writeFileSync(
      join(testDir, 'src', `module${i}.ts`),
      Array.from({ length: 40 }, (_, line) => `// module${i} line ${line}: oversized_pattern`).join('\n'),
    )
  }
})

afterAll(() => {
  if (previousOrcaHome === undefined) delete process.env.ORCA_HOME
  else process.env.ORCA_HOME = previousOrcaHome

  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(orcaHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('Hermes runtime: tool arg coercion', () => {
  it('coerces string line ranges for read_file', () => {
    const result = executeTool('read_file', {
      path: 'src/sample.ts',
      start_line: '2' as unknown as number,
      end_line: '2' as unknown as number,
    }, testDir)

    expect(result.success).toBe(true)
    expect(result.output).toContain('line2')
    expect(result.output).not.toContain('line1')
    expect(result.output).not.toContain('line3')
  })
})

describe('Hermes runtime: oversized tool result persistence', () => {
  it('persists oversized read_file output to a tool-results artifact', () => {
    const result = executeTool('read_file', {
      path: 'src/large.ts',
    }, testDir)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Saved full output to')
    expect(result.output).toContain('truncated')

    const artifactPath = result.output.match(/Saved full output to (.+)/)?.[1]?.trim()
    expect(artifactPath).toBeTruthy()
    expect(existsSync(artifactPath!)).toBe(true)
    expect(readFileSync(artifactPath!, 'utf-8')).toContain('export const line419 = 419')
  })
})

describe('Hermes runtime: background completion notifications', () => {
  it('tracks background jobs and emits a completion notification once', async () => {
    const result = executeTool('run_background', {
      command: `node -e "setTimeout(() => console.log('bg done'), 80)"`,
      notify_on_complete: 'true' as unknown as boolean,
    }, testDir)

    expect(result.success).toBe(true)
    const jobId = result.output.match(/Started background job (bg-[a-z0-9-]+)/)?.[1]
    expect(jobId).toBeTruthy()

    let completed = []
    for (let attempt = 0; attempt < 25; attempt++) {
      completed = consumeCompletedBackgroundJobs()
      if (completed.some((job) => job.id === jobId)) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const job = completed.find((entry) => entry.id === jobId)
    expect(job).toBeDefined()
    expect(job!.status).toBe('completed')
    expect(readFileSync(job!.logPath, 'utf-8')).toContain('bg done')

    const secondPass = consumeCompletedBackgroundJobs().find((entry) => entry.id === jobId)
    expect(secondPass).toBeUndefined()
  })
})
