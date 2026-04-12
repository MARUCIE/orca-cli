---
description: Use when scanning this repository skill catalog and routing work to the
  correct skill group.
name: skills-index
---

# SKILL.md - 技能群索引

> AI-Fleet 技能群速查 | 29 Groups, 668 skills | 单一事实源: `configs/skill-groups.json`
> Cross-CLI: Claude Code / Codex / Gemini 均应在任务启动时读取本文件

**架构** (2026-03-31 重构):
- `/` 命令只显示 **Skill Group**（组合技能），不显示个体 skill
- 个体 skill 存放在 `_lib/` 目录（项目级 + 全局级），文件名为 `SPEC.md`
- Group SKILL.md 充当路由器，按需加载 `_lib/<skill-name>/SPEC.md`

**加载方式**:
- Claude Code: 自动加载（项目根目录 SKILL.md）
- Codex: 通过 `~/.codex/instructions.md` 引用，或项目根目录 SKILL.md；Codex 原生 skills 在 `~/.codex/skills/`
- Gemini: 通过 GEMINI.md 引用，或项目根目录 SKILL.md
- 同步机制: `ai-tools-launcher.sh` 的 `ensure_agent_docs()` 自动复制到项目目录

---

## 使用规则

1. **先匹配 Skill Group**：执行任务前先扫描下方 Skill Groups 表，激活最匹配的组（自动或显式）
2. **组内选择**：组激活后优先使用 core tier skill，按需加载 extended tier
3. **选择优先级**：Skill Group > 单一 Skill > Plugin > MCP > 手工步骤
4. **记录选型**：把选用的 group/skill 及原因记到 task_plan.md / notes.md

---

## Skill Groups (Composite Skills)

> 单一事实源: `configs/skill-groups.json` | 最多同时激活 3 个组 | base 组始终活跃

| Group ID | Name | Core Skills | Trigger Keywords | Est. Tokens |
|----------|------|-------------|------------------|-------------|
| base | Base Essentials | planning-with-files, git-commit, verification-before-completion, code-review | (always active) | 2800 |
| frontend-dev | Frontend Development | frontend-design, react-best-practices, frontend-testing | frontend, React, dashboard, component | 3500 |
| design-system | Design System | design-taste-frontend, product-design, stitch-design-pipeline | design, redesign, brand, prototype, Stitch | 3000 |
| doc-styling | Document Styling | html-style-router | report, guide, briefing, analysis | 2000 |
| product | Product Management | brainstorming, ralph-wiggum, compliance-docs, stitch-design-pipeline, **cognitive-skeleton** | brainstorm, PRD, product, feature, prototype, mental model, 思维模型 | 4500 |
| architecture | Architecture & Engineering | rpi-research -> rpi-plan -> rpi-implement (sequenced) | architecture, new feature, ADR | 3500 |
| research | Deep Research | deep-research, notebooklm, agent-reach, x-reader | research, SOTA, read article, fetch URL | 2000 |
| data | Data & Analytics | bigdata-core, bigdata-viz | data, ML, analytics, visualization | 3000 |
| devops | DevOps & Quality | git-commit, code-review, github-pr-creation, verification-before-completion | git, PR, review, deploy | 3000 |
| media | Media Production | video-constrict, remotion-best-practices | video, image, media, download | 2500 |
| skill-ops-pipeline | Agent & Skill Operations | skill-creator, creating-skills, skill-group-loop | skill creator, eval skill, optimize skill, migrate agent | 3000 |
| orchestration | Heavy Orchestration (Conductor) | conductor-go, conductor-orchestrator, conductor-evaluators, conductor-board | /go, conductor, board meeting, full orchestration | 4000 |
| device-automation | Device Automation | android-device-automation, ios-device-automation, desktop-computer-automation | android, ios, mobile, device, desktop automation | 2500 |
| browser-scraping | Browser & Scraping | browser-automation, chrome-bridge-automation, scrapling-crawler | scrape, crawl, Cloudflare, headless, Electron | 2500 |
| knowledge | Knowledge Management | obsidian-markdown, obsidian-bases | obsidian, vault, PDF, canvas, mind map | 2000 |
| automation | Workflow Automation | n8n-automation, ghost-os-automation | n8n, ghost os, 小红书, macOS automation | 2500 |
| market-strategy | Market Strategy & GTM | competitor-analysis, competitive-battlecard, gtm-strategy, **cognitive-skeleton** | GTM, market research, pricing, SWOT, growth, 芒格, framework | 3000 |
| frontend-polish | Frontend Polish | design-taste-frontend, redesign-existing-projects, jh3y-hover-cards | polish, 打磨, UI improvement, redesign | 2500 |

