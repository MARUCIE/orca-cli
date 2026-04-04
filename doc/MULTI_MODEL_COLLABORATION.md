# Multi-Model Collaboration — Design Document

> The one feature no single-vendor CLI can ever have.

## Problem

Claude Code only uses Claude. Codex only uses GPT. Gemini Code only uses Gemini.
Forge CLI has access to 11 models from 7 vendors through Poe. This is an untapped
superpower — currently, the user picks ONE model per session.

## Insight

Different models have measurably different strengths:

| Model | Strength | Weakness |
|-------|----------|----------|
| claude-opus-4.6 | Deep reasoning, careful analysis | Slow, expensive |
| gpt-5.4 | Fast code generation, broad knowledge | Sometimes shallow |
| gemini-3.1-pro | Massive context (2M), multimodal | Can be verbose |
| grok-4.20 | Multi-agent native, real-time data | Less refined code |
| qwen3.6-plus | Chinese/Asian language, math | English nuance |
| kimi-k2.5 | Long-context reasoning | Limited tool use |

**No single model is best at everything. The optimal strategy is to use multiple
models collaboratively — like a team of specialists, not a single generalist.**

## Three Collaboration Modes

### 1. Council Mode (议会模式) — `/council`

**Use case**: Decisions, code review, architecture, debugging tough issues.

```
forge council "should we use SQL or NoSQL for this?" --models 3
forge council "review this PR for security issues"
```

**Flow**:
```
                    ┌─── Model A ──→ Answer A ───┐
User Prompt ───────├─── Model B ──→ Answer B ───├──→ Judge Model ──→ Synthesized Result
                    └─── Model C ──→ Answer C ───┘
```

1. Same prompt sent to N models in parallel (default: 3 diverse models)
2. All N responses collected
3. A judge model (default: claude-opus-4.6) receives all responses and synthesizes:
   - Points of agreement (high confidence)
   - Points of disagreement (flag for user)
   - Best answer with reasoning
4. User sees: individual answers (collapsed) + synthesized verdict

**Auto-model selection**: Pick maximally diverse models (one from each vendor family).

### 2. Race Mode (竞速模式) — `/race`

**Use case**: Speed-critical tasks where any good answer will do.

```
forge race "write a function to parse CSV" --models 5
```

**Flow**:
```
                    ┌─── Model A ──→ ✓ (3.2s) ──→ WINNER
User Prompt ───────├─── Model B ──→ ... (still running)
                    ├─── Model C ──→ ... (still running)
                    └─── (cancel remaining)
```

1. Same prompt sent to N models in parallel
2. First model to return a complete, valid response wins
3. Remaining requests are cancelled (abort signal)
4. Shows: winner model, time, response, and which models were still running

### 3. Pipeline Mode (流水线模式) — `/pipeline`

**Use case**: Complex tasks that benefit from specialized roles.

```
forge pipeline "build a REST API for user management" \
  --plan claude-opus-4.6 \
  --code gpt-5.4 \
  --review gemini-3.1-pro
```

**Flow**:
```
Plan (Opus) ──→ Code (GPT) ──→ Review (Gemini) ──→ Fix (GPT) ──→ Verify (Opus)
```

1. **Plan stage**: Architect model creates a detailed plan
2. **Code stage**: Fast coder model implements the plan
3. **Review stage**: Reviewer model checks for issues
4. **Fix stage**: Coder fixes any issues found
5. **Verify stage**: Architect verifies the fix matches the plan

Each stage's output feeds into the next stage's prompt.

## Architecture

### New module: `src/multi-model.ts`

```typescript
interface CouncilOptions {
  prompt: string
  models: string[]          // models to consult
  judgeModel?: string       // synthesis model (default: first model)
  maxConcurrent?: number    // parallel limit
}

interface RaceOptions {
  prompt: string
  models: string[]
  timeout?: number          // per-model timeout
}

interface PipelineOptions {
  prompt: string
  stages: Array<{
    role: 'plan' | 'code' | 'review' | 'fix' | 'verify'
    model: string
  }>
}
```

### Integration Points

1. **Slash commands**: `/council`, `/race`, `/pipeline` in REPL
2. **CLI commands**: `forge council "prompt"`, `forge race "prompt"`
3. **Tool**: `multi_model_council` available to the agent itself

### Model Selection Strategy

When user doesn't specify models, auto-select for maximum diversity:

```typescript
const DIVERSITY_GROUPS = [
  ['claude-opus-4.6', 'claude-sonnet-4.6'],     // Anthropic
  ['gpt-5.4'],                                   // OpenAI
  ['gemini-3.1-pro', 'gemini-3.1-flash-lite'],  // Google
  ['grok-4.20-multi-agent'],                     // xAI
  ['qwen3.6-plus'],                              // Alibaba
  ['kimi-k2.5'],                                 // Moonshot
  ['glm-5'],                                     // Zhipu
]
// Pick one from each group, prioritizing: Anthropic + OpenAI + Google first
```

### Output Format

```
╭──────────────────────────────────────────╮
│  Council: 3 models · "optimize query"    │
╰──────────────────────────────────────────╯

  ● claude-opus-4.6 (4.2s)
  │ Use a covering index on (user_id, created_at)...
  │ [12 lines]

  ● gpt-5.4 (2.1s)
  │ Add a materialized view for the aggregation...
  │ [8 lines]

  ● gemini-3.1-pro (3.8s)
  │ Partition the table by month, then index...
  │ [10 lines]

  ─────────────────────────────────────────

  ★ Verdict (claude-opus-4.6 as judge, 5.1s)

  All three models agree on indexing. Key differences:
  - Claude: covering index (simplest, works for most cases)
  - GPT: materialized view (best for heavy aggregation)
  - Gemini: partitioning (best for very large tables)

  **Recommendation**: Start with covering index (Claude's approach),
  add materialized view if aggregation becomes a bottleneck.

  Confidence: HIGH (3/3 agree on core approach)

  ─ 3 models · 15.2s total · 2.1s fastest · $0.0412 ─
```

### Competitive Advantage

| Feature | Claude Code | Codex | Forge CLI |
|---------|------------|-------|-----------|
| Single model | ✓ Claude only | ✓ GPT only | ✓ Any of 11 |
| Multi-model parallel | ✗ | ✗ | ✓ Council |
| First-wins racing | ✗ | ✗ | ✓ Race |
| Specialist pipeline | ✗ | ✗ | ✓ Pipeline |
| Cross-vendor synthesis | ✗ | ✗ | ✓ Judge model |

## Implementation Priority

1. **Council Mode** — highest impact, most unique (implement first)
2. **Race Mode** — simplest to implement (parallel + abort)
3. **Pipeline Mode** — most complex (sequential with role prompts)

---

Maurice | maurice_wen@proton.me
