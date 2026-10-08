/**
 * The status bar: a mission HUD above the prompt.
 *
 *              ▄▀▄    ▄▀▄                                                       (Kit, when on)
 *   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ the top edge
 *   ▸ Rewriting the cache scheduler · step 3 of 8               ▲ Tests failing   ◆ Control Room
 *     WORK ●━●━●━◉─○─○─○─○ 3/8    CONTEXT ▇▇▇▇▇▇▇▇▇▇▌▇▇▇ 48% · hands off 70%    CACHE ◕ 42m   RUN $49.55
 *
 * The headline says what is happening, in words, with a mark for the state
 * (working, thinking, running a check, waiting for you or for a result,
 * blocked, handing off, done). On its right: only what needs a look, as
 * chips, then the Control Room button, drawn as a filled control.
 *
 * Under it, the instruments, each its own shape so they cannot be confused:
 * WORK is a track of milestones (it carries across handoffs), CONTEXT a
 * filling meter with the handoff point as a notch (it starts over after one),
 * CACHE a clock face (shown only while it can matter: when you are away, or
 * after a costly rebuild), and the whole run's cost on the right.
 *
 * Kit, when on, walks a lane of its own: in the terminal it stands on the
 * HUD's top edge; on Desktop it is a short animated image above the headline.
 * A handoff that needs the person takes a line of its own above everything.
 *
 * Width decides the detail: the richest tier whose instruments all fit,
 * from named readings with long graphics down to bare graphics, then the
 * least important reading drops. Desktop draws the marks, the track, the
 * meter and the clock as SVG.
 */

import type { RenderElement } from 'claude-code'

import type { HudChip, HudModel, Tone, TrackStop } from '../../types'
import * as fmt from '../core/format'
import { type CompanionAnimation, LANE_H, svgCompanion } from '../features/companion'
import type { Kit } from './kit'
import { clip, isNative } from './primitives'
import { G, STATE_MARK, STOP_LOOK, clockGlyph, meterCells, scaleTrack, svgClock, svgContextMeter, svgStateIcon, svgWorkTrack, toneProps } from './theme'

/**
 * A run of text in one style. `isTrack` draws the empty part of a graphic in the theme's quietest
 * gray (`subtle`): dim text varies from terminal to terminal, and a dim block reads as a slab.
 */
type Span = { text: string; tone?: Tone; isDim?: boolean; isBold?: boolean; isTrack?: boolean }

/** A graphic drawn as SVG on the remote surfaces, in place of its glyphs: `cells` wide. */
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

/** Cells between instruments. */
const GAP = 4

/** The instruments sit under the headline's words, past its mark. */
const INDENT = 2

/** The pixels a cell of a status-bar graphic takes as SVG. */
const CELL_PX = 8

/** Kit's lane on the remote surfaces, in CSS pixels. */
const KIT_LANE_W = 280

const spanWidth = (spans: readonly Span[] | undefined): number => (spans ?? []).reduce((n, p) => n + p.text.length, 0)

export const widthOf = (s: Segment): number => spanWidth(s.spans) + (s.graphic?.cells ?? 0) + spanWidth(s.after)

/** How much the instruments row shows: names, the meter's cells, the track's stops, the long notes. */
export type Tier = { labels: boolean; meter: number; stops: number; notes: boolean }

const TIERS: readonly Tier[] = [
  { labels: true, meter: 24, stops: 16, notes: true },
  { labels: true, meter: 16, stops: 12, notes: true },
  { labels: true, meter: 12, stops: 10, notes: false },
  { labels: true, meter: 10, stops: 8, notes: false },
  { labels: true, meter: 8, stops: 6, notes: false },
  { labels: false, meter: 8, stops: 6, notes: false },
  { labels: false, meter: 6, stops: 5, notes: false },
]

/**
 * From this wide (terminal columns; Desktop's are wider) the readings carry their names, docked
 * beside the panel included, so the names do not come and go as readings appear.
 */
const NAMED_FROM: Record<'terminal' | 'other', number> = { terminal: 72, other: 64 }

const namedFrom = (surface: Kit['surface']): number => (surface === 'terminal' ? NAMED_FROM.terminal : NAMED_FROM.other)

