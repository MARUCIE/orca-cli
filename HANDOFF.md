# HANDOFF — Forge CLI Provider Decoupling + Feature Parity (2026-04-06)

## Commits (10 Forge CLI + 2 SDK)

### Forge CLI (MARUCIE/forge-cli)
```
98d45b0 fix: aggregator detection requires aggregator:true flag
be1cd81 feat: per-model provider routing — aggregator + direct fallback
be55362 feat: add forge serve — headless HTTP server with SSE streaming
7f07f49 feat: add forge pr — one-click GitHub PR checkout and review
6c1cf78 feat: add forge session — list, show, delete saved sessions
fa3e68b feat: add forge stats — persistent usage tracking with SQLite
7435ebd feat: auto-retry on 429 rate limit with exponential backoff
a8dcdfb feat: config-driven multi-model selection
3705eb3 feat: multi-provider config + decouple from Anthropic
```

### Armature SDK (MARUCIE/armature-agent-sdk)
```
134855e feat: add 429 retry with backoff to OpenAI-compat shim
a4c5921 feat: OpenAI-compat shim — decouple SDK from Anthropic
```

## Architecture

### Multi-Provider Routing
- Config: `~/.armature/config.json` — 7 providers (anthropic/google/openai/poe/openrouter/deepseek/local)
- Per-provider: apiKey, baseURL, models, defaultModel, aggregator flag
- `${ENV_VAR}` template syntax for secrets
- resolveModelEndpoint(): 3-tier fallback (aggregator → model prefix detection → default)

### Multi-Model Collaboration
- Aggregator mode (Poe/OpenRouter): single endpoint, cross-vendor diversity groups
- Direct mode: each model routes to its own provider's API
- `-p poe` → aggregator; `-p google` → single-provider with Google's models
- Auto-detect: findAggregator() → cross-vendor if available, else direct

### SDK Shim
- openaiCompatShim.ts: Anthropic SDK interface → OpenAI Chat Completions protocol
- Streaming (SSE) + tool calling fully translated
- claude.ts (1800 lines) works unchanged

## Verification
- Forge: 326/326 tests, 10/10 bench (SOTA READY)
- SDK: 21/22 tests (1 pre-existing sandbox-runtime issue)
- E2E: council with 3 Gemini models via direct routing verified

## Environment
- Google Cloud: gen-lang-client project → $300 Free Trial billing → paid tier 1000 RPM
- Tools: forge + opencode v1.3.10 + kilo v7.1.21, all configured with Google Gemini
- Keys: GOOGLE_API_KEY + GOOGLE_GENERATIVE_AI_API_KEY + GEMINI_API_KEY in ~/.zshenv

## Next Steps
- Set ANTHROPIC_API_KEY → enables direct Claude access + true cross-vendor council
- Set OPENROUTER_API_KEY → enables OpenRouter as aggregator (alternative to Poe)
- SDK Phase 2: generic TransportClient interface (replace Anthropic SDK types)
- forge serve: add WebSocket for live attach/reconnect
- Version bump to 0.2.0
