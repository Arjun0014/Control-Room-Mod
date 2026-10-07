/**
 * The status bar: the run at a glance, in two layers above the prompt.
 *
 *   ▸ Downloading the kernel outputs · 4m 51s                     Fetch E-008 outputs · 2 of 5
 *   ◆   Context ━━━━━┃── 62%   Work ■■□□□ 2/5   Checks ✓ Tests ✗ Lint   Run $115.93   Control Room
 *
 * The top line is what is happening: while a turn runs, what Claude is doing
 * (in its own words when the milestone under way has them), how long a slow
 * call has run, and the milestone it serves; once the turn ends, what it did,
 * in counted words. It appears with the first turn of a context, and a
 * handoff that needs the person takes its place, with its actions.
 *
 * The bottom line holds the readings, each a name and a graphic. Context is
 * a continuous line with the handoff tick (how much of the window is used;
 * it starts over after a handoff). Work is one square per milestone with
 * "done/total" (how much of the objective is finished; it carries across
 * handoffs). Checks are their latest outcomes. Then states only while they
 * matter (a handoff under way, calls that need a look, a busy machine,
 * agents, the guard), the Quest log's level, and the whole run's cost.
 *
 * Width decides the detail: names and long meters when wide, shorter meters
 * and fewer items when narrow. Desktop draws the meters as SVG.
 */

import type { RenderElement } from 'claude-code'

import type { HudActivity, HudModel, Tone } from '../../types'
import * as fmt from '../core/format'
import type { Kit } from './kit'
import { clip, isNative } from './primitives'
import { CHECK_DOT, G, meterCells, svgBar, svgRing, svgSegments, toneProps, workCells } from './theme'

type Span = { text: string; tone?: Tone; isDim?: boolean; isBold?: boolean }

/** A meter drawn as SVG on the remote surfaces, in place of its glyphs: `cells` wide. */
type Graphic = { source: string; cells: number; alt: string; height: number }

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

/** How much the readings line shows: names, check names, and the cells of each meter. */
export type Tier = { labels: boolean; names: boolean; meter: number; squares: number }

const TIERS: readonly Tier[] = [
  { labels: true, names: true, meter: 10, squares: 10 },
  { labels: false, names: true, meter: 8, squares: 8 },
  { labels: false, names: true, meter: 6, squares: 6 },
  { labels: false, names: false, meter: 6, squares: 6 },
  { labels: false, names: false, meter: 4, squares: 4 },
]

/**
 * The tiers the readings line may take at a width, richest first: it takes
 * the first whose segments all fit. Names need a wide bar (100 columns in
 * the terminal, 70 on Desktop), so they do not come and go as states do.
 */