**Activation**: auto-detect (task keyword match) | explicit ("use frontend-dev group") | task-type (SOP trigger)

### Loop Execution (Multi-Skill PDCA)

Groups with `execution.mode: "loop"` in `configs/skill-groups.json` run their skills iteratively:

| Group | Loop Skills | Gate | Max Iter |
|-------|------------|------|----------|
| frontend-dev | frontend-design -> react-best-practices -> frontend-testing | `npx tsc --noEmit` | 3 |
| architecture | rpi-research -> rpi-plan -> rpi-implement | `ai check --json --no-tests` | 3 |
| product | brainstorming -> ralph-wiggum -> compliance-docs | completion_promise (PRD_COMPLETE) | 2 |
| skill-ops-pipeline | skill-creator -> creating-skills -> skill-group-loop | `registry_validator --groups --strict` | 3 |
| orchestration | conductor-go -> conductor-orchestrator -> conductor-evaluators | completion_promise (TRACK_COMPLETE) | 5 |

**Trigger**: "group loop", "skill loop", "PDCA loop", "iterative improvement"
**Orchestrator**: `skill-group-loop` skill (`.claude/skills/skill-group-loop/SKILL.md`)

### Orchestration Mode Selection

| 场景 | 推荐模式 | 理由 |
|------|---------|------|
| 单文件修改/小 bugfix | base (无组切换) | 开销最低 |
| 中等功能 (1-3 文件) | architecture (RPI) | 人工可控的三阶段 |
| 大型功能 (5+ 文件, 多依赖) | orchestration (Conductor) | 自动 DAG 并行 + Board 审核 + 知识学习 |
| 多 Agent 并行 (独立任务) | Superset Desktop + 任意组 | 进程隔离 + worktree，每个 Agent 内部自选组 |

---

## 工作流与规划

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| cognitive-skeleton | layers/L3-intelligence/skills | 决策/策略/风险/增长/问题分析，211 模型格栅（111 Munger + 100 PM），9 场景路由 |
| planning-with-files | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 大型任务，需跨会话断点续传 |
| workflow-router | layers/L3-intelligence/skills | 任务场景路由，识别 scenario/scope/mode |
| engineering-protocol | layers/L3-intelligence/skills | 最小 diff + 拓扑映射协议注入 |
| ralph-loop | layers/L3-intelligence/skills, codex-skills | 多轮自纠错直到完成承诺 |
| ralph-wiggum | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 需求 -> 规划 -> 迭代闭环（AUDIENCE_JTBD） |
| brainstorming | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 创建功能/组件/修改行为前的需求探索 |
| continue | .claude/skills/ | 跨会话恢复上下文 |
| prompt-engineering-100 | layers/L3-intelligence/skills | 需求分析 -> 可执行提示词生成 |

## 代码工程

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| writing-plans | `skills/shared/`, `~/.codex/skills/` | 编写实现计划 |
| executing-plans | `skills/shared/`, `~/.codex/skills/` | 执行实现计划 |
| subagent-driven-development | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/` | 并行 SubAgent 实现 |
| dispatching-parallel-agents | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/` | 2+ 独立任务并行分发 |
| test-driven-development | layers/L3-intelligence/skills/skills/ | TDD 实现 |
| systematic-debugging | layers/L3-intelligence/skills/skills/ | Bug/测试失败/异常排查 |
| vibe-debug | layers/L3-intelligence/skills/skills/ | 自动化 TDD 调试流水线 (reproduce -> test -> fix-loop -> verify) |
| using-git-worktrees | `skills/shared/`, `~/.codex/skills/` | 隔离 feature 工作 |
| finishing-a-development-branch | `skills/shared/`, `~/.codex/skills/` | 完成后合并/PR/清理 |
| using-superpowers | `skills/shared/`, `~/.codex/skills/` | 会话初始化，发现可用 skills |

