/**
 * The status bar: one line above the prompt, live readings only.
 *
 *   ◆   Context ━━━━━━━──── 69%   $78.35   CPU ▂▃▅▃ 23%   RAM ▇▇▇▇ 79%   2 agents        Control Room
 *
 * What it shows changes while you work: context, cost, the machine's CPU
 * and memory, running agents, and events as they happen (a handoff about to
 * start or under way, the guard keeping Claude going). Settings live in the
 * panel, not here. Labels are dim, values plain, color only where a reading
 * asks for attention. Items drop by priority as the width shrinks; a second
 * line appears only when something needs the person.
 */

import type { RenderElement } from 'claude-code'

import type { HudModel, Tone } from '../../types'
import * as fmt from '../core/format'
import type { Kit } from './kit'
import { isNative } from './primitives'
import { G, meterCells, sparkline, toneProps } from './theme'

type Span = { text: string; tone?: Tone; isDim?: boolean; isBold?: boolean }
export type Segment = { key: string; priority: number; spans: Span[] }

const GAP = 3

export const widthOf = (s: Segment): number => s.spans.reduce((n, p) => n + p.text.length, 0)

function meterSpans(fraction: number, marker: number | null, tone: Tone, width: number): Span[] {
  const c = meterCells(fraction, width, marker)
  const out: Span[] = []
  for (let i = 0; i < c.width; i++) {
    const span: Span = i === c.marker ? { text: G.marker, tone: 'accent' } : i < c.filled ? { text: G.lineFull, tone } : { text: G.lineEmpty, isDim: true }
    const last = out[out.length - 1]
    if (last !== undefined && last.tone === span.tone && last.isDim === span.isDim) last.text += span.text
    else out.push(span)
  }
  return out
}

const valueTone = (tone: Tone): Tone | undefined => (tone === 'good' || tone === 'normal' || tone === 'muted' ? undefined : tone)

function reading(key: string, label: string, value: number | null, tone: Tone, series: readonly number[], hasSpark: boolean, priority: number): Segment {
  const spark = hasSpark && series.length > 1 ? [{ text: `${sparkline(series, 6)} `, isDim: true }] : []
  return {
    key,
    priority,
    spans: [{ text: `${label} `, isDim: true }, ...spark, { text: value === null ? G.none : `${Math.round(value)}%`, tone: valueTone(tone), isBold: tone === 'bad' }],
  }
}

const EVENT_STATES = new Set(['pending', 'requested', 'handoff', 'verifying', 'clearing', 'compacting', 'resuming', 'awaiting'])

export function hudSegments(hud: HudModel, columns: number, surface: Kit['surface'] = 'terminal'): Segment[] {
  const isTerminal = surface === 'terminal'
  const segments: Segment[] = [{ key: 'brand', priority: 0, spans: [{ text: G.brand, tone: 'accent', isBold: true }] }]

  const ctx = hud.ctx
  if (ctx.pct === null) {
    segments.push({ key: 'ctx', priority: 0, spans: [{ text: 'Context ', isDim: true }, { text: G.none, isDim: true }] })
  } else {
    const hasMeter = isTerminal && columns >= 76 && ctx.tokens !== null && ctx.window !== null && ctx.window > 0
    const meter = hasMeter
      ? [...meterSpans(ctx.tokens! / ctx.window!, ctx.threshold === null ? null : ctx.threshold / ctx.window!, ctx.tone === 'muted' ? 'good' : ctx.tone, 10), { text: ' ' }]
      : []
    segments.push({ key: 'ctx', priority: 0, spans: [{ text: 'Context ', isDim: true }, ...meter, { text: `${ctx.pct}%`, tone: valueTone(ctx.tone), isBold: ctx.tone === 'bad' }] })
  }

  if (hud.autopilot.isOn && EVENT_STATES.has(hud.autopilot.state)) {
    segments.push({ key: 'event', priority: 0, spans: [{ text: hud.autopilot.text, tone: hud.autopilot.tone === 'normal' ? 'accent' : hud.autopilot.tone, isBold: true }] })
  }

  segments.push({ key: 'cost', priority: 1, spans: [{ text: fmt.cost(hud.cost.usd), isDim: hud.cost.usd === null }] })
  if (hud.cost.runUsd !== null && hud.cost.usd !== null && hud.cost.runUsd - hud.cost.usd > 0.005) {
    segments.push({ key: 'runcost', priority: 6, spans: [{ text: `run ${fmt.cost(hud.cost.runUsd)}${hud.cost.isRunPartial ? '+' : ''}`, isDim: true }] })
  }

  if (hud.load !== null) {
    const hasSpark = isTerminal && columns >= 110
    segments.push(reading('cpu', 'CPU', hud.load.cpu, hud.load.cpuTone, hud.load.cpuSeries, hasSpark, 2))
    segments.push(reading('ram', 'RAM', hud.load.ram, hud.load.ramTone, hud.load.ramSeries, hasSpark, 2))
  }

  if (hud.agents.running > 0) {
    const text = hud.agents.limit === null ? fmt.plural(hud.agents.running, 'agent') : `${hud.agents.running} of ${hud.agents.limit} agents`
    segments.push({ key: 'agents', priority: 3, spans: [{ text, tone: 'info' }] })
  }
  if (hud.guard.isOn && hud.guard.continued > 0) segments.push({ key: 'guard', priority: 3, spans: [{ text: `Kept going ×${hud.guard.continued}`, tone: 'warn' }] })
  return segments
}