export function tiersOf(columns: number, surface: Kit['surface'] = 'terminal'): readonly Tier[] {
  return columns >= (surface === 'terminal' ? 100 : 70) ? TIERS : TIERS.slice(1)
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

const CHECK_GLYPH: Record<string, string> = { passed: G.ok, failed: G.fail, running: G.run, blocked: G.stop, background: G.ring, stopped: G.stop }

/** The readings line's segments at a tier, in display order, each with its priority for when room runs short. */
export function hudSegments(hud: HudModel, tier: Tier, surface: Kit['surface'] = 'terminal'): Segment[] {
  const isSvg = surface !== 'terminal'
  const label = (text: string): Span[] => (tier.labels ? [{ text: `${text} `, isDim: true }] : [])
  const segments: Segment[] = [{ key: 'brand', priority: 0, side: 'left', spans: [{ text: G.brand, tone: 'accent', isBold: true }] }]

  // Context: a line with the handoff tick.
  const ctx = hud.ctx
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
            spans: label('Context'),
            graphic: { source: svgBar({ fraction, marker, tone, width: tier.meter * CELL_PX, height: 10 }), cells: tier.meter, alt: `Context ${ctx.pct}% used`, height: 10 },
            after: [pct],
          }
        : { key: 'ctx', priority: 0, side: 'left', spans: [...label('Context'), ...meterSpans(fraction, marker, tone, tier.meter), pct] },
    )
  }

  // Work: one square per milestone, as Claude's own task list counts them.
  const work = hud.work
  if (work !== null && work.total > 0) {
    const isDone = work.done === work.total
    const count: Span = { text: ` ${work.done}/${work.total}`, tone: isDone ? 'good' : undefined }
    const hasCurrent = work.current !== null
    segments.push(
      isSvg
        ? {
            key: 'work',
            priority: 1,
            side: 'left',
            spans: label('Work'),
            graphic: {
              source: svgSegments({ done: work.done, total: work.total, hasCurrent, max: tier.squares, width: Math.min(work.total, tier.squares) * CELL_PX + 8, height: 10 }),
              cells: Math.min(work.total, tier.squares) + 1,
              alt: `Work: ${work.done} of ${work.total} milestones done`,
              height: 10,
            },
            after: [count],
          }
        : { key: 'work', priority: 1, side: 'left', spans: [...label('Work'), ...squareSpans(work.done, work.total, tier.squares, hasCurrent), count] },
    )
  }

  // Checks: each kind's latest outcome, named when there is room.
  if (hud.checks.length > 0) {
    const spans: Span[] = [...label('Checks')]
    hud.checks.forEach((c, i) => {
      const tone = CHECK_DOT[c.status] ?? 'muted'
      spans.push({ text: `${i > 0 && tier.names ? ' ' : ''}${CHECK_GLYPH[c.status] ?? G.ring}`, tone })
      if (tier.names) spans.push({ text: ` ${c.label}`, tone: c.status === 'failed' ? 'bad' : undefined, isDim: c.status !== 'failed' ? true : undefined })
    })
    segments.push({ key: 'checks', priority: hud.checks.some(c => c.status === 'failed') ? 1 : 2, side: 'left', spans })
  }

  if (hud.autopilot.isOn && EVENT_STATES.has(hud.autopilot.state)) {
    segments.push({ key: 'event', priority: 0, side: 'left', spans: [{ text: hud.autopilot.text, tone: hud.autopilot.tone === 'normal' ? 'accent' : hud.autopilot.tone, isBold: true }] })
  }

  // Right: states while they matter, the level, then the run's cost.
  if (hud.attention > 0) segments.push({ key: 'attention', priority: 2, side: 'right', spans: [{ text: `${G.warn} ${fmt.plural(hud.attention, 'issue')}`, tone: 'warn' }] })
  for (const which of ['cpu', 'ram'] as const) {
    const load = hud.load
    if (load === null) continue
    const value = which === 'cpu' ? load.cpu : load.ram
    const tone = which === 'cpu' ? load.cpuTone : load.ramTone
    if (!isHigh(tone)) continue
    const name = which === 'cpu' ? 'CPU' : 'RAM'
    const reading: Span = { text: `${isSvg ? ' ' : ''}${Math.round(value ?? 0)}%`, tone, isBold: tone === 'bad' }
    segments.push(
      isSvg
        ? { key: which, priority: 3, side: 'right', spans: [{ text: `${name} `, isDim: true }], graphic: { source: svgBar({ fraction: (value ?? 0) / 100, tone, width: 4 * CELL_PX, height: 10 }), cells: 4, alt: `${name} ${Math.round(value ?? 0)}%`, height: 10 }, after: [reading] }
        : { key: which, priority: 3, side: 'right', spans: [{ text: `${name} `, isDim: true }, reading] },
    )
  }
  if (hud.agents.running > 0) {
    const text = hud.agents.limit === null ? fmt.plural(hud.agents.running, 'agent') : `${hud.agents.running} of ${hud.agents.limit} agents`
    segments.push({ key: 'agents', priority: 3, side: 'right', spans: [{ text, tone: 'info' }] })
  }
  if (hud.guard.isOn && hud.guard.continued > 0) segments.push({ key: 'guard', priority: 4, side: 'right', spans: [{ text: `Kept going ×${hud.guard.continued}`, tone: 'warn' }] })

  const quest = hud.quest
  if (quest !== null) {
    const level: Span = { text: `Lv ${quest.level}`, isBold: true }
    const xp: Span = { text: ` ${quest.xp} XP`, isDim: true }
    segments.push(
      isSvg
        ? { key: 'quest', priority: 3, side: 'right', spans: [], graphic: { source: svgRing({ fraction: quest.levelSpan > 0 ? quest.intoLevel / quest.levelSpan : 0, size: 14 }), cells: 2, alt: `Level ${quest.level}`, height: 14 }, after: [level, xp] }
        : { key: 'quest', priority: 3, side: 'right', spans: [{ text: `${G.star} `, tone: 'accent' }, level, ...(tier.labels ? [xp] : [])] },
    )
  }

  const run = hud.cost.runUsd ?? hud.cost.usd
  segments.push({
    key: 'cost',
    priority: 2,
    side: 'right',
    // A dollar figure says what it is by itself; an unknown one ("—") keeps its name.
    spans: [...(run === null ? [{ text: 'Run ', isDim: true }] : label('Run')), { text: `${fmt.cost(run)}${run !== null && hud.cost.isRunPartial ? '+' : ''}`, isDim: run === null }],
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
    <Box key={`seg-${s.key}`} flexDirection="row" alignItems="center" flexShrink={0} columnGap={s.spans.length === 0 ? 1 : 0}>
      {text(s.spans, 'before')}
      <Svg key={`seg-${s.key}-svg`} source={s.graphic.source} alt={s.graphic.alt} height={s.graphic.height} />
      {text(s.after, 'after')}
    </Box>
  )
}

/**
 * "Fetch E-008 outputs · 2 of 5", or just "2 of 5" when the room is short.
 * When the line already names the milestone, in its "doing" words, only
 * where it sits: "Milestone 2 of 5".
 */
