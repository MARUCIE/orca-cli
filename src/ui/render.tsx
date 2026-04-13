/**
 * Ink render entry point.
 *
 * Creates the ink instance and mounts the App component.
 * Returns cleanup function for teardown.
 */

import React from 'react'
import { render } from 'ink'
import { App } from './components/App.js'
import type { ChatSessionEmitter } from './session.js'
import type { StatusInfo } from './types.js'

export interface InkInstance {
  /** Wait for the ink app to unmount */
  waitUntilExit: () => Promise<void>
  /** Unmount and cleanup */
  unmount: () => void
  /** Clear the screen */
  clear: () => void
}

export function renderInkApp(
  session: ChatSessionEmitter,
  initialStatus: StatusInfo,
): InkInstance {
  const instance = render(
    <App session={session} initialStatus={initialStatus} />,
    {
      // exitOnCtrlC: false — we handle Ctrl+C in the REPL loop
      exitOnCtrlC: false,
    },
  )

  return {
    waitUntilExit: () => instance.waitUntilExit(),
    unmount: () => instance.unmount(),
    clear: () => instance.clear(),
  }
}
