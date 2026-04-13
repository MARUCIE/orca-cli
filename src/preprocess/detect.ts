/**
 * File format detection — extension + MIME type mapping.
 */

import { extname } from 'node:path'

export type FormatCategory =
  | 'text'       // MD, TXT, code — pass through
  | 'document'   // PDF, DOCX, PPTX, XLSX — markitdown
  | 'markup'     // HTML, XML, RSS — markitdown (strip tags)
  | 'data'       // JSON, CSV, YAML, TOML — structured, may simplify
  | 'image'      // PNG, JPG, SVG — OCR / description
  | 'audio'      // MP3, WAV, M4A — speech-to-text
  | 'video'      // MP4, MOV, MKV — keyframes + transcript
  | 'archive'    // ZIP, TAR — list contents
  | 'unknown'

export interface FileFormat {
  extension: string
  category: FormatCategory
  /** Which converter to use */
  converter: 'passthrough' | 'markitdown' | 'pandoc' | 'ffmpeg' | 'none'
  /** MIME type hint */
  mimeType: string
}

const FORMAT_MAP: Record<string, Omit<FileFormat, 'extension'>> = {
  // Text (pass through)
  '.md':    { category: 'text', converter: 'passthrough', mimeType: 'text/markdown' },
  '.txt':   { category: 'text', converter: 'passthrough', mimeType: 'text/plain' },
  '.log':   { category: 'text', converter: 'passthrough', mimeType: 'text/plain' },
  // Code (pass through)
  '.ts':    { category: 'text', converter: 'passthrough', mimeType: 'text/typescript' },
  '.tsx':   { category: 'text', converter: 'passthrough', mimeType: 'text/typescript' },
  '.js':    { category: 'text', converter: 'passthrough', mimeType: 'text/javascript' },
  '.jsx':   { category: 'text', converter: 'passthrough', mimeType: 'text/javascript' },
  '.py':    { category: 'text', converter: 'passthrough', mimeType: 'text/x-python' },
  '.go':    { category: 'text', converter: 'passthrough', mimeType: 'text/x-go' },
  '.rs':    { category: 'text', converter: 'passthrough', mimeType: 'text/x-rust' },
  '.java':  { category: 'text', converter: 'passthrough', mimeType: 'text/x-java' },
  '.c':     { category: 'text', converter: 'passthrough', mimeType: 'text/x-c' },
  '.cpp':   { category: 'text', converter: 'passthrough', mimeType: 'text/x-c++' },
  '.h':     { category: 'text', converter: 'passthrough', mimeType: 'text/x-c' },
  '.rb':    { category: 'text', converter: 'passthrough', mimeType: 'text/x-ruby' },
  '.php':   { category: 'text', converter: 'passthrough', mimeType: 'text/x-php' },
  '.swift': { category: 'text', converter: 'passthrough', mimeType: 'text/x-swift' },
  '.kt':    { category: 'text', converter: 'passthrough', mimeType: 'text/x-kotlin' },
  '.sh':    { category: 'text', converter: 'passthrough', mimeType: 'text/x-shellscript' },
  '.zsh':   { category: 'text', converter: 'passthrough', mimeType: 'text/x-shellscript' },
  '.bash':  { category: 'text', converter: 'passthrough', mimeType: 'text/x-shellscript' },
  '.css':   { category: 'text', converter: 'passthrough', mimeType: 'text/css' },
  '.scss':  { category: 'text', converter: 'passthrough', mimeType: 'text/x-scss' },
  '.sql':   { category: 'text', converter: 'passthrough', mimeType: 'text/x-sql' },
  '.vue':   { category: 'text', converter: 'passthrough', mimeType: 'text/x-vue' },
  '.svelte': { category: 'text', converter: 'passthrough', mimeType: 'text/x-svelte' },
  // Documents (markitdown)
  '.pdf':   { category: 'document', converter: 'markitdown', mimeType: 'application/pdf' },
  '.docx':  { category: 'document', converter: 'markitdown', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.pptx':  { category: 'document', converter: 'markitdown', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.xlsx':  { category: 'document', converter: 'markitdown', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.doc':   { category: 'document', converter: 'markitdown', mimeType: 'application/msword' },
  '.ppt':   { category: 'document', converter: 'markitdown', mimeType: 'application/vnd.ms-powerpoint' },
  '.xls':   { category: 'document', converter: 'markitdown', mimeType: 'application/vnd.ms-excel' },
  '.rtf':   { category: 'document', converter: 'pandoc', mimeType: 'application/rtf' },
  '.epub':  { category: 'document', converter: 'pandoc', mimeType: 'application/epub+zip' },
  // Markup (markitdown — strips tags, keeps content)
  '.html':  { category: 'markup', converter: 'markitdown', mimeType: 'text/html' },
  '.htm':   { category: 'markup', converter: 'markitdown', mimeType: 'text/html' },
  '.xml':   { category: 'markup', converter: 'markitdown', mimeType: 'text/xml' },
  '.rss':   { category: 'markup', converter: 'markitdown', mimeType: 'application/rss+xml' },
  // Data (structured — may simplify)
  '.json':  { category: 'data', converter: 'passthrough', mimeType: 'application/json' },
  '.csv':   { category: 'data', converter: 'markitdown', mimeType: 'text/csv' },
  '.tsv':   { category: 'data', converter: 'passthrough', mimeType: 'text/tab-separated-values' },
  '.yaml':  { category: 'data', converter: 'passthrough', mimeType: 'text/yaml' },
  '.yml':   { category: 'data', converter: 'passthrough', mimeType: 'text/yaml' },
  '.toml':  { category: 'data', converter: 'passthrough', mimeType: 'text/toml' },
  // Images (OCR / description)
  '.png':   { category: 'image', converter: 'markitdown', mimeType: 'image/png' },
  '.jpg':   { category: 'image', converter: 'markitdown', mimeType: 'image/jpeg' },
  '.jpeg':  { category: 'image', converter: 'markitdown', mimeType: 'image/jpeg' },
  '.gif':   { category: 'image', converter: 'markitdown', mimeType: 'image/gif' },
  '.webp':  { category: 'image', converter: 'markitdown', mimeType: 'image/webp' },
  '.svg':   { category: 'markup', converter: 'passthrough', mimeType: 'image/svg+xml' },
  '.bmp':   { category: 'image', converter: 'markitdown', mimeType: 'image/bmp' },
  // Audio (speech-to-text)
  '.mp3':   { category: 'audio', converter: 'markitdown', mimeType: 'audio/mpeg' },
  '.wav':   { category: 'audio', converter: 'markitdown', mimeType: 'audio/wav' },
  '.m4a':   { category: 'audio', converter: 'markitdown', mimeType: 'audio/mp4' },
  '.ogg':   { category: 'audio', converter: 'markitdown', mimeType: 'audio/ogg' },
  '.flac':  { category: 'audio', converter: 'markitdown', mimeType: 'audio/flac' },
  // Video (keyframes + transcript)
  '.mp4':   { category: 'video', converter: 'ffmpeg', mimeType: 'video/mp4' },
  '.mov':   { category: 'video', converter: 'ffmpeg', mimeType: 'video/quicktime' },
  '.mkv':   { category: 'video', converter: 'ffmpeg', mimeType: 'video/x-matroska' },
  '.avi':   { category: 'video', converter: 'ffmpeg', mimeType: 'video/x-msvideo' },
  '.webm':  { category: 'video', converter: 'ffmpeg', mimeType: 'video/webm' },
  // Archives (list contents)
  '.zip':   { category: 'archive', converter: 'markitdown', mimeType: 'application/zip' },
  '.tar':   { category: 'archive', converter: 'none', mimeType: 'application/x-tar' },
  '.gz':    { category: 'archive', converter: 'none', mimeType: 'application/gzip' },
}

export function detectFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase()
  const info = FORMAT_MAP[ext]
  if (info) {
    return { extension: ext, ...info }
  }
  return { extension: ext, category: 'unknown', converter: 'none', mimeType: 'application/octet-stream' }
}

/** Check if a file format can be converted to Markdown */
export function isConvertible(format: FileFormat): boolean {
  return format.converter !== 'none' && format.category !== 'unknown'
}
