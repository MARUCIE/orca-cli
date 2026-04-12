/**
 * Telegram Bot adapter — long-polling integration for Telegram Bot API.
 */

export interface TelegramConfig {
  botToken: string
  onMessage: (chatId: string, text: string) => Promise<string>
}

interface TelegramUpdate {
  update_id: number
  message?: {
    chat: { id: number }
    text?: string
  }
}

export class TelegramAdapter {
  private polling = false
  private offset = 0
  private baseUrl: string

  constructor(private config: TelegramConfig) {
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`
  }

  /** Start long-polling for updates */
  async startPolling(): Promise<void> {
    this.polling = true
    while (this.polling) {
      try {
        const updates = await this.getUpdates()
        for (const update of updates) {
          this.offset = update.update_id + 1
          if (update.message?.text) {
            const chatId = String(update.message.chat.id)
            try {
              const reply = await this.config.onMessage(chatId, update.message.text)
              await this.sendMessage(chatId, reply)
            } catch (err) {
              // Log and continue; do not crash the poll loop
              console.error('[TelegramAdapter] onMessage error:', err)
            }
          }
        }
      } catch (err) {
        // Log and continue; transient network errors should not kill polling
        console.error('[TelegramAdapter] polling error:', err)
        // Brief pause before retry to avoid tight error loops
        await this.sleep(2000)
      }
    }
  }

  /** Stop polling */
  stopPolling(): void {
    this.polling = false
  }

  /** Send a message to a chat */
  async sendMessage(chatId: string, text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    if (!res.ok) {
      throw new Error(`Telegram sendMessage failed: ${res.status} ${res.statusText}`)
    }
  }

  /** Get bot info */
  async getMe(): Promise<{ id: number; username: string }> {
    const res = await fetch(`${this.baseUrl}/getMe`)
    if (!res.ok) {
      throw new Error(`Telegram getMe failed: ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as { result: { id: number; username: string } }
    return data.result
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const url = `${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=30`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Telegram getUpdates failed: ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as { result: TelegramUpdate[] }
    return data.result
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
