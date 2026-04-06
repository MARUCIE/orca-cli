/**
 * Persistent usage tracking with Node.js built-in SQLite.
 *
 * Stores every API call's token/cost/duration data in ~/.armature/usage.db.
 * Used by `forge stats` and the session summary.
 *
 * Zero external dependencies — uses node:sqlite (Node 22+).
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { getGlobalDir } from './config.js'

// ── Schema ──────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 1,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  command TEXT,
  cwd TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model);
`

// ── Database ────────────────────────────────────────────────────────

let _db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (!_db) {
    const dbPath = join(getGlobalDir(), 'usage.db')
    _db = new DatabaseSync(dbPath)
    _db.exec(SCHEMA)
  }
  return _db
}

// ── Record ──────────────────────────────────────────────────────────

export interface UsageRecord {
  sessionId?: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
  turns?: number
  toolCalls?: number
  command?: string
  cwd?: string
}

export function recordUsage(record: UsageRecord): void {
  try {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO usage (session_id, provider, model, input_tokens, output_tokens, cost_usd, duration_ms, turns, tool_calls, command, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      record.sessionId || null,
      record.provider,
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.costUsd,
      record.durationMs,
      record.turns || 1,
      record.toolCalls || 0,
      record.command || null,
      record.cwd || null,
    )
  } catch {
    // Non-fatal — don't break the CLI if usage tracking fails
  }
}

// ── Query ───────────────────────────────────────────────────────────

export interface StatsOverview {
  totalSessions: number
  totalMessages: number
  totalDays: number
  totalCost: number
  avgCostPerDay: number
  avgTokensPerSession: number
  medianTokensPerSession: number
  totalInputTokens: number
  totalOutputTokens: number
}

export interface ModelBreakdown {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  cost: number
  avgDurationMs: number
}

export interface DailyUsage {
  date: string
  calls: number
  cost: number
  tokens: number
}

export function getStatsOverview(): StatsOverview {
  const db = getDb()

  const overview = db.prepare(`
    SELECT
      COUNT(DISTINCT session_id) as sessions,
      COUNT(*) as messages,
      COUNT(DISTINCT date(timestamp)) as days,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output
    FROM usage
  `).get() as unknown as Record<string, number>

  // Per-session token totals for avg/median
  const sessionTokens = db.prepare(`
    SELECT session_id, SUM(input_tokens + output_tokens) as tokens
    FROM usage
    WHERE session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY tokens
  `).all() as unknown as Array<{ session_id: string; tokens: number }>

  const tokenValues = sessionTokens.map(s => s.tokens)
  const median = tokenValues.length > 0
    ? tokenValues[Math.floor(tokenValues.length / 2)]!
    : 0
  const avg = tokenValues.length > 0
    ? tokenValues.reduce((a, b) => a + b, 0) / tokenValues.length
    : 0

  const days = Math.max(overview.days, 1)

  return {
    totalSessions: overview.sessions || 0,
    totalMessages: overview.messages,
    totalDays: overview.days,
    totalCost: overview.total_cost,
    avgCostPerDay: overview.total_cost / days,
    avgTokensPerSession: Math.round(avg),
    medianTokensPerSession: Math.round(median),
    totalInputTokens: overview.total_input,
    totalOutputTokens: overview.total_output,
  }
}

export function getModelBreakdown(): ModelBreakdown[] {
  const db = getDb()
  return db.prepare(`
    SELECT
      model,
      COUNT(*) as calls,
      SUM(input_tokens) as inputTokens,
      SUM(output_tokens) as outputTokens,
      SUM(cost_usd) as cost,
      AVG(duration_ms) as avgDurationMs
    FROM usage
    GROUP BY model
    ORDER BY cost DESC
  `).all() as unknown as ModelBreakdown[]
}

export function getDailyUsage(days: number = 14): DailyUsage[] {
  const db = getDb()
  return db.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(*) as calls,
      SUM(cost_usd) as cost,
      SUM(input_tokens + output_tokens) as tokens
    FROM usage
    WHERE timestamp >= datetime('now', ?)
    GROUP BY date(timestamp)
    ORDER BY date DESC
  `).all(`-${days} days`) as unknown as DailyUsage[]
}
