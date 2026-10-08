/**
 * Kit on the terminal: a Client surface module that plays the companion's
 * frames as half-block pixels (two pixels per cell, the upper in the text
 * color, the lower in the background) and walks it along its lane on the
 * surface's own frame clock, so the plugin does no work between frames. Its
 * feet rest on the bottom of the lane, right over the status bar's top edge.
 * A click posts to the hooks module, which opens Control Room.
 *
 * Walks: none (stays where it is), slow and normal (back and forth), patrol
 * (back and forth, pausing at each end), enter (in from beyond the left edge
 * to its resting place) and exit (off beyond the right edge, then gone until
 * the mood changes).
 *
 * Self-contained by design: it runs on the drawing thread, and takes every
 * frame, color and pace from its props (features/companion.ts makes them).
 */

import type { ClientSurface, RenderElement } from 'claude-code'

type Walk = 'none' | 'slow' | 'normal' | 'patrol' | 'enter' | 'exit'

type Animation = {
  frames: string[][]
  palette: Record<string, string>
  fps: number
  walk: Walk
  bubbles: { text: string; color: string }[]
}

/** x: the sprite's left column (negative: partly beyond the left edge); gone: walked off; rest: beats left to pause. */
type State = { x: number; dir: 1 | -1; frame: number; gone: boolean; rest: number; walk: Walk }

/** The clock's beat: five a second; slower moods advance on some beats only. */
const BEAT_MS = 200

/** Beats per step for each walk, and how long a patrol pauses at each end. */
const STEP_EVERY: Record<Walk, number> = { none: 0, slow: 4, normal: 2, patrol: 3, enter: 1, exit: 1 }
const PATROL_PAUSE = 12

/** The props each instance last drew with, so its ticks play the current mood. */
const latest = new WeakMap<object, Animation>()

type Cell = { glyph: string; color?: string; background?: string }

/** One pair of pixel rows as cells: the upper pixel as the text color of ▀, the lower as its background. */
function cellsOf(top: string, bottom: string, palette: Record<string, string>): Cell[] {
  const out: Cell[] = []
  const width = Math.max(top.length, bottom.length)
  for (let x = 0; x < width; x++) {
    const up = palette[top[x] ?? '.']
    const down = palette[bottom[x] ?? '.']
    if (up === undefined && down === undefined) out.push({ glyph: ' ' })
    else if (up === undefined) out.push({ glyph: '▄', color: down })
    else if (down === undefined) out.push({ glyph: '▀', color: up })
    else if (down === up) out.push({ glyph: '█', color: up })
    else out.push({ glyph: '▀', color: up, background: down })
  }
  return out
}

/** Adjacent cells of one style become one run, so a row is a few Texts, not one per cell. */
function runsOf(cells: readonly Cell[]): Cell[] {
  const out: Cell[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last !== undefined && last.color === c.color && last.background === c.background && (last.glyph === c.glyph || (c.color === undefined && c.background === undefined))) last.glyph += c.glyph
    else out.push({ ...c })
  }
  return out
}

const flip = (rows: readonly string[]): string[] => rows.map(r => [...r].reverse().join(''))

const widthOf = (a: Animation): number => Math.max(1, ...a.frames.map(f => Math.max(0, ...f.map(r => r.length))))

/** Where Kit rests when it is not walking: a third of the way along the lane. */
const restOf = (room: number): number => Math.max(0, Math.round(room * 0.33))

