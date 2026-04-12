/**
 * Smart Project Context Loader.
 *
 * Auto-detects project type, reads key config files, and generates
 * a context summary that enriches the system prompt. This is what
 * separates a generic chatbot from a project-aware coding agent.
 *
 * Detects: Node/TS, Python, Go, Rust, Java, Ruby, Swift, mixed
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execSync } from 'node:child_process'

// ── Types ────────────────────────────────────────────────────────

export interface ProjectContext {
  /** Detected project type */
  type: ProjectType
  /** Project name (from package.json, Cargo.toml, etc.) */
  name: string
  /** Languages detected */
  languages: string[]
  /** Key config files found */
  configFiles: string[]
  /** Git branch and status */
  git: { branch: string; dirty: boolean; recentCommits: string[] } | null
  /** Top-level directory listing */
  structure: string[]
  /** Dependencies summary (count by type) */
  deps: { production: number; development: number } | null
  /** Entry points or main files detected */
  entryPoints: string[]
  /** Framework detected (React, Express, FastAPI, etc.) */
  framework: string | null
  /** Test runner detected */
  testRunner: string | null
}

export type ProjectType =
  | 'node-typescript'
  | 'node-javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'ruby'
  | 'swift'
  | 'mixed'
  | 'unknown'

// ── Config File Markers ─────────────────────────────────────────

const PROJECT_MARKERS: Array<{ file: string; type: ProjectType }> = [
  { file: 'tsconfig.json', type: 'node-typescript' },
  { file: 'package.json', type: 'node-javascript' },
  { file: 'pyproject.toml', type: 'python' },
  { file: 'setup.py', type: 'python' },
  { file: 'requirements.txt', type: 'python' },
  { file: 'go.mod', type: 'go' },
  { file: 'Cargo.toml', type: 'rust' },
  { file: 'pom.xml', type: 'java' },
  { file: 'build.gradle', type: 'java' },
  { file: 'Gemfile', type: 'ruby' },
  { file: 'Package.swift', type: 'swift' },
]

const FRAMEWORK_MARKERS: Record<string, string> = {
  'next.config': 'Next.js',
  'nuxt.config': 'Nuxt',
  'vite.config': 'Vite',
  'angular.json': 'Angular',
  'svelte.config': 'Svelte',
  'remix.config': 'Remix',
  'astro.config': 'Astro',
  'tailwind.config': 'Tailwind CSS',
}

const TEST_RUNNER_MARKERS: Record<string, string> = {
  'vitest.config': 'Vitest',
  'jest.config': 'Jest',
  'pytest.ini': 'pytest',
  '.mocharc': 'Mocha',
  'karma.conf': 'Karma',
}

// ── Main Loader ─────────────────────────────────────────────────

