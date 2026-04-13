/**
 * File Converters — transform any format to Markdown.
 *
 * Converter dispatch:
 *   markitdown: PDF, DOCX, PPTX, XLSX, HTML, CSV, images, audio, ZIP
 *   pandoc:     RTF, EPUB (fallback for formats markitdown doesn't handle)
 *   ffmpeg:     Video → extract audio → markitdown speech-to-text
 *   passthrough: MD, TXT, code files — read as-is
 *
 * All converters are LOCAL (no API cost). The entire point is to
 * convert expensive-to-tokenize formats into cheap Markdown BEFORE
 * sending to SOTA models.
 */

import { execSync } from 'node:child_process'
import { readFileSync, statSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { detectFormat, type FileFormat } from './detect.js'

export interface ConversionResult {
  success: boolean
  /** Converted Markdown content */
  markdown: string
  /** Original file size in bytes */
  originalSize: number
  /** Converted content size in chars */
  convertedSize: number
  /** Conversion method used */
  method: string
  /** Token savings estimate (ratio: original/converted) */
  savingsRatio: number
  /** Time taken in ms */
  durationMs: number
  /** Error message if failed */
  error?: string
}

// ── Tool Availability Cache ─────────────────────────────────────

let _markitdownAvailable: boolean | null = null
let _pandocAvailable: boolean | null = null
let _ffmpegAvailable: boolean | null = null

function hasMarkitdown(): boolean {
  if (_markitdownAvailable === null) {
    try { execSync('markitdown --version', { stdio: 'pipe' }); _markitdownAvailable = true }
    catch { _markitdownAvailable = false }
  }
  return _markitdownAvailable
}

function hasPandoc(): boolean {
  if (_pandocAvailable === null) {
    try { execSync('pandoc --version', { stdio: 'pipe' }); _pandocAvailable = true }
    catch { _pandocAvailable = false }
  }
  return _pandocAvailable
}

function hasFfmpeg(): boolean {
  if (_ffmpegAvailable === null) {
    try { execSync('ffmpeg -version', { stdio: 'pipe' }); _ffmpegAvailable = true }
    catch { _ffmpegAvailable = false }
  }
  return _ffmpegAvailable
}

// ── Main Converter ──────────────────────────────────────────────

export function convertToMarkdown(filePath: string): ConversionResult {
  const startTime = Date.now()
  const format = detectFormat(filePath)

  try {
    const stat = statSync(filePath)
    const originalSize = stat.size

    // Size guard: skip files > 50MB
    if (originalSize > 50 * 1024 * 1024) {
      return {
        success: false, markdown: '', originalSize, convertedSize: 0,
        method: 'none', savingsRatio: 1, durationMs: Date.now() - startTime,
        error: `File too large: ${(originalSize / 1024 / 1024).toFixed(1)}MB (max 50MB)`,
      }
    }

    let markdown: string
    let method: string

    switch (format.converter) {
      case 'passthrough':
        markdown = readFileSync(filePath, 'utf-8')
        method = 'passthrough'
        break

      case 'markitdown':
        markdown = runMarkitdown(filePath, format)
        method = 'markitdown'
        break

      case 'pandoc':
        markdown = runPandoc(filePath, format)
        method = 'pandoc'
        break

      case 'ffmpeg':
        markdown = runVideoConvert(filePath)
        method = 'ffmpeg+markitdown'
        break

      default:
        return {
          success: false, markdown: '', originalSize, convertedSize: 0,
          method: 'none', savingsRatio: 1, durationMs: Date.now() - startTime,
          error: `No converter for format: ${format.extension}`,
        }
    }

    const convertedSize = markdown.length
    // Estimate token savings: raw file chars/4 vs markdown chars/4
    const rawTokens = Math.ceil(originalSize / 4)
    const mdTokens = Math.ceil(convertedSize / 4)
    const savingsRatio = mdTokens > 0 ? rawTokens / mdTokens : 1

    return {
      success: true,
      markdown,
      originalSize,
      convertedSize,
      method,
      savingsRatio,
      durationMs: Date.now() - startTime,
    }
  } catch (err) {
    return {
      success: false, markdown: '', originalSize: 0, convertedSize: 0,
      method: format.converter, savingsRatio: 1, durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Individual Converters ───────────────────────────────────────

function runMarkitdown(filePath: string, format: FileFormat): string {
  if (!hasMarkitdown()) {
    // Fallback: for HTML, strip tags with regex; for others, read raw
    if (format.category === 'markup') {
      const raw = readFileSync(filePath, 'utf-8')
      return stripHtmlToText(raw)
    }
    return readFileSync(filePath, 'utf-8')
  }

  const output = execSync(`markitdown "${filePath}"`, {
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  })

  return output.trim()
}

function runPandoc(filePath: string, format: FileFormat): string {
  if (!hasPandoc()) {
    // Try markitdown as fallback
    if (hasMarkitdown()) return runMarkitdown(filePath, format)
    return readFileSync(filePath, 'utf-8')
  }

  const output = execSync(`pandoc -t markdown --wrap=none "${filePath}"`, {
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  })

  return output.trim()
}

function runVideoConvert(filePath: string): string {
  const parts: string[] = []

  // Extract metadata
  try {
    const probe = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: 'utf-8', timeout: 10_000 },
    )
    const meta = JSON.parse(probe) as { format?: { duration?: string; size?: string; format_name?: string } }
    if (meta.format) {
      const dur = meta.format.duration ? `${Math.round(Number(meta.format.duration))}s` : 'unknown'
      parts.push(`## Video Metadata\n- Duration: ${dur}\n- Format: ${meta.format.format_name || 'unknown'}\n- Size: ${((Number(meta.format.size) || 0) / 1024 / 1024).toFixed(1)}MB`)
    }
  } catch { /* metadata extraction is best-effort */ }

  // Extract audio → markitdown for transcript
  if (hasFfmpeg() && hasMarkitdown()) {
    const tmpAudio = join(tmpdir(), `orca-audio-${Date.now()}.wav`)
    try {
      execSync(`ffmpeg -i "${filePath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 -t 300 "${tmpAudio}" -y`, {
        stdio: 'pipe', timeout: 120_000,
      })
      if (existsSync(tmpAudio) && statSync(tmpAudio).size > 1000) {
        const transcript = execSync(`markitdown "${tmpAudio}"`, {
          encoding: 'utf-8', timeout: 120_000, maxBuffer: 5 * 1024 * 1024,
        }).trim()
        if (transcript) {
          parts.push(`## Audio Transcript (first 5 min)\n${transcript}`)
        }
      }
    } catch { /* transcript is best-effort */ }
    finally { try { unlinkSync(tmpAudio) } catch {} }
  }

  // Extract keyframes as descriptions (if markitdown supports images)
  if (hasFfmpeg()) {
    const tmpDir = join(tmpdir(), `orca-frames-${Date.now()}`)
    try {
      mkdirSync(tmpDir, { recursive: true })
      // Extract 1 frame per 30 seconds, max 10 frames
      execSync(`ffmpeg -i "${filePath}" -vf "fps=1/30" -frames:v 10 "${tmpDir}/frame_%03d.jpg" -y`, {
        stdio: 'pipe', timeout: 60_000,
      })
      const frames = readFileSync(join(tmpDir, 'frame_001.jpg'), null) // check if any frames were extracted
      if (frames.length > 0) {
        parts.push(`## Keyframes\n(${10} frames extracted at 30s intervals for visual reference)`)
      }
    } catch { /* keyframe extraction is best-effort */ }
  }

  if (parts.length === 0) {
    return `[Video file: ${basename(filePath)} — install ffmpeg + markitdown for transcript extraction]`
  }

  return parts.join('\n\n')
}

// ── Fallback HTML Stripper ──────────────────────────────────────

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
