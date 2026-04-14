/**
 * Ink render entry point.
 *
 * Creates the ink instance and mounts the App component.
 * Intercepts console.log/stderr to route through the ink component tree
 * so legacy code that writes directly to stdout doesn't corrupt the TUI.
 */

import React from 'react'
import { render } from 'ink'
import { App } from './components/App.js'
import type { BannerInfo } from './components/App.js'
import { ThemeProvider } from './theme.js'
import { TerminalSizeProvider } from './useTerminalSize.js'
import { AlternateScreen } from './components/AlternateScreen.js'
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

// ANSI escape code stripper for routing legacy output through ink
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\[\?[0-9;]*[a-zA-Z]/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

export function renderInkApp(
  session: ChatSessionEmitter,
  initialStatus: StatusInfo,
  banner?: BannerInfo,
): InkInstance {
  // Save original console methods
  const origLog = console.log.bind(console)
  const origError = console.error.bind(console)
  const origStderrWrite = process.stderr.write.bind(process.stderr)

  // Filter out startup noise that's already rendered by the Banner component
  const STARTUP_NOISE = /^(hooks:|\/help|config |Orca v|\d+ tools|▸ |MCP:|provider:|hint:)/
  const shouldFilter = (text: string): boolean => STARTUP_NOISE.test(text)

  // Intercept console.log → emit as system_message (info)
  console.log = (...args: unknown[]) => {
    const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ')
    const clean = stripAnsi(text).trim()
    if (clean && !shouldFilter(clean)) {
      session.emitSystemMessage(clean, 'info')
    }
  }

  // Intercept console.error → emit as system_message (error)
  console.error = (...args: unknown[]) => {
    const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ')
    const clean = stripAnsi(text).trim()
    if (clean) {
      session.emitSystemMessage(clean, 'error')
    }
  }

  // Intercept process.stderr.write → emit as system_message (warn)
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString()
    const clean = stripAnsi(text).trim()
    if (clean && !shouldFilter(clean)) {
      session.emitSystemMessage(clean, 'warn')
    }
    return true
  }) as typeof process.stderr.write

  const instance = render(
    <TerminalSizeProvider>
      <ThemeProvider>
        <AlternateScreen>
          <App session={session} initialStatus={initialStatus} banner={banner} />
        </AlternateScreen>
      </ThemeProvider>
    </TerminalSizeProvider>,
    {
      exitOnCtrlC: false,
    },
  )

  const cleanup = () => {
    // Restore original methods
    console.log = origLog
    console.error = origError
    process.stderr.write = origStderrWrite
  }

  return {
    waitUntilExit: () => instance.waitUntilExit(),
    unmount: () => {
      cleanup()
      instance.unmount()
    },
    clear: () => instance.clear(),
  }
}