function tick(surface: ClientSurface<State>, beat: number): void {
  const a = latest.get(surface)
  const s = surface.state
  if (a === undefined || s === undefined || a.fps <= 0) return
  const beatsPerFrame = Math.max(1, Math.round(1000 / BEAT_MS / a.fps))
  const isFrame = beat % beatsPerFrame === 0
  const width = widthOf(a)
  const room = Math.max(0, surface.columns - width - 4)
  let { x, dir, gone, rest } = s
  // A new mood after walking off walks back in from the left; entering starts beyond the edge.
  let walk = a.walk
  if (gone && walk !== 'exit') {
    gone = false
    x = -width
    dir = 1
  }
  if (walk === 'enter' && s.walk !== 'enter') {
    x = -width
    dir = 1
  }
  // Still walking in from beyond the edge: keep walking until it reaches its resting place.
  if (x < restOf(room) && dir === 1 && x < 0 && walk !== 'exit') walk = 'enter'
  const every = STEP_EVERY[walk]
  let isStep = every > 0 && beat % every === 0
  if (rest > 0) {
    rest -= 1
    isStep = false
  }
  if (isStep) {
    if (walk === 'enter') {
      if (x < restOf(room)) x += 1
    } else if (walk === 'exit') {
      x += 1
      dir = 1
      if (x > surface.columns) gone = true
    } else if (room > 0) {
      if (x + dir > room || x + dir < 0) {
        dir = dir === 1 ? -1 : 1
        if (walk === 'patrol') rest = PATROL_PAUSE
      } else x += dir
    }
  }
  if (!isFrame && !isStep && rest === s.rest && walk === s.walk && gone === s.gone && x === s.x) return
  surface.setState({ x, dir, frame: isFrame ? s.frame + 1 : s.frame, gone, rest, walk: a.walk })
}

export default function Companion(props: Animation, surface: ClientSurface<State>): RenderElement {
  const { Box, Text } = surface.elements
  latest.set(surface, props)
  const width = widthOf(props)
  if (surface.state === undefined) {
    const room = Math.max(0, surface.columns - width - 4)
    const isEntering = props.walk === 'enter'
    surface.setState({ x: isEntering ? -width : restOf(room), dir: 1, frame: 0, gone: false, rest: 0, walk: props.walk })
    // The beat count lives here, not in the state: a beat that changes nothing draws nothing.
    let beat = 0
    surface.every(BEAT_MS, () => {
      beat += 1
      tick(surface, beat)
    })
    surface.onPointer(e => {
      if (e.type === 'down') surface.post({ open: true })
    })
  }
  const s = surface.state ?? { x: 0, dir: 1, frame: 0, gone: false, rest: 0, walk: props.walk }
  const height = Math.ceil(Math.max(...props.frames.map(f => f.length), 2) / 2)
  if (s.gone) return <Box flexDirection="column" height={height} />
  const frame = props.frames[s.frame % Math.max(1, props.frames.length)] ?? []
  let rows = s.dir === 1 ? frame : flip(frame)
  // Partly beyond an edge: only the columns on the lane are drawn.
  const left = Math.max(0, -s.x)
  const right = Math.max(0, s.x + width - Math.max(width, surface.columns))
  if (left > 0 || right > 0) rows = rows.map(r => r.slice(left, Math.max(left, r.length - right)))
  const shown = props.bubbles.length === 0 ? null : props.bubbles[s.frame % props.bubbles.length]
  const bubble = shown === undefined || shown === null || shown.text === '' ? null : shown
  const lines = Array.from({ length: height }, (_, y) => runsOf(cellsOf(rows[2 * y] ?? '', rows[2 * y + 1] ?? '', props.palette)))
  const margin = Math.max(0, s.x)
  return (
    <Box flexDirection="column" height={height}>
      {lines.map((cells, y) => (
        <Box key={`row-${y}`} flexDirection="row" marginLeft={y === 1 && s.dir === -1 && bubble !== null ? Math.max(0, margin - 3) : margin}>
          {y === 1 && s.dir === -1 && bubble !== null ? (
            <Text key="bubble" color={bubble.color}>
              {`${bubble.text.slice(0, 3).padStart(3)}`}
            </Text>
          ) : null}
          <Text key="pixels">
            {cells.map((c, i) => (
              <Text key={`c-${i}`} color={c.color} backgroundColor={c.background}>
                {c.glyph}
              </Text>
            ))}
          </Text>
          {y === 1 && s.dir === 1 && bubble !== null ? (
            <Text key="bubble" color={bubble.color}>
              {` ${bubble.text}`}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}
