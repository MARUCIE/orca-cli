/**
 * Prompt Decomposer — splits a complex prompt into discrete tasks.
 *
 * Two decomposition paths:
 *   1. LLM decomposition: calls the model to analyze and split
 *   2. Heuristic fallback: sentence splitting + action verb detection
 *
 * The LLM path produces better results (understands dependencies,
 * classifies main vs side) but costs an API call. The heuristic
 * path is free and fast, used when the prompt is clearly multi-task.
 */

import { chatOnce } from '../providers/openai-compat.js'
import type { OpenAICompatOptions } from '../providers/openai-compat.js'
import type { TaskPlan, PlannedTask, TaskType, TaskPriority } from './types.js'

// ── Heuristic Detection ─────────────────────────────────────────

/**
 * Detect if a prompt contains multiple discrete tasks.
 *
 * Signals:
 *   - Numbered list ("1. ... 2. ... 3. ...")
 *   - Semicolons separating clauses with action verbs
 *   - Chinese enumeration markers (；、然后、接着、另外、同时、还要)
 *   - Multiple sentences with different action verbs
 *   - "and also", "then", "additionally" conjunctions
 */
export function isMultiTaskPrompt(prompt: string): boolean {
  // Numbered list: "1. ... 2. ..."
  if (/\d+\.\s+\S/.test(prompt) && /\n\s*\d+\.\s+\S/.test(prompt)) return true

  // Bullet list: "- ... \n- ..."
  if (/^[\s]*[-*]\s+\S/m.test(prompt) && (prompt.match(/^[\s]*[-*]\s+/gm) || []).length >= 2) return true

  // Chinese enumeration: 3+ clauses separated by ；、or conjunctions
  const cnSplit = prompt.split(/[；;]|然后|接着|另外|同时|还要|以及|并且/).filter(s => s.trim().length > 5)
  if (cnSplit.length >= 3) return true

  // English conjunctions: "also", "additionally", "then", "and then"
  const enConjunctions = (prompt.match(/\b(also|additionally|then|and then|furthermore|moreover|next)\b/gi) || []).length
  if (enConjunctions >= 2) return true

  // Multiple sentences with action verbs (>= 3 distinct action sentences)
  const sentences = prompt.split(/[.!?。！？]\s+/).filter(s => s.trim().length > 10)
  const actionVerbs = /^(fix|add|create|update|remove|refactor|implement|write|build|deploy|test|check|move|rename|delete|optimize|设计|修复|添加|创建|更新|删除|重构|实现|编写|构建|部署|测试|检查|移动|优化)/i
  const actionSentences = sentences.filter(s => actionVerbs.test(s.trim()))
  if (actionSentences.length >= 3) return true

  return false
}

// ── LLM Decomposition ───────────────────────────────────────────

const DECOMPOSE_SYSTEM_PROMPT = `You are a task planner. Decompose the user's request into discrete, actionable tasks.

Rules:
- "main" tasks are on the critical path — they must run sequentially
- "side" tasks are independent — they can run concurrently
- Each task should be completable in a single focused session
- Include blockedBy relationships where tasks depend on others
- Classify priority: critical > high > normal > low
- If a task needs verification (tests, build, lint), include a doneCriteria

Output format — a single JSON block:

\`\`\`json
{
  "reasoning": "Brief explanation of decomposition strategy",
  "tasks": [
    {
      "id": "main-1",
      "title": "Short imperative title",
      "spec": "Detailed specification",
      "type": "main",
      "priority": "high",
      "blockedBy": [],
      "doneCriteria": "tests pass",
      "files": ["src/foo.ts"]
    }
  ]
}
\`\`\`

Important:
- ID format: "main-N" for main tasks, "side-N" for side tasks
- Main tasks are numbered in execution order
- Side tasks can reference main task IDs in blockedBy
- Keep specs detailed enough for an agent with no context to execute`

/**
 * Decompose a prompt into a TaskPlan using the LLM.
 */
export async function decomposePrompt(
  prompt: string,
  apiOptions: OpenAICompatOptions,
): Promise<TaskPlan> {
  const result = await chatOnce(
    { ...apiOptions, systemPrompt: DECOMPOSE_SYSTEM_PROMPT },
    `Decompose this request into tasks:\n\n${prompt}`,
  )

  return parsePlanResponse(result.text, prompt, result.inputTokens + result.outputTokens)
}

/**
 * Quick heuristic decomposition — no API call.
 * Splits by sentence/line boundaries and classifies by position.
 */
