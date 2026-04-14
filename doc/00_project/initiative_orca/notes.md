# Notes

## 2026-04-12

- User provided explicit `PROJECT_DIR`: `/Users/mauricewen/Projects/MARUCIE-orca-cli`
- Project root initially lacked repo-level `AGENTS.md` / `CLAUDE.md` / mirror files
- Existing docs were flat under `doc/` and did not include the required `doc/00_project/initiative_orca/` tree
- `.omx/tmux-hook.json` existed as untracked runtime state; `.gitignore` was updated to ignore `.omx/`
- Command surface was verified from `src/program.ts`, not inferred solely from README
- Verification completed:
  - `npm run lint` passed
  - `npm test` passed (`326/326`)
- Test suite emitted one `fatal: not a git repository` message in subprocess output while still passing; no bootstrap code path depends on that warning
- Follow-up after review:
  - Regenerated 7 planning/architecture HTML companions from canonical Markdown sources
  - Added heading anchors so the generated TOC links are valid
  - Replaced duplicated `CODEX.md` / `GEMINI.md` content with thin references to `CLAUDE.md`
- Root-cause follow-up:
  - Reproduced the stray `fatal: not a git repository` output with `tests/adversarial.test.ts`
  - Root cause: `executeGitCommit()` used `execSync()` without explicit piped stdio, so git stderr escaped during non-repo failure paths
  - Fix: pipe child stdio in `src/tools.ts` and add regression coverage in `tests/protocol.test.ts`
- Additional verification completed:
  - `npm run build` passed
  - `npm run bench` passed (`10/10`, `100%`)
  - `node dist/bin/orca.js --help` rendered expected command help
  - Full `npm test` rerun passed (`327/327`) with the stray git warning removed
  - Targeted regression run passed: `tests/adversarial.test.ts` + `tests/protocol.test.ts` (`34/34`)
- New feature branch note:
  - User requested Hermes-agent capability internalization into Orca CLI, with SDK updates only if the boundary requires it
  - Hermes local fact source: `00-AI-Fleet/state/services/hermes-agent/src/hermes-agent/RELEASE_v0.8.0.md`
  - Initial capability bundle selected for Orca: tool arg coercion, oversized tool result persistence, background completion notifications
  - Current SDK conclusion: `MARUCIE-open-agent-sdk` is the canonical SDK repo, but this first capability bundle is likely Orca-local unless a reusable runtime seam emerges during implementation
- Implementation outcome:
  - Added `src/background-jobs.ts` for detached job tracking and REPL completion notifications
  - `src/tools.ts` now coerces model-sent stringified tool arguments to schema-compatible runtime values
  - Oversized tool outputs now persist to `~/.orca/tool-results/` (or `$ORCA_HOME/tool-results/`) and return an artifact path instead of destructive truncation
  - REPL gained `/jobs` for tracked background work visibility
- SDK boundary decision:
  - No SDK code change in `MARUCIE-open-agent-sdk`
  - Reason: this capability bundle is currently Orca-local shell/runtime ergonomics, not a shared provider-neutral agent-loop seam yet
- Follow-up capability slice:
  - Added `src/model-catalog.ts` to centralize known model/provider metadata
  - `/model` and `/models` now surface provider, context window, approximate pricing, and caution metadata
  - Hard-coded Poe-only picker behavior was removed from REPL flows
- Provider/output follow-up:
  - `orca providers` now reuses the same catalog metadata and prints context/pricing/caution lines
  - One-shot `orca chat "..."` startup now emits the same model caution used by the REPL when applicable
- Logging follow-up:
  - Added `src/logger.ts` for local `agent.log` / `errors.log`
  - Added `orca logs` via `src/commands/logs.ts`
  - Routed core warning/error paths plus selected chat/provider runtime events into the local logger
- Doctor follow-up:
  - Added `src/doctor.ts` plus top-level `orca doctor`
  - Doctor now reports provider/config/hook/MCP/session/background-job/log status in one place
  - Doctor also surfaces malformed local JSON config files explicitly via `configDiagnostics`
  - No SDK change required; diagnostics remain Orca-local runtime tooling
- Serve follow-up:
  - `orca serve` now exposes richer `/health`, `/providers`, and `/doctor` surfaces
  - Headless server responses reuse the same model catalog and doctor diagnostics used by CLI commands
- Stats follow-up:
  - `orca stats` now includes runtime health and recent error summaries
  - The stats surface now composes usage-db + doctor + logger instead of showing cost-only data
- Branding follow-up:
  - Canonical docs and governance files now consistently use `Orca/orca/.orca`
  - Real filesystem `PROJECT_DIR` references remain `/Users/mauricewen/Projects/MARUCIE-orca-cli` until the repo directory itself is renamed
- Verification completed:
  - `npm run lint` passed
  - `npm test` passed (`426/426`)
  - `npm run build` passed
  - `npm run bench` passed (`10/10`, `100%`)
  - `node dist/bin/orca.js --help` rendered expected command help
  - `tests/hermes-runtime.test.ts` passed (`3/3`)
  - `tests/model-catalog.test.ts` passed (`4/4`)
  - `tests/model-catalog.test.ts` + `tests/providers-command.test.ts` passed (`5/5`)
  - `node dist/bin/orca.js providers` rendered provider metadata as expected
  - `tests/logger.test.ts` + `tests/logs-command.test.ts` + `tests/program.test.ts` passed (`12/12`)
  - `node dist/bin/orca.js logs` rendered the expected empty-log state
  - `tests/doctor-command.test.ts` passed (`1/1`)
  - `node dist/bin/orca.js doctor --json` returned structured diagnostics
  - malformed-config smoke for `orca doctor` now reports config issues without the old bare stderr warning prefix
  - `tests/serve-command.test.ts` passed (`1/1`)
  - `tests/stats-command.test.ts` passed (`1/1`)
