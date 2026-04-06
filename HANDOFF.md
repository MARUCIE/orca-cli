# HANDOFF — Forge CLI Provider Decoupling Session

## What was done (2026-04-06)

### Forge CLI — 7 commits, +1,388 lines, 6 new commands
- **Multi-provider config**: 9 well-known providers, per-provider apiKey/baseURL/models, ${ENV_VAR} templates
- **429 retry**: exponential backoff on rate limits (2s/4s/8s)
- **Config-driven multi-model**: council/race/pipeline use provider's models[] instead of hardcoded cross-vendor list
- **forge stats**: SQLite usage tracking (node:sqlite, zero deps), overview + model breakdown + daily chart
- **forge session**: list/show/delete saved sessions from ~/.armature/sessions/
- **forge pr**: one-click GitHub PR checkout + agent review
- **forge serve**: headless HTTP server with SSE streaming (POST /chat, GET /health, GET /providers)

### Armature SDK — 2 commits, +492 lines
- **OpenAI-compat shim**: translates Anthropic SDK client interface to OpenAI protocol at getAnthropicClient() level
- **createAgent({ provider: 'openai-compat', baseURL, apiKey })**: any OpenAI-compat endpoint works
- claude.ts (1800 lines) works unchanged via client-level shim

### Environment
- Google Cloud billing linked: gen-lang-client project → $300 Free Trial (expires July 2026)
- Paid tier active: 1000 RPM (was Free Tier 15 RPM)
- ~/.zshenv: GOOGLE_API_KEY + GOOGLE_GENERATIVE_AI_API_KEY + GEMINI_API_KEY (all same key)
- OpenCode v1.3.10 + Kilo Code v7.1.21 installed and configured

## Verification
- Tests: 326/326 pass
- Bench: 10/10 (100% SOTA READY)
- TypeScript: 0 errors
- E2E: forge chat/serve/stats/session/providers/pr all verified

## What's next (Phase 2/3)
- SDK Phase 2: define generic TransportClient interface, add proper OpenAI transport (not just shim)
- SDK Phase 3: replace 83 direct @anthropic-ai/sdk imports with @armature/core neutral types
- forge serve: add WebSocket support for attach/reconnect
- forge session: add `forge -c` (continue last) flag wiring into chat command
- ANTHROPIC_API_KEY: user needs to set this for direct Claude access in Forge
- Push to GitHub: local commits only, not pushed yet