## Git & GitHub

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| git-commit | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/` | 提交变更（Conventional Commits） |
| commit-helper | .claude/skills/ | 分析 diff 生成 commit message |
| github-pr-creation | `skills/shared/`, `~/.codex/skills/` | 创建 PR |
| github-pr-merge | `skills/shared/`, `~/.codex/skills/` | 合并 PR |
| github-pr-review | `skills/shared/`, `~/.codex/skills/` | 处理 PR review 反馈 |
| release-skills | .claude/skills/ | 通用发布工作流（自动检测版本文件/changelog，9 步发布，7 语言 changelog，baoyu-skills） |

## 代码审查与质量

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| code-review | .claude/skills/ | 代码质量/安全/可维护性审查 |
| requesting-code-review | `skills/shared/`, `~/.codex/skills/` | 完成任务后请求审查 |
| receiving-code-review | `skills/shared/`, `~/.codex/skills/` | 收到审查反馈时 |
| verification-before-completion | `skills/shared/`, `~/.codex/skills/` | 宣称完成前验证 |
| creating-skills | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/` | 创建新 skill |
| writing-skills | `skills/shared/`, `~/.codex/skills/` | 编写/编辑 skill |
| bug-hunt | ~/.claude/skills/ | 对抗式 3-Agent Bug 狩猎（adversarial bug hunting） |

## 前端与 UI

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| frontend-design | .claude/skills/ | 生产级前端界面设计 |
| frontend-testing | .claude/skills/ | 前端性能/控制台/响应式/E2E 验证 |
| react-best-practices | .claude/skills/ | React/Next.js 性能优化 |
| product-design | .claude/skills/ | 画布/原型/品牌资产 |
| tanstack-start-dashboard | .claude/skills/ | TanStack Start + shadcn/ui 后台脚手架 |
| diceui | .claude/skills/ | shadcn/ui 业务组件库 |
| jh3y-hover-cards | .claude/skills/ | CodePen hover blur 效果封装 |
| valq-powerbi-planning | .claude/skills/ | ValQ 风格规划组件/图表 |
| ui-skills | codex-skills | UI 约束规则安装 |
| web-interface-guidelines | codex-skills | Vercel Web 界面规范安装 |

## 数据与分析

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| bigdata-core | .claude/skills/ | 大规模数据处理（Polars/Dask/Vaex） |
| bigdata-ml | .claude/skills/ | ML 训练/部署（sklearn/PyTorch/Transformers） |
| bigdata-viz | .claude/skills/ | 数据可视化（Matplotlib/Seaborn/Plotly） |
| excel-analysis | .claude/skills/ | Excel/CSV 分析与处理 |

## 算法与研究

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| algo-core | .claude/skills/ | 图算法/符号数学/优化/仿真/概率编程 |
| algo-dl | .claude/skills/ | 深度学习（PyTorch/Transformers/GNN/RL） |
| karpathy-autoresearch | .claude/skills/ | 自动迭代实验框架（Karpathy 方法论，ML 训练/调参/代码优化） |
| research-paper-writing | ~/.claude/skills/ | ML/CV/NLP 学术论文写作（详细技能集） |

## 产品管理 (PM Skills Marketplace, phuryn/pm-skills)

### Discovery -- 产品发现

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| brainstorm-ideas-new | .claude/skills/ | 新产品创意发散（多视角） |
| brainstorm-ideas-existing | .claude/skills/ | 已有产品创意发散 |
| identify-assumptions-new | .claude/skills/ | 新产品假设识别（8 类风险） |
| identify-assumptions-existing | .claude/skills/ | 已有产品假设识别 |
| prioritize-assumptions | .claude/skills/ | 假设优先级（Impact x Risk 矩阵） |
| brainstorm-experiments-new | .claude/skills/ | 新产品实验设计（pretotype） |
| brainstorm-experiments-existing | .claude/skills/ | 已有产品实验设计 |
| opportunity-solution-tree | .claude/skills/ | OST 机会方案树（Teresa Torres） |
| interview-script | .claude/skills/ | 用户访谈脚本（JTBD 探询） |
| summarize-interview | .claude/skills/ | 访谈摘要结构化 |
| analyze-feature-requests | .claude/skills/ | 需求分析与优先级排序 |
| metrics-dashboard | .claude/skills/ | 指标看板设计 |
| prioritize-features | .claude/skills/ | 功能优先级（9 种框架） |

