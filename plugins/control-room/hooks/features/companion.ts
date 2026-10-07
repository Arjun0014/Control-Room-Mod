/**
 * The companion: Kit, a small pixel fox in Claude orange that lives on the
 * status bar (off unless the person turns it on) and shows, by what it does,
 * what Claude is doing: walking while Claude works, sniffing about while it
 * reads and searches, sitting with a spinner while a check runs, celebrating
 * a green finish, sweating over a failure, carrying a note through a handoff,
 * tending the cache's clock while Keep warm holds it, curling up to sleep
 * when nothing has happened for a while.
 *
 * Pure: the mood is a function of the status bar's state and the time; the
 * animation is pixel frames (a palette letter per pixel, 4 pixels tall, so
 * two terminal rows of half blocks) and how fast to play them. The terminal
 * draws them in a Client surface module on its own frame clock (no work for
 * the plugin between frames); Desktop draws an SVG that animates itself.
 */

export type Mood = 'idle' | 'think' | 'work' | 'search' | 'test' | 'celebrate' | 'worried' | 'waiting' | 'handoff' | 'wake' | 'sleepy' | 'sleep' | 'tend' | 'tired'

export type Walk = 'none' | 'slow' | 'normal' | 'fast'

/** One mood's animation, plain data a surface module plays: frames of pixel rows, a palette, a pace. */
export type CompanionAnimation = {
  mood: Mood
  /** Frames, each 4 rows of palette letters ('.' is see-through), facing right. */
  frames: string[][]
  palette: Record<string, string>
  /** Frames a second; 0 holds the first frame still. */
  fps: number
  walk: Walk
  /** Glyphs beside the head, one per frame in turn (empty for none). */
  bubbles: { text: string; color: string }[]
  /** What it is doing, in words: an alt text and a tooltip. */
  caption: string
}

export const PALETTE: Record<string, string> = {
  o: '#D97757',
  d: '#A35038',
  e: '#2A1B16',
  w: '#F4EFE6',
  b: '#5A9BF6',
}

/** The fox, facing right: tail up at the back, four legs, ears, one eye. */
const STAND = ['w......o.o', 'o..oooooeo', '.ooooooooo', '..d.d..d.d']
const STEP = ['w......o.o', 'o..oooooeo', '.ooooooooo', '...d....d.']
const BLINK = ['w......o.o', 'o..ooooooo', '.ooooooooo', '..d.d..d.d']
const LOOK_UP = ['w......oeo', 'o..ooooooo', '.ooooooooo', '..d.d..d.d']
const SNIFF = ['w.......o.', 'o..ooooo.o', '.oooooooeo', '..d.d..d.d']
const SNIFF_STEP = ['w.......o.', 'o..ooooo.o', '.oooooooeo', '...d....d.']
const SIT = ['w......o.o', 'o..oooooeo', '.ooooooooo', '.dd....d.d']
const SIT_WAG = ['.......o.o', 'w..oooooeo', 'oooooooooo', '.dd....d.d']
const SIT_BLINK = ['w......o.o', 'o..ooooooo', '.ooooooooo', '.dd....d.d']
const HOP = ['w......o.o', 'o..oooooeo', '.ooooooooo', '.d.......d']
const WORRY = ['w........b', 'o..oooooeo', '.ooooooooo', '..d.d..d.d']
const WORRY_DRIP = ['w.........', 'o..oooooeo', '.oooooooob', '..d.d..d.d']
const DROWSY = ['w......o.o', 'o..ooooodo', '.ooooooooo', '.dd....d.d']
const CURLED = ['..........', 'w....o.o..', 'oooooooooo', '.dddddddd.']
const NOTE = ['w......o.o.', 'o..oooooeo.', '.ooooooooow', '..d.d..d.d.']
const NOTE_STEP = ['w......o.o.', 'o..oooooeo.', '.ooooooooow', '...d....d..']

const ORANGE = '#D97757'
const YELLOW = '#F2C14E'
const BLUE = '#5A9BF6'
const GREY = '#8E8E93'
const AMBER = '#F2A33A'

const at = (text: string, color: string) => ({ text, color })

