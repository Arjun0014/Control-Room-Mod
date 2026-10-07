/**
 * The persistent HUD: one line above the prompt with the session's vital
 * signs, fitted to the width by priority (the most important segments stay
 * when room runs out), and a second line only when something needs the
 * person (handoff pending, autopilot waiting, critical machine load).
 */

import type { RenderElement } from 'claude-code'

import type { HudModel, Tone } from '../../types'
import * as fmt from '../core/format'
import type { Kit } from './kit'
import { G, meter, toneProps } from './theme'

type Segment = { key: string; text: string; tone: Tone; priority: number; isBold?: boolean }

export function hudSegments(hud: HudModel, columns: number): Segment[] {
  const segments: Segment[] = []
  const ctx = hud.ctx
  const ctxText =
    ctx.tokens === null
      ? 'CTX —'
      : `CTX ${fmt.tokens(ctx.tokens)}${ctx.window === null ? '' : `/${fmt.tokens(ctx.window)}`}${ctx.pct === null ? '' : ` ${ctx.pct}%`}`
  segments.push({ key: 'brand', text: columns >= 110 ? `${G.brand} CONTROL ROOM` : G.brand, tone: 'accent', priority: 0, isBold: true })
  segments.push({ key: 'ctx', text: ctxText, tone: ctx.tone, priority: 0, isBold: ctx.tone === 'bad' })
  if (ctx.tokens !== null && ctx.window !== null && ctx.window > 0) {
    const marker = ctx.threshold === null ? undefined : ctx.threshold / ctx.window
    segments.push({ key: 'meter', text: meter(ctx.tokens / ctx.window, 10, marker), tone: ctx.tone, priority: 6 })
  }
  segments.push({ key: 'cost', text: fmt.cost(hud.cost.usd), tone: hud.cost.usd === null ? 'muted' : 'normal', priority: 1 })
  if (hud.cost.runUsd !== null && hud.cost.usd !== null && hud.cost.runUsd - hud.cost.usd > 0.005) {
    segments.push({ key: 'runcost', text: `run ${fmt.cost(hud.cost.runUsd)}${hud.cost.isRunPartial ? '+' : ''}`, tone: 'muted', priority: 7 })
  }
  const mode = hud.frontier.isOn ? `FRONTIER ${hud.frontier.effort ?? ''}`.trim() : hud.profile.label.toUpperCase()
  segments.push({ key: 'mode', text: mode, tone: hud.frontier.isOn ? 'accent' : 'normal', priority: 1, isBold: hud.frontier.isOn })
  segments.push({ key: 'auto', text: hud.autopilot.label, tone: hud.autopilot.tone, priority: hud.autopilot.isPending ? 0 : 2, isBold: hud.autopilot.isPending })
  segments.push({ key: 'res', text: hud.resources.label, tone: hud.resources.tone, priority: 2 })
  segments.push({ key: 'agents', text: hud.agents.label, tone: hud.agents.tone, priority: 3 })
  if (hud.guard.label !== 'GUARD OFF') segments.push({ key: 'guard', text: hud.guard.label, tone: hud.guard.tone, priority: 4 })
  if (hud.router.label !== 'ROUTER OFF') segments.push({ key: 'router', text: hud.router.label, tone: hud.router.tone, priority: 5 })
  if (hud.focus.isOn) segments.push({ key: 'focus', text: 'FOCUS', tone: 'muted', priority: 8 })
  segments.push({ key: 'run', text: hud.run.label, tone: 'muted', priority: 9 })
  return segments
}

/** Keeps the highest-priority segments that fit `width` (separators included), in display order. */
export function fitSegments(segments: readonly Segment[], width: number, separator = 3): Segment[] {
  const kept = [...segments]
  const widthOf = (list: readonly Segment[]) => list.reduce((sum, s) => sum + s.text.length, 0) + Math.max(0, list.length - 1) * separator
  while (kept.length > 1 && widthOf(kept) > width) {
    let worst = 0
    for (let i = 1; i < kept.length; i++) if (kept[i]!.priority >= kept[worst]!.priority) worst = i
    kept.splice(worst, 1)
  }
  return kept
}

export function hudView(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Text, Button } = kit.ui
  const openLabel = kit.columns >= 90 ? 'Control Room' : 'Open'
  const buttonCells = openLabel.length + 4
  const room = Math.max(10, kit.columns - buttonCells - 1)
  const segments = fitSegments(hudSegments(hud, kit.columns), room)
  const line = (
    <Box flexDirection="row" key="hud-line">
      <Box flexDirection="row" flexGrow={1} flexShrink={1}>
        {segments.map((s, i) => (
          <Text key={`seg-${s.key}`} wrap="truncate-end">
            {i === 0 ? '' : <Text dimColor>{` ${G.sep} `}</Text>}
            <Text {...toneProps(s.tone)} bold={s.isBold === true || toneProps(s.tone).bold === true}>
              {s.text}
            </Text>
          </Text>
        ))}
      </Box>
      <Button key="open" label={openLabel} onPress={kit.actions.openPane} />
    </Box>
  )
  if (hud.alert === null) return line
  const alert = hud.alert
  const isPending = hud.autopilot.state === 'pending'
  const isAwaiting = hud.autopilot.state === 'awaiting'
  return (
    <Box flexDirection="column">
      {line}
      <Box flexDirection="row" key="hud-alert">
        <Box flexGrow={1} flexShrink={1}>
          <Text {...toneProps(alert.tone)} wrap="truncate-end">
            {`${G.warn} ${alert.text}`}
          </Text>
        </Box>
        {isPending ? <Button key="handoff-now" label="Handoff now" onPress={kit.actions.handoff} /> : null}
        {isPending || isAwaiting ? <Button key="snooze" label="Snooze" onPress={kit.actions.snooze} /> : null}
        {isAwaiting ? <Button key="fresh" label="Start fresh context" variant="primary" onPress={kit.actions.fresh} /> : null}
      </Box>
    </Box>
  )
}
