/**
 * Kit on the terminal: a Client surface module that plays the companion's
 * frames as half-block pixels (two pixels per cell, upper in the text color,
 * lower in the background) and walks it along its row on the surface's own
 * frame clock, so the plugin does no work between frames. A click posts to
 * the hooks module, which opens Control Room.
 *
 * Self-contained by design: it runs on the drawing thread, and takes every
 * frame, color and pace from its props (features/companion.ts makes them).
 */

import type { ClientSurface, RenderElement } from 'claude-code'

type Animation = {
  frames: string[][]
  palette: Record<string, string>
  fps: number
  walk: 'none' | 'slow' | 'normal' | 'fast'
  bubbles: { text: string; color: string }[]
}

type State = { x: number; dir: 1 | -1; frame: number }

/** The clock's beat: five a second; slower moods advance on some beats only. */
const BEAT_MS = 200

/** The props each instance last drew with, so its ticks play the current mood. */
const latest = new WeakMap<object, Animation>()

const STEP_EVERY: Record<Animation['walk'], number> = { none: 0, slow: 5, normal: 2, fast: 1 }

type Cell = { glyph: string; color?: string; background?: string }

/** One frame row pair as cells: the upper pixel as the text color of ▀, the lower as its background. */
function cellsOf(top: string, bottom: string, palette: Record<string, string>): Cell[] {
  const out: Cell[] = []
  const width = Math.max(top.length, bottom.length)
  for (let x = 0; x < width; x++) {
    const up = palette[top[x] ?? '.']
    const down = palette[bottom[x] ?? '.']
    if (up === undefined && down === undefined) out.push({ glyph: ' ' })
    else if (up === undefined) out.push({ glyph: '▄', color: down })
    else if (down === undefined || down === up) out.push({ glyph: down === up ? '█' : '▀', color: up })
    else out.push({ glyph: '▀', color: up, background: down })
  }
  return out
}

const flip = (rows: readonly string[]): string[] => rows.map(r => [...r].reverse().join(''))

export default function Companion(props: Animation, surface: ClientSurface<State>): RenderElement {
  const { Box, Text } = surface.elements
  latest.set(surface, props)
  if (surface.state === undefined) {
    surface.setState({ x: 0, dir: 1, frame: 0 })
    // The beat count lives here, not in the state: a beat that changes nothing draws nothing.
    let tick = 0
    surface.every(BEAT_MS, () => {
      const a = latest.get(surface)
      const s = surface.state
      if (a === undefined || s === undefined || a.fps <= 0) return
      tick += 1
      const beatsPerFrame = Math.max(1, Math.round(1000 / BEAT_MS / a.fps))
      const isFrame = tick % beatsPerFrame === 0
      const every = STEP_EVERY[a.walk]
      const isStep = every > 0 && tick % every === 0
      if (!isFrame && !isStep) return
      const width = Math.max(...a.frames.map(f => Math.max(...f.map(r => r.length))))
      const room = Math.max(0, surface.columns - width - 3)
      let { x, dir } = s
      if (isStep && room > 0) {
        if (x + dir > room || x + dir < 0) dir = dir === 1 ? -1 : 1
        x = Math.min(room, Math.max(0, x + dir))
      }
      surface.setState({ x, dir, frame: isFrame ? s.frame + 1 : s.frame })
    })
    surface.onPointer(e => {
      if (e.type === 'down') surface.post({ open: true })
    })
  }
  const s = surface.state ?? { x: 0, dir: 1, frame: 0 }
  const frame = props.frames[s.frame % Math.max(1, props.frames.length)] ?? []
  const rows = s.dir === 1 ? frame : flip(frame)
  const shown = props.bubbles.length === 0 ? null : props.bubbles[s.frame % props.bubbles.length]
  const bubble = shown === undefined || shown === null || shown.text === '' ? null : shown
  const lines = [cellsOf(rows[0] ?? '', rows[1] ?? '', props.palette), cellsOf(rows[2] ?? '', rows[3] ?? '', props.palette)]
  return (
    <Box flexDirection="column" height={2}>
      {lines.map((cells, y) => (
        <Box key={`row-${y}`} flexDirection="row" marginLeft={s.x}>
          {y === 0 && s.dir === -1 && bubble !== null ? (
            <Text key="bubble" color={bubble.color}>
              {`${bubble.text.padStart(3)} `}
            </Text>
          ) : y === 1 && s.dir === -1 && bubble !== null ? (
            <Text key="pad">{'    '}</Text>
          ) : null}
          <Text key="pixels">
            {cells.map((c, i) => (
              <Text key={`c-${i}`} color={c.color} backgroundColor={c.background}>
                {c.glyph}
              </Text>
            ))}
          </Text>
          {y === 0 && s.dir === 1 && bubble !== null ? (
            <Text key="bubble" color={bubble.color}>
              {` ${bubble.text}`}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}
