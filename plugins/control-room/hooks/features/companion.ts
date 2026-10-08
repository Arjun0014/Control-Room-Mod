/**
 * The companion: Kit, a small Claude-orange creature that lives on the top
 * edge of the status bar (off unless the person turns it on) and shows, by
 * what it does, what the run is doing: patrolling while Claude thinks, busy
 * while it works, searching with a magnifier while it reads, watching a check,
 * hopping at a green finish, startled by a failure, waiting with a question
 * mark when the person is needed, sweating on a busy machine, tending a small
 * fire while Keep warm holds the cache, dozing as the cache nears its expiry,
 * carrying the notes away at a handoff and walking back in with the fresh
 * context.
 *
 * Pure: the mood is a function of the status bar's state and the time; the
 * animation is pixel frames (a palette letter per pixel, 10 pixels tall, so
 * five terminal rows of half blocks) and how to play them. The terminal draws
 * them in a Client surface module on its own frame clock (no work for the
 * plugin between frames); Desktop draws an SVG that animates itself.
 *
 * Calm by design: most moods stand or sit still and only blink or glance
 * now and then; walking is slow, and pauses.
 */

export type Mood =
  | 'idle'
  | 'think'
  | 'work'
  | 'search'
  | 'test'
  | 'celebrate'
  | 'worried'
  | 'waiting'
  | 'handoff'
  | 'wake'
  | 'sleepy'
  | 'dim'
  | 'sleep'
  | 'tend'
  | 'tired'

/**
 * How Kit moves along its lane: not at all, at a pace, back and forth with
 * pauses (patrol), walking in from the left edge (enter), or walking off to
 * the right (exit).
 */
export type Walk = 'none' | 'slow' | 'normal' | 'patrol' | 'enter' | 'exit'

/** One mood's animation, plain data a surface module plays: frames of pixel rows, a palette, a pace. */
export type CompanionAnimation = {
  mood: Mood
  /** Frames, each 10 rows of palette letters ('.' is see-through), facing right. */
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
  l: '#EBA084',
  d: '#A9553A',
  k: '#2A1B16',
  w: '#F4EFE6',
  b: '#6FA8F5',
  g: '#9A9AA0',
  y: '#F2C14E',
  r: '#E5603F',
  p: '#F0A08C',
}

/** The same creature, faded: the cache is about to lapse. */
const DIM_PALETTE: Record<string, string> = { ...PALETTE, o: '#B47A66', l: '#C79A88', d: '#8C5A48' }

/** Sprite size in pixels: 18 wide (the creature is 14, props reach further), 10 tall: five terminal rows. */
export const SPRITE_W = 18
export const SPRITE_H = 10

// ---------------------------------------------------------------------------
// The sprite, composed: a pose, a pair of eyes, and props. Facing right.

type Pose = 'stand' | 'step' | 'stride' | 'sit' | 'hop' | 'lie'
type Eyes = 'open' | 'blink' | 'closed' | 'focus' | 'left' | 'up' | 'front' | 'wide' | 'tired'
type Prop = 'magnifier' | 'fireA' | 'fireB' | 'note' | 'sweatA' | 'sweatB' | 'armUp' | 'spark' | 'smile' | 'gasp' | 'blush'

/**
 * The body, eight rows from the ear tips down: two pointed ears, a round
 * head-body with a highlight, stubby arms on the sixth row, a shaded base.
 * Fourteen pixels wide; props reach to eighteen.
 */
const BODY = [
  '...o......o...',
  '...oo....oo...',
  '..oooooooooo..',
  '.oolloooooooo.',
  '.oooooooooooo.',
  'dooooooooooood',
  '.oooooooooooo.',
  '..dddddddddd..',
]
const FEET: Record<'stand' | 'step' | 'stride', string> = { stand: '..dd......dd..', step: '...dd....dd...', stride: '.dd........dd.' }
/** Asleep: lying flat, ears down, eyes closed, facing you. */
const LIE = ['....oo....oo..', '..oooooooooo..', '.oooooooooooo.', 'ooooddooddoooo', '.dddddddddddd.']

