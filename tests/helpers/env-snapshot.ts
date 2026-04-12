/**
 * Test helper to safely manage environment variables during tests.
 * Saves original values, applies overrides, runs callback, restores originals.
 */

export async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const original = { ...process.env }

  try {
    // Apply overrides
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    // Run callback
    await fn()
  } finally {
    // Restore original environment
    for (const [key, value] of Object.entries(original)) {
      process.env[key] = value
    }

    // Clean up any new keys added
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) {
        delete process.env[key]
      }
    }
  }
}
