/**
 * useSession — React hook for subscribing to ChatSessionEmitter events.
 *
 * Provides a declarative way for ink components to listen to specific event types.
 */

import { useEffect } from 'react'
import type { ChatSessionEmitter } from '../session.js'
import type { UIEvent } from '../types.js'

/** Subscribe to all UIEvents from a session emitter */
export function useSessionEvents(
  session: ChatSessionEmitter,
  handler: (event: UIEvent) => void,
): void {
  useEffect(() => {
    session.on('*', handler)
    return () => { session.removeListener('*', handler) }
  }, [session, handler])
}

/** Subscribe to a specific event type */
export function useSessionEvent<T extends UIEvent['type']>(
  session: ChatSessionEmitter,
  type: T,
  handler: (event: Extract<UIEvent, { type: T }>) => void,
): void {
  useEffect(() => {
    const wrapped = (event: UIEvent) => {
      if (event.type === type) handler(event as Extract<UIEvent, { type: T }>)
    }
    session.on('*', wrapped)
    return () => { session.removeListener('*', wrapped) }
  }, [session, type, handler])
}
