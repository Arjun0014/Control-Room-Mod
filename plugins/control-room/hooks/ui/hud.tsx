/**
 * The status bar: the run at a glance, in two lines above the prompt.
 *
 *   ▸ Downloading the kernel outputs · 4m 51s · Milestone 2 of 5          Run $115.93   [ ◆ Control Room ]
 *     Context ━━━━━┃── 62%   Work ●─◉─○─○─○ 1/5   Cache ◕ 52m   ✓ Tests ✗ Lint                ▲ 2 issues
 *
 * The top line is what is happening: while a turn runs, what Claude is doing
 * (in its own words when the milestone under way has them), how long a slow
 * call has run, and where the milestone sits in the plan; once the turn
 * ends, what it did, in counted words. On its right, the whole run's cost
 * and the Control Room button, bright while the panel is open.
 *
 * The second line holds the three lifecycles, each a name and a graphic of
 * its own shape, so they cannot be confused. Context is a continuous line
 * with the handoff tick (how much of the window is used; it starts over
 * after a handoff). Work is a track of milestones, one stop each (how much of
 * the objective is finished; it carries across handoffs). Cache is a clock
 * face emptying as the prompt cache's lifetime runs out (it starts over with
 * every request and is lost at a fresh context). Then the checks' latest
 * outcomes, and on the right states only while they matter: calls that need
 * a look, a busy machine, agents, the guard, the Quest log's level.
 *
 * A handoff that needs the person takes a line of its own above, with its
 * actions. Width decides the detail: names and long graphics when wide,
 * shorter ones and fewer items when narrow. Desktop draws the graphics as SVG.
 */

import type { RenderElement } from 'claude-code'

import type { HudActivity, HudModel, Tone } from '../../types'
import * as fmt from '../core/format'
import { type CompanionAnimation, svgCompanion } from '../features/companion'
import type { Kit } from './kit'
import { clip, isNative } from './primitives'
import { CHECK_DOT, G, type Stop, clockGlyph, meterCells, svgBar, svgClock, svgRing, svgTrack, toneProps, trackStops } from './theme'

type Span = { text: string; tone?: Tone; isDim?: boolean; isBold?: boolean }

/** A graphic drawn as SVG on the remote surfaces, in place of its glyphs: `cells` wide. */
type Graphic = { source: string; cells: number; alt: string; height: number; isInteractive?: boolean }

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

/** The second line sits under the first line's text, past its glyph. */
const INDENT = 2

/** The pixels a cell of a status-bar graphic takes as SVG. */
const CELL_PX = 8

const spanWidth = (spans: readonly Span[] | undefined): number => (spans ?? []).reduce((n, p) => n + p.text.length, 0)

export const widthOf = (s: Segment): number => spanWidth(s.spans) + (s.graphic?.cells ?? 0) + spanWidth(s.after)

/** How much the lifecycles line shows: names, check names, the meter's cells and the track's stops. */
export type Tier = { labels: boolean; names: boolean; meter: number; stops: number }

const TIERS: readonly Tier[] = [
  { labels: true, names: true, meter: 10, stops: 8 },
  { labels: false, names: true, meter: 8, stops: 7 },
  { labels: false, names: true, meter: 6, stops: 6 },
  { labels: false, names: false, meter: 6, stops: 5 },
  { labels: false, names: false, meter: 4, stops: 4 },
]

/** From this wide (terminal columns; Desktop's are wider) the readings carry their names. */
const NAMED_FROM: Record<'terminal' | 'other', number> = { terminal: 100, other: 70 }

const namedFrom = (surface: Kit['surface']): number => (surface === 'terminal' ? NAMED_FROM.terminal : NAMED_FROM.other)

/**
 * The tiers the lifecycles line may take at a width, richest first: it takes
 * the first whose segments all fit. Names need a wide bar (100 columns in
 * the terminal, 70 on Desktop), so they do not come and go as states do.
 */
export function tiersOf(columns: number, surface: Kit['surface'] = 'terminal'): readonly Tier[] {
  return columns >= namedFrom(surface) ? TIERS : TIERS.slice(1)
}

