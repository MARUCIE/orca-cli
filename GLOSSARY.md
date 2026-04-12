# GLOSSARY.md - 术语表与定义库

> AI-Fleet 项目专用术语速查 | 按字母/拼音排序
> Cross-CLI: Claude Code / Codex / Gemini 均应在任务启动时读取本文件

**加载方式**:
- Claude Code: 自动加载（项目根目录 GLOSSARY.md）
- Codex: 通过 `~/.codex/instructions.md` 引用，或项目根目录 GLOSSARY.md
- Gemini: 通过 GEMINI.md 引用，或项目根目录 GLOSSARY.md
- 同步机制: `ai-tools-launcher.sh` 的 `ensure_agent_docs()` 自动复制到项目目录

---

## A

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Agent Council | Agent Council | 多视角 SubAgent 并行辩论模式（PM/Architect/Security/QA），输出综合共识 | AGENTS.md |
| Agent DNA | Agent DNA Capsule | 跨 Agent 可继承的经验胶囊（SKILL.md + triggers + tags），支持 inherit/solidify/validate | configs/dna-registry.json |
| Agent Teams | Agent Teams Swarm | 多智能体编排模式（Leader/Swarm/Pipeline/Council/Watchdog），用于复杂并行任务 | CLAUDE.md |

## D

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| DoD | Definition of Done | 完成标志。Round 1: `ai check` 自动化验证；Round 2: 按 USER_EXPERIENCE_MAP.md 模拟真实人工测试并留证据。两轮都通过才允许宣称完成 | CLAUDE.md |
| DNA Capsule | DNA Capsule | Agent DNA 的最小单元。一个 OpenClaw skill 目录（含 SKILL.md），可被 `ai dna inherit` 下载并激活 | configs/dna-registry.json |

## F

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| feature-dev | Feature Development | 中型任务形态。一个主窗口 + Todo 跟随即可完成，不强制初始化 planning files | CLAUDE.md |
| Full-loop Closure | Full-loop Closure | 代码变更必须确保：入口已接线（UI 路由/CLI 命令）、前后端集成可用、API 契约已验证、自动化测试覆盖 | CLAUDE.md |

## H

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| HITL | Human-in-the-Loop | 涉及资金/隐私/生产系统的操作需人工二次确认 | CLAUDE.md |

## L

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Longrun Harness | Long-running Harness | 跨会话/长周期任务护栏。`ai longrun init` 生成 feature_list + progress log，每次会话只完成一个 feature | CLAUDE.md |

## M

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| MCP | Model Context Protocol | Anthropic 开放协议，Agent 通过 MCP Server 连接外部工具（浏览器/数据库/API） | 行业标准 |
| MoA | Mixture of Agents | 多模型交叉验证模式，用于深度研究/事实核查 | CLAUDE.md |

## P

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| PDCA Patrol | PDCA 巡查表 | 四文档联动机制：PRD + USER_EXPERIENCE_MAP + SYSTEM_ARCHITECTURE + PLATFORM_OPTIMIZATION_PLAN，任何一处变更必须同步更新其余三处 | CLAUDE.md |
| Planning with Files | Planning with Files | 大型任务形态（"U盘型"）。三文件外置记忆：task_plan.md（目标/进度）+ notes.md（证据/研究）+ deliverable.md（交付物打勾） | CLAUDE.md |
| Postmortem | Postmortem (RCA) | 事故尸检报告。必须包含 machine-matchable triggers（关键词/路径/正则），存放于 `./postmortem/PM-*.md` | CLAUDE.md |
| PROJECT_DIR | Project Directory | 当前任务的项目根目录。必须归一为 git root，禁止在 HOME 或 Projects 容器根目录操作 | CLAUDE.md |

## R

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Ralph Loop | Ralph Loop (Stop Hook) | 多轮自纠错机制。把"退出"变成"下一轮输入"，直到满足 completion promise 或达到最大轮次 | layers/L3-intelligence/skills |
| Rolling Ledger | Rolling Requirements & Prompts | 滚动需求台账 + 规划提示词库。单一事实源：`ROLLING_REQUIREMENTS_AND_PROMPTS.md` | CLAUDE.md |

## S

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Sandbox Tiers | Sandbox Isolation Tiers | 沙盒隔离级别。T0=Host / T1=Node VFS / T2=Deno microVM / T3=Devcontainer / T4=Firecracker | .claude/rules/05 |
| SOP | Standard Operating Procedure | 标准操作流程。AI-Fleet 中通过 `ai auto` 自动匹配并执行 | core/sop_engine.py |
| Spec Kit | Spec Kit | feature spec 脚手架。`ai feature-dev <slug>` 生成 `specs/<id>-<slug>/` 目录 | CLAUDE.md |

## T

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Task Closeout | Task Closeout | 任务收尾沉淀。四个落点：Skills / PDCA 四文档 / 底层规范 / Rolling Ledger | CLAUDE.md |
| Three-end Consistency | 三端一致性 | 任务完结前核对 Local / GitHub / Production 版本一致（commit SHA 或 artifact digest） | CLAUDE.md |