export function loadProjectContext(cwd: string): ProjectContext {
  const ctx: ProjectContext = {
    type: 'unknown',
    name: basename(cwd),
    languages: [],
    configFiles: [],
    git: null,
    structure: [],
    deps: null,
    entryPoints: [],
    framework: null,
    testRunner: null,
  }

  // Detect project type
  const detectedTypes: ProjectType[] = []
  for (const marker of PROJECT_MARKERS) {
    if (existsSync(join(cwd, marker.file))) {
      detectedTypes.push(marker.type)
      ctx.configFiles.push(marker.file)
    }
  }

  if (detectedTypes.includes('node-typescript')) {
    ctx.type = 'node-typescript'
  } else if (detectedTypes.length === 1) {
    ctx.type = detectedTypes[0]!
  } else if (detectedTypes.length > 1) {
    ctx.type = 'mixed'
  }

  // Read package.json
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      ctx.name = pkg.name || ctx.name
      const prodDeps = Object.keys(pkg.dependencies || {}).length
      const devDeps = Object.keys(pkg.devDependencies || {}).length
      ctx.deps = { production: prodDeps, development: devDeps }

      // Detect entry points
      if (pkg.main) ctx.entryPoints.push(pkg.main)
      if (pkg.module) ctx.entryPoints.push(pkg.module)
      if (pkg.bin) {
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin)
        ctx.entryPoints.push(...bins as string[])
      }

      // Detect framework from dependencies
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (allDeps.react) ctx.framework = allDeps.next ? 'Next.js + React' : 'React'
      else if (allDeps.vue) ctx.framework = allDeps.nuxt ? 'Nuxt + Vue' : 'Vue'
      else if (allDeps.express) ctx.framework = 'Express'
      else if (allDeps.fastify) ctx.framework = 'Fastify'
      else if (allDeps.hono) ctx.framework = 'Hono'
      else if (allDeps.svelte) ctx.framework = 'SvelteKit'

      // Detect test runner from dependencies
      if (allDeps.vitest) ctx.testRunner = 'Vitest'
      else if (allDeps.jest) ctx.testRunner = 'Jest'
      else if (allDeps.mocha) ctx.testRunner = 'Mocha'
    } catch { /* ignore parse errors */ }
  }

  // Detect framework from config files
  if (!ctx.framework) {
    for (const [marker, name] of Object.entries(FRAMEWORK_MARKERS)) {
      try {
        const files = readdirSync(cwd)
        if (files.some(f => f.startsWith(marker))) {
          ctx.framework = name
          break
        }
      } catch { break }
    }
  }

  // Detect test runner from config files
  if (!ctx.testRunner) {
    for (const [marker, name] of Object.entries(TEST_RUNNER_MARKERS)) {
      try {
        const files = readdirSync(cwd)
        if (files.some(f => f.startsWith(marker))) {
          ctx.testRunner = name
          break
        }
      } catch { break }
    }
  }

  // Detect languages from file extensions
  try {
    const langSet = new Set<string>()
    const files = readdirSync(cwd)
    scanLanguages(cwd, langSet, 0)
    ctx.languages = [...langSet].sort()
  } catch { /* ignore */ }

  // Top-level structure
  try {
    const entries = readdirSync(cwd)
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      try {
        const stat = statSync(join(cwd, entry))
        ctx.structure.push(stat.isDirectory() ? `${entry}/` : entry)
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

  // Git info
  try {
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    const logOutput = execSync('git log --oneline -5', { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    ctx.git = {
      branch: branch || 'HEAD',
      dirty: status.length > 0,
      recentCommits: logOutput ? logOutput.split('\n').slice(0, 5) : [],
    }
  } catch { /* not a git repo */ }

  return ctx
}

// ── Language Detection ───────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java', '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.swift': 'Swift',
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.hpp': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
}

function scanLanguages(dir: string, langSet: Set<string>, depth: number): void {
  if (depth > 2) return
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'build') continue
      const full = join(dir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) {
          scanLanguages(full, langSet, depth + 1)
        } else {
          const ext = entry.slice(entry.lastIndexOf('.'))
          const lang = EXT_TO_LANG[ext]
          if (lang) langSet.add(lang)
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

// ── Context Formatter ───────────────────────────────────────────

// ── Skill Loading ──────────────────────────────────────────────

export interface SkillInfo {
  name: string
  description: string
  source: 'claude' | 'codex' | 'orca'
}

/**
 * Load skills from .claude/skills/, .codex/skills/, and .orca/skills/.
 * Reads each skill's SKILL.md for its description (first non-empty, non-heading line).
 */
export function loadSkills(cwd: string): SkillInfo[] {
  const home = process.env.HOME || '/tmp'
  const skills: SkillInfo[] = []

  const skillDirs: Array<{ path: string; source: SkillInfo['source'] }> = [
    { path: join(cwd, '.claude', 'skills'), source: 'claude' },
    { path: join(home, '.claude', 'skills'), source: 'claude' },
    { path: join(cwd, '.codex', 'skills'), source: 'codex' },
    { path: join(home, '.codex', 'skills'), source: 'codex' },
    { path: join(cwd, '.orca', 'skills'), source: 'orca' },
  ]

  const seen = new Set<string>()

  for (const { path: skillsRoot, source } of skillDirs) {
    if (!existsSync(skillsRoot)) continue
    try {
      const entries = readdirSync(skillsRoot)
      for (const entry of entries) {
        if (entry.startsWith('.') || seen.has(entry)) continue
        const skillMd = join(skillsRoot, entry, 'SKILL.md')
        if (!existsSync(skillMd)) continue

        seen.add(entry)
        try {
          const content = readFileSync(skillMd, 'utf-8')
          // Extract description: first line after frontmatter that isn't a heading or blank
          const lines = content.split('\n')
          let inFrontmatter = false
          let description = ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed === '---') { inFrontmatter = !inFrontmatter; continue }
            if (inFrontmatter) continue
            if (!trimmed || trimmed.startsWith('#')) continue
            description = trimmed.slice(0, 120)
            break
          }
          skills.push({ name: entry, description: description || entry, source })
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  return skills
}

export function formatContextForPrompt(ctx: ProjectContext): string {
  const lines: string[] = []

  lines.push(`## Project: ${ctx.name}`)
  lines.push(`Type: ${ctx.type} | Languages: ${ctx.languages.join(', ') || 'unknown'}`)

  if (ctx.framework) lines.push(`Framework: ${ctx.framework}`)
  if (ctx.testRunner) lines.push(`Tests: ${ctx.testRunner}`)

  if (ctx.deps) {
    lines.push(`Dependencies: ${ctx.deps.production} prod, ${ctx.deps.development} dev`)
  }

  if (ctx.entryPoints.length > 0) {
    lines.push(`Entry points: ${ctx.entryPoints.join(', ')}`)
  }

  if (ctx.git) {
    const dirty = ctx.git.dirty ? ' (uncommitted changes)' : ''
    lines.push(`Git: ${ctx.git.branch}${dirty}`)
  }

  if (ctx.structure.length > 0) {
    lines.push(`\nStructure: ${ctx.structure.slice(0, 20).join(' | ')}`)
  }

  if (ctx.configFiles.length > 0) {
    lines.push(`Config: ${ctx.configFiles.join(', ')}`)
  }

  return lines.join('\n')
}