/** Eye pixels in body rows (4 and 5 are the eye rows), facing right: two by two, a glint top left. */
const EYES: Record<Eyes, [number, number, string][]> = {
  open: [[4, 7, 'w'], [4, 8, 'k'], [5, 7, 'k'], [5, 8, 'k'], [4, 10, 'w'], [4, 11, 'k'], [5, 10, 'k'], [5, 11, 'k']],
  blink: [[5, 7, 'k'], [5, 8, 'k'], [5, 10, 'k'], [5, 11, 'k']],
  closed: [[5, 7, 'd'], [5, 8, 'd'], [5, 10, 'd'], [5, 11, 'd']],
  focus: [[4, 7, 'd'], [4, 8, 'd'], [5, 7, 'k'], [5, 8, 'k'], [4, 10, 'd'], [4, 11, 'd'], [5, 10, 'k'], [5, 11, 'k']],
  left: [[4, 2, 'w'], [4, 3, 'k'], [5, 2, 'k'], [5, 3, 'k'], [4, 5, 'w'], [4, 6, 'k'], [5, 5, 'k'], [5, 6, 'k']],
  up: [[3, 7, 'w'], [3, 8, 'k'], [4, 7, 'k'], [4, 8, 'k'], [3, 10, 'w'], [3, 11, 'k'], [4, 10, 'k'], [4, 11, 'k']],
  front: [[4, 4, 'w'], [4, 5, 'k'], [5, 4, 'k'], [5, 5, 'k'], [4, 8, 'w'], [4, 9, 'k'], [5, 8, 'k'], [5, 9, 'k']],
  wide: [[4, 7, 'w'], [4, 8, 'w'], [5, 7, 'w'], [5, 8, 'k'], [4, 10, 'w'], [4, 11, 'w'], [5, 10, 'w'], [5, 11, 'k']],
  tired: [[4, 7, 'd'], [4, 8, 'd'], [5, 7, 'k'], [5, 8, 'd'], [4, 10, 'd'], [4, 11, 'd'], [5, 10, 'k'], [5, 11, 'd']],
}

/** Props as pixels [row, col, letter] of a standing Kit's frame, drawn over the body. */
const PROPS: Record<Prop, [number, number, string][]> = {
  // A magnifying glass held up in front: the lens, a blue glint, the handle down to the arm.
  magnifier: [[5, 15, 'g'], [6, 14, 'g'], [6, 15, 'b'], [6, 16, 'g'], [7, 15, 'g'], [7, 14, 'd']],
  // A small fire on the ground ahead, two flickers, on its logs.
  fireA: [[6, 16, 'y'], [7, 15, 'r'], [7, 16, 'y'], [7, 17, 'r'], [8, 16, 'r'], [9, 15, 'd'], [9, 16, 'd'], [9, 17, 'd']],
  fireB: [[6, 15, 'y'], [7, 15, 'y'], [7, 16, 'r'], [7, 17, 'y'], [8, 16, 'y'], [9, 15, 'd'], [9, 16, 'd'], [9, 17, 'd']],
  // The handoff notes, a little stack carried on its head between the ears.
  note: [[0, 5, 'g'], [0, 6, 'w'], [0, 7, 'w'], [0, 8, 'g'], [1, 5, 'g'], [1, 6, 'w'], [1, 7, 'w'], [1, 8, 'g']],
  sweatA: [[3, 13, 'b']],
  sweatB: [[4, 13, 'b']],
  // The front arm raised, mid-task, with a spark where it lands.
  armUp: [[6, 13, '.'], [5, 13, 'd']],
  spark: [[4, 14, 'y']],
  smile: [[7, 9, 'd'], [7, 8, 'p'], [7, 12, 'p']],
  gasp: [[7, 9, 'k']],
  blush: [[7, 6, 'p'], [7, 12, 'p']],
}

