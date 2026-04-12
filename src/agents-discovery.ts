/**
 * AGENTS.md Auto-Discovery — scans directory hierarchy for guidance files
 * and formats them into system prompt context.
 *
 * Walks from cwd upward, looking for: AGENTS.md, CLAUDE.md, CODEX.md,
 * and .orca/rules/*.md at each level. Closest files appear first.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

export interface DiscoveredGuidance {
  path: string
  source: 'AGENTS.md' | 'CLAUDE.md' | '.orca/rules' | 'CODEX.md'
  content: string
  depth: number // 0 = cwd, 1 = parent, 2 = grandparent, etc.
}

// ── Well-known guidance files ───────────────────────────────────

const GUIDANCE_FILES: Array<{ name: string; source: DiscoveredGuidance['source'] }> = [
  { name: 'AGENTS.md', source: 'AGENTS.md' },
  { name: 'CLAUDE.md', source: 'CLAUDE.md' },
  { name: 'CODEX.md', source: 'CODEX.md' },
]

// ── Discovery ───────────────────────────────────────────────────

/**
 * Scan cwd and up to maxDepth parent directories for guidance files.
 * Returns discovered files sorted by depth (closest first).
 */
export function discoverGuidance(cwd: string, maxDepth = 3): DiscoveredGuidance[] {
  const results: DiscoveredGuidance[] = []
  let current = resolve(cwd)

  for (let depth = 0; depth <= maxDepth; depth++) {
    // Check well-known files
    for (const { name, source } of GUIDANCE_FILES) {
      const filePath = join(current, name)
      const content = safeRead(filePath)
      if (content !== null) {
        results.push({ path: filePath, source, content, depth })
      }
    }

    // Check .orca/rules/*.md
    const rulesDir = join(current, '.orca', 'rules')
    if (existsSync(rulesDir)) {
      try {
        const entries = readdirSync(rulesDir).sort()
        for (const entry of entries) {
          if (!entry.endsWith('.md')) continue
          const filePath = join(rulesDir, entry)
          const content = safeRead(filePath)
          if (content !== null) {
            results.push({ path: filePath, source: '.orca/rules', content, depth })
          }
        }
      } catch {
        // skip unreadable directories
      }
    }

    // Move to parent
    const parent = dirname(current)
    if (parent === current) break // reached filesystem root
    current = parent
  }

  // Already in depth order (0, 0, ..., 1, 1, ..., 2, ...)
  return results
}

// ── Formatting ──────────────────────────────────────────────────

/**
 * Format discovered guidance into a system prompt section.
 * Truncates each file to maxCharsPerFile to prevent context bloat.
 */
export function formatGuidanceForPrompt(
  guidance: DiscoveredGuidance[],
  maxCharsPerFile = 2000,
): string {
  if (guidance.length === 0) return ''

  const sections: string[] = ['## Project Guidance (auto-discovered)']

  for (const g of guidance) {
    const truncated =
      g.content.length > maxCharsPerFile
        ? g.content.slice(0, maxCharsPerFile) + '\n... (truncated)'
        : g.content

    // Build a relative-ish display path
    const label = g.source === '.orca/rules'
      ? `.orca/rules/${g.path.split('/').pop()}`
      : g.source

    const depthHint = g.depth === 0 ? './' : '../'.repeat(g.depth)

    sections.push(`\n### ${label} (${depthHint}${g.source === '.orca/rules' ? label : g.source})`)
    sections.push(truncated)
  }

  return sections.join('\n')
}

// ── Helpers ─────────────────────────────────────────────────────

function safeRead(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}