export function decomposeHeuristic(prompt: string): TaskPlan {
  const segments = extractSegments(prompt)

  const tasks: PlannedTask[] = segments.map((seg, i) => {
    const isFirst = i === 0
    const isSide = detectSideTask(seg)

    return {
      id: isSide ? `side-${i + 1}` : `main-${i + 1}`,
      title: seg.slice(0, 80).replace(/\n/g, ' ').trim(),
      spec: seg.trim(),
      type: (isSide ? 'side' : 'main') as TaskType,
      status: 'pending',
      priority: (isFirst ? 'high' : 'normal') as TaskPriority,
      blockedBy: [],
      attempts: 0,
      maxRetries: 2,
      tokensUsed: 0,
    }
  })

  // Set dependencies: each main task blocked by previous main
  const mainTasks = tasks.filter(t => t.type === 'main')
  for (let i = 1; i < mainTasks.length; i++) {
    mainTasks[i]!.blockedBy = [mainTasks[i - 1]!.id]
  }

  return {
    originalPrompt: prompt,
    tasks,
    reasoning: 'Heuristic decomposition by sentence/line boundaries',
    createdAt: new Date().toISOString(),
    estimatedRuns: tasks.length,
  }
}

// ── Parse LLM Response ──────────────────────────────────────────

function parsePlanResponse(text: string, originalPrompt: string, tokens: number): TaskPlan {
  // Extract JSON block
  const jsonMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as {
        reasoning?: string
        tasks?: Array<{
          id?: string; title?: string; spec?: string; type?: string
          priority?: string; blockedBy?: string[]; doneCriteria?: string; files?: string[]
        }>
      }

      if (parsed.tasks && Array.isArray(parsed.tasks)) {
        const tasks: PlannedTask[] = parsed.tasks.map((t, i) => ({
          id: t.id || `task-${i + 1}`,
          title: t.title || `Task ${i + 1}`,
          spec: t.spec || t.title || '',
          type: (t.type === 'side' ? 'side' : 'main') as TaskType,
          status: 'pending' as const,
          priority: (['critical', 'high', 'normal', 'low'].includes(t.priority || '') ? t.priority : 'normal') as TaskPriority,
          blockedBy: t.blockedBy || [],
          attempts: 0,
          maxRetries: 2,
          doneCriteria: t.doneCriteria,
          files: t.files,
          tokensUsed: 0,
        }))

        return {
          originalPrompt,
          tasks,
          reasoning: parsed.reasoning || 'LLM decomposition',
          createdAt: new Date().toISOString(),
          estimatedRuns: tasks.length,
        }
      }
    } catch { /* fall through to heuristic */ }
  }

  // Fallback: heuristic
  return decomposeHeuristic(originalPrompt)
}

// ── Segment Extraction ──────────────────────────────────────────

function extractSegments(prompt: string): string[] {
  // Try numbered list first
  const numbered = prompt.match(/\d+\.\s+[^\n]+/g)
  if (numbered && numbered.length >= 2) {
    return numbered.map(s => s.replace(/^\d+\.\s+/, '').trim())
  }

  // Try bullet list
  const bullets = prompt.match(/^[\s]*[-*]\s+[^\n]+/gm)
  if (bullets && bullets.length >= 2) {
    return bullets.map(s => s.replace(/^[\s]*[-*]\s+/, '').trim())
  }

  // Try Chinese semicolons / conjunctions
  const cnParts = prompt.split(/[；;]|(?:然后|接着|另外|同时|还要|以及|并且)/).filter(s => s.trim().length > 5)
  if (cnParts.length >= 2) return cnParts.map(s => s.trim())

  // Fall back to sentence splitting
  const sentences = prompt.split(/[.!?。！？]\s+/).filter(s => s.trim().length > 10)
  if (sentences.length >= 2) return sentences.map(s => s.trim())

  // Single task
  return [prompt.trim()]
}

/**
 * Detect if a segment is a side task (non-blocking, supplementary).
 * Side task signals: documentation, formatting, cleanup, "also", "btw"
 */
function detectSideTask(segment: string): boolean {
  const lower = segment.toLowerCase()
  const sideSignals = [
    /\b(also|btw|by the way|optionally|if possible|nice to have)\b/i,
    /\b(format|style|lint|comment|document|readme|cleanup|clean up)\b/i,
    /(顺便|如果可以|另外|文档|格式化|注释|清理)/,
  ]
  return sideSignals.some(re => re.test(lower))
}