### Strategy -- 产品战略

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| product-vision | .claude/skills/ | 产品愿景构建 |
| product-strategy | .claude/skills/ | 产品战略（9 section） |
| value-proposition | .claude/skills/ | 价值主张设计（6 部分 JTBD） |
| business-model | .claude/skills/ | 商业模式画布（BMC 9 模块） |
| lean-canvas | .claude/skills/ | 精益画布 |
| startup-canvas | .claude/skills/ | 创业画布（Strategy + Lean 组合） |
| swot-analysis | .claude/skills/ | SWOT 分析 |
| pestle-analysis | .claude/skills/ | PESTLE 宏观环境分析 |
| porters-five-forces | .claude/skills/ | 波特五力分析 |
| ansoff-matrix | .claude/skills/ | 安索夫矩阵（增长战略） |
| monetization-strategy | .claude/skills/ | 变现策略设计 |
| pricing-strategy | .claude/skills/ | 定价策略分析 |

### Execution -- 产品执行

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| create-prd | .claude/skills/ | PRD 撰写（8 section） |
| brainstorm-okrs | .claude/skills/ | OKR 构思 |
| outcome-roadmap | .claude/skills/ | 结果导向路线图 |
| sprint-plan | .claude/skills/ | Sprint 规划 |
| user-stories | .claude/skills/ | 用户故事（3C） |
| job-stories | .claude/skills/ | Job Stories（JTBD 格式） |
| wwas | .claude/skills/ | Why-What-Acceptance 格式 backlog |
| test-scenarios | .claude/skills/ | 测试场景生成 |
| stakeholder-map | .claude/skills/ | 利益相关方地图（Power x Interest） |
| pre-mortem | .claude/skills/ | 事前验尸分析 |
| retro | .claude/skills/ | Sprint 回顾 |
| release-notes | .claude/skills/ | 发布说明生成 |
| summarize-meeting | .claude/skills/ | 会议纪要结构化 |
| dummy-dataset | .claude/skills/ | 生成测试数据集 |
| prioritization-frameworks | .claude/skills/ | 9 种优先级框架参考 |

### Market Research -- 市场研究

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| user-personas | .claude/skills/ | 用户画像（3 personas + JTBD） |
| user-segmentation | .claude/skills/ | 用户分群 |
| market-segments | .claude/skills/ | 市场细分 |
| market-sizing | .claude/skills/ | 市场规模（TAM/SAM/SOM） |
| customer-journey-map | .claude/skills/ | 用户旅程地图 |
| competitor-analysis | .claude/skills/ | 竞品分析 |
| sentiment-analysis | .claude/skills/ | 情感分析 |

### Data Analytics -- 数据分析

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| sql-queries | .claude/skills/ | 自然语言生成 SQL |
| cohort-analysis | .claude/skills/ | 留存/cohort 分析 |
| ab-test-analysis | .claude/skills/ | A/B 测试统计显著性分析 |

### GTM -- 上市策略

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| beachhead-segment | .claude/skills/ | 登陆市场选择 |
| ideal-customer-profile | .claude/skills/ | ICP 定义 |
| gtm-strategy | .claude/skills/ | GTM 策略规划 |
| gtm-motions | .claude/skills/ | GTM 动作类型（7 种） |
| growth-loops | .claude/skills/ | 增长飞轮设计 |
| competitive-battlecard | .claude/skills/ | 竞争对手 Battlecard |

### Marketing -- 营销增长

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| marketing-ideas | .claude/skills/ | 营销创意（低成本） |
| positioning-ideas | .claude/skills/ | 定位差异化 |
| value-prop-statements | .claude/skills/ | 价值主张文案 |
| product-name | .claude/skills/ | 产品命名 |
| north-star-metric | .claude/skills/ | 北极星指标定义 |

