/**
 * Text helpers. Everything drawn in a tree passes through `clean` so a
 * command line, a path or a model's words can never inject control
 * characters into the terminal, and long values never break a layout.
 */

/** Builds a character class from code-point ranges (keeps this source free of invisible characters). */
const classOf = (ranges: readonly (readonly [number, number])[]): string =>
  `[${ranges.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`

const INVISIBLE: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
]

const CONTROL = new RegExp(classOf([[0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], ...INVISIBLE]), 'g')
const CONTROL_KEEP_LINES = new RegExp(classOf([[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], ...INVISIBLE]), 'g')

/** One printable line: control and bidi characters dropped, whitespace collapsed. */
export function clean(text: unknown, max = 200): string {
  const s = typeof text === 'string' ? text : text === undefined || text === null ? '' : String(text)
  const line = s.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  return truncate(line, max)
}

/** Multi-line text with control characters dropped (newlines and tabs kept). */
export function cleanBlock(text: unknown, max = 4000): string {
  const s = typeof text === 'string' ? text : ''
  const kept = s.replace(CONTROL_KEEP_LINES, '')
  return kept.length > max ? `${kept.slice(0, max - 1)}…` : kept
}

/** Cut at `max` characters with an ellipsis, never splitting a surrogate pair. */
export function truncate(s: string, max: number): string {
  if (max <= 0) return ''
  if (s.length <= max) return s
  let cut = Math.max(0, max - 1)
  const code = s.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  return `${s.slice(0, cut)}…`
}

/** Keeps the end of a path-like string: "…/src/components/App.tsx". */
export function truncateStart(s: string, max: number): string {
  if (s.length <= max) return s
  return `…${s.slice(s.length - (max - 1))}`
}

/** The last two segments of a path, for compact rows. */
export function shortPath(path: string, max = 48): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  const tail = parts.slice(-2).join('/')
  return truncateStart(parts.length > 2 ? `…/${tail}` : norm, max)
}

/** A path relative to `root` when inside it, otherwise as given. */
export function relativeTo(path: string, root: string): string {
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (r !== '' && (p === r || p.toLowerCase().startsWith(`${r.toLowerCase()}/`))) {
    return p.slice(r.length + 1) || '.'
  }
  return p
}

/** Pads or cuts `s` to exactly `width` columns (ASCII-width assumption). */
export function fit(s: string, width: number): string {
  if (width <= 0) return ''
  return s.length > width ? truncate(s, width) : s + ' '.repeat(width - s.length)
}

/** Sentences of a block of text (for quoting what the guard found). */
export function sentencesOf(text: string): string[] {
  const found = text.replace(/\r/g, '').match(/[^.!?\n]+[.!?]*/g) ?? []
  return found.map(s => s.trim()).filter(s => s.length > 0)
}

/** Starts a sentence: its first letter upper case ("queued work" → "Queued work"). */
export const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export const isBlank = (s: string | undefined | null): boolean => s === undefined || s === null || s.trim() === ''