/** Adjacent spans of one style become one, so a graphic is a few Texts, not one per cell. */
function merged(spans: readonly Span[]): Span[] {
  const out: Span[] = []
  for (const span of spans) {
    const last = out[out.length - 1]
    if (last !== undefined && last.tone === span.tone && last.isDim === span.isDim && last.isBold === span.isBold) last.text += span.text
    else out.push({ ...span })
  }
  return out
}

function meterSpans(fraction: number, marker: number | null, tone: Tone, width: number): Span[] {
  const c = meterCells(fraction, width, marker)
  return merged(
    Array.from({ length: c.width }, (_, i): Span => (i === c.marker ? { text: G.marker, tone: 'accent' } : i < c.filled ? { text: G.lineFull, tone } : { text: G.lineEmpty, isDim: true })),
  )
}

/** The track of milestones: ●─●─◉─○, done in blue, the one under way bright, the rest dim. */
export function trackSpans(stops: readonly Stop[]): Span[] {
  const out: Span[] = []
  stops.forEach((s, i) => {
    if (i > 0) out.push({ text: G.stepJoin, isDim: true })
    out.push(s === 'done' ? { text: G.stepDone, tone: 'info' } : s === 'now' ? { text: G.stepNow, isBold: true } : { text: G.stepOpen, isDim: true })
  })
  return merged(out)
}

const valueTone = (tone: Tone): Tone | undefined => (tone === 'good' || tone === 'normal' || tone === 'muted' ? undefined : tone)

const isHigh = (tone: Tone): boolean => tone === 'warn' || tone === 'bad'

const EVENT_STATES = new Set(['pending', 'requested', 'handoff', 'verifying', 'clearing', 'compacting', 'resuming', 'awaiting'])

const CHECK_GLYPH: Record<string, string> = { passed: G.ok, failed: G.fail, running: G.run, blocked: G.stop, background: G.ring, stopped: G.stop }