/** Props that stand on the ground rather than move with the body. */
const GROUNDED = new Set<Prop>(['fireA', 'fireB'])

/** One frame: the pose placed in the sprite, its eyes and props drawn over it. */
export function frame(pose: Pose, eyes: Eyes = 'open', props: readonly Prop[] = []): string[] {
  const grid = Array.from({ length: SPRITE_H }, () => Array.from({ length: SPRITE_W }, () => '.'))
  const put = (row: number, col: number, letter: string) => {
    if (row >= 0 && row < SPRITE_H && col >= 0 && col < SPRITE_W) grid[row]![col] = letter
  }
  const draw = (rows: readonly string[], top: number) => rows.forEach((line, r) => [...line].forEach((c, x) => c !== '.' && put(top + r, x, c)))
  if (pose === 'lie') {
    draw(LIE, SPRITE_H - LIE.length)
    for (const p of props) for (const [r, x, c] of PROPS[p]) put(r, x, c)
    return grid.map(row => row.join(''))
  }
  // Where the ear tips sit: standing on its feet, sitting low on its base, or in the air.
  const top = pose === 'sit' ? 2 : pose === 'hop' ? 0 : 1
  draw(BODY, top)
  for (const [r, x, c] of EYES[eyes]) put(top + r, x, c)
  if (pose === 'hop') draw([FEET.stand], top + BODY.length)
  else if (pose !== 'sit') draw([FEET[pose]], top + BODY.length)
  // Props are placed for a standing Kit and move with its body; a fire stays on the ground.
  for (const p of props) for (const [r, x, c] of PROPS[p]) put(GROUNDED.has(p) ? r : r + top - 1, x, c)
  return grid.map(row => row.join(''))
}

const ORANGE = '#D97757'
const YELLOW = '#F2C14E'
const BLUE = '#6FA8F5'
const GREY = '#8E8E93'
const AMBER = '#F2A33A'

const at = (text: string, color: string) => ({ text, color })
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'].map(t => at(t, BLUE))

type MoodSpec = Omit<CompanionAnimation, 'mood' | 'palette'> & { palette?: Record<string, string> }

const sit = (eyes: Eyes = 'open', props: Prop[] = []) => frame('sit', eyes, props)
const stand = (eyes: Eyes = 'open', props: Prop[] = []) => frame('stand', eyes, props)
const step = (eyes: Eyes = 'open', props: Prop[] = []) => frame('step', eyes, props)