const ANIMATIONS: Record<Mood, Omit<CompanionAnimation, 'mood' | 'palette'>> = {
  idle: { frames: [STAND, STAND, STAND, BLINK, STAND, STEP], fps: 3, walk: 'slow', bubbles: [], caption: 'Kit is waiting for the next turn' },
  think: { frames: [LOOK_UP, LOOK_UP, STAND, LOOK_UP], fps: 2, walk: 'none', bubbles: [at('.', GREY), at('..', GREY), at('...', GREY), at('..', GREY)], caption: 'Kit watches Claude think' },
  work: { frames: [STAND, STEP], fps: 6, walk: 'normal', bubbles: [], caption: 'Kit trots along while Claude works' },
  search: { frames: [SNIFF, SNIFF_STEP, SNIFF, STAND], fps: 4, walk: 'slow', bubbles: [], caption: 'Kit sniffs about while Claude reads and searches' },
  test: { frames: [SIT, SIT_WAG], fps: 4, walk: 'none', bubbles: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'].map(t => at(t, BLUE)), caption: 'Kit waits for the check to finish' },
  celebrate: { frames: [HOP, STAND, HOP, STAND], fps: 5, walk: 'none', bubbles: [at('+', YELLOW), at('*', ORANGE), at('+', ORANGE), at('*', YELLOW)], caption: 'Kit celebrates a green finish' },
  worried: { frames: [WORRY, WORRY_DRIP], fps: 2, walk: 'none', bubbles: [at('!', AMBER), at('!', AMBER)], caption: 'Kit worries about a failing check' },
  waiting: { frames: [SIT, SIT, SIT_BLINK, SIT_WAG], fps: 2, walk: 'none', bubbles: [at('?', ORANGE)], caption: 'Kit waits for you' },
  handoff: { frames: [NOTE, NOTE_STEP], fps: 6, walk: 'fast', bubbles: [], caption: 'Kit carries the handoff notes to the fresh context' },
  wake: { frames: [STAND, BLINK, STAND, STAND], fps: 4, walk: 'none', bubbles: [at('!', YELLOW), at('', YELLOW)], caption: 'Kit wakes up for the fresh context' },
  sleepy: { frames: [DROWSY, DROWSY, SIT_BLINK], fps: 1, walk: 'none', bubbles: [at('z', GREY), at('', GREY), at('', GREY)], caption: 'Kit is getting sleepy' },
  sleep: { frames: [CURLED], fps: 1, walk: 'none', bubbles: [at('z', GREY), at('Z', GREY), at('z', GREY), at('', GREY)], caption: 'Kit is asleep' },
  tend: { frames: [SIT, SIT_BLINK, SIT, SIT_WAG], fps: 1, walk: 'none', bubbles: ['◔', '◑', '◕', '●'].map(t => at(t, BLUE)), caption: 'Kit tends the cache while you are away' },
  tired: { frames: [SNIFF, SNIFF_STEP], fps: 2, walk: 'slow', bubbles: [at('~', GREY)], caption: 'Kit is tired: the context is nearly full' },
}

/**
 * The animation of a mood. Reduced motion holds one frame still; a busy
 * machine plays it at two frames a second at most.
 */
export function animationOf(mood: Mood, options: { isReduced: boolean; isBusy: boolean }): CompanionAnimation {
  const a = ANIMATIONS[mood]
  if (options.isReduced) return { mood, palette: PALETTE, frames: [a.frames[0] ?? STAND], fps: 0, walk: 'none', bubbles: a.bubbles.slice(0, 1).filter(b => b.text !== ''), caption: a.caption }
  return { mood, palette: PALETTE, frames: a.frames, fps: options.isBusy ? Math.min(2, a.fps) : a.fps, walk: options.isBusy && a.walk === 'fast' ? 'normal' : a.walk, bubbles: a.bubbles, caption: a.caption }
}

export type MoodInput = {
  now: number
  isWorking: boolean
  /** What the running turn's top line comes from (the thinking gap included). */
  source: 'plan' | 'tool' | 'thinking' | 'summary' | null
  /** The kind of the main conversation's running call ("read", "search", "edit", "shell", "web", "agent"), else null. */
  toolKind: string | null
  isCheckRunning: boolean
  /** A check failing, or calls that need a look. */
  isFailing: boolean
  autopilotState: string
  /** Every check of the last turn passed (at least one ran), or the plan was finished in it. */
  isGreen: boolean
  turnEndedAt: number | null
  /** When this context's first turn started; null before it. */
  hasTurned: boolean
  contextStartedAt: number | null
  /** The context's fill against the handoff point (or the window), 0–1+. */
  contextShare: number | null
  isKeepingWarm: boolean
}

const HANDOFF_STATES = new Set(['requested', 'handoff', 'verifying', 'clearing', 'compacting', 'resuming'])

/** What Kit is doing, from what Claude is doing. */
export function moodOf(m: MoodInput): Mood {
  if (HANDOFF_STATES.has(m.autopilotState)) return 'handoff'
  if (m.autopilotState === 'awaiting') return 'waiting'
  if (m.isWorking) {
    if (m.isCheckRunning) return 'test'
    if (m.source === 'thinking') return 'think'
    if (m.toolKind === 'read' || m.toolKind === 'search' || m.toolKind === 'web') return 'search'
    if (m.contextShare !== null && m.contextShare >= 0.9) return 'tired'
    return 'work'
  }
  if (!m.hasTurned) return m.contextStartedAt !== null && m.now - m.contextStartedAt < 60_000 ? 'wake' : 'idle'
  if (m.isFailing) return 'worried'
  const idle = m.turnEndedAt === null ? 0 : m.now - m.turnEndedAt
  if (m.isGreen && idle < 90_000) return 'celebrate'
  if (idle >= 10 * 60_000 && m.isKeepingWarm) return 'tend'
  if (idle >= 30 * 60_000) return 'sleep'
  if (idle >= 10 * 60_000) return 'sleepy'
  return 'idle'
}

/** A frame mirrored to face left. */
export const mirrored = (rows: readonly string[]): string[] => rows.map(r => [...r].reverse().join(''))

// ---------------------------------------------------------------------------
// Desktop: the same frames as an SVG that animates itself (SMIL), so the app
// plays it in its sandboxed frame with no work for the plugin.

const PX = 3

function frameRects(rows: readonly string[], palette: Record<string, string>, dx: number): string {
  let out = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x] ?? '.']
      if (color !== undefined) out += `<rect x="${dx + x * PX}" y="${y * PX + 3}" width="${PX}" height="${PX}" fill="${color}"/>`
    }
  })
  return out
}

