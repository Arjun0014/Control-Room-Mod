/**
 * The HUD: one calm line above the prompt.
 *
 *   ◆  Context ━━━━━─────── 31%   $4.18   Frontier Max   Hands off at 70%      Control Room
 *
 * Only what is on or needs a look is shown: an off system takes no room.
 * Labels are dim, values plain, color only where state asks for attention.
 * Segments drop by priority as the width shrinks. A second line appears
 * only when something needs the person (a handoff about to happen, a
 * handoff waiting for them, the machine under heavy load).
 */

import type { RenderElement } from 'claude-code'

import type { HudModel, Tone } from '../../types'
import * as fmt from '../core/format'
import type { Kit } from './kit'
import { isNative } from './primitives'
import { G, meterCells, toneProps } from './theme'

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

export function hudSegments(hud: HudModel, columns: number, surface: Kit['surface'] = 'terminal'): Segment[] {
  const segments: Segment[] = [{ key: 'brand', priority: 0, spans: [{ text: G.brand, tone: 'accent', isBold: true }] }]
  const ctx = hud.ctx
  const ctxTone: Tone = ctx.tone === 'good' || ctx.tone === 'muted' ? 'normal' : ctx.tone
  if (ctx.pct === null) {
    segments.push({ key: 'ctx', priority: 0, spans: [{ text: 'Context ', isDim: true }, { text: G.none, isDim: true }] })
  } else {
    const hasMeter = surface === 'terminal' && columns >= 76 && ctx.tokens !== null && ctx.window !== null && ctx.window > 0
    const meter = hasMeter ? [...meterSpans(ctx.tokens! / ctx.window!, ctx.threshold === null ? null : ctx.threshold / ctx.window!, ctx.tone === 'muted' ? 'good' : ctx.tone, 10), { text: ' ' }] : []
    segments.push({ key: 'ctx', priority: 0, spans: [{ text: 'Context ', isDim: true }, ...meter, { text: `${ctx.pct}%`, tone: ctxTone, isBold: ctx.tone === 'bad' }] })
  }
  segments.push({ key: 'cost', priority: 1, spans: [{ text: fmt.cost(hud.cost.usd), isDim: hud.cost.usd === null }] })
  if (hud.cost.runUsd !== null && hud.cost.usd !== null && hud.cost.runUsd - hud.cost.usd > 0.005) {
    segments.push({ key: 'runcost', priority: 7, spans: [{ text: `run ${fmt.cost(hud.cost.runUsd)}${hud.cost.isRunPartial ? '+' : ''}`, isDim: true }] })
  }
  if (hud.frontier.isOn) segments.push({ key: 'mode', priority: 1, spans: [{ text: 'Frontier Max', tone: 'accent' }] })
  else if (hud.profile.id !== 'normal') segments.push({ key: 'mode', priority: 1, spans: [{ text: hud.profile.name, tone: 'accent' }] })
  if (hud.autopilot.isOn) {
    const isQuiet = hud.autopilot.tone === 'normal'
    segments.push({
      key: 'auto',
      priority: hud.autopilot.state === 'pending' || hud.autopilot.state === 'awaiting' ? 0 : 2,
      spans: [{ text: hud.autopilot.text, isDim: isQuiet, tone: isQuiet ? undefined : hud.autopilot.tone, isBold: hud.autopilot.tone === 'bad' }],
    })
  }
  if (hud.resources.text !== null) segments.push({ key: 'load', priority: 2, spans: [{ text: hud.resources.text, tone: hud.resources.tone }] })
  if (hud.agents.running > 0) {
    const text = hud.agents.limit === null ? fmt.plural(hud.agents.running, 'agent') : `${hud.agents.running} of ${hud.agents.limit} agents`
    segments.push({ key: 'agents', priority: 3, spans: [{ text, tone: 'info' }] })
  }
  if (hud.guard.isOn && hud.guard.continued > 0) segments.push({ key: 'guard', priority: 4, spans: [{ text: `Kept going ×${hud.guard.continued}`, tone: 'warn' }] })
  if (hud.session.index > 1) segments.push({ key: 'session', priority: 6, spans: [{ text: `Session ${hud.session.index}`, isDim: true }] })
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