/** The lifecycles line's segments at a tier, in display order, each with its priority for when room runs short. */
export function hudSegments(hud: HudModel, tier: Tier, surface: Kit['surface'] = 'terminal'): Segment[] {
  const isSvg = surface !== 'terminal'
  const label = (text: string): Span[] => (tier.labels ? [{ text: `${text} `, isDim: true }] : [])
  const segments: Segment[] = []

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

  // A handoff under way belongs to the context: it says so beside the meter.
  if (hud.autopilot.isOn && EVENT_STATES.has(hud.autopilot.state)) {
    segments.push({ key: 'event', priority: 0, side: 'left', spans: [{ text: hud.autopilot.text, tone: hud.autopilot.tone === 'normal' ? 'accent' : hud.autopilot.tone, isBold: true }] })
  }

  // Work: a track of milestones, as Claude's own task list counts them.
  const work = hud.work
  if (work !== null && work.total > 0) {
    const isDone = work.done === work.total
    const count: Span = { text: ` ${work.done}/${work.total}`, tone: isDone ? 'good' : undefined }
    const stops = trackStops(work.done, work.total, tier.stops, work.current !== null)
    const alt = `Work: ${work.done} of ${work.total} milestones done`
    segments.push(
      isSvg
        ? {
            key: 'work',
            priority: 1,
            side: 'left',
            spans: label('Work'),
            graphic: {
              source: svgTrack({ stops, width: stops.length * 10 + 2, height: 10, isAnimated: hud.isAnimated }),
              cells: Math.ceil((stops.length * 10 + 2) / CELL_PX),
              alt,
              height: 10,
              isInteractive: hud.isAnimated && stops.includes('now') ? true : undefined,
            },
            after: [count],
          }
        : { key: 'work', priority: 1, side: 'left', spans: [...label('Work'), ...trackSpans(stops), count] },
    )
  }

  // Cache: a clock face emptying as the prompt cache's lifetime runs out.
  const cache = hud.cache
  if (cache !== null) {
    const text: Span = { text: `${isSvg ? '' : ' '}${cache.text}`, tone: cache.tone === 'warn' ? 'warn' : undefined, isDim: cache.tone === 'muted' ? true : undefined }
    const alt = cache.warmth === 'warm' ? `Prompt cache warm${cache.leftMs === null ? '' : `, about ${cache.text} left`}` : `Prompt cache ${cache.text}`
    segments.push(
      isSvg
        ? {
            key: 'cache',
            priority: 1,
            side: 'left',
            spans: label('Cache'),
            graphic: { source: svgClock({ fraction: cache.fraction, tone: cache.tone === 'normal' ? 'info' : cache.tone, size: 12 }), cells: 2, alt, height: 12 },
            after: [text],
          }
        : {
            key: 'cache',
            priority: 1,
            side: 'left',
            spans: [...label('Cache'), { text: clockGlyph(cache.fraction), tone: cache.tone === 'normal' ? 'info' : cache.tone === 'warn' ? 'warn' : undefined, isDim: cache.tone === 'muted' ? true : undefined }, text],
          },
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

  // Right: states while they matter, then the level.
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
    <Box key={`seg-${s.key}`} flexDirection="row" alignItems="center" flexShrink={0} columnGap={s.after === undefined || s.after.length === 0 || s.after[0]?.text.startsWith(' ') ? 0 : 1}>
      {text(s.spans, 'before')}
      <Svg key={`seg-${s.key}-svg`} source={s.graphic.source} alt={s.graphic.alt} height={s.graphic.height} isInteractive={s.graphic.isInteractive} />
      {text(s.after, 'after')}
    </Box>
  )
}

/**
 * Where the milestone sits: "Milestone 2 of 5" when the line already names
 * it in its "doing" words, else its name and place; shorter when room is short.
 */
function milestoneText(m: NonNullable<HudActivity['milestone']>, isNamed: boolean, room: number): string | null {
  const position = `${m.index} of ${m.total}`
  const options = isNamed ? [`Milestone ${position}`, position] : [`${m.subject.length > 40 ? `${m.subject.slice(0, 39)}…` : m.subject} · ${position}`, `Milestone ${position}`, position]
  return options.find(o => o.length <= room) ?? null
}

/** The top line's words: what is happening, then (dim) how long and where in the plan. */
function topWords(hud: HudModel, room: number): { glyph: string; glyphTone: Tone; main: string; isMainDim: boolean; isMainBold: boolean; rest: string | null } {
  const a = hud.activity
  if (a === null) return { glyph: G.ring, glyphTone: 'muted', main: hud.objective ?? 'Ready', isMainDim: true, isMainBold: false, rest: null }
  const isWorking = a.state === 'working'
  const main = a.text
  const parts: string[] = []
  if (isWorking && a.runningMs !== null) parts.push(fmt.duration(a.runningMs))
  if (!isWorking && a.durationMs !== null) parts.push(fmt.duration(a.durationMs))
  const fixed = parts.join(' · ')
  // The milestone's place, when the line has room for it after the words.
  const spare = room - main.length - (fixed === '' ? 0 : fixed.length + 3) - 3
  const where = isWorking && a.milestone !== null ? milestoneText(a.milestone, a.source === 'plan', spare) : null
  if (where !== null) parts.push(where)
  return {
    glyph: isWorking ? G.run : G.ok,
    glyphTone: isWorking ? (a.source === 'thinking' ? 'muted' : 'info') : 'good',
    main,
    isMainDim: isWorking && a.source === 'thinking',
    isMainBold: isWorking && a.source !== 'thinking',
    rest: parts.length === 0 ? null : parts.join(' · '),
  }
}

/** The Control Room button's words: its name with the brand mark, or a short verb in a narrow bar. */
const pillLabel = (hud: HudModel, columns: number): string => (columns >= 70 ? `${G.brand} Control Room` : `${G.brand} ${hud.isPaneOpen ? 'Close' : 'Open'}`)

/** The top line: what is happening, then the run's cost and the Control Room button. */
function topLine(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Text, Button } = kit.ui
  const run = hud.cost.runUsd ?? hud.cost.usd
  const isNamed = kit.columns >= namedFrom(kit.surface)
  const cost = `${fmt.cost(run)}${run !== null && hud.cost.isRunPartial ? '+' : ''}`
  const costWidth = (isNamed || run === null ? 4 : 0) + cost.length
  const pill = pillLabel(hud, kit.columns)
  const pillWidth = pill.length + (isNative(kit) ? 6 : 4)
  const room = Math.max(8, kit.columns - INDENT - costWidth - pillWidth - 2 * GAP)
  const w = topWords(hud, room)
  return (
    <Box flexDirection="row" key="hud-top" alignItems="center" columnGap={GAP}>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} {...clip(kit)}>
        <Box width={INDENT} flexShrink={0}>
          <Text {...toneProps(w.glyphTone)}>{w.glyph}</Text>
        </Box>
        <Box flexShrink={1} {...clip(kit)}>
          <Text wrap="truncate-end">
            <Text dimColor={w.isMainDim ? true : undefined} bold={w.isMainBold ? true : undefined}>
              {w.main}
            </Text>
            {w.rest === null ? null : <Text dimColor>{` · ${w.rest}`}</Text>}
          </Text>
        </Box>
      </Box>
      <Box flexShrink={0}>
        <Text>
          {isNamed || run === null ? <Text dimColor>{'Run '}</Text> : null}
          <Text dimColor={run === null ? true : undefined}>{cost}</Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Button key="open" label={pill} variant={hud.isPaneOpen ? 'primary' : 'secondary'} onPress={kit.actions.togglePane} />
      </Box>
    </Box>
  )
}