/** The tiers the instruments may take at a width, richest first: the first whose segments all fit wins. */
export function tiersOf(columns: number, surface: Kit['surface'] = 'terminal'): readonly Tier[] {
  return columns >= namedFrom(surface) ? TIERS : TIERS.filter(t => !t.labels)
}

/** Adjacent spans of one style become one, so a graphic is a few Texts, not one per cell. */
function merged(spans: readonly Span[]): Span[] {
  const out: Span[] = []
  for (const span of spans) {
    const last = out[out.length - 1]
    if (last !== undefined && last.tone === span.tone && last.isDim === span.isDim && last.isBold === span.isBold && last.isTrack === span.isTrack) last.text += span.text
    else out.push({ ...span })
  }
  return out
}

/** The context meter in the terminal: filled segments in its tone, empty ones dim, the handoff point an orange bar. */
function meterSpans(fraction: number, marker: number | null, tone: Tone, width: number): Span[] {
  const c = meterCells(fraction, width, marker)
  return merged(
    Array.from({ length: c.width }, (_, i): Span => (i === c.marker ? { text: G.notch, tone: 'accent' } : i < c.filled ? { text: G.segFull, tone } : { text: G.segEmpty, isTrack: true })),
  )
}

/** The work track in the terminal: ●━●━◉─○, done in the work color, the stretch to come dim. */
export function trackSpans(stops: readonly TrackStop[]): Span[] {
  const out: Span[] = []
  stops.forEach((s, i) => {
    if (i > 0) out.push(stops[i - 1] === 'done' && s !== 'open' ? { text: G.lineFull, tone: 'info' } : { text: G.lineEmpty, isDim: true })
    const look = STOP_LOOK[s]
    out.push({ text: look.glyph, tone: look.tone, isBold: look.isBold, isDim: look.isDim })
  })
  return merged(out)
}

const valueTone = (tone: Tone): Tone | undefined => (tone === 'good' || tone === 'normal' || tone === 'muted' ? undefined : tone)

const label = (tier: Tier, text: string): Span[] => (tier.labels ? [{ text: `${text} `, isDim: true }] : [])

