/**
 * `orca serve` — Headless agent server.
 *
 * Exposes Orca as an HTTP API with SSE streaming.
 * Attach from another terminal with: curl -N http://localhost:PORT/chat -d '{"prompt":"..."}'
 *
 * Usage:
 *   orca serve                  Start on random port
 *   orca serve --port 9100      Start on specific port
 */

import { Command } from 'commander'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { listProviders, resolveConfig, resolveProvider } from '../config.js'
import { streamChat, chatOnce } from '../providers/openai-compat.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { recordUsage } from '../usage-db.js'
import type { OrcaConfig } from '../config.js'
import { getModelChoice, formatContextWindow, formatPricing, getPricingForModel } from '../model-catalog.js'
import { gatherDoctorReport } from '../doctor.js'
import { logInfo, logWarning } from '../logger.js'
import { MCPServer } from '../mcp-server.js'

export interface ServerState {
  config: OrcaConfig
  resolved: ReturnType<typeof resolveProvider>
  cwd: string
}

function getServeModelMetadata(provider: string, model: string): Record<string, unknown> {
  const choice = getModelChoice(model, provider)
  return {
    provider,
    model,
    contextWindow: choice.contextWindow ?? null,
    maxOutput: choice.maxOutput ?? null,
    pricing: choice.pricing ?? null,
    contextLabel: formatContextWindow(choice.contextWindow),
    pricingLabel: formatPricing(choice.pricing),
    caution: choice.note || null,
  }
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) }
      catch { reject(new Error('Invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function json(res: ServerResponse, status: number, data: unknown): void {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function handleChat(req: IncomingMessage, res: ServerResponse, state: ServerState): Promise<void> {
  const body = await parseBody(req)
  const prompt = (body.prompt as string) || ''
  const model = (body.model as string) || state.resolved.model
  const stream = body.stream !== false // default: streaming
  logInfo('serve chat request', { model, stream, cwd: state.cwd })

  if (!prompt) {
    json(res, 400, { error: 'Missing "prompt" field' })
    return
  }

  if (!state.resolved.baseURL) {
    json(res, 500, { error: 'No baseURL configured for provider' })
    return
  }

  if (!stream) {
    // Non-streaming: return full response
    const startTime = Date.now()
    try {
      const result = await chatOnce(
        { apiKey: state.resolved.apiKey, baseURL: state.resolved.baseURL, model },
        prompt,
      )
      recordUsage({
        provider: state.resolved.provider,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: (() => { const p = getPricingForModel(model); return p ? (result.inputTokens * p[0] + result.outputTokens * p[1]) / 1_000_000 : 0 })(),
        durationMs: Date.now() - startTime,
        command: 'serve',
        cwd: state.cwd,
      })
      logInfo('serve chat completed', { provider: state.resolved.provider, model, stream: false, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
      json(res, 200, { text: result.text, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
    } catch (err) {
      logWarning('serve chat failed', { provider: state.resolved.provider, model, error: err instanceof Error ? err.message : String(err) })
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  // SSE streaming
  cors(res)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const startTime = Date.now()
  let totalInput = 0
  let totalOutput = 0

  try {
    const events = streamChat(
      { apiKey: state.resolved.apiKey, baseURL: state.resolved.baseURL, model, systemPrompt: buildSystemPrompt(state.cwd) },
      prompt,
    )

    for await (const event of events) {
      if (event.type === 'text') {
        res.write(`data: ${JSON.stringify({ type: 'text', text: event.text })}\n\n`)
      } else if (event.type === 'usage') {
        totalInput = event.inputTokens || 0
        totalOutput = event.outputTokens || 0
        res.write(`data: ${JSON.stringify({ type: 'usage', inputTokens: totalInput, outputTokens: totalOutput })}\n\n`)
      } else if (event.type === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: event.error })}\n\n`)
      } else if (event.type === 'done') {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      }
    }
  } catch (err) {
    logWarning('serve streaming chat failed', { provider: state.resolved.provider, model, error: err instanceof Error ? err.message : String(err) })
    res.write(`data: ${JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : String(err) })}\n\n`)
  }

  recordUsage({
    provider: state.resolved.provider,
    model,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd: (() => { const p = getPricingForModel(model); return p ? (totalInput * p[0] + totalOutput * p[1]) / 1_000_000 : 0 })(),
    durationMs: Date.now() - startTime,
    command: 'serve',
    cwd: state.cwd,
  })
  logInfo('serve streaming chat completed', { provider: state.resolved.provider, model, stream: true, inputTokens: totalInput, outputTokens: totalOutput })

  res.write('data: [DONE]\n\n')
  res.end()
}

export function createOrcaHttpServer(state: ServerState) {
  return createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      cors(res)
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    try {
      if (url.pathname === '/health') {
        json(res, 200, {
          status: 'ok',
          provider: state.resolved.provider,
          model: state.resolved.model,
          modelMetadata: getServeModelMetadata(state.resolved.provider, state.resolved.model),
        })
      } else if (url.pathname === '/doctor') {
        json(res, 200, gatherDoctorReport(state.cwd))
      } else if (url.pathname === '/chat' && req.method === 'POST') {
        await handleChat(req, res, state)
      } else if (url.pathname === '/providers') {
        const providers = listProviders(state.config).map((provider) => ({
          ...provider,
          modelMetadata: getServeModelMetadata(provider.id, provider.model),
        }))
        json(res, 200, { providers, default: state.resolved.provider })
      } else {
        json(res, 404, { error: 'Not found. Endpoints: POST /chat, GET /health, GET /providers, GET /doctor' })
      }
    } catch (err) {
      logWarning('serve request failed', {
        path: url.pathname,
        method: req.method,
        error: err instanceof Error ? err.message : String(err),
      })
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })
}

export function createServeCommand(): Command {
  return new Command('serve')
    .description('Start headless agent server (HTTP + SSE)')
    .option('--port <port>', 'Port to listen on', '0')
    .option('--host <host>', 'Hostname to bind', '127.0.0.1')
    .option('--mcp', 'Start as MCP server over stdio instead of HTTP')
    .option('-m, --model <model>', 'Default model')
    .option('-p, --provider <provider>', 'Provider')
    .action(async (opts: { port: string; host: string; mcp?: boolean; model?: string; provider?: string }) => {
      const flags: Record<string, unknown> = {}
      if (opts.model) flags.model = opts.model
      if (opts.provider) flags.provider = opts.provider

      const config = resolveConfig({ cwd: process.cwd(), flags })
      const resolved = resolveProvider(config)
      const cwd = process.cwd()

      if (opts.mcp) {
        const mcp = new MCPServer(cwd)
        process.stderr.write('Orca MCP server started (stdio mode)\n')
        mcp.start()
        return
      }

      const state: ServerState = { config, resolved, cwd }
      const server = createOrcaHttpServer(state)

      const port = parseInt(opts.port, 10) || 0
      server.listen(port, opts.host, () => {
        const addr = server.address()
        const actualPort = typeof addr === 'object' ? addr?.port : port
        logInfo('serve server started', { host: opts.host, port: actualPort, provider: resolved.provider, model: resolved.model })
        console.log()
        console.log(`  \x1b[1mOrca Server\x1b[0m`)
        console.log(`  \x1b[90m${resolved.provider}/${resolved.model}\x1b[0m`)
        const metadata = getServeModelMetadata(resolved.provider, resolved.model)
        console.log(`  \x1b[90mctx ${metadata.contextLabel} · ${metadata.pricingLabel}/1M in/out${metadata.caution ? ` · caution` : ''}\x1b[0m`)
        console.log()
        console.log(`  \x1b[36mhttp://${opts.host}:${actualPort}\x1b[0m`)
        console.log()
        console.log(`  \x1b[90mEndpoints:\x1b[0m`)
        console.log(`  \x1b[90m  POST /chat          Send prompt (SSE streaming)\x1b[0m`)
        console.log(`  \x1b[90m  GET  /health         Server status\x1b[0m`)
        console.log(`  \x1b[90m  GET  /providers      List providers\x1b[0m`)
        console.log(`  \x1b[90m  GET  /doctor         Runtime diagnostics\x1b[0m`)
        console.log()
        console.log(`  \x1b[90mTest: curl -N http://${opts.host}:${actualPort}/chat -d '{"prompt":"hello"}'\x1b[0m`)
        console.log()
      })
    })
}
