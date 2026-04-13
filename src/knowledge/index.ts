/**
 * Knowledge Management System — AI-Fleet doc management transplant.
 *
 * 5 components:
 *   1. NotesManager — free-form observations, tagged and searchable
 *   2. PostmortemLog — structured error patterns (problem → root cause → fix → prevention)
 *   3. PromptRepository — versioned prompt templates with effectiveness tracking
 *   4. LearningJournal — auto-evolution: observations → hypotheses → promoted rules
 *   5. ArtifactStore — tool output capture for cross-session reference
 *
 * Storage: JSON files in ~/.orca/knowledge/
 * Integration: PostToolUse hook + SessionEnd + /knowledge REPL command
 */

export { NotesManager, type Note } from './notes.js'
export { PostmortemLog, type Postmortem } from './postmortem.js'
export { PromptRepository, type PromptTemplate } from './prompts.js'
export { LearningJournal, type LearningEntry } from './learning.js'