/** The instruments at a tier, in display order, each with its priority for when room runs short. */
export function hudSegments(hud: HudModel, tier: Tier, surface: Kit['surface'] = 'terminal'): Segment[] {
  const isSvg = surface !== 'terminal'
  const segments: Segment[] = []

  // WORK: a track of milestones, as Claude's own task list counts them.
  const work = hud.work
  if (work !== null && work.total > 0) {
    const isDone = work.done === work.total
    const count: Span = { text: ` ${work.done}/${work.total}`, tone: isDone ? 'good' : undefined, isBold: true }
    const stops = scaleTrack(work.track.length === work.total ? work.track : fallbackTrack(work.done, work.total, work.current !== null), tier.stops)
    const alt = `Work: ${work.done} of ${work.total} milestones done`
    if (isSvg) {
      const source = svgWorkTrack({ stops, height: 14, pitch: 16 })
      const px = Math.round(2 * 6.5 + (stops.length - 1) * 16)
      segments.push({ key: 'work', priority: 1, side: 'left', spans: label(tier, 'WORK'), graphic: { source, cells: Math.ceil(px / CELL_PX), alt, height: 14 }, after: [count] })
    } else {
      segments.push({ key: 'work', priority: 1, side: 'left', spans: [...label(tier, 'WORK'), ...trackSpans(stops), count] })
    }
  }

  // CONTEXT: a filling meter with the handoff notch; it starts over in each fresh context.
  const ctx = hud.ctx
  if (ctx.pct === null || ctx.tokens === null || ctx.window === null || ctx.window <= 0) {
    segments.push({ key: 'ctx', priority: 0, side: 'left', spans: [...label(tier, 'CONTEXT'), { text: G.none, isDim: true }] })
  } else {
    const fraction = ctx.tokens / ctx.window
    const marker = ctx.threshold === null ? null : ctx.threshold / ctx.window
    const tone: Tone = ctx.tone === 'muted' || ctx.tone === 'normal' ? 'good' : ctx.tone
    const pct: Span = { text: ` ${ctx.pct}%`, tone: valueTone(ctx.tone), isBold: true }
    const notes: string[] = []
    const event = hud.autopilot.isOn && hud.autopilot.state !== 'armed' && hud.autopilot.state !== 'off' ? hud.autopilot.text : null
    if (event !== null) notes.push(event)
    else if (tier.notes && marker !== null && hud.autopilot.isOn) notes.push(`hands off ${Math.round(marker * 100)}%`)
    if (tier.notes && hud.session.index > 1) notes.push(`session ${hud.session.index}`)
    const after: Span[] = [pct, ...(notes.length === 0 ? [] : [{ text: ` · ${notes.join(' · ')}`, isDim: event === null, tone: event === null ? undefined : 'accent' } as Span])]
    if (isSvg) {
      const px = tier.meter * CELL_PX + 24
      segments.push({ key: 'ctx', priority: 0, side: 'left', spans: label(tier, 'CONTEXT'), graphic: { source: svgContextMeter({ fraction, marker, tone, width: px, height: 14 }), cells: Math.ceil(px / CELL_PX), alt: `Context ${ctx.pct}% used`, height: 14 }, after })
    } else {
      segments.push({ key: 'ctx', priority: 0, side: 'left', spans: [...label(tier, 'CONTEXT'), ...meterSpans(fraction, marker, tone, tier.meter), ...after] })
    }
  }

  // CACHE: only while it can matter.
  const cache = hud.cache
  if (cache !== null && cache.isShown) {
    const word = cache.recentMiss !== null ? cache.text : cache.warmth === 'warm' && cache.leftMs !== null && tier.notes ? `${cache.text} left` : cache.text
    const text: Span = { text: ` ${word}`, tone: cache.tone === 'warn' ? 'warn' : undefined, isDim: cache.tone === 'muted' ? true : undefined }
    const glyphTone: Tone = cache.tone === 'normal' ? 'info' : cache.tone
    const alt = cache.warmth === 'warm' ? `Prompt cache warm${cache.leftMs === null ? '' : `, about ${cache.text} left`}` : `Prompt cache ${cache.text}`
    segments.push(
      isSvg
        ? { key: 'cache', priority: 2, side: 'left', spans: label(tier, 'CACHE'), graphic: { source: svgClock({ fraction: cache.fraction, tone: glyphTone, size: 14 }), cells: 2, alt, height: 14 }, after: [text] }
        : { key: 'cache', priority: 2, side: 'left', spans: [...label(tier, 'CACHE'), { text: clockGlyph(cache.fraction), tone: glyphTone }, text] },
    )
  }

  // RUN: the whole run's cost, on the right.
  const run = hud.cost.runUsd ?? hud.cost.usd
  segments.push({
    key: 'run',
    priority: 1,
    side: 'right',
    spans: [...label(tier, 'RUN'), { text: `${fmt.cost(run)}${run !== null && hud.cost.isRunPartial ? '+' : ''}`, isDim: run === null, isBold: run !== null }],
  })
  return segments
}

/** A track from counts alone (a stored plan without statuses): done, the one under way, the rest. */
function fallbackTrack(done: number, total: number, hasCurrent: boolean): TrackStop[] {
  return Array.from({ length: total }, (_, i) => (i < done ? 'done' : i === done && hasCurrent ? 'now' : 'open'))
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
  const props = span.isTrack === true ? { color: 'subtle' as const } : span.tone === undefined ? {} : toneProps(span.tone)
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
    <Box key={`seg-${s.key}`} flexDirection="row" alignItems="center" flexShrink={0} columnGap={1}>
      {text(s.spans, 'before')}
      <Svg key={`seg-${s.key}-svg`} source={s.graphic.source} alt={s.graphic.alt} height={s.graphic.height} />
      {text(s.after?.map((p, i) => (i === 0 ? { ...p, text: p.text.replace(/^ /, '') } : p)), 'after')}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The headline row

/** The Control Room button's words: its name with the brand mark, or a short verb in a narrow bar. */
const buttonLabel = (hud: HudModel, columns: number): string => (columns >= 64 ? `${G.brand} Control Room` : `${G.brand} ${hud.isPaneOpen ? 'Close' : 'Open'}`)

/**
 * The Control Room button. Desktop draws its native button (primary while
 * the panel is open). The terminal draws a filled chip, brighter under the
 * pointer and in the brand color while the panel is open, so it reads as a
 * control and not as more text.
 */
function controlButton(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Button } = kit.ui
  const text = buttonLabel(hud, kit.columns)
  if (isNative(kit)) return <Button key="open" label={text} variant={hud.isPaneOpen ? 'primary' : 'secondary'} onPress={kit.actions.togglePane} />
  return (
    <Box key="open-chip" flexShrink={0} paddingX={1} backgroundColor={hud.isPaneOpen ? 'claude' : 'subtle'} hover={{ backgroundColor: hud.isPaneOpen ? 'claude' : 'inactive' }}>
      <Button key="open" label={text} plain onPress={kit.actions.togglePane} />
    </Box>
  )
}