### PM Toolkit -- 工具箱

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| review-resume | .claude/skills/ | PM 简历审查 |
| draft-nda | .claude/skills/ | NDA 起草 |
| privacy-policy | .claude/skills/ | 隐私政策起草 |
| grammar-check | .claude/skills/ | 语法/逻辑/文风检查 |

## 文档与 PDF

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| pdf-processing | .claude/skills/ | PDF 提取/填表/合并/转换 |
| pdf-layout-analysis | .claude/skills/ | PDF 版面分析（Docker 服务） |
| compliance-docs | .claude/skills/ | 合规文档/政策映射/审计报告 |
| codegen-doc | ~/.claude/skills/ | 代码生成文档（Code-to-Documentation） |
| md-report-summary | ~/.claude/skills/ | Markdown 报告摘要生成 |
| paper-write | ~/.claude/skills/ | 学术论文写作 |

## 知识管理

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| zread-introspection | layers/L3-intelligence/skills/skills/ | Zread MCP 源码级自省，允许 OpenClaw 检索自身框架源码 |
| obsidian-markdown | .claude/skills/ | Obsidian 风格 Markdown（wikilinks/callouts） |
| obsidian-bases | .claude/skills/ | Obsidian Bases（数据库视图） |
| json-canvas | .claude/skills/ | JSON Canvas 文件（mind map/flowchart） |
| notebooklm | .claude/skills/, layers/L3-intelligence/skills | Google NotebookLM 查询 |

## Web3 与量化交易

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| hyperx-trade | layers/L3-intelligence/skills/skills/ | Hyperliquid 钱包分析、清算热图与自动化跟单 (Copy-Trading) |

## 媒体与视频

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| video (registry) | layers/L3-intelligence/skills | 一句话生成视频 |
| video-constrict | .claude/skills/ | 视频压缩到目标大小 |
| remotion-best-practices | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | Remotion 视频创作 + 短视频制作工作流 |
| nanobanana-image-gen | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | Gemini Flash/Pro 图片生成/编辑（MCP） |
| downloadhd | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 54+ 平台视频/图片/音频下载（浏览器自动化） |
| surge | ~/bin/surge | Go TUI 多线程下载管理器 (v0.6.10, 32 并发连接, 多镜像, 守护进程架构) |
| baoyu-translate | ~/.claude/skills/ | 三模式翻译 (快速/标准/精修, 长文分块, 术语表, 7.1K stars) |
| makeownsrt | ~/.claude/skills/ | MKV 字幕提取 + 翻译 |
| wechat-article-writer | ~/.claude/skills/ | 微信公众号文章生成 |
| excalidraw-diagram-skill | ~/.claude/skills/ | Excalidraw 图表生成 |
| drawio-diagram | ~/.claude/skills/ | Draw.io 图表生成 |
| codegen-diagram | ~/.claude/skills/ | 代码生成图表（Code-to-Diagram） |
| pptgen-drawio | ~/.claude/skills/ | PPT 生成（含 Draw.io 图表） |

## 设计资源

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| better-icons | .claude/skills/ | 200K+ 图标搜索（150+ collections: Lucide/Heroicons/Material Design 等，`npx better-icons search/get`） |
| canvas-design | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 画布级视觉艺术创作（海报/设计稿） |
| design-taste-frontend | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 反 AI Purple 前端设计（可调参数/反模式目录/硬件加速） |
| redesign-existing-projects | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 审计既有 UI 并升级为高端设计（不破坏功能） |
| stitch-design-pipeline | .claude/skills/ | Google Stitch AI 原型设计流水线：PRD -> 多方案生成 -> AI 比稿 -> 选定 -> 前端代码 |
| full-output-enforcement | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 强制完整输出（禁止 TODO/占位符/截断） |
| lobe-icons | .claude/skills/ | LobeHub AI/LLM 模型图标 |
| svglogo-icons | .claude/skills/ | 国内矢量 LOGO 图标库 |

