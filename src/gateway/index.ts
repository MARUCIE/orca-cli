/**
 * Gateway module — webhook ingestion + messaging adapters.
 */

export { WebhookGateway } from './webhook.js'
export type { WebhookRoute, WebhookConfig } from './webhook.js'

export { TelegramAdapter } from './adapters/telegram.js'
export type { TelegramConfig } from './adapters/telegram.js'