/** The chips that fit beside the headline: the most pressing first. */
function chipsThatFit(chips: readonly HudChip[], room: number): HudChip[] {
  const out: HudChip[] = []
  let used = 0
  for (const c of chips) {
    const w = c.text.length + 2 + (out.length > 0 ? 2 : 0)
    if (used + w > room) break
    out.push(c)
    used += w
  }
  return out
}

function chipEl(kit: Kit, chip: HudChip): RenderElement {
  const { Text } = kit.ui
  const mark = chip.key === 'failing' ? G.fail : chip.tone === 'bad' || chip.tone === 'warn' ? G.warn : chip.key === 'quest' ? G.star : G.dot
  return (
    <Text key={`chip-${chip.key}`} wrap="truncate-end">
      <Text {...toneProps(chip.tone)}>{`${mark} `}</Text>
      <Text {...toneProps(chip.tone === 'info' || chip.tone === 'accent' ? 'normal' : chip.tone)} bold={chip.tone === 'bad' ? true : undefined}>
        {chip.text}
      </Text>
    </Text>
  )
}

/** The headline: the state's mark, what is happening, its detail; then the chips and the button on the right. */
function headlineRow(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Text, Svg } = kit.ui
  // Not `h`: that name is the JSX factory's in this module.
  const line = hud.headline
  const mark = STATE_MARK[line.state]
  const isStrong = line.state === 'working' || line.state === 'validating' || line.state === 'handoff' || line.state === 'waitingUser' || line.state === 'waitingExternal' || line.state === 'blocked'
  const isQuiet = line.state === 'ready' || line.state === 'thinking'
  const buttonWidth = buttonLabel(hud, kit.columns).length + (isNative(kit) ? 6 : 4)
  const chips = chipsThatFit(hud.chips, Math.max(0, Math.floor((kit.columns - buttonWidth) * 0.45)))
  return (
    <Box key="hud-head" flexDirection="row" alignItems="center" columnGap={3}>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} alignItems="center" columnGap={Svg !== undefined ? 1 : 0} {...clip(kit)}>
        {/* The terminal's mark takes the indent the instruments line up under; an icon takes its own size. */}
        <Box width={Svg !== undefined ? undefined : INDENT} flexShrink={0}>
          {Svg !== undefined ? <Svg key="mark" source={svgStateIcon(line.state)} alt={line.state} width={16} height={16} /> : <Text {...toneProps(mark.tone)}>{mark.glyph}</Text>}
        </Box>
        <Box flexShrink={1} {...clip(kit)}>
          <Text wrap="truncate-end">
            <Text bold={isStrong ? true : undefined} dimColor={isQuiet ? true : undefined}>
              {line.text}
            </Text>
            {line.detail === null || line.detail === '' ? null : <Text dimColor>{` · ${line.detail}`}</Text>}
          </Text>
        </Box>
      </Box>
      {chips.length === 0 ? null : (
        <Box key="hud-chips" flexDirection="row" columnGap={2} flexShrink={0} alignItems="center">
          {chips.map(c => chipEl(kit, c))}
        </Box>
      )}
      <Box flexShrink={0}>{controlButton(kit, hud)}</Box>
    </Box>
  )
}

