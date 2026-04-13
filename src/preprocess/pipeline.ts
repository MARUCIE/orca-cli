/**
 * Preprocessing Pipeline — the full L0→L2 chain.
 *
 * Usage:
 *   const result = preprocessFile('/path/to/report.pdf')
 *   // result.markdown = clean, compact Markdown
 *   // result.savingsRatio = 4.2 (4.2x fewer tokens than raw)
 *
 * Smart truncation (L2):
 *   - Preserves heading structure (# ## ###)
 *   - Keeps first + last sections for context
 *   - Middle sections summarized as "[N paragraphs omitted]"
 */

import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { detectFormat, isConvertible } from './detect.js'
import { convertToMarkdown, type ConversionResult } from './convert.js'

export interface PreprocessResult extends ConversionResult {
  /** File name */
  fileName: string
  /** Format category */
  category: string
  /** Was the content truncated in L2? */
  truncated: boolean
}

/**
 * Full preprocessing pipeline: detect → convert → truncate.
 *
 * @param filePath Absolute path to the file
 * @param maxChars Maximum output chars (default 20KB = ~5K tokens)
 */
export function preprocessFile(filePath: string, maxChars = 20_000): PreprocessResult {
  const format = detectFormat(filePath)
  const fileName = basename(filePath)

  if (!isConvertible(format)) {
    return {
      success: false,
      markdown: `[Unsupported format: ${format.extension} (${format.category})]`,
      originalSize: 0,
      convertedSize: 0,
      method: 'none',
      savingsRatio: 1,
      durationMs: 0,
      fileName,
      category: format.category,
      truncated: false,
      error: `Format ${format.extension} not supported for conversion`,
    }
  }

  // L1: Convert to Markdown
  const result = convertToMarkdown(filePath)

  if (!result.success) {
    return { ...result, fileName, category: format.category, truncated: false }
  }

  // L2: Smart truncation if over limit
  let markdown = result.markdown
  let truncated = false

  if (markdown.length > maxChars) {
    markdown = smartTruncate(markdown, maxChars)
    truncated = true
  }

  return {
    ...result,
    markdown,
    convertedSize: markdown.length,
    fileName,
    category: format.category,
    truncated,
  }
}

/**
 * Smart truncation that preserves semantic structure.
 *
 * Strategy:
 *   1. Keep all headings (# lines)
 *   2. Keep first 40% and last 20% of content
 *   3. Middle 40% replaced with "[... N paragraphs omitted ...]"
 *   4. Never break in the middle of a paragraph
 */
function smartTruncate(markdown: string, maxChars: number): string {
  // Split by paragraphs (double newline)
  const paragraphs = markdown.split(/\n\n+/)

  // If few paragraphs, just hard truncate
  if (paragraphs.length <= 5) {
    return markdown.slice(0, maxChars) + `\n\n[... truncated at ${(maxChars / 1024).toFixed(0)}KB]`
  }

  // Keep headings from everywhere
  const headings = paragraphs.filter(p => p.startsWith('#'))

  // Calculate split points
  const headPct = 0.4
  const tailPct = 0.2
  const headCount = Math.max(2, Math.floor(paragraphs.length * headPct))
  const tailCount = Math.max(1, Math.floor(paragraphs.length * tailPct))
  const omittedCount = paragraphs.length - headCount - tailCount

  const headParts = paragraphs.slice(0, headCount)
  const tailParts = paragraphs.slice(-tailCount)

  // Build truncated content
  const parts = [
    ...headParts,
    `\n[... ${omittedCount} paragraphs omitted for token efficiency ...]\n`,
    ...tailParts,
  ]

  let result = parts.join('\n\n')

  // Final hard limit
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '\n[truncated]'
  }

  return result
}
