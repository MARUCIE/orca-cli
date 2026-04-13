/**
 * Notes Manager — free-form observations with tags and search.
 *
 * Notes are lightweight observations captured during work.
 * They feed into the LearningJournal for promotion to rules.
 *
 * Storage: ~/.orca/knowledge/notes/
 * Format: { id, content, tags[], source, createdAt }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface Note {
  id: string
  content: string
  tags: string[]
  source?: string      // file path, command, or context where note was captured
  project?: string     // project name
  createdAt: string
}

export class NotesManager {
  private dir: string

  constructor() {
    const home = process.env.ORCA_HOME || process.env.HOME || homedir()
    this.dir = join(home, '.orca', 'knowledge', 'notes')
    mkdirSync(this.dir, { recursive: true })
  }

  getDir(): string { return this.dir }

  /** Create a new note */
  create(content: string, tags: string[] = [], source?: string, project?: string): Note {
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const note: Note = {
      id,
      content,
      tags,
      source,
      project,
      createdAt: new Date().toISOString(),
    }
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(note, null, 2))
    return note
  }

  /** Load a note by id */
  load(id: string): Note | null {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  }

  /** List recent notes, optionally filtered by tag or project */
  list(limit = 20, filter?: { tag?: string; project?: string }): Note[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.json'))
    const notes: Note[] = []
    for (const file of files) {
      try {
        const note: Note = JSON.parse(readFileSync(join(this.dir, file), 'utf-8'))
        if (filter?.tag && !note.tags.includes(filter.tag)) continue
        if (filter?.project && note.project !== filter.project) continue
        notes.push(note)
      } catch { /* skip malformed */ }
    }
    return notes
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  /** Search notes by content keyword */
  search(query: string, limit = 10): Note[] {
    const lower = query.toLowerCase()
    return this.list(100)
      .filter(n => n.content.toLowerCase().includes(lower) || n.tags.some(t => t.toLowerCase().includes(lower)))
      .slice(0, limit)
  }

  /** Delete a note */
  delete(id: string): boolean {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  }
}
