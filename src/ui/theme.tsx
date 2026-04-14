/**
 * Theme system for ink UI components.
 *
 * 30+ semantic color tokens organized by role (not by hue).
 * Dark/light mode auto-detection via COLORFGBG or ORCA_THEME env var.
 * Components use useTheme() to get the current theme's semantic colors.
 *
 * Themes: default (cyan/dark), light (cyan/light), dark (green/dark),
 *         ocean (blue/dark), warm (yellow/dark), mono (white/dark)
 */

import React, { createContext, useContext } from 'react'

export interface InkTheme {
  name: string
  mode: 'dark' | 'light'

  // ── Primary ──
  /** Primary accent (borders, highlights, art, spinners) */
  accent: string
  /** Secondary accent (less prominent highlights) */
  accentDim: string
  /** Prompt/input caret color */
  prompt: string

  // ── Semantic status ──
  /** Success indicators (tool ok, test pass) */
  success: string
  /** Error indicators (tool fail, exception) */
  error: string
  /** Warning indicators (system messages, caution) */
  warning: string
  /** Informational (system messages, notes) */
  info: string

  // ── Text ──
  /** Primary text (default readable) */
  text: string
  /** Secondary/dim text (metadata, timestamps) */
  dim: string
  /** Muted text (placeholders, disabled) */
  muted: string

  // ── UI elements ──
  /** Active border (focused input, selected item) */
  border: string
  /** Inactive border (unfocused, background) */
  borderDim: string
  /** Status bar background accent */
  statusBg: string

  // ── Code & tools ──
  /** Tool name highlight */
  tool: string
  /** Model/AI name */
  model: string
  /** File path display */
  filePath: string
  /** Code/command text */
  code: string
  /** Diff: added lines */
  diffAdd: string
  /** Diff: removed lines */
  diffRemove: string
  /** Diff: context lines */
  diffContext: string

  // ── Permission ──
  /** Permission allow */
  permAllow: string
  /** Permission deny */
  permDeny: string

  // ── Progress ──
  /** Context bar: healthy (<40%) */
  ctxGreen: string
  /** Context bar: caution (40-60%) */
  ctxYellow: string
  /** Context bar: danger (>60%) */
  ctxRed: string
}

// ── Dark mode detection ──
function detectDarkMode(): boolean {
  // COLORFGBG is "foreground;background" — bg > 6 is typically light
  const colorfgbg = process.env.COLORFGBG
  if (colorfgbg) {
    const parts = colorfgbg.split(';')
    const bg = parseInt(parts[parts.length - 1] || '', 10)
    if (!isNaN(bg)) return bg <= 6
  }
  // Default to dark mode (most developer terminals are dark)
  return true
}

const isDark = detectDarkMode()

// ── Theme definitions ──

function darkTheme(name: string, accent: string, accentDim: string, prompt: string): InkTheme {
  return {
    name, mode: 'dark',
    accent, accentDim, prompt,
    success: 'green', error: 'red', warning: 'yellow', info: 'gray',
    text: 'white', dim: 'gray', muted: 'gray',
    border: accent, borderDim: 'gray', statusBg: accent,
    tool: 'yellow', model: 'magenta', filePath: 'cyan', code: 'white',
    diffAdd: 'green', diffRemove: 'red', diffContext: 'gray',
    permAllow: 'green', permDeny: 'red',
    ctxGreen: 'green', ctxYellow: 'yellow', ctxRed: 'red',
  }
}

function lightTheme(name: string, accent: string, accentDim: string, prompt: string): InkTheme {
  return {
    name, mode: 'light',
    accent, accentDim, prompt,
    success: 'green', error: 'red', warning: '#B8860B', info: 'gray',
    text: 'black', dim: 'gray', muted: 'gray',
    border: accent, borderDim: 'gray', statusBg: accent,
    tool: '#B8860B', model: 'magenta', filePath: 'blue', code: 'black',
    diffAdd: 'green', diffRemove: 'red', diffContext: 'gray',
    permAllow: 'green', permDeny: 'red',
    ctxGreen: 'green', ctxYellow: '#B8860B', ctxRed: 'red',
  }
}

const THEMES: Record<string, InkTheme> = {
  default:  darkTheme('default',  'cyan',   '#5F8787', 'cyan'),
  light:    lightTheme('light',   'blue',   '#5F87AF', 'blue'),
  dark:     darkTheme('dark',     'green',  '#5F875F', 'green'),
  ocean:    darkTheme('ocean',    'blue',   '#5F87AF', 'blue'),
  warm:     darkTheme('warm',     'yellow', '#AF8700', 'yellow'),
  mono:     darkTheme('mono',     'white',  'gray',    'white'),
}

function resolveTheme(): InkTheme {
  const envTheme = (process.env.ORCA_THEME || '').toLowerCase()
  if (envTheme && THEMES[envTheme]) return THEMES[envTheme]!
  // Auto-detect: dark → default (cyan), light → light (blue)
  return isDark ? THEMES['default']! : THEMES['light']!
}

const currentTheme: InkTheme = resolveTheme()

const ThemeContext = createContext<InkTheme>(currentTheme)

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ThemeContext.Provider value={currentTheme}>{children}</ThemeContext.Provider>
}

export function useTheme(): InkTheme {
  return useContext(ThemeContext)
}

/** Get the resolved theme without React context (for non-component code) */
export function getTheme(): InkTheme {
  return currentTheme
}
