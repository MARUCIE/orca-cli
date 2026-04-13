/**
 * Default system prompt for Orca CLI agent.
 *
 * Dynamically generates tool documentation from TOOL_DEFINITIONS.
 */

import { TOOL_DEFINITIONS } from './tools.js'
import { loadProjectContext, formatContextForPrompt, loadSkills } from './context.js'
import { discoverGuidance, formatGuidanceForPrompt } from './agents-discovery.js'
import { getFirstPrinciplesPrompt } from './cognitive-skeleton.js'

export function buildSystemPrompt(cwd: string): string {
  // Generate tool list from actual definitions
  const toolDocs = TOOL_DEFINITIONS.map(t => {
    const f = t.function
    const params = f.parameters?.properties
      ? Object.entries(f.parameters.properties as Record<string, { type: string; description?: string }>)
          .map(([k, v]) => `${k} (${v.type})`)
          .join(', ')
      : ''
    return `- **${f.name}**(${params}): ${f.description}`
  }).join('\n')

  return `You are Orca, a provider-neutral coding agent. You help users with software engineering tasks by using your built-in tools proactively.

## Available Tools (${TOOL_DEFINITIONS.length})

${toolDocs}

## Working Style

- Use tools proactively without asking permission. Read before editing.
- Use edit_file for surgical changes. Use write_file only for new files or full rewrites.
- Make minimal, reviewable changes — don't rewrite entire files when a targeted edit works.
- Use spawn_agent or delegate_task for complex sub-tasks that can run independently.
- Use task_create/task_update to track multi-step work.
- After making changes, verify your work (run tests, check syntax).
- Fix your own errors immediately without asking.
- Keep explanations concise. Lead with the action, not the reasoning.

## First Principles (mandatory pre-check)

${getFirstPrinciplesPrompt()}

## Working Directory

Current directory: ${cwd}

${(() => {
  try {
    const ctx = loadProjectContext(cwd)
    return formatContextForPrompt(ctx)
  } catch {
    return ''
  }
})()}

${(() => {
  try {
    const skills = loadSkills(cwd)
    if (skills.length === 0) return ''
    // Compact index: only skill names (lazy load full SKILL.md on demand)
    // 475 skills × ~15 chars/name ≈ 2K tokens (vs 14K with descriptions)
    const MAX_INLINE = 30 // skills with descriptions shown inline
    const top = skills.slice(0, MAX_INLINE)
    const rest = skills.slice(MAX_INLINE)
    const topList = top.map(s => `- ${s.name}: ${s.description.slice(0, 80)}`).join('\n')
    const restNames = rest.length > 0
      ? `\n\n${rest.length} more skills available: ${rest.map(s => s.name).join(', ')}`
      : ''
    return `## Available Skills (${skills.length})\n\n${topList}${restNames}\n\nTo use a skill, read its SKILL.md: \`.claude/skills/<name>/SKILL.md\` or \`.codex/skills/<name>/SKILL.md\``
  } catch {
    return ''
  }
})()}

${(() => {
  try {
    const guidance = discoverGuidance(cwd)
    return formatGuidanceForPrompt(guidance)
  } catch {
    return ''
  }
})()}
`
}
