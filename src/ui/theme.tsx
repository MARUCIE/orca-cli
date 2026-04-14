/**
 * Theme system for ink UI components.
 *
 * Reads ORCA_THEME env var and provides color tokens via React Context.
 * Components use useTheme() to get the current theme's colors.
 *
 * Themes: default (cyan), dark (green), ocean (blue), warm (yellow), mono (white)
 */

import React, { createContext, useContext } from 'react'

export interface InkTheme {
  name: string
  /** Primary accent color (borders, highlights, orca art) */
  accent: string
  /** Prompt/input color */
  prompt: string
  /** Success indicators */
  success: string
  /** Secondary/dim text — ink's dimColor handles this, but theme can override */
  dim: string
  /** Status bar background style */
  statusBg: string
}

const THEMES: Record<string, InkTheme> = {
  default: { name: 'default', accent: 'cyan',    prompt: 'cyan',    success: 'green',  dim: 'gray',   statusBg: 'cyan' },
  dark:    { name: 'dark',    accent: 'green',   prompt: 'green',   success: 'green',  dim: 'gray',   statusBg: 'green' },
  ocean:   { name: 'ocean',   accent: 'blue',    prompt: 'blue',    success: 'cyan',   dim: 'gray',   statusBg: 'blue' },
  warm:    { name: 'warm',    accent: 'yellow',  prompt: 'yellow',  success: 'green',  dim: 'gray',   statusBg: 'yellow' },
  mono:    { name: 'mono',    accent: 'white',   prompt: 'white',   success: 'white',  dim: 'gray',   statusBg: 'white' },
}

const themeId = (process.env.ORCA_THEME || 'default').toLowerCase()
const currentTheme: InkTheme = THEMES[themeId] || THEMES['default']!

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