function milestoneText(m: NonNullable<HudActivity['milestone']>, isNamed: boolean, room: number): string | null {
  const position = `${m.index} of ${m.total}`
  if (isNamed) return `Milestone ${position}`.length <= room ? `Milestone ${position}` : position.length <= room ? position : null
  const subject = m.subject.length > 40 ? `${m.subject.slice(0, 39)}…` : m.subject
  const full = `${subject} · ${position}`
  if (full.length <= room) return full
  return position.length <= room ? position : null
}

/**
 * The top line: what Claude is doing now, or what the last turn did. The
 * text is one plain string, so it cuts with an ellipsis on every surface.
 */
function activityLine(kit: Kit, a: HudActivity): RenderElement {
  const { Box, Text } = kit.ui
  const isWorking = a.state === 'working'
  const glyphTone: Tone = isWorking ? (a.source === 'thinking' ? 'muted' : 'info') : 'good'
  const left = isWorking && a.runningMs !== null ? `${a.text} · ${fmt.duration(a.runningMs)}` : a.text
  const room = Math.max(0, kit.columns - left.length - 2 - GAP - 8)
  const right = isWorking
    ? a.milestone === null
      ? null
      : milestoneText(a.milestone, a.source === 'plan', Math.max(room, 12))
    : a.durationMs === null
      ? null
      : fmt.duration(a.durationMs)
  return (
    <Box flexDirection="row" key="hud-activity" alignItems="center" columnGap={GAP}>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} {...clip(kit)}>
        <Box width={2} flexShrink={0}>
          <Text {...toneProps(glyphTone)}>{isWorking ? G.run : G.ok}</Text>
        </Box>
        <Box flexShrink={1} {...clip(kit)}>
          <Text wrap="truncate-end" dimColor={isWorking && a.source !== 'thinking' ? undefined : true}>
            {left}
          </Text>
        </Box>
      </Box>
      {right === null ? null : (
        <Box flexShrink={0}>
          <Text dimColor>{right}</Text>
        </Box>
      )}
    </Box>
  )
}

/** A handoff that needs the person, in the top line's place, with its actions. */
function alertLine(kit: Kit, alert: NonNullable<HudModel['alert']>): RenderElement {
  const { Box, Text, Button } = kit.ui
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
    <Box flexDirection="row" key="hud-alert" alignItems="center" columnGap={2}>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} {...clip(kit)}>
        <Box width={2} flexShrink={0}>
          <Text {...toneProps(alert.tone)}>{alert.kind === 'awaiting' ? G.dot : G.warn}</Text>
        </Box>
        <Box flexShrink={1} {...clip(kit)}>
          <Text wrap="truncate-end">{alert.text}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" columnGap={1} flexShrink={0}>
        {actions.map(a => (
          <Button key={a.key} label={a.label} variant={a.isPrimary === true ? 'primary' : 'secondary'} onPress={a.onPress} />
        ))}
      </Box>
    </Box>
  )
}

/** The readings line: each a name and a graphic, then the run's cost and the panel's button. */
function readingsLine(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Button } = kit.ui
  // The button opens and closes the panel: its name when there is room, else what a press does.
  const label = kit.columns >= 70 ? 'Control Room' : hud.isPaneOpen ? 'Close' : 'Open'
  const room = Math.max(10, kit.columns - label.length - GAP - (isNative(kit) ? 4 : 0))
  // The richest tier that shows every reading; failing that, the leanest one, least important readings dropped.
  let kept: Segment[] = []
  for (const tier of tiersOf(kit.columns, kit.surface)) {
    const all = hudSegments(hud, tier, kit.surface)
    kept = fitSegments(all, room)
    if (kept.length === all.length) break
  }
  const left = kept.filter(s => s.side === 'left')
  const right = kept.filter(s => s.side === 'right')
  return (
    <Box flexDirection="row" key="hud-line" alignItems="center">
      <Box flexDirection="row" columnGap={GAP} flexShrink={0} alignItems="center">
        {left.map(s => segmentEl(kit, s))}
      </Box>
      <Box key="hud-gap" flexGrow={1} flexShrink={1} />
      <Box flexDirection="row" columnGap={GAP} flexShrink={0} marginLeft={right.length > 0 ? GAP : 0} alignItems="center">
        {right.map(s => segmentEl(kit, s))}
      </Box>
      <Box marginLeft={GAP} flexShrink={0}>
        <Button key="open" label={label} plain dimColor onPress={kit.actions.togglePane} />
      </Box>
    </Box>
  )
}

export function hudView(kit: Kit, hud: HudModel): RenderElement {
  const { Box } = kit.ui
  const readings = readingsLine(kit, hud)
  const top = hud.alert !== null ? alertLine(kit, hud.alert) : hud.activity !== null ? activityLine(kit, hud.activity) : null
  if (top === null) return readings
  return (
    <Box flexDirection="column" rowGap={isNative(kit) && hud.alert !== null ? 1 : 0}>
      {top}
      {readings}
    </Box>
  )
}