const ANIMATIONS: Record<Mood, MoodSpec> = {
  // Sitting quietly: a blink now and then, a glance back, a look at you.
  idle: {
    frames: [sit(), sit(), sit(), sit(), sit('blink'), sit(), sit(), sit(), sit('left'), sit('left'), sit(), sit(), sit(), sit('front', ['blush']), sit('front', ['blush']), sit()],
    fps: 2,
    walk: 'none',
    bubbles: [],
    caption: 'Kit sits by, waiting for the next turn',
  },
  // Pacing back and forth, looking up, stopping now and then to think.
  think: { frames: [stand('up'), step('up'), stand('up'), step('up')], fps: 3, walk: 'patrol', bubbles: [at('.', GREY), at('..', GREY), at('...', GREY), at('..', GREY)], caption: 'Kit paces while Claude thinks' },
  // Busy in one place: the arm going up and down, a spark as it lands.
  work: { frames: [stand('focus'), stand('focus', ['armUp']), stand('focus', ['spark']), stand('focus', ['armUp'])], fps: 4, walk: 'none', bubbles: [], caption: 'Kit works away while Claude works' },
  // Looking about with a magnifying glass.
  search: { frames: [stand('open', ['magnifier']), step('open', ['magnifier']), stand('up', ['magnifier']), step('open', ['magnifier'])], fps: 3, walk: 'slow', bubbles: [], caption: 'Kit searches while Claude reads' },
  // Sitting up and watching the check run.
  test: { frames: [sit('up'), sit('up'), sit('up'), sit('blink')], fps: 4, walk: 'none', bubbles: SPINNER, caption: 'Kit watches the check run' },
  // Little hops at a green finish.
  celebrate: { frames: [frame('hop', 'open', ['smile']), stand('open', ['smile']), frame('hop', 'blink', ['smile']), stand('open', ['smile'])], fps: 4, walk: 'none', bubbles: [at('✦', YELLOW), at('+', ORANGE), at('✦', ORANGE), at('+', YELLOW)], caption: 'Kit celebrates a green finish' },
  // Startled by a failure, a bead of sweat running down.
  worried: { frames: [stand('wide', ['gasp', 'sweatA']), stand('wide', ['gasp', 'sweatB'])], fps: 2, walk: 'none', bubbles: [at('!', AMBER), at('!', AMBER)], caption: 'Kit is worried: something failed' },
  // Sitting, facing you, a question mark: the run needs you, or waits for a result.
  waiting: { frames: [sit('front', ['blush']), sit('front', ['blush']), sit('front', ['blush']), sit('blink', ['blush'])], fps: 1, walk: 'none', bubbles: [at('?', ORANGE)], caption: 'Kit waits: the run needs you, or a result' },
  // Carrying the notes off to the fresh context.
  handoff: { frames: [stand('open', ['note']), step('open', ['note'])], fps: 4, walk: 'exit', bubbles: [], caption: 'Kit carries the handoff notes to the fresh context' },
  // Walking back in with the fresh context.
  wake: { frames: [stand(), step(), stand(), step()], fps: 4, walk: 'enter', bubbles: [at('!', YELLOW), at('', YELLOW)], caption: 'Kit is back for the fresh context' },
  sleepy: { frames: [sit('closed'), sit('closed'), sit('blink'), sit('closed')], fps: 1, walk: 'none', bubbles: [at('z', GREY), at('', GREY), at('', GREY), at('', GREY)], caption: 'Kit is getting sleepy' },
  // The cache is about to lapse: dozing, and fading with it.
  dim: { frames: [sit('closed'), sit('closed'), sit('closed'), sit('blink')], fps: 1, walk: 'none', bubbles: [at('z', GREY), at('', GREY), at('', GREY), at('', GREY)], caption: 'Kit dozes: the prompt cache is about to lapse', palette: DIM_PALETTE },
  sleep: { frames: [frame('lie', 'closed')], fps: 1, walk: 'none', bubbles: [at('z', GREY), at('Z', GREY), at('z', GREY), at('', GREY)], caption: 'Kit is asleep' },
  // Tending a small fire: Keep warm holds the cache while you are away.
  tend: { frames: [sit('open', ['fireA']), sit('open', ['fireB']), sit('blink', ['fireA']), sit('open', ['fireB'])], fps: 3, walk: 'none', bubbles: [], caption: 'Kit keeps the cache warm while you are away' },
  // Tired: the machine is busy or the context nearly full; slow, sweating.
  tired: { frames: [stand('tired', ['sweatA']), step('tired', ['sweatB'])], fps: 2, walk: 'slow', bubbles: [at('~', GREY)], caption: 'Kit is tired: the machine is busy or the context nearly full' },
}

/**
 * The animation of a mood. Reduced motion holds one frame still; a busy
 * machine plays it at two frames a second at most and stops walking; a
 * machine at its limit holds it still.
 */