- Boundary reminder:
  - Hermes-inspired runtime, model-catalog, logs, and doctor slices all remain Orca-local
  - `MARUCIE-open-agent-sdk` still intentionally unchanged because no provider-neutral seam has been proven yet

## 2026-04-14

- ink UI CC-parity deep source comparison (3-round swarm audit)
- Round 1: Rendering pipeline (AlternateScreen, FullscreenLayout, ScrollBox, Resize)
- Round 2: Input system (Cursor class, paste handler, focus model, submit flow)
- Round 3: Visual UX (theme depth, spinner, tool call states, keyboard hints)
- P0 implementations completed:
  1. **useTerminalSize** — reactive terminal dimensions via SIGWINCH + stdout.resize
     - TerminalSizeProvider at render root, useTerminalSize() hook
     - All 6 components migrated from static useStdout() to reactive context
     - Files: `src/ui/useTerminalSize.tsx`, updated AlternateScreen/App/StatusBar/Banner/Footer/InputArea/render.tsx
  2. **ScrollBox** — scrollable content area with stickyScroll
     - Negative marginTop trick for ink/Yoga scroll simulation
     - stickyScroll auto-follows bottom, keyboard nav (PageUp/PageDown, g/G)
     - Imperative API: scrollTo/scrollBy/scrollToBottom/isSticky/getScrollTop
     - measureElement for content height tracking
     - Files: `src/ui/components/ScrollBox.tsx`, integrated into App.tsx
  3. **usePasteHandler** — bracketed paste mode detection
     - Enables \x1b[?2004h on mount, detects \x1b[200~ / \x1b[201~ brackets
     - During paste, Enter becomes literal newline (prevents accidental submit)
     - onPaste callback for content insertion
     - Files: `src/ui/usePasteHandler.ts`, integrated into InputArea.tsx
- Orca advantages over CC identified (6 items): SIGCONT resume, dual-line StatusBar, Sparkline, context-aware Footer, DiffPreview, OSC 8 FileLink
- Test count: 1173 (up from 1168)
- Review report v3 generated: `outputs/reports/code-quality-swarm/2026-04-14-ink-cc-parity-review-v3.html`
- P1 implementations completed:
  4. **Cursor model** — pure-function text editing with word-boundary ops
     - prevWord/nextWord (Option+Left/Right), deleteWordBefore (Ctrl+W)
     - deleteToLineEnd (Ctrl+K), deleteToLineStart (Ctrl+U upgrade), yank (Ctrl+Y)
     - kill ring buffer for cut/paste workflow
     - 28 unit tests in tests/cursor.test.ts
     - Files: `src/ui/cursor.ts`, InputArea.tsx rewritten to use Cursor module
  5. **Theme expansion** — 25 semantic color tokens + dark/light mode
     - Role-based tokens: accent/success/error/warning/tool/model/filePath/diffAdd/diffRemove/ctxGreen/ctxYellow/ctxRed...
     - Auto dark/light detection via COLORFGBG env var
     - 6 themes: default/light/dark/ocean/warm/mono
     - Components migrated: ToolCallBlock, StatusBar, App (system messages), InputArea
  6. **Mouse wheel scrolling** — SGR mouse protocol integration
     - useMouseWheel hook: enables \x1b[?1003h\x1b[?1006h, parses SGR events
     - Wheel up/down → ScrollBox.scrollBy(+/-3 rows)
     - Clean teardown on unmount
     - File: `src/ui/useMouseWheel.ts`, wired in App.tsx
  7. **Focus fine-grained control** — showCursor prop + theme-aware borders
     - Independent showCursor prop (cursor visible even when input blocked)
     - Border color from theme.border/theme.borderDim
     - Placeholder/dim text from theme tokens
- Test count: 1203 (up from 1173)
- P2 implementations completed:
  8. **Spinner upgrade** — 204 verbs (CC-parity), stalledIntensity 颜色渐变（accent→warning→error）
     - prefers-reduced-motion 检测（REDUCE_MOTION / NO_MOTION env）
     - 三段式着色：<10s accent, 10-30s warning, >30s error
  9. **Tool call graduated error** — 6 种错误类型定制渲染
     - rejected/permission/timeout/not_found/validation/generic
     - 每种类型独立 icon + label + 颜色（rejected 用 warning, 其余用 error）
     - errorType 字段添加到 ToolEndInfo 接口
  10. **Meta+Enter / Shift+Enter 换行** — CC 兼容多键换行
     - Ctrl+J / Ctrl+Enter / Meta+Enter / Shift+Enter 全部支持
     - 修复了键序：新行检测在 submit 之前，避免 Shift+Enter 误提交
- Final test count: 1203
- Final parity: 15/17 差距修复（88%），CC parity 65/80（81%）
