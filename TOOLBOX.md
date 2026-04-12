# TOOLBOX.md - 外部接口与资源速查

> AI-Fleet 可用工具/接口/服务一览 | 选型优先级：Skill > Plugin > MCP > 手工
> Cross-CLI: Claude Code / Codex / Gemini 均应在任务启动时读取本文件

**加载方式**:
- Claude Code: 自动加载（项目根目录 TOOLBOX.md）
- Codex: 通过 `~/.codex/instructions.md` 引用，或项目根目录 TOOLBOX.md
- Gemini: 通过 GEMINI.md 引用，或项目根目录 TOOLBOX.md
- 同步机制: `ai-tools-launcher.sh` 的 `ensure_agent_docs()` 自动复制到项目目录

---

## 1. CLI 入口

| 命令 | 说明 | 备注 |
|------|------|------|
| `ai` | AI-Fleet 统一入口（launcher 别名） | `bin/ai` -> `ai-tools-launcher.sh` |
| `ai doctor` | 工具箱稳定性体检 | `--json` 输出机器可读；`--fix` 自动修复 |
| `ai check` | 自动化验证（lint + test + security） | DoD Round 1 |
| `ai auto` | SOP 自动匹配与执行 | `--plan` 预览 / `--yes` 直接执行 |
| `ai wf15` | 15 步多项目 pipeline | `init` / `run --start-step N` |
| `ai dna` | Agent DNA 管理 | `search` / `inherit` / `new` / `validate` / `doctor` |
| `ai task` | 任务池管理 | `auto` 生成 / `status` 查看 |
| `ai longrun` | 长任务护栏 | `init <project_dir>` |
| `ai feature-dev` | Feature Spec Kit 脚手架 | `<slug> [--title <title>]` |
| `ai sandbox` | 沙盒化执行 | 高风险命令自动升级隔离级别 |
| `bin/claude` | Claude Code CLI | 订阅版；默认 yolo |
| `1p` | Claude Poe | 使用 Poe API 多模型组运行 Claude Code |
| `bin/codex` | OpenAI Codex CLI | 含 Poe API 模式；默认 yolo |
| `bin/gemini` | Google Gemini CLI | 缺失时自动 npx 回退；默认 yolo |
| `bin/droid` | Factory Droid CLI | 默认 yolo |
| `bin/augment` | Augment CLI | 默认 yolo |
| `bin/amp` | Amp CLI | 默认 yolo |
| `bin/asc` | Agent Supervisor CLI | 多 Agent 进程监控 |
| `bin/codegraph` | CodeGraph 代码图谱 CLI | AST + KuzuDB 知识图谱 |
| `bin/cogniverse` | CogniVerse 统一入口 | CodeGraph + CogNebula |
| `bin/gitnexus` | GitNexus Git 知识图谱 | commit/branch/PR 关系挖掘 |
| `bin/nebula` | CogNebula 快捷入口 | 企业级认知星云 |
| `bin/graph` | 图谱快捷入口 | CodeGraph 别名 |
| `bin/embed` | 语义嵌入引擎 | Gemini Embedding 2 Preview（text/batch/similarity/image/search） |
| `bin/ait` | AI Tool 快捷入口 | `ait <subcommand>` 常用工具快捷方式 |
| `bin/agent` | Agent 启动器 | 单 Agent 进程启动 |
| `bin/metrics` | 指标采集器 | Fleet 运行时指标汇总 |
| `bin/ruler` | 规则管理器 | .claude/rules/ 规则文件管理 |
| `bin/jarvis` | Jarvis 入口 | 智能助手快捷入口 |
| `bin/github` | GitHub CLI 封装 | gh CLI 增强封装 |
| `bin/speckit` | Spec Kit 生成器 | Feature Spec 文档脚手架 |
| `bin/opencode` | OpenCode CLI | 开源代码 Agent |
| `bin/aider` | Aider CLI | AI pair programming |
| `bin/interpreter` | Open Interpreter | 自然语言代码执行 |
| `bin/af` | AI-Fleet 别名 | `ai` 的短别名 |
| `bin/ai-workflow` | 工作流引擎 | 多步骤工作流执行 |
| `bin/amazon` | Amazon Q CLI | AWS 官方 AI 助手 |
| `bin/codex-2p` | Codex via Poe CLI | Codex 的 Poe API 入口；默认 yolo |
| `bin/codex-openclaw` | Codex OpenClaw 模式 | OpenClaw 集成 Codex |
| `bin/copilot` | GitHub Copilot CLI | Copilot 命令行 |
| `bin/cursor-agent` | Cursor Agent CLI | Cursor IDE Agent 模式 |
| `bin/gemini-acp` | Gemini ACP CLI | Gemini Agent Communication Protocol |
| `bin/oi` | Open Interpreter 别名 | interpreter 短别名 |
| `bin/github-mcp-server` | GitHub MCP Server | GitHub API MCP 服务端 |

