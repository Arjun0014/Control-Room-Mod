/**
 * The status bar: the run at a glance, one line above the prompt.
 *
 *   ◆   Context ━━━━━━━┃── 62%   Work ■■■■□□□ 4/7   ▸ Running regression tests       Run $115.93   Control Room
 *
 * Two meters that cannot be confused. Context is a continuous line with the
 * handoff tick: how much of the reasoning window is used, which starts over
 * after a handoff. Work is one square per milestone with "done/total": how
 * much of the run's objective is finished, which carries across handoffs.
 * Then what Claude is doing right now, which takes the room that is left,
 * and the whole run's cost. States appear only while they matter: a handoff,
 * a failing check, calls that need a look, a busy machine, agents, the guard.
 *
 * Wide: labelled meters. Medium: the meters alone. Narrow: shorter meters,
 * then the least important items drop. Desktop draws both meters as SVG.
 * A second line appears only when something needs the person.
 */

import type { RenderElement } from 'claude-code'

import type { HudModel, Tone } from '../../types'
import * as fmt from '../core/format'
import type { Kit } from './kit'
import { clip, isNative } from './primitives'
import { G, meterCells, svgBar, svgSegments, toneProps, workCells } from './theme'

type Span = { text: string; tone?: Tone; isDim?: boolean; isBold?: boolean }

/** A meter drawn as SVG on the remote surfaces, in place of its glyphs: `cells` wide. */
type Graphic = { source: string; cells: number; alt: string }

export type Segment = {
  key: string
  priority: number
  side: 'left' | 'right'
  /** Text before the graphic (or the whole segment). */
  spans: Span[]
  graphic?: Graphic
  /** Text after the graphic. */
  after?: Span[]
}

const GAP = 3

/** The pixels a cell of a status-bar meter takes as SVG. */
const CELL_PX = 8

const spanWidth = (spans: readonly Span[] | undefined): number => (spans ?? []).reduce((n, p) => n + p.text.length, 0)

export const widthOf = (s: Segment): number => spanWidth(s.spans) + (s.graphic?.cells ?? 0) + spanWidth(s.after)

/** How much the bar shows at a width: labels, and the cells of each meter. */
export type Tier = { labels: boolean; meter: number; squares: number }

export function tierOf(columns: number, surface: Kit['surface'] = 'terminal'): Tier {
  const wide = surface === 'terminal' ? 120 : 100
  if (columns >= wide) return { labels: true, meter: 10, squares: 10 }
  if (columns >= 90) return { labels: false, meter: 8, squares: 8 }
  if (columns >= 64) return { labels: false, meter: 6, squares: 6 }
  return { labels: false, meter: 4, squares: 4 }
}

function meterSpans(fraction: number, marker: number | null, tone: Tone, width: number): Span[] {
  const c = meterCells(fraction, width, marker)
  const out: Span[] = []
  for (let i = 0; i < c.width; i++) {
    const span: Span = i === c.marker ? { text: G.marker, tone: 'accent' } : i < c.filled ? { text: G.lineFull, tone } : { text: G.lineEmpty, isDim: true }
    const last = out[out.length - 1]
    if (last !== undefined && last.tone === span.tone && last.isDim === span.isDim && last.isBold === span.isBold) last.text += span.text
    else out.push(span)
  }
  return out
}

function squareSpans(done: number, total: number, max: number, hasCurrent: boolean): Span[] {
  const c = workCells(done, total, max, hasCurrent)
  const out: Span[] = []
  for (let i = 0; i < c.width; i++) {
    const span: Span = i < c.done ? { text: G.square, tone: 'info' } : i === c.current ? { text: G.square, isBold: true } : { text: G.squareOpen, isDim: true }
    const last = out[out.length - 1]
    if (last !== undefined && last.tone === span.tone && last.isDim === span.isDim && last.isBold === span.isBold) last.text += span.text
    else out.push(span)
  }
  return out
}

const valueTone = (tone: Tone): Tone | undefined => (tone === 'good' || tone === 'normal' || tone === 'muted' ? undefined : tone)

const isHigh = (tone: Tone): boolean => tone === 'warn' || tone === 'bad'

const EVENT_STATES = new Set(['pending', 'requested', 'handoff', 'verifying', 'clearing', 'compacting', 'resuming', 'awaiting'])