/**
 * Kit as SVG on a stage `width` pixels wide: each frame a group shown in
 * turn, the walk a back-and-forth glide (facing the way it goes), bubbles
 * beside the head. One mood per drawing; the status bar draws again when it
 * changes.
 */
export function svgCompanion(a: CompanionAnimation, width: number): string {
  const w = Math.max(60, Math.round(width))
  const h = 18
  const spriteW = Math.max(...a.frames.map(f => Math.max(...f.map(r => r.length)))) * PX
  const n = a.frames.length
  const dur = a.fps > 0 ? n / a.fps : 1
  const groups = (facing: 'right' | 'left') =>
    a.frames
      .map((f, i) => {
        const rows = facing === 'right' ? f : mirrored(f)
        const values = Array.from({ length: n }, (_, j) => (j === i ? 'inline' : 'none')).join(';')
        const anim = n > 1 && a.fps > 0 ? `<animate attributeName="display" values="${values}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"/>` : ''
        return `<g display="${i === 0 ? 'inline' : 'none'}">${anim}${frameRects(rows, a.palette, 0)}</g>`
      })
      .join('')
  const bubble = (bx: number) => {
    const shown = a.bubbles.filter(b => b.text !== '')
    if (shown.length === 0) return ''
    const t = a.bubbles.length
    return a.bubbles
      .map((b, i) => {
        const values = Array.from({ length: t }, (_, j) => (j === i ? 'inline' : 'none')).join(';')
        const anim = t > 1 && a.fps > 0 ? `<animate attributeName="display" values="${values}" dur="${t / Math.max(1, a.fps)}s" calcMode="discrete" repeatCount="indefinite"/>` : ''
        return b.text === '' ? '' : `<text x="${bx}" y="9" font-size="9" font-family="monospace" fill="${b.color}" display="${i === 0 ? 'inline' : 'none'}">${anim}${escapeXml(b.text)}</text>`
      })
      .join('')
  }
  const speed = a.walk === 'fast' ? 40 : a.walk === 'normal' ? 24 : a.walk === 'slow' ? 10 : 0
  if (speed === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${escapeXml(a.caption)}</title><g transform="translate(6 0)">${groups('right')}${bubble(spriteW + 3)}</g></svg>`
  }
  const span = Math.max(1, w - spriteW - 20)
  const leg = span / speed
  const right = `<g><animate attributeName="display" values="inline;none" keyTimes="0;0.5" dur="${(2 * leg).toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>${groups('right')}${bubble(spriteW + 3)}</g>`
  const left = `<g display="none"><animate attributeName="display" values="none;inline" keyTimes="0;0.5" dur="${(2 * leg).toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>${groups('left')}${bubble(-12)}</g>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${escapeXml(a.caption)}</title>` +
    `<g><animateTransform attributeName="transform" type="translate" values="6 0;${(6 + span).toFixed(1)} 0;6 0" keyTimes="0;0.5;1" dur="${(2 * leg).toFixed(2)}s" repeatCount="indefinite"/>${right}${left}</g>` +
    `</svg>`
  )
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
