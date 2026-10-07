/**
 * The design system's tokens. Colors are Claude Code theme keys, so every
 * drawing follows the person's theme (dark, light, daltonized, ANSI) on the
 * terminal and on Desktop. Glyphs are single-cell BMP characters.
 *
 * Restraint is the rule: text is the default color, secondary text is dim,
 * the accent marks the brand and the selected place, and status colors are
 * reserved for state that needs a look.
 */

import type { TabId, Tone } from '../../types'

export type ColorProps = { color?: string; dimColor?: boolean; bold?: boolean }

export function toneProps(tone: Tone): ColorProps {
  switch (tone) {
    case 'normal':
      return {}
    case 'muted':
      return { dimColor: true }
    case 'good':
      return { color: 'success' }
    case 'warn':
      return { color: 'warning' }
    case 'bad':
      return { color: 'error' }
    case 'accent':
      return { color: 'claude' }
    case 'info':
      return { color: 'suggestion' }
  }
}

/**
 * Each section's accent, a theme key: its card titles and its tab indicator,
 * nothing more. One quiet hue per place, so the eye learns where it is.
 */
export const ACCENT: Record<TabId, string> = {
  overview: 'claude',
  context: 'ide',
  behavior: 'autoAccept',
  guardrails: 'planMode',
  activity: 'suggestion',
  setup: 'inactive',
}

/** The colors drawn into SVG (Desktop, mobile), where theme keys do not reach. */
export const SVG_COLOR: Record<Tone, string> = {
  normal: '#8E8E93',
  muted: '#8E8E93',
  good: '#30B158',
  warn: '#F2A33A',
  bad: '#E5534B',
  accent: '#D97757',
  info: '#4C8DF6',
}

export const G = {
  brand: '◆',
  dot: '●',
  ring: '○',
  mid: '·',
  chevron: '›',
  back: '‹',
  down: '▾',
  up: '▴',
  arrow: '▸',
  lineFull: '━',
  lineEmpty: '─',
  marker: '┃',
  rule: '─',
  ok: '✓',
  fail: '✗',
  stop: '⊘',
  run: '…',
  warn: '▲',
  minus: '−',
  plus: '+',
  none: '—',
  spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const,
} as const

/** A sparkline of 0–100 values: "▁▂▄▆█". */
export function sparkline(values: readonly number[], width: number): string {
  const v = values.slice(-Math.max(1, width))
  return v.map(n => G.spark[Math.min(7, Math.max(0, Math.floor((Math.max(0, Math.min(100, n)) / 100) * 7.999)))]).join('')
}

/** The cells of a line meter: how many are filled, and where the marker sits (or -1). */
export function meterCells(fraction: number, width: number, markerAt?: number | null): { filled: number; marker: number; width: number } {
  const w = Math.max(3, Math.floor(width))
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const filled = Math.round(f * w)
  const marker = markerAt === undefined || markerAt === null || !Number.isFinite(markerAt) ? -1 : Math.min(w - 1, Math.max(0, Math.round(markerAt * w) - 1))
  return { filled, marker, width: w }
}

/** The same meter as one plain string ("━━━━──┃──"), for the status line and tests. */
export function meter(fraction: number, width: number, markerAt?: number | null): string {
  const c = meterCells(fraction, width, markerAt)
  return Array.from({ length: c.width }, (_, i) => (i === c.marker ? G.marker : i < c.filled ? G.lineFull : G.lineEmpty)).join('')
}

/** A rounded horizontal bar with an optional threshold tick, as SVG for the remote surfaces. */
export function svgBar(input: { fraction: number; marker?: number | null; tone: Tone; width: number; height?: number }): string {
  const w = Math.max(40, Math.round(input.width))
  const h = input.height ?? 10
  const track = Math.max(4, h - 4)
  const y = Math.round((h - track) / 2)
  const f = Number.isFinite(input.fraction) ? Math.min(1, Math.max(0, input.fraction)) : 0
  const fill = Math.max(f > 0 ? track : 0, Math.round(f * w))
  const tick =
    input.marker === undefined || input.marker === null || !Number.isFinite(input.marker)
      ? ''
      : `<rect x="${Math.max(0, Math.min(w - 2, Math.round(input.marker * w) - 1))}" y="0" width="2" height="${h}" rx="1" fill="${SVG_COLOR.accent}"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="${y}" width="${w}" height="${track}" rx="${track / 2}" fill="#8E8E93" fill-opacity="0.25"/>` +
    (fill > 0 ? `<rect x="0" y="${y}" width="${fill}" height="${track}" rx="${track / 2}" fill="${SVG_COLOR[input.tone]}"/>` : '') +
    tick +
    `</svg>`
  )
}

/** A filled sparkline as SVG (Desktop, mobile): 0–100 values. */
export function svgSpark(values: readonly number[], input: { tone: Tone; width: number; height: number; ceiling?: number | null }): string {
  const w = Math.max(40, Math.round(input.width))
  const h = Math.max(12, Math.round(input.height))
  const v = values.length === 0 ? [0] : values
  const step = v.length > 1 ? w / (v.length - 1) : w
  const yOf = (n: number) => (h - 1 - (Math.max(0, Math.min(100, n)) / 100) * (h - 2)).toFixed(1)
  const points = v.map((n, i) => `${(i * step).toFixed(1)},${yOf(n)}`).join(' ')
  const color = SVG_COLOR[input.tone]
  const ceiling = input.ceiling === undefined || input.ceiling === null ? '' : `<line x1="0" x2="${w}" y1="${yOf(input.ceiling)}" y2="${yOf(input.ceiling)}" stroke="${SVG_COLOR.accent}" stroke-width="1" stroke-dasharray="3 3"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<polygon points="0,${h} ${points} ${w},${h}" fill="${color}" fill-opacity="0.18"/>` +
    `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    ceiling +
    `</svg>`
  )
}

/**
 * How a live reading reads: against the governor's ceilings when it is on
 * (amber within 10 points, red at or past), else against fixed marks.
 */
export function readingTone(value: number | null, ceiling: number | null, marks: { warn: number; bad: number }): Tone {
  if (value === null) return 'muted'
  const bad = ceiling ?? marks.bad
  const warn = ceiling === null ? marks.warn : ceiling - 10
  return value >= bad ? 'bad' : value >= warn ? 'warn' : 'good'
}

export const toneOfLevel = (level: string): Tone =>
  level === 'ok' ? 'good' : level === 'elevated' ? 'warn' : level === 'high' || level === 'critical' ? 'bad' : 'muted'