/** A handoff that needs the person, on a line of its own above, with its actions. */
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
        <Box width={INDENT} flexShrink={0}>
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

/** The lifecycles line: Context, Work and Cache, the checks, then what needs a look. */
function lifecyclesLine(kit: Kit, hud: HudModel): RenderElement {
  const { Box } = kit.ui
  const room = Math.max(10, kit.columns - INDENT)
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
    <Box flexDirection="row" key="hud-line" alignItems="center" marginLeft={INDENT}>
      <Box flexDirection="row" columnGap={GAP} flexShrink={0} alignItems="center">
        {left.map(s => segmentEl(kit, s))}
      </Box>
      <Box key="hud-gap" flexGrow={1} flexShrink={1} />
      {right.length === 0 ? null : (
        <Box flexDirection="row" columnGap={GAP} flexShrink={0} marginLeft={GAP} alignItems="center">
          {right.map(s => segmentEl(kit, s))}
        </Box>
      )}
    </Box>
  )
}

/**
 * Kit's row, only while the companion is on: the terminal's surface module
 * (made by the hooks module, which alone may name it), or an SVG that
 * animates itself on Desktop.
 */
function stageRow(kit: Kit, hud: HudModel, stage: RenderElement | null): RenderElement | null {
  const { Box, Svg } = kit.ui
  const companion = hud.companion
  if (companion === null) return null
  if (kit.surface === 'terminal') {
    return stage === null ? null : (
      <Box key="hud-stage" flexDirection="row" marginLeft={INDENT} height={2}>
        {stage}
      </Box>
    )
  }
  if (Svg === undefined) return null
  const width = Math.min(560, Math.max(120, kit.columns * 7))
  return (
    <Box key="hud-stage" flexDirection="row" marginLeft={INDENT}>
      <Svg key="companion" source={svgCompanion(companion as CompanionAnimation, width)} alt={companion.caption} height={18} isInteractive={companion.fps > 0 ? true : undefined} />
    </Box>
  )
}

export function hudView(kit: Kit, hud: HudModel, stage: RenderElement | null = null): RenderElement {
  const { Box } = kit.ui
  return (
    <Box flexDirection="column" rowGap={isNative(kit) && hud.alert !== null ? 1 : 0}>
      {hud.alert === null ? null : alertLine(kit, hud.alert)}
      {topLine(kit, hud)}
      {lifecyclesLine(kit, hud)}
      {stageRow(kit, hud, stage)}
    </Box>
  )
}