export function animationOf(mood: Mood, options: { isReduced: boolean; isBusy: boolean; isStrained?: boolean }): CompanionAnimation {
  const a = ANIMATIONS[mood]
  const palette = a.palette ?? PALETTE
  if (options.isReduced || options.isStrained === true) {
    return { mood, palette, frames: [a.frames[0] ?? sit()], fps: 0, walk: 'none', bubbles: a.bubbles.slice(0, 1).filter(b => b.text !== ''), caption: a.caption }
  }
  if (options.isBusy) return { mood, palette, frames: a.frames, fps: Math.min(2, a.fps), walk: a.walk === 'normal' ? 'slow' : a.walk, bubbles: a.bubbles, caption: a.caption }
  return { mood, palette, frames: a.frames, fps: a.fps, walk: a.walk, bubbles: a.bubbles, caption: a.caption }
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
  /** Whether this context has had a turn yet. */
  hasTurned: boolean
  contextStartedAt: number | null
  /** The context's fill against the handoff point (or the window), 0–1+. */
  contextShare: number | null
  isKeepingWarm: boolean
  /** The run waits for the person or for a result (a question, a blocked or waiting milestone, a background job). */
  isWaiting?: boolean
  /** The machine is busy (a reading near or past its ceiling). */
  isBusy?: boolean
  /** The prompt cache will lapse soon with no refresh coming. */
  isCacheNear?: boolean
  /** Keep warm refreshed the cache in the last minute. */
  isRefreshing?: boolean
}

const HANDOFF_STATES = new Set(['requested', 'handoff', 'verifying', 'clearing', 'compacting', 'resuming'])

/** What Kit is doing, from what the run is doing. */
export function moodOf(m: MoodInput): Mood {
  if (HANDOFF_STATES.has(m.autopilotState)) return 'handoff'
  if (m.autopilotState === 'awaiting') return 'waiting'
  if (m.isWorking) {
    if (m.isCheckRunning) return 'test'
    if ((m.contextShare !== null && m.contextShare >= 0.9) || m.isBusy === true) return 'tired'
    if (m.source === 'thinking') return 'think'
    if (m.toolKind === 'read' || m.toolKind === 'search' || m.toolKind === 'web') return 'search'
    return 'work'
  }
  // A fresh context: Kit walks back in.
  if (!m.hasTurned) return m.contextStartedAt !== null && m.now - m.contextStartedAt < 60_000 ? 'wake' : 'idle'
  if (m.isFailing) return 'worried'
  if (m.isWaiting === true) return 'waiting'
  const idle = m.turnEndedAt === null ? 0 : m.now - m.turnEndedAt
  if (m.isGreen && idle < 90_000) return 'celebrate'
  if (m.isRefreshing === true) return 'tend'
  if (m.isCacheNear === true) return 'dim'
  if (idle >= 10 * 60_000 && m.isKeepingWarm) return 'tend'
  if (idle >= 30 * 60_000) return 'sleep'
  if (idle >= 10 * 60_000) return 'sleepy'
  if (m.isBusy === true) return 'tired'
  return 'idle'
}

/** A frame mirrored to face left. */
export const mirrored = (rows: readonly string[]): string[] => rows.map(r => [...r].reverse().join(''))

// ---------------------------------------------------------------------------
// Desktop: the same frames as an SVG that animates itself (SMIL), drawn as
// an image (transparent, no frame around it) in a short lane above the headline.

/** Desktop pixel size: each sprite pixel is 4 × 4 CSS pixels. */
const PX = 4

/** The lane: the sprite and room for a bubble above its head. */
export const LANE_H = SPRITE_H * PX + 8

function frameRects(rows: readonly string[], palette: Record<string, string>, dy: number): string {
  let out = ''
  rows.forEach((row, y) => {
    // Runs of one color in a row become one rect: fewer nodes, no hairline seams.
    let x = 0
    while (x < row.length) {
      const letter = row[x] ?? '.'
      const color = palette[letter]
      let end = x + 1
      while (end < row.length && row[end] === letter) end++
      if (color !== undefined) out += `<rect x="${x * PX}" y="${dy + y * PX}" width="${(end - x) * PX}" height="${PX}" fill="${color}"/>`
      x = end
    }
  })
  return out
}

/** The root style that keeps the drawing transparent on light and dark themes alike, in a frame as well. */
const TRANSPARENT = '<style>:root{color-scheme:light dark}</style>'

/**
 * Kit as SVG on a lane `width` pixels wide: each frame a group shown in turn,
 * the walk a glide (patrol back and forth with pauses, enter from the left,
 * exit to the right) and bubbles beside the head. One mood per drawing.
 */
