/**
 * Test helper to create temporary directories with test file structures.
 * Handles setup and cleanup automatically.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

export function createTempProject(structure: Record<string, string>): {
  dir: string
  cleanup: () => void
} {
  const tempDir = join(tmpdir(), `orca-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(tempDir, { recursive: true })

  // Create directory structure and files
  for (const [path, content] of Object.entries(structure)) {
    const fullPath = join(tempDir, path)
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))

    if (dir !== tempDir) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(fullPath, content, 'utf-8')
  }

  return {
    dir: tempDir,
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}