/** The instruments: Work, Context and Cache on the left, the run's cost on the right. */
function instrumentsRow(kit: Kit, hud: HudModel): RenderElement {
  const { Box } = kit.ui
  const room = Math.max(10, kit.columns - INDENT)
  // The richest tier that shows every reading; failing that, the leanest one, the least important readings dropped.
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
          <Text wrap="truncate-end" bold>
            {alert.text}
          </Text>
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

/**
 * Kit's lane, only while the companion is on: the terminal's surface module
 * (made by the hooks module, which alone may name it), or on Desktop an SVG
 * that animates itself, in a short lane above the headline.
 */
function laneRow(kit: Kit, hud: HudModel, stage: RenderElement | null): RenderElement | null {
  const { Box, Svg } = kit.ui
  const companion = hud.companion
  if (companion === null) return null
  if (kit.surface === 'terminal') {
    return stage === null ? null : (
      <Box key="hud-lane" flexDirection="row" height={5}>
        {stage}
      </Box>
    )
  }
  if (Svg === undefined) return null
  // A short lane of a fixed size, drawn as an image (it animates itself): it fits any band, and an
  // image is never boxed in a frame the surface sizes and paints on its own.
  return (
    <Box key="hud-lane" flexDirection="row">
      <Svg key="companion" source={svgCompanion(companion as CompanionAnimation, KIT_LANE_W)} alt={companion.caption} width={KIT_LANE_W} height={LANE_H} />
    </Box>
  )
}

/** The HUD's top edge in the terminal: a line right under Kit's feet when it is on, a quiet rule otherwise. */
function edgeRow(kit: Kit, hud: HudModel, hasLane: boolean): RenderElement | null {
  const { Text } = kit.ui
  if (kit.surface !== 'terminal') return null
  return (
    <Text key="hud-edge" color="subtle" wrap="truncate-end">
      {(hasLane ? G.edge : G.lineEmpty).repeat(Math.max(4, kit.columns))}
    </Text>
  )
}

// ---------------------------------------------------------------------------
// Desktop and mobile: the same readings laid out by the surface, not by counted cells.
//
//   (▸) Running tests · step 8 of 10                              ▲ 1 issue   [◆ Control Room]
//   Work                 Context · hands off at 80%    Cache                         Run
//   ●━●━◉─○─○  2 of 10   ▬▬▬▬▬▬▬▬┃▬▬▬  24%            ◔ 42m left                 $43.00
//
// Each reading is a cell of an equal share of the row: a quiet caption over its
// graphic and value, so the row never overflows and nothing drifts. Every
// graphic is an image of a fixed size (never a sandboxed frame, which Desktop
// sizes on its own and may paint opaque).

/** One instrument on the remote surfaces: its caption, its graphic and its value. */
export type Cell = { key: string; caption: Span[]; graphic?: { source: string; alt: string; width: number; height: number }; value: Span[]; isEnd?: boolean }

/** The instruments as cells, `isCompact` in a narrow band (fewer stops, a shorter meter, terse values). */
export function hudCells(hud: HudModel, isCompact: boolean): Cell[] {
  const cells: Cell[] = []
  const work = hud.work
  if (work !== null && work.total > 0) {
    const isDone = work.done === work.total
    const stops = scaleTrack(work.track.length === work.total ? work.track : fallbackTrack(work.done, work.total, work.current !== null), isCompact ? 7 : 12)
    const pitch = isCompact ? 14 : 17
    const height = 14
    const source = svgWorkTrack({ stops, height, pitch })
    const width = Math.round(2 * (Math.max(3, height / 2 - 2) + 1.5) + (stops.length - 1) * pitch)
    cells.push({
      key: 'work',
      caption: [{ text: 'Work', isDim: true }],
      graphic: { source, alt: `Work: ${work.done} of ${work.total} milestones done`, width, height },
      value: [{ text: isCompact ? `${work.done}/${work.total}` : `${work.done} of ${work.total}`, tone: isDone ? 'good' : undefined, isBold: true }],
    })
  }

  const ctx = hud.ctx
  const event = hud.autopilot.isOn && hud.autopilot.state !== 'armed' && hud.autopilot.state !== 'off' ? hud.autopilot.text : null
  if (ctx.pct === null || ctx.tokens === null || ctx.window === null || ctx.window <= 0) {
    cells.push({ key: 'ctx', caption: [{ text: 'Context', isDim: true }], value: [{ text: G.none, isDim: true }] })
  } else {
    const fraction = ctx.tokens / ctx.window
    const marker = ctx.threshold === null ? null : ctx.threshold / ctx.window
    const tone: Tone = ctx.tone === 'muted' || ctx.tone === 'normal' ? 'good' : ctx.tone
    const note: Span[] =
      event !== null
        ? [{ text: ` · ${event}`, tone: 'accent' }]
        : marker !== null && hud.autopilot.isOn && !isCompact
          ? [{ text: ` · hands off at ${Math.round(marker * 100)}%`, isDim: true }]
          : []
    const width = isCompact ? 80 : 144
    cells.push({
      key: 'ctx',
      caption: [{ text: 'Context', isDim: true }, ...note],
      graphic: { source: svgContextMeter({ fraction, marker, tone, width, height: 14 }), alt: `Context ${ctx.pct}% used`, width, height: 14 },
      value: [{ text: `${ctx.pct}%`, tone: valueTone(ctx.tone), isBold: true }],
    })
  }

  const cache = hud.cache
  if (cache !== null && cache.isShown) {
    const word = cache.recentMiss === null && cache.warmth === 'warm' && cache.leftMs !== null && !isCompact ? `${cache.text} left` : cache.text
    const glyphTone: Tone = cache.tone === 'normal' ? 'info' : cache.tone
    const alt = cache.warmth === 'warm' ? `Prompt cache warm${cache.leftMs === null ? '' : `, about ${cache.text} left`}` : `Prompt cache ${cache.text}`
    cells.push({
      key: 'cache',
      caption: [{ text: 'Cache', isDim: true }],
      graphic: { source: svgClock({ fraction: cache.fraction, tone: glyphTone, size: 14 }), alt, width: 14, height: 14 },
      value: [{ text: word, tone: cache.tone === 'warn' ? 'warn' : undefined, isDim: cache.tone === 'muted' ? true : undefined }],
    })
  }

  const run = hud.cost.runUsd ?? hud.cost.usd
  cells.push({
    key: 'run',
    caption: [{ text: 'Run', isDim: true }],
    value: [{ text: `${fmt.cost(run)}${run !== null && hud.cost.isRunPartial ? '+' : ''}`, isDim: run === null, isBold: run !== null }],
    isEnd: true,
  })
  return cells
}

/** Below this many columns the remote surfaces take the compact cells. */
const COMPACT_BELOW = 80

function cellsRow(kit: Kit, hud: HudModel): RenderElement {
  const { Box, Text, Svg } = kit.ui
  const cells = hudCells(hud, kit.columns < COMPACT_BELOW)
  const line = (key: string, spans: readonly Span[]) => <Text key={key} wrap="truncate-end">{spans.map((p, i) => spanEl(kit, `${key}-${i}`, p))}</Text>
  return (
    <Box key="hud-cells" flexDirection="row" columnGap={3} alignItems="flex-start">
      {cells.map(c => (
        <Box
          key={`cell-${c.key}`}
          flexDirection="column"
          // The readings share the row equally; the run's cost takes what it needs at the right edge.
          flexGrow={c.isEnd === true ? 0 : 1}
          flexShrink={c.isEnd === true ? 0 : 1}
          width={c.isEnd === true ? undefined : 0}
          alignItems={c.isEnd === true ? 'flex-end' : 'flex-start'}
          {...clip(kit)}
        >
          {line(`cell-${c.key}-caption`, c.caption)}
          <Box flexDirection="row" alignItems="center" columnGap={1} {...clip(kit)}>
            {c.graphic === undefined || Svg === undefined ? null : (
              <Box flexShrink={0}>
                <Svg key={`cell-${c.key}-svg`} source={c.graphic.source} alt={c.graphic.alt} width={c.graphic.width} height={c.graphic.height} />
              </Box>
            )}
            {line(`cell-${c.key}-value`, c.value)}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function nativeHud(kit: Kit, hud: HudModel): RenderElement {
  const { Box } = kit.ui
  return (
    <Box flexDirection="column" rowGap={1}>
      {hud.alert === null ? null : alertLine(kit, hud.alert)}
      {laneRow(kit, hud, null)}
      {headlineRow(kit, hud)}
      {cellsRow(kit, hud)}
    </Box>
  )
}

export function hudView(kit: Kit, hud: HudModel, stage: RenderElement | null = null): RenderElement {
  const { Box } = kit.ui
  if (kit.surface !== 'terminal') return nativeHud(kit, hud)
  const lane = laneRow(kit, hud, stage)
  return (
    <Box flexDirection="column">
      {hud.alert === null ? null : alertLine(kit, hud.alert)}
      {lane}
      {edgeRow(kit, hud, lane !== null)}
      {headlineRow(kit, hud)}
      {instrumentsRow(kit, hud)}
    </Box>
  )
}