---

## 2. MCP Servers (23 total)

### Core (always active)

| Server | 用途 | 配置位置 |
|--------|------|----------|
| **qmd** | 文档全文搜索（BM25 + 向量 + LLM reranking） | `.mcp.json` |
| **github** | GitHub API (repos/issues/PRs/actions/code_security) | `.mcp.json` |
| **ghost-os** | macOS AX Tree 自动化（29 tools） | `.mcp.json` |
| **chrome-devtools** | CDP 调试 + Lighthouse + 内存快照（40+ tools） | `settings.local.json` |
| **claude-in-chrome** | 浏览器扩展 MCP（截图/DOM/表单/导航） | Browser extension |

### Knowledge & Research

| Server | 用途 | 配置位置 |
|--------|------|----------|
| **paperclip** | 8M+ 学术论文原生索引（比 Deep Research 快 10x） | `~/.claude.json` (project) |
| **mempalace** | 跨工具记忆共享（CC=MCP, Codex=CLI），242K drawers | `~/.claude.json` (project) |
| **context7** | 实时文档查询（库/框架/SDK/API） | `~/.claude.json` (project) |

### Extended

| Server | 用途 | 配置位置 |
|--------|------|----------|
| **agentation** | Agent annotation / feedback 工作流 | `.mcp.json` |
| **21st-magic** | UI 组件生成 | `.mcp.json` |
| **apple-docs** | Apple 开发者文档 + WWDC 搜索 | `.mcp.json` |
| **stitch** | Google Design 原型（Stitch MCP proxy） | `.mcp.json` |
| **nanobanana-mcp** | Gemini 图片生成/编辑 | `settings.local.json` |
| **theSVG** | 5600+ SVG 图标（品牌 + 云基础设施） | MCP 注册 |
| **XcodeBuildMCP** | Xcode build 集成（iOS/macOS） | MCP 注册 |

### Anthropic Managed (Remote)

| Server | 用途 |
|--------|------|
| **Cloudflare** | Workers, D1, KV, R2 管理 |
| **Gmail** | 邮件搜索/读取/草稿 |
| **Google Calendar** | 日程/会议管理 |

### Plugins

| Plugin | 用途 |
|--------|------|
| **plugin:telegram** | Telegram bot 双向消息（@fleet_claude_code_bot） |
| **plugin:discord** | Discord bot 通知（AI-Fleet Command#0520） |
| **plugin:playwright** | Playwright 浏览器自动化（备选方案） |

---

## 3. Browser Automation（6 层架构，WebMCP-aware）

| Layer | 工具 | Token 成本 | 说明 |
|-------|------|-----------|------|
| L0 | WebMCP (`navigator.modelContext`) | ~20 | Chrome 146+ 结构化工具调用（Preview） |
| L1 | agent-browser-session (Patchright) | ~200 | 持久登录 + 反检测 + 多 Agent 并行 + DOM 交互 |
| L2 | Chrome DevTools MCP (autoConnect) / Ghost OS | ~300 | CDP 调试 + Lighthouse 审计 + 内存快照 + AX Tree 桌面应用 |
| L3 | Midscene / Playwright (Vision) | ~2000 | 截图 + VLM 视觉定位（最后手段） |
| L4 | agent-fetch / defuddle | ~50 | HTTP 结构化提取，无浏览器（默认） |
| L5 | fleet-page-fetch (VPS) | ~100 + 30s | VPS Chromium 渲染代理（GFW/反爬） |

