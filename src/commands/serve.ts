/**
 * `forge serve` — Headless agent server.
 *
 * Exposes Forge as an HTTP API with SSE streaming.
 * Attach from another terminal with: curl -N http://localhost:PORT/chat -d '{"prompt":"..."}'
 *
 * Usage:
 *   forge serve                  Start on random port
 *   forge serve --port 9100      Start on specific port
 */

import { Command } from 'commander'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolveConfig, resolveProvider } from '../config.js'
import { streamChat, chatOnce } from '../providers/openai-compat.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { recordUsage } from '../usage-db.js'
import type { ForgeConfig } from '../config.js'

interface ServerState {
  config: ForgeConfig
  resolved: ReturnType<typeof resolveProvider>
  cwd: string
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
        costUsd: 0,
        durationMs: Date.now() - startTime,
        command: 'serve',
        cwd: state.cwd,
      })
      json(res, 200, { text: result.text, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
    } catch (err) {
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
    res.write(`data: ${JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : String(err) })}\n\n`)
  }

  recordUsage({
    provider: state.resolved.provider,
    model,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd: 0,
    durationMs: Date.now() - startTime,
    command: 'serve',
    cwd: state.cwd,
  })

  res.write('data: [DONE]\n\n')
  res.end()
}

export function createServeCommand(): Command {
  return new Command('serve')
    .description('Start headless agent server (HTTP + SSE)')
    .option('--port <port>', 'Port to listen on', '0')
    .option('--host <host>', 'Hostname to bind', '127.0.0.1')
    .option('-m, --model <model>', 'Default model')
    .option('-p, --provider <provider>', 'Provider')
    .action(async (opts: { port: string; host: string; model?: string; provider?: string }) => {
      const flags: Record<string, unknown> = {}
      if (opts.model) flags.model = opts.model
      if (opts.provider) flags.provider = opts.provider

      const config = resolveConfig({ cwd: process.cwd(), flags })
      const resolved = resolveProvider(config)
      const cwd = process.cwd()
      const state: ServerState = { config, resolved, cwd }

      const server = createServer(async (req, res) => {
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
            json(res, 200, { status: 'ok', provider: resolved.provider, model: resolved.model })
          } else if (url.pathname === '/chat' && req.method === 'POST') {
            await handleChat(req, res, state)
          } else if (url.pathname === '/providers') {
            const { listProviders } = await import('../config.js')
            json(res, 200, { providers: listProviders(config), default: resolved.provider })
          } else {
            json(res, 404, { error: 'Not found. Endpoints: POST /chat, GET /health, GET /providers' })
          }
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      })

      const port = parseInt(opts.port, 10) || 0
      server.listen(port, opts.host, () => {
        const addr = server.address()
        const actualPort = typeof addr === 'object' ? addr?.port : port
        console.log()
        console.log(`  \x1b[1mForge Server\x1b[0m`)
        console.log(`  \x1b[90m${resolved.provider}/${resolved.model}\x1b[0m`)
        console.log()
        console.log(`  \x1b[36mhttp://${opts.host}:${actualPort}\x1b[0m`)
        console.log()
        console.log(`  \x1b[90mEndpoints:\x1b[0m`)
        console.log(`  \x1b[90m  POST /chat          Send prompt (SSE streaming)\x1b[0m`)
        console.log(`  \x1b[90m  GET  /health         Server status\x1b[0m`)
        console.log(`  \x1b[90m  GET  /providers      List providers\x1b[0m`)
        console.log()
        console.log(`  \x1b[90mTest: curl -N http://${opts.host}:${actualPort}/chat -d '{"prompt":"hello"}'\x1b[0m`)
        console.log()
      })
    })
}
