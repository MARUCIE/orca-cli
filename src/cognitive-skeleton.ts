/**
 * Cognitive Skeleton — built-in structured thinking framework.
 *
 * 9 scenarios × curated mental models → system prompt injection
 * that forces the agent to apply relevant thinking frameworks.
 *
 * Based on: 111 Munger mental models + 100 PM frameworks.
 * Each scenario selects 4 most relevant models as thinking anchors.
 *
 * Integration:
 *   - UserPromptSubmit: match prompt → inject models as context
 *   - System prompt: always-on First Principles reminder
 */

// ── Types ────────────────────────────────────────────────────────

export interface CognitiveModel {
  id: string
  name: string
  hint: string
}

export interface CognitiveMatch {
  scenario: string
  models: CognitiveModel[]
  instruction: string
}

// ── Scenario Definitions ─────────────────────────────────────────

interface Scenario {
  id: string
  label: string
  triggers: RegExp
  models: CognitiveModel[]
}

const SCENARIOS: Scenario[] = [
  {
    id: 'defining-problems',
    label: 'Defining Problems',
    triggers: /(?:\b(?:bug|error|fix|issue|broken|fail|wrong|debug|crash|problem)\b|报错|修复|问题|故障|异常)/i,
    models: [
      { id: 'M001', name: 'Inversion', hint: 'define the problem by what you want to avoid' },
      { id: 'M044', name: 'Complex Adaptive Systems', hint: 'multi-factor problems resist linear fixes' },
      { id: 'PM14', name: '5-Why', hint: 'drill past symptoms to structural root cause' },
      { id: 'PM21', name: 'Cynefin', hint: 'match response complexity to problem complexity' },
    ],
  },
  {
    id: 'making-decisions',
    label: 'Making Decisions',
    triggers: /(?:\b(?:should|choose|decide|option|tradeoff|trade-off|versus|vs|which|compare)\b|选择|决策|方案|对比)/i,
    models: [
      { id: 'M002', name: 'Second-Order Thinking', hint: 'then what happens next?' },
      { id: 'M005', name: "Occam's Razor", hint: 'simplest adequate explanation wins' },
      { id: 'PM01', name: 'RICE', hint: 'Reach x Impact x Confidence / Effort' },
      { id: 'PM36', name: 'Reversibility', hint: 'one-way door vs two-way door' },
    ],
  },
  {
    id: 'designing-systems',
    label: 'Designing Systems',
    triggers: /(?:\b(?:architect|design|system|infra|scale|refactor|migrate|pattern)\b|架构|设计|重构|迁移|模式)/i,
    models: [
      { id: 'M003', name: 'First Principles', hint: 'decompose to fundamental truths, build up' },
      { id: 'M009', name: 'Map vs Territory', hint: 'the model is not the system' },
      { id: 'PM24', name: 'MECE', hint: 'mutually exclusive, collectively exhaustive' },
      { id: 'PM45', name: "Conway's Law", hint: 'system mirrors org structure' },
    ],
  },
  {
    id: 'evaluating-risk',
    label: 'Evaluating Risk',
    triggers: /(?:\b(?:risk|danger|safe|security|vulnerability|attack|breach|threat)\b|风险|安全|漏洞|威胁)/i,
    models: [
      { id: 'M010', name: 'Margin of Safety', hint: 'build buffers for the unknown' },
      { id: 'M015', name: 'Survivorship Bias', hint: 'what failures are you not seeing?' },
      { id: 'PM48', name: 'Pre-Mortem', hint: 'assume failure, trace backwards' },
      { id: 'PM50', name: 'FMEA', hint: 'failure mode and effects analysis' },
    ],
  },
  {
    id: 'optimizing-performance',
    label: 'Optimizing Performance',
    triggers: /(?:\b(?:optimize|performance|slow|fast|speed|latency|throughput|memory|cpu|bottleneck)\b|优化|性能|速度|延迟|瓶颈)/i,
    models: [
      { id: 'M007', name: 'Pareto Principle', hint: '20% of causes produce 80% of effects' },
      { id: 'M020', name: 'Bottleneck', hint: 'system throughput limited by narrowest point' },
      { id: 'PM16', name: 'Theory of Constraints', hint: 'improve the constraint, not everything' },
      { id: 'PM99', name: "Amdahl's Law", hint: 'speedup limited by non-parallel fraction' },
    ],
  },
  {
    id: 'planning-execution',
    label: 'Planning Execution',
    triggers: /(?:\b(?:plan|implement|execute|build|create|develop|ship|deploy|release)\b|计划|实现|执行|部署|发布|开发)/i,
    models: [
      { id: 'M006', name: 'Circle of Competence', hint: 'know what you know and what you don\'t' },
      { id: 'M025', name: 'Activation Energy', hint: 'smallest push to start the reaction' },
      { id: 'PM08', name: 'MoSCoW', hint: 'Must/Should/Could/Won\'t prioritization' },
      { id: 'PM30', name: 'WBS', hint: 'decompose until each piece is estimable' },
    ],
  },
  {
    id: 'understanding-users',
    label: 'Understanding Users',
    triggers: /(?:\b(?:user|customer|ux|ui|experience|journey|persona|feedback)\b|用户|体验|反馈|需求)/i,
    models: [
      { id: 'M012', name: 'Empathy Gap', hint: "you can't feel what users feel" },
      { id: 'M038', name: 'Incentive', hint: 'follow the reward structure' },
      { id: 'PM03', name: 'JTBD', hint: 'what job is the user hiring this product to do?' },
      { id: 'PM22', name: 'Kano Model', hint: 'basic/performance/delight categorization' },
    ],
  },
  {
    id: 'analyzing-data',
    label: 'Analyzing Data',
    triggers: /(?:\b(?:data|metric|measure|analyze|statistics|trend|pattern)\b|数据|指标|分析|统计|趋势)/i,
    models: [
      { id: 'M014', name: 'Regression to Mean', hint: 'extreme values tend to normalize' },
      { id: 'M016', name: 'Availability Bias', hint: 'recent/vivid data feels more important' },
      { id: 'PM13', name: 'Cohort Analysis', hint: 'compare groups over time, not snapshots' },
      { id: 'PM42', name: 'Leading vs Lagging', hint: 'measure what predicts, not just what happened' },
    ],
  },
  {
    id: 'communicating',
    label: 'Communicating',
    triggers: /(?:\b(?:explain|document|write|present|communicate|review|report)\b|说明|文档|解释|报告|评审)/i,
    models: [
      { id: 'M004', name: "Hanlon's Razor", hint: "don't attribute to malice what's explained by confusion" },
      { id: 'M028', name: 'Narrative Instinct', hint: 'stories beat statistics for persuasion' },
      { id: 'PM07', name: 'Pyramid Principle', hint: 'conclusion first, then supporting evidence' },
      { id: 'PM35', name: 'BLUF', hint: 'bottom line up front' },
    ],
  },
]