**路由**: 纯数据 -> L4（默认）| L4 失败 -> L5（VPS 代理）| WebMCP 站点 -> L0 | 已知 DOM -> L1 | 桌面应用 -> L2 | 视觉交互 -> L3
**反爬升级链**: agent-fetch -> fleet-page-fetch -> scrapling-crawler -> Midscene Bridge -> human
**完整路由规则**: `.claude/rules/11-tool-integration.md`

---

## 4. Skill Groups（`/` 命令入口）

**单一事实源**: `configs/skill-groups.json` (v7.1.0)
**架构**: 输入 `/` 只显示 29 个 Group（组合技能），不显示个体 skill

| `/` 命令 | Skills | 触发场景 |
|----------|--------|----------|
| `/product-management-swarm` | 97 | PM, strategy, GTM, PRD, OKR, market |
| `/workflow-meta-swarm` | 69 | workflow, pipeline, agent, n8n, conductor |
| `/development-ops-swarm` | 63 | debug, git, CI/CD, security, code review |
| `/design-ui-swarm` | 61 | design, UI/UX, diagram, PPT, Figma |
| `/game-dev-swarm` | 37 | game, godot, unity, 48-agent studio |
| `/content-creation-swarm` | 31 | write, article, translate, document |
| `/research-learning-swarm` | 29 | learn, research, NotebookLM, RSS |
| `/ljg-cognitive-swarm` | 29 | ljg, 认知, X光, 降秩, cognitive |
| `/finance-tax-swarm` | 29 | 财税, 会计, 记账, 合规, 29 specialists |
| `/impeccable-pipeline` | 20 | UI polish loop: critique->arrange->typeset |
| `/browser-automation-pipeline` | 19 | browser, playwright, screenshot, DOM |
| `/lark-suite-swarm` | 19 | 飞书, lark, IM/Doc/Sheets/Calendar |
| `/web-scraping-pipeline` | 18 | scrape, crawl, extract, download |
| `/ontology-audit-swarm` | 17 | 本体审计, KG, 蜂群审计, 17-expert |
| `/data-analytics-swarm` | 15 | analytics, SQL, A/B, cohort, Excel |
| `/video-media-pipeline` | 15 | video, TTS, avatar, subtitle |
| `/web-search-swarm` | 12 | search, OSINT, deep research |
| `/advertising-swarm` | 12 | full-funnel marketing automation |
| `/algorithm-data-swarm` | 11 | ML, PyTorch, quant, RAG |
| `/animation-swarm` | 10 | GSAP, Remotion, motion |
| `/wechat-cn-social-swarm` | 10 | 微信/企微/飞书 digest + 小红书 |
| `/content-publish-pipeline` | 10 | 公众号/X 全渠道发布管线 |
| `/project-promotion-pipeline` | 7 | SEO, GEO, backlink |
| `/icon-design-swarm` | 7 | macOS icon, poster, logo |
| `/business-diagnosis-pipeline` | 6 | 商业模式诊断, 对标, dbs |
| `/skill-ops-pipeline` | 6 | OpenClaw, skill audit, registry |
| `/wechat-content-pipeline` | 4 | 公众号写作全流程 |
| `/codex-relay-pipeline` | 3 | Claude+Codex relay protocol |
| `/ios-dev-pipeline` | 2 | SwiftUI, XcodeBuildMCP |

**独立工具** (不属于任何组):