export function svgCompanion(a: CompanionAnimation, width: number): string {
  const w = Math.max(120, Math.round(width))
  const h = LANE_H
  const spriteW = SPRITE_W * PX
  const top = h - 1 - SPRITE_H * PX
  const n = a.frames.length
  const dur = a.fps > 0 ? n / a.fps : 1
  const groups = (facing: 'right' | 'left') =>
    a.frames
      .map((f, i) => {
        const rows = facing === 'right' ? f : mirrored(f)
        const values = Array.from({ length: n }, (_, j) => (j === i ? 'inline' : 'none')).join(';')
        const anim = n > 1 && a.fps > 0 ? `<animate attributeName="display" values="${values}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"/>` : ''
        return `<g display="${i === 0 ? 'inline' : 'none'}">${anim}${frameRects(rows, a.palette, top)}</g>`
      })
      .join('')
  const bubble = (bx: number) => {
    const t = a.bubbles.length
    return a.bubbles
      .map((b, i) => {
        const values = Array.from({ length: t }, (_, j) => (j === i ? 'inline' : 'none')).join(';')
        const anim = t > 1 && a.fps > 0 ? `<animate attributeName="display" values="${values}" dur="${t / Math.max(1, a.fps)}s" calcMode="discrete" repeatCount="indefinite"/>` : ''
        return b.text === '' ? '' : `<text x="${bx}" y="${top + 9}" font-size="12" font-family="system-ui,sans-serif" font-weight="600" fill="${b.color}" display="${i === 0 ? 'inline' : 'none'}">${anim}${escapeXml(b.text)}</text>`
      })
      .join('')
  }
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${TRANSPARENT}<title>${escapeXml(a.caption)}</title>`
  const still = (x: number) => `<g transform="translate(${x} 0)">${groups('right')}${bubble(spriteW - 8)}</g>`
  const span = Math.max(1, w - spriteW - 24)
  // At rest it lines up with the band's left edge, over the headline's mark.
  const rest = 0
  if (a.fps === 0 || a.walk === 'none') return `${head}${still(rest)}</svg>`
  if (a.walk === 'enter' || a.walk === 'exit') {
    // Once across, then still: in from the left edge to its resting place, or from it off to the right.
    const [from, to] = a.walk === 'enter' ? [-spriteW, rest] : [rest, w + 8]
    const secs = (Math.abs(to - from) / 30).toFixed(2)
    return `${head}<g><animateTransform attributeName="transform" type="translate" values="${from} 0;${to} 0" dur="${secs}s" fill="freeze" repeatCount="1"/>${groups('right')}${bubble(spriteW - 8)}</g></svg>`
  }
  // Back and forth across the lane, facing the way it goes; a patrol stops at each end to think.
  const speed = a.walk === 'normal' ? 24 : 12
  const leg = span / speed
  const pause = a.walk === 'patrol' ? 2.5 : 0
  const total = 2 * (leg + pause)
  const k = (t: number) => (t / total).toFixed(4)
  const keyTimes = `0;${k(leg)};${k(leg + pause)};${k(2 * leg + pause)};1`
  const right = `<g><animate attributeName="display" values="inline;none" keyTimes="0;${k(leg + pause)}" dur="${total.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>${groups('right')}${bubble(spriteW - 8)}</g>`
  const left = `<g display="none"><animate attributeName="display" values="none;inline" keyTimes="0;${k(leg + pause)}" dur="${total.toFixed(2)}s" calcMode="discrete" repeatCount="indefinite"/>${groups('left')}${bubble(2)}</g>`
  return (
    `${head}<g><animateTransform attributeName="transform" type="translate" values="12 0;${(12 + span).toFixed(1)} 0;${(12 + span).toFixed(1)} 0;12 0;12 0" keyTimes="${keyTimes}" dur="${total.toFixed(2)}s" repeatCount="indefinite"/>${right}${left}</g>` +
    `</svg>`
  )
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
