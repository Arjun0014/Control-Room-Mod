/**
 * The design system's tokens. Colors are Claude Code theme keys, so every
 * drawing follows the person's theme (dark, light, daltonized, ANSI) on the
 * terminal and on Desktop. Glyphs are single-cell BMP characters.
 */

import type { Tone } from '../../types'

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
      return { color: 'error', bold: true }
    case 'accent':
      return { color: 'claude', bold: true }
    case 'info':
      return { color: 'permission' }
  }
}

export const G = {
  brand: '◆',
  dot: '●',
  ring: '○',
  sep: '│',
  mid: '·',
  arrow: '▸',
  back: '◂',
  barFull: '▰',
  barEmpty: '▱',
  rule: '─',
  ok: '✓',
  fail: '✗',
  stop: '⊘',
  run: '…',
  warn: '▲',
  none: '—',
  spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const,
} as const

/** A sparkline of 0–100 values: "▁▂▄▆█". */
export function sparkline(values: readonly number[], width: number): string {
  const v = values.slice(-Math.max(1, width))
  return v.map(n => G.spark[Math.min(7, Math.max(0, Math.floor((Math.max(0, Math.min(100, n)) / 100) * 7.999)))]).join('')
}

/** A meter with an optional marker cell: "▰▰▰▰▰▱▱│▱▱". */
export function meter(fraction: number, width: number, markerAt?: number): string {
  const w = Math.max(3, Math.floor(width))
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const filled = Math.round(f * w)
  const cells: string[] = Array.from({ length: w }, (_, i) => (i < filled ? G.barFull : G.barEmpty))
  if (markerAt !== undefined && Number.isFinite(markerAt)) {
    const m = Math.min(w - 1, Math.max(0, Math.round(markerAt * w) - 1))
    cells[m] = '┃'
  }
  return cells.join('')
}

export const toneOfLevel = (level: string): Tone =>
  level === 'ok' ? 'good' : level === 'elevated' ? 'warn' : level === 'high' || level === 'critical' ? 'bad' : 'muted'