/** Keeps the highest-priority segments that fit `width` (gaps included), in display order. */
export function fitSegments(segments: readonly Segment[], width: number, gap = GAP): Segment[] {
  const kept = [...segments]
  const total = (list: readonly Segment[]) => list.reduce((sum, s) => sum + widthOf(s), 0) + Math.max(0, list.length - 1) * gap
  while (kept.length > 1 && total(kept) > width) {
    let worst = 0
    for (let i = 1; i < kept.length; i++) if (kept[i]!.priority >= kept[worst]!.priority) worst = i
    kept.splice(worst, 1)
  }
  return kept
}

function spanEl(kit: Kit, key: string, span: Span): RenderElement {
  const { Text } = kit.ui
  const props = span.tone === undefined ? {} : toneProps(span.tone)
  return (
    <Text key={key} {...props} dimColor={span.isDim === true ? true : undefined} bold={span.isBold === true ? true : undefined}>
      {span.text}
    </Text>
  )
}

export function hudView(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Text, Button } = kit.ui
  const label = kit.columns >= 70 ? 'Control Room' : 'Open'
  const room = Math.max(10, kit.columns - label.length - (isNative(kit) ? 6 : 2))
  const segments = fitSegments(hudSegments(hud, kit.columns, kit.surface), room)
  const line = (
    <Box flexDirection="row" key="hud-line" alignItems="center">
      <Box flexDirection="row" flexGrow={1} flexShrink={1} columnGap={GAP}>
        {segments.map(s => (
          <Text key={`seg-${s.key}`} wrap="truncate-end">
            {s.spans.map((p, i) => spanEl(kit, `seg-${s.key}-${i}`, p))}
          </Text>
        ))}
      </Box>
      <Button key="open" label={label} plain dimColor onPress={kit.actions.togglePane} />
    </Box>
  )
  const alert = hud.alert
  if (alert === null) return line
  const actions =
    alert.kind === 'pending'
      ? [
          { key: 'handoff-now', label: 'Hand off now', onPress: kit.actions.handoff, isPrimary: true },
          { key: 'snooze', label: 'Later', onPress: kit.actions.snooze },
        ]
      : alert.kind === 'awaiting'
        ? [
            { key: 'fresh', label: 'Start fresh', onPress: kit.actions.fresh, isPrimary: true },
            { key: 'snooze', label: 'Later', onPress: kit.actions.snooze },
          ]
        : []
  return (
    <Box flexDirection="column">
      {line}
      <Box flexDirection="row" key="hud-alert" alignItems="center">
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text {...toneProps(alert.tone)}>{`${alert.kind === 'awaiting' ? G.dot : G.warn} `}</Text>
            <Text>{alert.text}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={1} flexShrink={0}>
          {actions.map(a => (
            <Button key={a.key} label={a.label} variant={a.isPrimary === true ? 'primary' : 'secondary'} onPress={a.onPress} />
          ))}
        </Box>
      </Box>
    </Box>
  )
}