## 自动化与集成

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| uxc-universal-cli | layers/L3-intelligence/skills/skills/ | OpenAPI/GraphQL/MCP/gRPC 通用 API 渐进式发现与确定性调用 |
| n8n-automation | .claude/skills/ | n8n 工作流/Code 节点/表达式 |
| osint-framework | .claude/skills/ | OSINT 资源目录（合规模式） |
| agent-browser-electron | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | Electron 桌面应用 CDP 自动化 |
| agent-browser-slack | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | Slack 桌面端 CDP 自动化 |
| xiaohongshu-automation | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 小红书 CDP 自动发帖/搜索/评论/分析 |
| superset (desktop) | /Applications/Superset.app | 并行 AI Agent 管理器 (git worktree, Claude Code/Codex/OpenCode, Electron TUI) |
| claude-conductor (CLI) | npm global | Claude Code 文档框架 (CONDUCTOR.md/ARCHITECTURE.md/BUILD.md 自动生成) |
| cli-relay | bin/cli-relay, layers/L3-intelligence/skills/skills/ | 本地 AI CLI 代理服务器 (localhost:8317, OAuth+APIKey, 多 Provider 负载均衡/故障转移) |
| claude-to-im | ~/.claude/skills/ | Claude Code 远程 IM 桥接 (Telegram/Discord/飞书, 流式预览, 权限控制) |
| agentic-seo | ~/.claude/skills/ | SEO 分析（12 子技能 + 6 专家 Agent） |
| apify-competitor-intelligence | ~/.claude/skills/ | 竞品分析（via Apify） |
| apify-trend-analysis | ~/.claude/skills/ | 趋势追踪（Google/IG/FB/YT/TikTok, via Apify） |
| apify-ultimate-scraper | ~/.claude/skills/ | 通用 AI 爬虫（via Apify） |
| trends24 | ~/.claude/skills/ | Twitter/X 热搜趋势（Trends24） |
| x-tweet-fetcher | ~/.claude/skills/ | Twitter/X 推文抓取（无需 API Key，v1.6.3） |
| grok-search | ~/.claude/skills/ | xAI Grok 实时 Web + X/Twitter 搜索（server-side tools, 结构化 JSON + citations） |
| grok-twitter-search | ~/.claude/skills/ | xAI Grok Twitter 专用智能搜索 |
| tavily-search | ~/.claude/skills/ | Tavily API 搜索（AI 增强结果，深度搜索，域名过滤） |
| multi-search-engine | ~/.claude/skills/ | 17 引擎集成搜索（百度/微信/Google/DuckDuckGo/WolframAlpha，无需 API Key） |
| web-multi-search | ~/.claude/skills/ | 多引擎并行 Web 搜索 |
| wechat-article-search | ~/.claude/skills/ | 微信公众号文章全文 + 图片提取 |
| bestblogs-daily-digest | ~/.claude/skills/ | BestBlogs.dev 每日早报（7 API 并行，AI Top 10 筛选，3 种输出格式） |
| qiaomu-mondo-poster-design | ~/.claude/skills/ | 一句话生成大师级海报/封面设计（Mondo 风格，需 Nanobanana Pro API） |

## 安全与取证

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| wechat-decrypt | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | 微信 v4.0 数据库解密/消息搜索/实时监控（Windows） |
| vphone-cli | `skills/shared/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/` | Apple Silicon 虚拟 iPhone（iOS 26 安全研究） |

## 浏览器与测试自动化

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| agent-fetch | .claude/skills/ | L4 HTTP 结构化数据提取（Readability/JSON-LD/Next.js/WordPress API/text-density，CSS selector，proxy） |
| scrapling-crawler | .claude/skills/ | 反爬虫/Cloudflare bypass 爬取（Scrapling v0.4.1，StealthyFetcher + Camoufox） |
| ghost-os-automation | .claude/skills/ | L3 macOS 桌面自动化（AX Tree 29 MCP tools，任意 macOS 应用交互，10-20x token 省） |
| playwright-interactive | ~/.claude/skills/ | Playwright 持久会话 UI 调试 (OpenAI curated, js_repl, Electron 支持) |
| playwright-codex | ~/.claude/skills/ | Playwright 浏览器自动化 (导航/表单/截图/数据提取) |
| chrome-devtools-mcp | MCP (user-level) | Google 官方 Chrome DevTools MCP -- 浏览器调试/性能分析/无障碍审计/网络监控 (CDP, Puppeteer) |
| screenshot-codex | ~/.claude/skills/ | 桌面/窗口/区域截图 (OpenAI curated) |
| security-best-practices | ~/.claude/skills/ | 安全最佳实践审查 (OpenAI curated, 语言/框架特定) |

