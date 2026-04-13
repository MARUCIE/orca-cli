/**
 * File Preprocessing Pipeline — convert any format to compact Markdown.
 *
 * Core insight: SOTA models ($15-75/M tokens) should reason, not parse.
 * Pre-converting HTML/PDF/DOCX to Markdown saves 3-5x tokens.
 *
 * Pipeline:
 *   L0: Format detection (extension + MIME)
 *   L1: Conversion (markitdown / pandoc / ffmpeg — local, zero API cost)
 *   L2: Smart truncation (preserve semantic structure)
 *   L3: Feed compact Markdown to SOTA model
 *
 * Token economics:
 *   Raw HTML 50KB → ~12.5K tokens × 3 models = 37.5K tokens
 *   Clean MD  10KB → ~2.5K tokens × 3 models = 7.5K tokens
 *   Savings: 5x per council call
 */

export { detectFormat, type FileFormat, type FormatCategory } from './detect.js'
export { convertToMarkdown, type ConversionResult } from './convert.js'
export { preprocessFile } from './pipeline.js'