| `/` 命令 | 说明 |
|----------|------|
| `/tmux-bridge` | 多 Agent 跨 tmux session 协作工具 |
| `/commit` | Git commit with context |
| `/pr` | Pull request creation |
| `/push-all` | Stage + commit + push |
| `/relay-plan\|code\|codex\|review` | Claude+Codex file-based relay |
| `/rpi:plan\|research\|implement` | RPI 三阶段 |
| `/telegram:access\|configure` | Telegram channel 管理 |
| `/discord:access\|configure` | Discord channel 管理 |

**Skills 目录分布** (2026-03-31 group-first 架构):

```
.claude/skills/                          # 29 Group SKILL.md (visible as / commands)
.claude/skills/_lib/                     # 416 individual SPEC.md (hidden)
~/.claude/skills/_lib/                   # 648 individual SPEC.md (global, hidden)
layers/L3-intelligence/skills/skills/    # 155 advanced skills (Codex/Gemini)
.agents/skills/                          # 46 cross-agent shared skills
```

---

## 5. 配置注册表

| 文件 | 用途 |
|------|------|
| `configs/model-registry.json` | 模型路由映射（短名 -> provider + model ID） |
| `configs/dna-registry.json` | DNA Capsule 注册表 |
| `configs/codegraph-registry.json` | CodeGraph 代码图谱配置 |
| `configs/cognebula-registry.json` | CogNebula 认知星云配置 |
| `configs/skill-groups.json` | Skill Group 注册表（29 groups, 668 skills, v7.1.0） |
| `configs/pipeline-registry.json` | Pipeline 注册表（148 production + 29 dev pipelines） |
| `configs/cli-registry.json` | CLI 工具注册表 |
| `configs/project-registry.json` | 项目注册表（25 projects, 8 product lines） |
| `configs/sandbox/sandbox.default.json` | 沙盒默认配置 |
| `configs/workflows/wf15.local.json` | WF15 本地配置（gitignored） |

---

## 6. 外部服务与 API

| 服务 | 用途 | 认证方式 |
|------|------|----------|
| GitHub API | PR/Issue/检索 | `gh` CLI + GITHUB_TOKEN |
| Google Stitch | UI 原型生成 | stitch.withgoogle.com |
| Google NotebookLM | 文档研究（source-grounded） | 浏览器登录 |
| Poe API | 模型聚合器（fallback） | API Key |
| SiliconFlow | 国内模型（TTS/Image/LLM） | API Key |
| Tailscale | VPN Mesh 网络 | `tailscale status` |
| **MarkItDown** | 万物转 Markdown（PDF/DOCX/PPTX/Excel/YouTube） | `pip3 install markitdown` |
| **getdesign.md** | 产品设计规范一键注入（29+ 产品） | `npx getdesign@latest add <name>` |

---

## 7. 关键脚本

| 脚本 | 用途 |
|------|------|
| `ai-tools-launcher.sh` | 统一启动器（菜单/doctor/规范同步） |
| `scripts/ai-api-call.sh` | API 调用封装 |
| `scripts/ai-api-router.sh` | 模型路由 |
| `scripts/claude-settings-hook-tsc.py` | Claude 设置钩子 |
| `scripts/poe_anthropic_proxy.js` | Poe -> Anthropic 代理 |
| `scripts/regression-test-api.sh` | API 回归测试 |
| `scripts/hooks/post-tool-self-evolve.sh` | PostToolUse 自进化钩子 |
| `scripts/kg-node-sync.sh` | KG 节点同步（Mac <-> kg-node 双向） |
| `scripts/bootstrap-device.sh` | 新设备初始化脚本 |
| `scripts/remote-connect.sh` | 远程连接快捷脚本 |
| `scripts/sync-openclaw-memory.sh` | OpenClaw 记忆同步 |
| `scripts/xcode-agent-setup.sh` | Xcode Agent 环境配置 |
| `core/sop_engine.py` | SOP 引擎（自动匹配与执行） |
| `core/task_cli.py` | 任务池 CLI |
| `tools/generate_ai_tools_manual.py` | 手册生成器 |

---

## 8. 盘点入口（工具调用前必查）