## U

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Ultrathinking | Ultrathinking Mode | 同一 bug 连续出现 >= 2 次时自动触发的联合会诊模式。证据对齐 -> 根因树 -> 三方案对比 -> 最小可验证改动 | CLAUDE.md |

## W

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| WF15 | 15-Step Multi-Project Workflow | 15 步多项目 pipeline。`ai wf15 run` 按步骤执行设计/翻译/修复/发布，内置 git/doc/闭环/三端检查 | CLAUDE.md |
| Workflow Router | Workflow Router | 任务场景路由器。基于触发词识别 scenario/scope/mode，选择 feature-dev 或 planning-with-files | layers/L3-intelligence/skills |

---

## 文档层级术语

| 缩写 | 全称 | 说明 |
|------|------|------|
| PRD | Product Requirements Document | 项目级需求文档，滚动更新 |
| UX Map | User Experience Map | 用户体验地图 / User Journey Map |
| SA | System Architecture | 系统架构图（含 Mermaid） |
| POP | Platform Optimization Plan | 平台优化计划 |

---

## 模型路由术语

| 术语 | 说明 |
|------|------|
| 场景类型 | chat / code / vision / search / image / image_edit / video / video_i2v / embedding / audio_stt / audio_tts / reranker / workflow |
| 质量档位 | Premium / Balanced (default) / Fast |
| Aggregator-First | 路由策略：优先通过聚合器（Poe/OpenRouter），再 fallback 到直连 |
| 短名模型 ID | 业务代码只用短名（如 `claude-sonnet`），平台映射在统一映射表维护 |

---

## CLI 与运行时术语

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| ai | AI-Fleet Launcher | 统一入口 CLI。`bin/ai` -> `ai-tools-launcher.sh` | bin/ai |
| ai check | AI Check | 自动化验证（lint + test + security），DoD Round 1 | CLAUDE.md |
| ai doctor | AI Doctor | 工具箱稳定性体检。`--json` 机器输出，`--fix` 自动修复 | launcher |
| bootstrap_project_context | Bootstrap | 启动器函数：同步 5 个底层规范文件 + GEMINI.md/CODEX.md 到项目目录 | launcher |
| normalize-claude-md | Normalizer | CLAUDE.md -> 规范化 Markdown 的 Node.js 转换器，生成 GEMINI.md/CODEX.md | core/ |
| Spec Kit | Spec Kit | feature spec 脚手架。`ai feature-dev <slug>` 生成 `specs/<id>-<slug>/` 目录 | CLAUDE.md |

## 隔离与安全术语

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Sandbox Tiers | Sandbox Isolation Tiers | T0=Host / T1=Node VFS / T2=Deno microVM / T3=Devcontainer / T4=Firecracker | rules/05 |
| PreToolUse Hook | Pre-Tool Validation | `pre-tool-validate.sh`：在工具调用前拦截危险模式 | .claude/settings.json |
| Self-evolve Hook | Post-Tool Self-evolution | 同会话工具调用 > 8 次时输出优化建议 + Skill 化方向 | CLAUDE.md |

## 工作流模式术语

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| Leader | Leader Mode | 团队协调模式：Leader 编排委派，Teammates 执行 | Agent Teams |
| Swarm | Swarm Mode | 并行探索模式：多 Agent 同时探索不同方向 | Agent Teams |
| Pipeline | Pipeline Mode | 顺序门禁模式：步骤串联，每步有 gate | Agent Teams |
| Council | Council Mode | 多视角辩论模式：PM/Architect/Security/QA 各出意见 | Agent Teams |
| Watchdog | Watchdog Mode | 质量监控模式：持续监控指标并告警 | Agent Teams |
| RPI | Research-Plan-Implement | 三阶段工作流：Phase 1 可行性研究 -> Phase 2 规划 -> Phase 3 实现 | .claude/skills/ |

## 新增工具与平台术语

| 术语 | 英文 | 定义 | 来源 |
|------|------|------|------|
| ASC | Agent Supervisor CLI | 多 Agent 进程监控与调度 CLI | bin/asc |
| CodeGraph | Code Knowledge Graph | 代码级知识图谱引擎（AST 解析 + KuzuDB 图存储） | scripts/codegraph-oss.py |
| CogNebula | Cognitive Nebula | 企业级认知星云平台（Graph RAG + 3D 可视化 + MCP） | scripts/cognebula.py |
| CogniVerse | CogniVerse | 多维认知宇宙（CodeGraph + CogNebula 统一入口） | scripts/cogniverse.py |
| GitNexus | Git Knowledge Nexus | Git 历史知识图谱引擎（commit/branch/PR 关系挖掘） | scripts/gitnexus-kg.py |

---

## 配套文档（Cross-Reference）

| 文件 | 用途 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 工作准则（单一事实源） |
| [TOOLBOX.md](TOOLBOX.md) | 工具/接口/服务速查 |
| [SKILL.md](SKILL.md) | 技能树索引（按场景查 skill） |
| [AGENTS.md](AGENTS.md) | 角色协作规范 |

---

Maurice | maurice_wen@proton.me
