/**
 * Webhook Gateway — HTTP server that receives external webhooks,
 * validates signatures, transforms payloads, and dispatches to the agent loop.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { createHmac } from 'node:crypto'

export interface WebhookRoute {
  path: string
  secret?: string
  transform: (payload: unknown) => string
}

export interface WebhookConfig {
  port: number
  routes: WebhookRoute[]
  onPrompt: (prompt: string, source: string) => Promise<string>
}

export class WebhookGateway {
  private server: ReturnType<typeof createServer> | null = null
  private config: WebhookConfig

  constructor(config: WebhookConfig) {
    this.config = config
  }

  /** Start listening */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res))
      this.server.on('error', reject)
      this.server.listen(this.config.port, () => resolve())
    })
  }

  /** Stop the server */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close((err) => {
        this.server = null
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Whether server is running */
  get isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only accept POST
    if (req.method !== 'POST') {
      this.respond(res, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    // Find matching route
    const route = this.config.routes.find((r) => r.path === req.url)
    if (!route) {
      this.respond(res, 404, { ok: false, error: 'Unknown route' })
      return
    }

    // Read body
    let rawBody: string
    try {
      rawBody = await this.readBody(req)
    } catch {
      this.respond(res, 400, { ok: false, error: 'Failed to read body' })
      return
    }

    // Validate HMAC if route has a secret
    if (route.secret) {
      const signature = req.headers['x-hub-signature-256'] as string | undefined
      if (!signature || !this.verifySignature(rawBody, route.secret, signature)) {
        this.respond(res, 401, { ok: false, error: 'Invalid signature' })
        return
      }
    }

    // Parse JSON
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      this.respond(res, 400, { ok: false, error: 'Invalid JSON' })
      return
    }

    // Transform and dispatch
    try {
      const prompt = route.transform(payload)
      const response = await this.config.onPrompt(prompt, route.path)
      this.respond(res, 200, { ok: true, response })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error'
      this.respond(res, 500, { ok: false, error: message })
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  private verifySignature(body: string, secret: string, signature: string): boolean {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    // Constant-time comparison via length check + Buffer.equals
    if (expected.length !== signature.length) return false
    return Buffer.from(expected).equals(Buffer.from(signature))
  }

  private respond(res: ServerResponse, status: number, body: Record<string, unknown>): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}