```
claude-code-marketplace/plugins/     # 插件市场
.claude/skills/                      # Claude Code Skills
~/.agents/skills/                    # 跨 Agent Skills
layers/L3-intelligence/skills/skills/                 # 注册表 Skills
layers/L3-intelligence/skills/skills/skills-registry.json  # 注册表（单一事实源）
configs/                             # 所有配置注册表
```

---

## 9. 跨 CLI 工具差异

| 能力 | Claude Code | Codex | Gemini |
|------|-------------|-------|--------|
| 指令文件 | CLAUDE.md + .claude/rules/ | ~/.codex/instructions.md + ~/.codex/skills/ | GEMINI.md（层级记忆） |
| 浏览器 | Claude Chrome (MCP) | Playwright MCP / agent-browser | Playwright MCP / agent-browser |
| Skills 目录 | .claude/skills/ | ~/.codex/skills/ | 无原生 Skills，通过 GEMINI.md 引用 |
| 权限模式 | --dangerously-skip-permissions | --dangerously-bypass-approvals-and-sandbox | --yolo |
| 图片输入 | --image / 拖拽 | --image | 暂不支持 CLI --image |
| 规范同步 | 启动器自动同步 5 文件 | 启动器同步 + instructions.md 覆盖 | 启动器同步 GEMINI.md |

## 10. 底层规范文件体系（5 Pillars）

Ref: "Everything is Context" (arXiv:2512.05470)

```
CLAUDE.md      -> 工作准则（单一事实源，其他 CLI 通过规范化器生成对应版本）
GLOSSARY.md    -> 术语表（直接复制，所有 CLI 共用同一份）
TOOLBOX.md     -> 工具箱（直接复制，所有 CLI 共用同一份）
SKILL.md       -> 技能树（直接复制，所有 CLI 共用同一份）
MEMORY.md      -> 记忆（Claude Code 专用，位于 ~/.claude/projects/.../memory/）
```

### Context Loading Tiers（token 预算分层）

| Tier | 内容 | 加载方式 | Token 预算 |
|------|------|----------|-----------|
| T0 Auto | CLAUDE.md + .claude/rules/ + MEMORY.md | 会话启动自动加载 | ~19K (~10%) |
| T1 Index | GLOSSARY.md / TOOLBOX.md / SKILL.md | 任务启动时按 read priority 加载 | ~6K |
| T2 Query | doc/ / postmortem/ / memory/*.md | 按需搜索+分段读取 | Variable |
| T3 Immutable | git log / chat history | 仅通过工具查询，永不批量加载 | 0 |

### Memory Type Mapping（论文术语 -> 我们的实现）

| 论文术语 | 我们的文件 | 生命周期 |
|----------|-----------|---------|
| Scratchpad | task_plan.md / notes.md | 任务级，临时 |
| Episodic Memory | memory/YYYY-MM-DD.md | 会话级，追加 |
| Fact Memory | MEMORY.md | 项目级，稳定事实 |
| Experiential Memory | postmortem/ + ROLLING_REQUIREMENTS | 跨任务经验 |
| Procedural Memory | SKILL.md + TOOLBOX.md + .claude/skills/ | 工具与流程 |
| User Memory | CLAUDE.md + .claude/rules/ | 用户偏好与约束 |
| Historical Record | git log | 不可变，仅查询 |

同步流程: `ai-tools-launcher.sh` -> `ensure_agent_docs()` 复制 5 文件（源更新则覆盖） -> `sync_knowledge_docs()` 生成 GEMINI.md/CODEX.md

---

## 配套文档（Cross-Reference）

| 文件 | 用途 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 工作准则（单一事实源） |
| [GLOSSARY.md](GLOSSARY.md) | 术语表与定义库（快速查词） |
| [SKILL.md](SKILL.md) | 技能树索引（按场景查 skill） |
| [AGENTS.md](AGENTS.md) | 角色协作规范 |

---

Maurice | maurice_wen@proton.me
