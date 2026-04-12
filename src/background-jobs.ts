/**
 * Background job registry for long-running terminal tasks.
 *
 * Hermes-inspired behavior:
 * - start detached background work from tool calls
 * - persist job metadata and log path under ~/.orca/background-jobs
 * - surface completion notifications back into the REPL without polling commands
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'

export type BackgroundJobStatus = 'running' | 'completed' | 'failed'

export interface BackgroundJobRecord {
  id: string
  command: string
  cwd: string
  startedAt: string
  completedAt?: string
  status: BackgroundJobStatus
  notifyOnComplete: boolean
  logPath: string
  metaPath: string
  pid?: number
  runnerPid?: number
  exitCode?: number | null
  signal?: string | null
  notifiedAt?: string
}

function getBackgroundJobsDir(): string {
  const orcaHome = process.env.ORCA_HOME || join(process.env.HOME || homedir(), '.orca')
  return join(orcaHome, 'background-jobs')
}

function ensureBackgroundJobsDir(): string {
  const dir = getBackgroundJobsDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

function getMetaPath(id: string): string {
  return join(getBackgroundJobsDir(), `${id}.json`)
}

function readJob(metaPath: string): BackgroundJobRecord | null {
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as BackgroundJobRecord
  } catch {
    return null
  }
}

function writeJob(metaPath: string, record: BackgroundJobRecord): void {
  writeFileSync(metaPath, JSON.stringify(record, null, 2), 'utf-8')
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'job'
}

export function startBackgroundJob(command: string, cwd: string, notifyOnComplete = true): BackgroundJobRecord {
  const dir = ensureBackgroundJobsDir()
  const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const label = sanitizeLabel(basename(cwd))
  const metaPath = join(dir, `${id}.json`)
  const logPath = join(dir, `${id}-${label}.log`)
  const startedAt = new Date().toISOString()

  const initial: BackgroundJobRecord = {
    id,
    command,
    cwd,
    startedAt,
    status: 'running',
    notifyOnComplete,
    logPath,
    metaPath,
  }
  writeJob(metaPath, initial)

  const runnerScript = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [metaPath, logPath, cwd, command] = process.argv.slice(1);
function readMeta() {
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return {}; }
}
function writeMeta(patch) {
  const next = { ...readMeta(), ...patch };
  fs.writeFileSync(metaPath, JSON.stringify(next, null, 2), 'utf8');
}
const logFd = fs.openSync(logPath, 'a');
writeMeta({ runnerPid: process.pid, logPath, metaPath, cwd, command, status: 'running' });
const shell = process.env.SHELL || '/bin/sh';
const child = spawn(shell, ['-lc', command], {
  cwd,
  detached: false,
  stdio: ['ignore', logFd, logFd],
  env: { ...process.env },
});
writeMeta({ pid: child.pid });
child.on('error', (err) => {
  try {
    fs.appendFileSync(logPath, '\\n[runner error] ' + (err && err.message ? err.message : String(err)) + '\\n');
  } catch {}
  writeMeta({
    status: 'failed',
    completedAt: new Date().toISOString(),
    exitCode: null,
    signal: null,
  });
  try { fs.closeSync(logFd); } catch {}
  process.exit(0);
});
child.on('close', (code, signal) => {
  writeMeta({
    status: code === 0 ? 'completed' : 'failed',
    completedAt: new Date().toISOString(),
    exitCode: code,
    signal: signal,
  });
  try { fs.closeSync(logFd); } catch {}
  process.exit(0);
});
`

  const runner = spawn(process.execPath, ['-e', runnerScript, metaPath, logPath, cwd, command], {
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  runner.unref()

  const started = readJob(metaPath)
  if (!started) return initial
  return started
}

export function listBackgroundJobs(limit = 20): BackgroundJobRecord[] {
  const dir = ensureBackgroundJobsDir()
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)

  return files
    .map((name) => readJob(join(dir, name)))
    .filter((job): job is BackgroundJobRecord => Boolean(job))
}

export function consumeCompletedBackgroundJobs(limit = 10): BackgroundJobRecord[] {
  const jobs = listBackgroundJobs(limit * 4)
    .filter((job) => job.notifyOnComplete && job.completedAt && !job.notifiedAt)
    .sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''))
    .slice(0, limit)

  for (const job of jobs) {
    writeJob(job.metaPath, {
      ...job,
      notifiedAt: new Date().toISOString(),
    })
  }

  return jobs
}

export function readBackgroundJobLog(job: BackgroundJobRecord, maxLines = 8): string {
  if (!existsSync(job.logPath)) return ''
  try {
    const lines = readFileSync(job.logPath, 'utf-8').trim().split('\n').filter(Boolean)
    return lines.slice(-maxLines).join('\n')
  } catch {
    return ''
  }
}