// ── Always-On First Principles ───────────────────────────────────

const FIRST_PRINCIPLES_PROMPT = `Before acting on any task, decompose it:
1. What is the actual goal? (not the stated task, the underlying need)
2. What assumptions am I making?
3. What is the simplest path?
4. What existing code/data already solves this?
5. What can be eliminated rather than added?`

// ── Matching ─────────────────────────────────────────────────────

/**
 * Match a user prompt against cognitive scenarios.
 * Returns the first matching scenario, or null for generic prompts.
 */
export function matchCognitive(prompt: string): CognitiveMatch | null {
  for (const scenario of SCENARIOS) {
    if (scenario.triggers.test(prompt)) {
      return {
        scenario: scenario.label,
        models: scenario.models,
        instruction: `Apply ${scenario.models.map(m => m.name).join(', ')} thinking to this task.`,
      }
    }
  }
  return null
}

/**
 * Format cognitive match as context injection string.
 */
export function formatCognitiveContext(match: CognitiveMatch): string {
  const models = match.models
    .map(m => `  ${m.id}: ${m.name} -- ${m.hint}`)
    .join('\n')
  return `[COGNITIVE] Scenario: ${match.scenario}\n${models}\nInstruction: ${match.instruction}`
}

/**
 * Get the always-on first principles prompt for system prompt injection.
 */
export function getFirstPrinciplesPrompt(): string {
  return FIRST_PRINCIPLES_PROMPT
}

/**
 * List all available scenarios (for /cognitive command or diagnostics).
 */
export function listScenarios(): Array<{ id: string; label: string; modelCount: number }> {
  return SCENARIOS.map(s => ({
    id: s.id,
    label: s.label,
    modelCount: s.models.length,
  }))
}
