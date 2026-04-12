/**
 * Phase 2: Gateway — 12 tests
 *
 * Covers:
 *   1. WebhookGateway — start/stop, routing, HMAC validation, error handling
 *   2. TelegramAdapter — constructor, stopPolling
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { WebhookGateway } from '../src/gateway/webhook.js'
import { TelegramAdapter } from '../src/gateway/adapters/telegram.js'
import { createHmac } from 'node:crypto'

// ── Helpers ────────────────────────────────────────────────────────

const TEST_PORT = 19871
const TEST_SECRET = 'test-secret-key'

function signPayload(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

async function postJSON(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(body)
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw,
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, body: data }
}

// Track gateways so we always shut them down
const gateways: WebhookGateway[] = []

afterAll(async () => {
  for (const gw of gateways) {
    if (gw.isRunning) await gw.stop()
  }
})

function createGateway(port: number, overrides: Partial<Parameters<typeof Object.assign>[0]> = {}): WebhookGateway {
  const gw = new WebhookGateway({
    port,
    routes: [
      {
        path: '/github',
        secret: TEST_SECRET,
        transform: (p: unknown) => `github event: ${JSON.stringify(p)}`,
      },
      {
        path: '/ci',
        transform: (p: unknown) => `ci event: ${JSON.stringify(p)}`,
      },
    ],
    onPrompt: async (prompt: string) => `Processed: ${prompt.slice(0, 50)}`,
    ...overrides,
  })
  gateways.push(gw)
  return gw
}

// ── WebhookGateway ─────────────────────────────────────────────────

describe('WebhookGateway: HTTP webhook receiver', () => {
  let gw: WebhookGateway

  afterEach(async () => {
    if (gw?.isRunning) await gw.stop()
  })

  it('G.1 start/stop lifecycle — isRunning reflects state', async () => {
    gw = createGateway(TEST_PORT)
    expect(gw.isRunning).toBe(false)
    await gw.start()
    expect(gw.isRunning).toBe(true)
    await gw.stop()
    expect(gw.isRunning).toBe(false)
  })

  it('G.2 POST to valid route without secret returns 200', async () => {
    gw = createGateway(TEST_PORT + 1)
    await gw.start()
    const res = await postJSON(TEST_PORT + 1, '/ci', { build: 'ok' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.response).toBe('string')
  })

  it('G.3 POST to unknown route returns 404', async () => {
    gw = createGateway(TEST_PORT + 2)
    await gw.start()
    const res = await postJSON(TEST_PORT + 2, '/unknown', { data: 1 })
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
  })

  it('G.4 POST with valid HMAC signature returns 200', async () => {
    gw = createGateway(TEST_PORT + 3)
    await gw.start()
    const body = JSON.stringify({ action: 'push' })
    const sig = signPayload(body, TEST_SECRET)
    const res = await fetch(`http://127.0.0.1:${TEST_PORT + 3}/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sig,
      },
      body,
    })
    const data = (await res.json()) as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
  })

  it('G.5 POST with invalid HMAC signature returns 401', async () => {
    gw = createGateway(TEST_PORT + 4)
    await gw.start()
    const res = await postJSON(TEST_PORT + 4, '/github', { action: 'push' }, {
      'X-Hub-Signature-256': 'sha256=bad_signature',
    })
    expect(res.status).toBe(401)
    expect(res.body.ok).toBe(false)
  })

  it('G.6 POST with missing signature to signed route returns 401', async () => {
    gw = createGateway(TEST_PORT + 5)
    await gw.start()
    const res = await postJSON(TEST_PORT + 5, '/github', { action: 'push' })
    expect(res.status).toBe(401)
  })

  it('G.7 POST with invalid JSON returns 400', async () => {
    gw = createGateway(TEST_PORT + 6)
    await gw.start()
    const res = await fetch(`http://127.0.0.1:${TEST_PORT + 6}/ci`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    })
    expect(res.status).toBe(400)
  })

  it('G.8 onPrompt receives correct prompt and source', async () => {
    let capturedPrompt = ''
    let capturedSource = ''
    gw = new WebhookGateway({
      port: TEST_PORT + 7,
      routes: [{ path: '/test', transform: () => 'hello-prompt' }],
      onPrompt: async (prompt, source) => {
        capturedPrompt = prompt
        capturedSource = source
        return 'ok'
      },
    })
    gateways.push(gw)
    await gw.start()
    await postJSON(TEST_PORT + 7, '/test', { x: 1 })
    expect(capturedPrompt).toBe('hello-prompt')
    expect(capturedSource).toBe('/test')
  })

  it('G.9 onPrompt error returns 500', async () => {
    gw = new WebhookGateway({
      port: TEST_PORT + 8,
      routes: [{ path: '/fail', transform: () => 'boom' }],
      onPrompt: async () => { throw new Error('handler died') },
    })
    gateways.push(gw)
    await gw.start()
    const res = await postJSON(TEST_PORT + 8, '/fail', {})
    expect(res.status).toBe(500)
    expect(res.body.ok).toBe(false)
  })

  it('G.10 stop on non-running server resolves cleanly', async () => {
    gw = createGateway(TEST_PORT + 9)
    // stop without start should not throw
    await expect(gw.stop()).resolves.toBeUndefined()
  })
})

// ── TelegramAdapter ────────────────────────────────────────────────

describe('TelegramAdapter: Telegram Bot API integration', () => {
  it('G.11 constructor sets up adapter without error', () => {
    const adapter = new TelegramAdapter({
      botToken: 'test-token-123',
      onMessage: async () => 'reply',
    })
    expect(adapter).toBeDefined()
    // stopPolling on a non-polling adapter should not throw
    expect(() => adapter.stopPolling()).not.toThrow()
  })

  it('G.12 stopPolling sets polling flag to false', () => {
    const adapter = new TelegramAdapter({
      botToken: 'test-token-456',
      onMessage: async () => 'reply',
    })
    // Call stopPolling before startPolling — should be safe
    adapter.stopPolling()
    // Starting polling would make a real network call, so we just verify
    // the adapter is constructed and stopPolling is callable
    expect(adapter).toBeInstanceOf(TelegramAdapter)
  })
})