## Agent 运维与学习 (from ECC 63.8K stars)

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| strategic-compact | ~/.claude/skills/ | 策略性 compact (hook 计数 50 次工具调用后建议, 逻辑边界压缩) |
| continuous-learning-v2 | ~/.claude/skills/ | 持续学习 v2.1 (项目隔离 instinct, 置信度评分, 自动进化为 skill) |
| search-first | ~/.claude/skills/ | 先搜索后编码 (调用 researcher agent 查找现有工具/库/模式) |
| verification-loop | ~/.claude/skills/ | 验证循环 (编辑后自动检查, 构建/lint/测试闭环) |
| enterprise-agent-ops | ~/.claude/skills/ | 企业级 Agent 运维 (可观测性/安全边界/生命周期管理) |
| skill-prompt-convert | ~/.claude/skills/ | Skill 转 Prompt 转换器 |

## 质量与运维

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| ecc-hooks | layers/L3-intelligence/skills/skills/ | ECC 全生命周期钩子引擎 (Pre/PostToolUse 拦截假死/自动格式化/防失忆) |
| postmortem (registry) | layers/L3-intelligence/skills | 事故尸检 + 回归触发器 |
| reflection (registry) | layers/L3-intelligence/skills | 阶段性反思与沉淀 |
| agent-eval-system (registry) | layers/L3-intelligence/skills | Agent 可审计评估框架 |

## 多智能体编排

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| self-improving-agent | layers/L3-intelligence/skills/skills/ | 自我进化/记忆增强 (捕获偏好与避免重复踩坑) |
| agent-teams-swarm (registry) | layers/L3-intelligence/skills | Agent Teams 蜂群编排 |
| multi-agent-orchestration (registry) | layers/L3-intelligence/skills/skills/ | 多智能体双脑协作规划 (PM2并发执行/Symphony/Harness) |
| conductor-orchestrator | layers/L3-intelligence/skills/skills/ | Multi-agent orchestration v3 (/go goal-driven, parallel workers, Board of Directors, 42 skills + 22 commands) |
| skill-group-loop | .claude/skills/ | 组合技能循环引擎 (Multi-Skill PDCA, 组内技能轮流执行直到质量门禁通过) |

## RPI 三阶段

| Skill | 目录 | 触发场景 |
|-------|------|----------|
| rpi-research | .claude/skills/ | Phase 1: 可行性研究（GO/NO-GO） |
| rpi-plan | .claude/skills/ | Phase 2: 实现规划（PM + UX + 工程） |
| rpi-implement | .claude/skills/ | Phase 3: 分阶段实现 + 验证门禁 |

---

## DNA Capsules

| Capsule ID | 类型 | Tags |
|------------|------|------|
| cli-supervisor | openclaw-skill | ops, tmux, agents |
| dna-inheritance | openclaw-skill | dna, skills, inheritance |
| openclaw-best-practices | openclaw-skill | openclaw, security, memory, model-routing |
| agentic-engineering-ceo-mode | openclaw-skill | agentic-engineering, closed-loop, guardrails |

---

## 快速查找

```bash
# 按关键词搜索 skill
ai dna search "<keyword>"

# 查看注册表
cat layers/L3-intelligence/skills/skills/skills-registry.json | python3 -c "
import json, sys
for k, v in json.load(sys.stdin)['skills'].items():
    if '<keyword>' in str(v): print(f'{k}: {v[\"name\"]}')"

# 列出所有 Claude Code skills
ls .claude/skills/

# 列出所有跨 Agent skills
ls ~/.gemini/skills/
```

---

## 配套文档（Cross-Reference）

| 文件 | 用途 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 工作准则（单一事实源） |
| [GLOSSARY.md](GLOSSARY.md) | 术语表与定义库（快速查词） |
| [TOOLBOX.md](TOOLBOX.md) | 工具/接口/服务速查 |
| [AGENTS.md](AGENTS.md) | 角色协作规范 |

---

Maurice | maurice_wen@proton.me