export function hudSegments(hud: HudModel, columns: number, surface: Kit['surface'] = 'terminal'): Segment[] {
  const tier = tierOf(columns, surface)
  const isSvg = surface !== 'terminal'
  const segments: Segment[] = [{ key: 'brand', priority: 0, side: 'left', spans: [{ text: G.brand, tone: 'accent', isBold: true }] }]

  // Context: a line with the handoff tick.
  const ctx = hud.ctx
  const ctxLabel: Span[] = tier.labels ? [{ text: 'Context ', isDim: true }] : []
  if (ctx.pct === null || ctx.tokens === null || ctx.window === null || ctx.window <= 0) {
    segments.push({ key: 'ctx', priority: 0, side: 'left', spans: [{ text: 'Context ', isDim: true }, { text: ctx.pct === null ? G.none : `${ctx.pct}%`, isDim: ctx.pct === null }] })
  } else {
    const fraction = ctx.tokens / ctx.window
    const marker = ctx.threshold === null ? null : ctx.threshold / ctx.window
    const tone: Tone = ctx.tone === 'muted' ? 'good' : ctx.tone
    const pct: Span = { text: ` ${ctx.pct}%`, tone: valueTone(ctx.tone), isBold: ctx.tone === 'bad' }
    segments.push(
      isSvg
        ? {
            key: 'ctx',
            priority: 0,
            side: 'left',
            spans: ctxLabel,
            graphic: { source: svgBar({ fraction, marker, tone, width: tier.meter * CELL_PX, height: 10 }), cells: tier.meter, alt: `Context ${ctx.pct}% used` },
            after: [pct],
          }
        : { key: 'ctx', priority: 0, side: 'left', spans: [...ctxLabel, ...meterSpans(fraction, marker, tone, tier.meter), pct] },
    )
  }

  // Work: one square per milestone, as Claude's own task list counts them.
  const work = hud.work
  if (work !== null && work.total > 0) {
    const label: Span[] = tier.labels ? [{ text: 'Work ', isDim: true }] : []
    const isDone = work.done === work.total
    const count: Span = { text: ` ${work.done}/${work.total}`, tone: isDone ? 'good' : undefined }
    const hasCurrent = work.current !== null
    segments.push(
      isSvg
        ? {
            key: 'work',
            priority: 1,
            side: 'left',
            spans: label,
            graphic: {
              source: svgSegments({ done: work.done, total: work.total, hasCurrent, max: tier.squares, width: Math.min(work.total, tier.squares) * CELL_PX + 8, height: 10 }),
              cells: Math.min(work.total, tier.squares) + 1,
              alt: `Work: ${work.done} of ${work.total} milestones done`,
            },
            after: [count],
          }
        : { key: 'work', priority: 1, side: 'left', spans: [...label, ...squareSpans(work.done, work.total, tier.squares, hasCurrent), count] },
    )
  }

  if (hud.autopilot.isOn && EVENT_STATES.has(hud.autopilot.state)) {
    segments.push({ key: 'event', priority: 0, side: 'left', spans: [{ text: hud.autopilot.text, tone: hud.autopilot.tone === 'normal' ? 'accent' : hud.autopilot.tone, isBold: true }] })
  }

  // Right: states while they matter, then the run's cost.
  if (hud.failing.length > 0) {
    const names = hud.failing.join(', ')
    segments.push({ key: 'failing', priority: 1, side: 'right', spans: [{ text: `${G.fail} ${tier.labels ? `${names} failing` : names}`, tone: 'bad' }] })
  }
  if (hud.attention > 0) segments.push({ key: 'attention', priority: 2, side: 'right', spans: [{ text: `${G.warn} ${fmt.plural(hud.attention, 'issue')}`, tone: 'warn' }] })
  if (hud.load !== null && isHigh(hud.load.cpuTone)) {
    segments.push({ key: 'cpu', priority: 3, side: 'right', spans: [{ text: 'CPU ', isDim: true }, { text: `${Math.round(hud.load.cpu ?? 0)}%`, tone: hud.load.cpuTone, isBold: hud.load.cpuTone === 'bad' }] })
  }
  if (hud.load !== null && isHigh(hud.load.ramTone)) {
    segments.push({ key: 'ram', priority: 3, side: 'right', spans: [{ text: 'RAM ', isDim: true }, { text: `${Math.round(hud.load.ram ?? 0)}%`, tone: hud.load.ramTone, isBold: hud.load.ramTone === 'bad' }] })
  }
  if (hud.agents.running > 0) {
    const text = hud.agents.limit === null ? fmt.plural(hud.agents.running, 'agent') : `${hud.agents.running} of ${hud.agents.limit} agents`
    segments.push({ key: 'agents', priority: 3, side: 'right', spans: [{ text, tone: 'info' }] })
  }
  if (hud.guard.isOn && hud.guard.continued > 0) segments.push({ key: 'guard', priority: 4, side: 'right', spans: [{ text: `Kept going ×${hud.guard.continued}`, tone: 'warn' }] })

  const run = hud.cost.runUsd ?? hud.cost.usd
  segments.push({
    key: 'cost',
    priority: 2,
    side: 'right',
    spans: [{ text: 'Run ', isDim: true }, { text: `${fmt.cost(run)}${run !== null && hud.cost.isRunPartial ? '+' : ''}`, isDim: run === null }],
  })
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

/** The least room the work line needs to be worth drawing. */
const NOW_MIN = 14

function spanEl(kit: Kit, key: string, span: Span): RenderElement {
  const { Text } = kit.ui
  const props = span.tone === undefined ? {} : toneProps(span.tone)
  return (
    <Text key={key} {...props} dimColor={span.isDim === true ? true : undefined} bold={span.isBold === true ? true : undefined}>
      {span.text}
    </Text>
  )
}

function segmentEl(kit: Kit, s: Segment): RenderElement {
  const { Box, Text, Svg } = kit.ui
  const text = (spans: readonly Span[] | undefined, part: string) =>
    spans === undefined || spans.length === 0 ? null : <Text key={`seg-${s.key}-${part}`}>{spans.map((p, i) => spanEl(kit, `seg-${s.key}-${part}-${i}`, p))}</Text>
  if (s.graphic === undefined || Svg === undefined) {
    return (
      <Text key={`seg-${s.key}`} wrap="truncate-end">
        {s.spans.map((p, i) => spanEl(kit, `seg-${s.key}-${i}`, p))}
      </Text>
    )
  }
  return (
    <Box key={`seg-${s.key}`} flexDirection="row" alignItems="center" flexShrink={0}>
      {text(s.spans, 'before')}
      <Svg key={`seg-${s.key}-svg`} source={s.graphic.source} alt={s.graphic.alt} height={10} />
      {text(s.after, 'after')}
    </Box>
  )
}

export function hudView(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Text, Button } = kit.ui
  // The button opens and closes the panel: its name when there is room, else what a press does.
  const label = kit.columns >= 70 ? 'Control Room' : hud.isPaneOpen ? 'Close' : 'Open'
  const room = Math.max(10, kit.columns - label.length - GAP - (isNative(kit) ? 4 : 0))
  const all = hudSegments(hud, kit.columns, kit.surface)
  const now = hud.now
  // The work line takes what the meters leave; it yields first when room is short.
  let kept = fitSegments(all, room - (now === null ? 0 : NOW_MIN + GAP))
  const used = kept.reduce((n, s) => n + widthOf(s), 0) + Math.max(0, kept.length - 1) * GAP
  const isNowShown = now !== null && room - used - GAP >= NOW_MIN
  if (now !== null && !isNowShown) kept = fitSegments(all, room)
  const left = kept.filter(s => s.side === 'left')
  const right = kept.filter(s => s.side === 'right')
  const line = (
    <Box flexDirection="row" key="hud-line" alignItems="center">
      <Box flexDirection="row" columnGap={GAP} flexShrink={0} alignItems="center">
        {left.map(s => segmentEl(kit, s))}
      </Box>
      <Box key="hud-now" flexGrow={1} flexShrink={1} marginLeft={GAP} {...clip(kit)}>
        {isNowShown && now !== null ? (
          <Text wrap="truncate-end">
            <Text color="suggestion">{`${G.arrow} `}</Text>
            <Text dimColor={now.source === 'thinking' ? true : undefined}>{now.text}</Text>
          </Text>
        ) : null}
      </Box>
      <Box flexDirection="row" columnGap={GAP} flexShrink={0} marginLeft={right.length > 0 ? GAP : 0} alignItems="center">
        {right.map(s => segmentEl(kit, s))}
      </Box>
      <Box marginLeft={GAP} flexShrink={0}>
        <Button key="open" label={label} plain dimColor onPress={kit.actions.togglePane} />
      </Box>
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
      <Box flexDirection="row" key="hud-alert" alignItems="center" columnGap={2}>
        <Box flexGrow={1} flexShrink={1} {...clip(kit)}>
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
