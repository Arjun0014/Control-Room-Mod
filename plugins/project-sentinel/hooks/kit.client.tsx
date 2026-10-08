/**
 * Kit, the companion: one surface module, drawn in the terminal and on Desktop.
 *
 * The hooks module hands it plain props (features/companion.ts): the mood the run is in, the
 * calm switches, and a few one-shot signals as values to compare with what it last saw (a
 * milestone done, a green finish, a failure, a Keep warm refresh). Everything Kit does between
 * two redraws of the status bar happens here, on the surface's own frame clock: a small
 * behaviour model (the act it is in, a queue of acts, a settled mood) decides what Kit does
 * next, and two renderers draw the pose it is in: half-block pixels in the terminal (20 × 10),
 * and on Desktop an SVG image per frame (40 × 24 art pixels at 3 CSS pixels each, shaded and
 * outlined), in a lane above the headline.
 *
 * Never a jump: Kit's place changes only by walking, its facing only through a turn frame, and
 * it sits, stands and lies down only through transition frames. A mood change applies once it
 * has held for a moment (at once for a handoff, a finish, a failure, a question, a fresh
 * context), so a flicker between tool calls restarts nothing. Reduce motion and a strained
 * machine hold one still pose; a busy machine draws two frames a second at most and never walks.
 *
 * A touch is a reaction (a purr, a hop, a spin, a blush, an ear flick, a nose boop, a roll for a
 * belly rub, a high five; never the same twice in a row); many touches make it dizzy; a sleeping
 * Kit is startled; while Claude works it only looks up. Kit never opens anything: the status
 * bar's button does that.
 *
 * Self-contained: it runs on the drawing thread, without `$`. The model and the renderers are
 * pure functions over plain data, exported for the tests.
 */

import type { ClientPointerEvent, ClientSurface, RenderElement } from 'claude-code'

import type { CompanionView, KitMood } from '../types'

export type KitProps = CompanionView & { surface: 'terminal' | 'desktop' }

// ---------------------------------------------------------------------------
// Units and pace
//
// The model counts in lane units: a terminal cell across (one art pixel), two art pixels on
// Desktop (six CSS pixels). Heights are half units: a terminal art pixel (half a row).

/** Kit's box across, in lane units: the body, the tail behind it and room for what it holds. */
export const KIT_W = 20

/** Moods that apply at once; the others wait until they have held for SETTLE_MS. */
const PRIORITY: ReadonlySet<KitMood> = new Set<KitMood>(['handoff', 'celebrate', 'worried', 'waiting', 'wake'])
export const SETTLE_MS = 1200
/** A settled mood holds at least this long before a non-priority mood replaces it. */
export const HOLD_MS = 2500
/** A reaction to a touch, at most one in this long. */
export const COOLDOWN_MS = 900
/** This many touches within TAP_WINDOW_MS make Kit dizzy. */
export const DIZZY_TAPS = 5
const TAP_WINDOW_MS = 5000

/** Walking paces, in lane units a second: slow on purpose (six CSS pixels a unit on Desktop). */
const PACE = { stroll: 3, pace: 1.6, magnify: 1.2, trudge: 1.1, enter: 4, exit: 4 } as const

/** A tick of the model: ten a second on Desktop, five in the terminal. */
export const TICK_MS: Record<KitProps['surface'], number> = { desktop: 100, terminal: 200 }
/** A busy machine: at most one new frame in this long. */
const BUSY_FRAME_MS = 500

// ---------------------------------------------------------------------------
// The model

export type Posture = 'stand' | 'sit' | 'down'

export type ActKind =
  // Moving between poses, and walking.
  | 'hold'
  | 'walk'
  | 'turn'
  | 'sitDown'
  | 'standUp'
  | 'lieDown'
  | 'getUp'
  | 'gone'
  // Idle.
  | 'stretch'
  | 'yawn'
  | 'scratch'
  | 'groom'
  | 'swish'
  | 'look'
  | 'watch'
  | 'butterfly'
  | 'pounce'
  | 'sneeze'
  | 'nod'
  // What the run is doing.
  | 'ponder'
  | 'type'
  | 'check'
  | 'read'
  | 'magnify'
  | 'watchTest'
  | 'dance'
  | 'happy'
  | 'startle'
  | 'facepalm'
  | 'sweat'
  | 'wait'
  | 'pickup'
  | 'nap'
  | 'doze'
  | 'tend'
  | 'poke'
  | 'fan'
  | 'stamp'
  | 'greet'
  // A touch.
  | 'purr'
  | 'hop'
  | 'spin'
  | 'blush'
  | 'earflick'
  | 'boop'
  | 'roll'
  | 'highfive'
  | 'startled'
  | 'glance'
  | 'notice'
  | 'dizzy'

export type WalkStyle = 'stroll' | 'pace' | 'magnify' | 'trudge' | 'enter' | 'exit' | 'stop'

/** One thing Kit does: how long, in which posture it ends, a walk's target and pace. */
export type Act = {
  kind: ActKind
  /** When it began, on Kit's clock (ms); set as it begins. */
  t0: number
  /** How long it lasts (ms); a walk lasts until it arrives. */
  dur: number
  /** The posture Kit is in at its end (and during it, but for the transitions). */
  posture: Posture
  to?: number
  speed?: number
  style?: WalkStyle
  /** Where a pounce set off from. */
  from?: number
  /** Which take of the act: a seed, so two in a row differ. */
  v: number
}

export type KitState = {
  /** Kit's clock (ms), moved on by each tick. */
  t: number
  seed: number
  /** The box's left edge, in lane units (negative while walking in from the left). */
  x: number
  facing: 1 | -1
  posture: Posture
  /** Walked off at a handoff, until the mood changes. */
  isGone: boolean
  act: Act
  queue: Act[]
  /** The settled mood, when it settled, and one waiting to. */
  mood: KitMood
  moodAt: number
  pending: KitMood | null
  pendingAt: number
  /** The lane's width in units, and where Kit rests when it has nowhere to be. */
  lane: number
  home: number
  /** Recent acts (no repeats), the reactions left in this round, the last one, the touches. */
  recent: ActKind[]
  bag: ActKind[]
  lastReaction: ActKind | null
  taps: number[]
  reactedAt: number
  dancedAt: number
  /** The signals as last seen: a change is a moment to mark. */
  seen: { done: number; greenAt: number | null; fails: number; refreshAt: number | null; context: number | null }
}

const TRANSITIONS: ReadonlySet<ActKind> = new Set<ActKind>(['turn', 'sitDown', 'standUp', 'lieDown', 'getUp'])
/** Acts that finish once begun: short, and cut midway they would jump. */
const UNBROKEN: ReadonlySet<ActKind> = new Set<ActKind>([...TRANSITIONS, 'gone', 'spin', 'dance', 'pounce', 'hop', 'startled', 'pickup', 'stamp'])
const REACTIONS: readonly ActKind[] = ['purr', 'hop', 'spin', 'blush', 'earflick', 'boop', 'roll', 'highfive']
const NAPS: ReadonlySet<ActKind> = new Set<ActKind>(['nap', 'doze', 'nod'])
const FOREVER = 1e12

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const maxX = (s: KitState): number => Math.max(0, s.lane - KIT_W)
export const isCalm = (p: KitProps): boolean => p.isReduced || p.isStrained

function copy(s: KitState): KitState {
  return { ...s, act: { ...s.act }, queue: s.queue.map(a => ({ ...a })), recent: [...s.recent], bag: [...s.bag], taps: [...s.taps], seen: { ...s.seen } }
}

/** Mulberry32: a small seeded generator, its state kept in the model. */
function rand(s: KitState): number {
  s.seed = (s.seed + 0x6d2b79f5) | 0
  let t = s.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (s: KitState, lo: number, hi: number): number => lo + (hi - lo) * rand(s)

function act(kind: ActKind, dur: number, posture: Posture, extra: Partial<Act> = {}): Act {
  return { kind, t0: 0, dur, posture, v: 0, ...extra }
}

/** The posture a mood is drawn in when Kit has just appeared or holds still. */
export function naturalPosture(mood: KitMood): Posture {
  if (mood === 'think' || mood === 'handoff') return 'stand'
  return mood === 'sleep' ? 'down' : 'sit'
}

function begin(s: KitState, a: Act): void {
  a.t0 = s.t
  a.v = Math.floor(rand(s) * 1e6)
  if (a.kind === 'pounce') a.from = s.x
  s.act = a
}

/** Where planning stands after the current act and the queue: posture, facing, place. */
type Cursor = { posture: Posture; facing: 1 | -1; x: number }

function endOf(c: Cursor, a: Act): void {
  c.posture = a.posture
  if (a.kind === 'turn') c.facing = c.facing === 1 ? -1 : 1
  if (a.kind === 'walk' && a.to !== undefined) c.x = a.to
  if (a.kind === 'pounce') c.x = (a.from ?? c.x) + 2.5 * c.facing
}

function cursorOf(s: KitState): Cursor {
  const c: Cursor = { posture: s.posture, facing: s.facing, x: s.x }
  endOf(c, s.act)
  for (const a of s.queue) endOf(c, a)
  return c
}

function push(s: KitState, c: Cursor, a: Act): void {
  s.queue.push(a)
  endOf(c, a)
}

/** The transitions from the cursor's posture to another: stand ⇄ sit ⇄ down, one step at a time. */
function toPosture(s: KitState, c: Cursor, want: Posture): void {
  for (let i = 0; i < 3 && c.posture !== want; i++) {
    if (c.posture === 'stand') push(s, c, act('sitDown', 260, 'sit'))
    else if (c.posture === 'down') push(s, c, act('getUp', 420, 'sit'))
    else push(s, c, want === 'stand' ? act('standUp', 260, 'stand') : act('lieDown', 520, 'down'))
  }
}

/** Turns to face `dir` (sitting up first: a curled-up Kit does not turn round where it lies). */
function face(s: KitState, c: Cursor, dir: number): void {
  if (dir === 0 || c.facing === Math.sign(dir)) return
  if (c.posture === 'down') toPosture(s, c, 'sit')
  push(s, c, act('turn', 220, c.posture))
}

/** Before an act with something in front of Kit (a keyboard, a book, a fire, a flag): face the open lane, not an edge close by. */
function faceOpen(s: KitState, c: Cursor): void {
  if (c.facing === -1 && c.x < 8) face(s, c, 1)
  else if (c.facing === 1 && c.x > maxX(s) - 8) face(s, c, -1)
}

function walkTo(s: KitState, c: Cursor, to: number, style: WalkStyle): void {
  const target = clamp(to, 0, maxX(s))
  if (Math.abs(target - c.x) < 0.75) return
  toPosture(s, c, 'stand')
  face(s, c, target - c.x)
  push(s, c, act('walk', 0, 'stand', { to: target, speed: PACE[style as keyof typeof PACE] ?? PACE.stroll, style }))
}

/**
 * Lets what Kit is doing end gracefully: a walk eases to a stop, a short act that would jump if
 * cut finishes, anything else ends now (its posture is Kit's posture, so the next act starts
 * from where it is). The queue is dropped.
 */
function interrupt(s: KitState): void {
  s.queue = []
  const a = s.act
  if (a.kind === 'walk') {
    if (a.style === 'enter' || a.style === 'exit' || a.style === 'stop') return
    const dir = Math.sign((a.to ?? s.x) - s.x) || s.facing
    begin(s, act('walk', 0, 'stand', { to: clamp(s.x + dir * 0.6, 0, maxX(s)), speed: (a.speed ?? PACE.stroll) / 2, style: 'stop' }))
    return
  }
  if (UNBROKEN.has(a.kind)) return
  a.dur = Math.max(0, s.t - a.t0)
}

/** Kit walks back in from the left edge: after a handoff, or as a fresh context begins. */
function reenter(s: KitState): void {
  s.isGone = false
  s.x = -KIT_W
  s.facing = 1
  s.posture = 'stand'
  s.queue = []
  begin(s, act('walk', 0, 'stand', { to: clamp(s.home, 0, maxX(s)), speed: PACE.enter, style: 'enter' }))
}

/** A new Kit: where it rests (or walking in from the left), settled in the props' mood. */
export function createKit(
  p: KitProps,
  o: { lane: number; home: number; seed: number; isEntering: boolean; x?: number; facing?: 1 | -1 },
): KitState {
  const s: KitState = {
    t: 0,
    seed: o.seed | 0,
    x: 0,
    facing: o.facing ?? 1,
    posture: naturalPosture(p.mood),
    isGone: false,
    act: act('hold', 0, naturalPosture(p.mood)),
    queue: [],
    mood: p.mood,
    moodAt: -HOLD_MS,
    pending: null,
    pendingAt: 0,
    lane: Math.max(KIT_W, o.lane),
    home: 0,
    recent: [],
    bag: [],
    lastReaction: null,
    taps: [],
    reactedAt: -COOLDOWN_MS,
    dancedAt: -FOREVER,
    seen: { done: p.done, greenAt: p.greenAt, fails: p.fails, refreshAt: p.refreshAt, context: p.contextStartedAt },
  }
  s.home = clamp(o.home, 0, maxX(s))
  s.x = clamp(o.x ?? s.home, 0, maxX(s))
  if (o.isEntering && !isCalm(p)) {
    reenter(s)
    const c = cursorOf(s)
    push(s, c, act('greet', 2000, 'stand'))
  } else begin(s, act('hold', 500 + Math.floor(rand(s) * 700), s.posture))
  return s
}

/** The lane changed width: Kit stays where it is, within the lane. */
export function resizeKit(prev: KitState, lane: number, home: number): KitState {
  const s = copy(prev)
  s.lane = Math.max(KIT_W, lane)
  s.home = clamp(home, 0, maxX(s))
  const inLane = (n: number) => clamp(n, 0, maxX(s))
  const isOff = s.act.kind === 'walk' && (s.act.style === 'enter' || s.act.style === 'exit')
  if (!s.isGone && !isOff) s.x = inLane(s.x)
  // Walks stay in the lane; a walk off to the right ends just past its new edge (or where Kit already is).
  const fit = (a: Act) => {
    if (a.kind !== 'walk' || a.to === undefined) return
    a.to = a.style === 'exit' ? Math.max(Math.min(a.to, s.lane + 2), a === s.act ? s.x : -KIT_W) : a.style === 'enter' ? s.home : inLane(a.to)
  }
  fit(s.act)
  s.queue.forEach(fit)
  return s
}

/** One tick of Kit's clock: the mood settles, signals become moments, the act moves on. */
export function stepKit(prev: KitState, p: KitProps, dt: number): KitState {
  const s = copy(prev)
  s.t += dt
  s.taps = s.taps.filter(t => s.t - t < TAP_WINDOW_MS)
  if (isCalm(p)) {
    holdStill(s, p)
    return s
  }
  settle(s, p)
  signals(s, p)
  if (p.isBusy && s.act.kind === 'walk' && s.act.style !== 'enter' && s.act.style !== 'exit' && s.act.style !== 'stop') interrupt(s)
  advance(s, p, dt)
  return s
}

/** Reduce motion, a strained machine: the props' mood at once, one pose, nowhere to walk. */
function holdStill(s: KitState, p: KitProps): void {
  s.mood = p.mood
  s.moodAt = s.t
  s.pending = null
  s.seen = { done: p.done, greenAt: p.greenAt, fails: p.fails, refreshAt: p.refreshAt, context: p.contextStartedAt }
  s.isGone = false
  s.x = clamp(s.x, 0, maxX(s))
  s.posture = naturalPosture(p.mood)
  s.queue = []
  if (s.act.kind !== 'hold' || s.act.posture !== s.posture) begin(s, act('hold', 400, s.posture))
}

function settle(s: KitState, p: KitProps): void {
  const want = p.mood
  if (want === s.mood) {
    s.pending = null
    return
  }
  if (PRIORITY.has(want)) return switchMood(s, p, want)
  if (s.pending !== want) {
    s.pending = want
    s.pendingAt = s.t
    return
  }
  if (s.t - s.pendingAt >= SETTLE_MS && s.t - s.moodAt >= HOLD_MS) switchMood(s, p, want)
}

function switchMood(s: KitState, p: KitProps, mood: KitMood): void {
  s.mood = mood
  s.moodAt = s.t
  s.pending = null
  if (s.isGone) {
    if (mood !== 'handoff') reenter(s)
    return
  }
  interrupt(s)
  const c = cursorOf(s)
  if (mood === 'celebrate' && s.t - s.dancedAt > 10_000) {
    toPosture(s, c, 'stand')
    push(s, c, act('dance', 2600, 'stand'))
    s.dancedAt = s.t
  } else if (mood === 'worried') {
    push(s, c, act('startle', 650, c.posture === 'down' ? 'down' : c.posture))
    toPosture(s, c, 'sit')
    push(s, c, act('facepalm', 1700, 'sit'))
  }
}

/** One-shot signals: a milestone done (a flag), a green finish (a dance), a failure, a refresh. */
function signals(s: KitState, p: KitProps): void {
  const seen = s.seen
  const moments: ActKind[] = []
  if (p.contextStartedAt !== seen.context) {
    seen.context = p.contextStartedAt
    if (p.isFresh && p.contextStartedAt !== null) {
      if (s.isGone) reenter(s)
      else if (s.mood !== 'handoff') moments.push('greet')
    }
  }
  if (p.done > seen.done) moments.push('stamp')
  seen.done = p.done
  if (p.greenAt !== seen.greenAt) {
    if (p.greenAt !== null && s.t - s.dancedAt > 3000) moments.push('dance')
    seen.greenAt = p.greenAt
  }
  if (p.fails > seen.fails) moments.push('facepalm')
  seen.fails = p.fails
  if (p.refreshAt !== seen.refreshAt) {
    if (p.refreshAt !== null) moments.push('poke')
    seen.refreshAt = p.refreshAt
  }
  if (moments.length === 0 || s.isGone || s.mood === 'handoff') return
  // A mood that changed on this tick has planned its own start (a failure's startle): the moments follow it.
  if (s.moodAt !== s.t) interrupt(s)
  const c = cursorOf(s)
  for (const kind of moments) {
    if (s.queue.some(a => a.kind === kind)) continue
    if (kind === 'stamp' || kind === 'dance' || kind === 'greet') {
      toPosture(s, c, 'stand')
      if (kind === 'stamp') faceOpen(s, c)
      push(s, c, act(kind, kind === 'dance' ? 2600 : kind === 'stamp' ? 2600 : 2000, 'stand'))
      if (kind === 'dance') s.dancedAt = s.t
    } else {
      toPosture(s, c, 'sit')
      if (kind === 'poke') faceOpen(s, c)
      push(s, c, act(kind, kind === 'poke' ? 1500 : 1700, 'sit'))
    }
  }
}

/** Where a pounce has carried Kit, by its time: a crouch, a leap two and a half units on, a landing. */
function pounceX(s: KitState, a: Act): number {
  const e = s.t - a.t0
  const u = clamp((e - 900) / 500, 0, 1)
  const eased = u * u * (3 - 2 * u)
  return clamp((a.from ?? s.x) + s.facing * 2.5 * eased, 0, maxX(s))
}

function advance(s: KitState, p: KitProps, dt: number): void {
  let left = dt
  for (let i = 0; i < 4; i++) {
    const a = s.act
    // Walked off at a handoff: gone until the mood moves on (even while it was still walking), then a fresh Kit walks in.
    if (a.kind === 'gone') {
      if (s.mood !== 'handoff') reenter(s)
      return
    }
    if (a.kind === 'walk') {
      const to = a.to ?? s.x
      const speed = a.speed ?? PACE.stroll
      const reach = (speed * left) / 1000
      const dist = Math.abs(to - s.x)
      if (dist > reach) {
        s.x += Math.sign(to - s.x) * reach
        return
      }
      s.x = to
      left = Math.max(0, left - (dist / speed) * 1000)
      finish(s, p)
      // Off the lane: gone for a frame at least before anything walks back in.
      if (s.isGone) return
      continue
    }
    if (a.kind === 'pounce') s.x = pounceX(s, a)
    if (s.t - a.t0 < a.dur) return
    finish(s, p)
  }
}

function finish(s: KitState, p: KitProps): void {
  const a = s.act
  s.posture = a.posture
  if (a.kind === 'turn') s.facing = s.facing === 1 ? -1 : 1
  if (a.kind === 'walk' && a.style === 'exit') {
    s.isGone = true
    s.queue = []
    begin(s, act('gone', FOREVER, 'stand'))
    return
  }
  if (!TRANSITIONS.has(a.kind) && a.kind !== 'walk') s.recent = [a.kind, ...s.recent].slice(0, 3)
  // A placeholder while the next act is chosen, so planning starts from where Kit is now.
  s.act = { ...act('hold', 0, s.posture), t0: s.t, v: a.v }
  const queued = s.queue.shift()
  if (queued !== undefined) return begin(s, queued)
  program(s, p)
  begin(s, s.queue.shift() ?? act('hold', 1500, s.posture))
}

// ---------------------------------------------------------------------------
// What Kit does next, by mood

type Option = [ActKind, number]

/** Picks by weight, never what Kit did last (a hold may follow anything). */
function choose(s: KitState, options: readonly Option[]): ActKind {
  const last = s.recent[0]
  const usable = options.filter(([k, w]) => w > 0 && (k === 'hold' || (k !== last && !(s.recent[1] === k && k !== 'type'))))
  const total = usable.reduce((n, [, w]) => n + w, 0)
  let r = rand(s) * total
  for (const [k, w] of usable) {
    r -= w
    if (r <= 0) return k
  }
  return usable[usable.length - 1]?.[0] ?? 'hold'
}

const hold = (s: KitState, c: Cursor, lo: number, hi: number): void => push(s, c, act('hold', Math.round(between(s, lo, hi)), c.posture))

/** Fills the queue with what Kit does next in its settled mood. */
function program(s: KitState, p: KitProps): void {
  const c = cursorOf(s)
  const isBusy = p.isBusy
  const last = s.recent[0]
  switch (s.mood) {
    case 'idle':
    case 'wake': {
      // Calm first: anything lively is followed by sitting still a while.
      const isNight = p.hour >= 22 || p.hour < 6
      const kind =
        last !== undefined && last !== 'hold'
          ? 'hold'
          : choose(s, [
              ['hold', 5],
              ['yawn', isNight ? 3 : 0.8],
              ['stretch', 1],
              ['scratch', 1],
              ['groom', 1],
              ['swish', 1],
              ['look', 1.2],
              ['watch', 1],
              ['walk', isBusy ? 0 : 1.6],
              ['butterfly', isBusy ? 0 : 0.25],
              ['pounce', isBusy ? 0 : 0.25],
              ['sneeze', 0.2],
            ])
      if (kind === 'walk') {
        const span = maxX(s)
        let to = between(s, 0, span)
        if (Math.abs(to - c.x) < 4) to = c.x + (c.x < span / 2 ? 6 : -6)
        walkTo(s, c, to, 'stroll')
        toPosture(s, c, 'sit')
        return hold(s, c, 2000, 3500)
      }
      if (kind === 'stretch' || kind === 'butterfly') {
        toPosture(s, c, 'stand')
        push(s, c, act(kind, kind === 'stretch' ? 1700 : 4200, 'stand'))
        return toPosture(s, c, 'sit')
      }
      if (kind === 'pounce') {
        toPosture(s, c, 'sit')
        // Room to land: otherwise it turns toward the middle first.
        if (c.x + c.facing * 3 < 0 || c.x + c.facing * 3 > maxX(s)) face(s, c, maxX(s) / 2 - c.x)
        return push(s, c, act('pounce', 2600, 'sit'))
      }
      toPosture(s, c, c.posture === 'down' ? 'sit' : c.posture)
      if (kind === 'hold') return hold(s, c, 2500, 5000)
      const DUR: Partial<Record<ActKind, number>> = { yawn: 1700, scratch: 1600, groom: 2000, swish: 2200, look: 2600, watch: 2600, sneeze: 1300 }
      return push(s, c, act(kind, DUR[kind] ?? 2000, c.posture))
    }
    case 'think': {
      if (isBusy) {
        toPosture(s, c, 'sit')
        return push(s, c, act('ponder', Math.round(between(s, 2200, 3400)), 'sit'))
      }
      if (last !== 'ponder') {
        toPosture(s, c, 'stand')
        return push(s, c, act('ponder', Math.round(between(s, 1600, 2800)), 'stand'))
      }
      // Pacing: a few units one way, back toward the middle of the lane at its ends.
      const span = maxX(s)
      const dir = c.x <= 1 ? 1 : c.x >= span - 1 ? -1 : rand(s) < 0.5 ? -c.facing : c.facing
      return walkTo(s, c, c.x + dir * between(s, 3, 6), 'pace')
    }
    case 'work': {
      toPosture(s, c, 'sit')
      faceOpen(s, c)
      if (last === 'type' && rand(s) < 0.4) return push(s, c, act('check', 1300, 'sit'))
      return push(s, c, act('type', Math.round(between(s, 3000, 6000)), 'sit'))
    }
    case 'search': {
      if (!isBusy && last !== 'magnify' && rand(s) < 0.4) {
        const span = maxX(s)
        const dir = c.x <= 1 ? 1 : c.x >= span - 1 ? -1 : c.facing
        walkTo(s, c, c.x + dir * between(s, 2, 4), 'magnify')
        toPosture(s, c, 'stand')
        return push(s, c, act('magnify', 1400, 'stand'))
      }
      toPosture(s, c, 'sit')
      faceOpen(s, c)
      return push(s, c, act('read', Math.round(between(s, 3000, 5000)), 'sit'))
    }
    case 'test':
      toPosture(s, c, 'sit')
      return push(s, c, act('watchTest', Math.round(between(s, 2500, 4000)), 'sit'))
    case 'celebrate':
      toPosture(s, c, 'sit')
      return push(s, c, act('happy', Math.round(between(s, 2500, 4000)), 'sit'))
    case 'worried':
      toPosture(s, c, 'sit')
      return push(s, c, last === 'sweat' && rand(s) < 0.5 ? act('facepalm', 1700, 'sit') : act('sweat', Math.round(between(s, 2000, 3000)), 'sit'))
    case 'waiting':
      toPosture(s, c, 'sit')
      return push(s, c, act('wait', Math.round(between(s, 2500, 4000)), 'sit'))
    case 'handoff': {
      // Pick up the notes, face the way out, walk off to the right.
      toPosture(s, c, 'stand')
      push(s, c, act('pickup', 700, 'stand'))
      face(s, c, 1)
      return push(s, c, act('walk', 0, 'stand', { to: s.lane + 2, speed: PACE.exit, style: 'exit' }))
    }
    case 'sleepy':
      toPosture(s, c, 'sit')
      return push(s, c, last === 'nod' && rand(s) < 0.4 ? act('yawn', 1700, 'sit') : act('nod', Math.round(between(s, 3000, 4500)), 'sit'))
    case 'sleep':
      toPosture(s, c, 'down')
      return push(s, c, act('nap', Math.round(between(s, 8000, 14_000)), 'down'))
    case 'dim':
      toPosture(s, c, 'sit')
      return push(s, c, act('doze', Math.round(between(s, 4000, 7000)), 'sit'))
    case 'tend':
      toPosture(s, c, 'sit')
      faceOpen(s, c)
      return push(s, c, last === 'tend' && rand(s) < 0.35 ? act('poke', 1500, 'sit') : act('tend', Math.round(between(s, 3000, 5000)), 'sit'))
    case 'tired': {
      if (!isBusy && last !== 'walk' && rand(s) < 0.15) {
        const span = maxX(s)
        walkTo(s, c, c.x + (c.x < span / 2 ? 1 : -1) * between(s, 2, 4), 'trudge')
      }
      toPosture(s, c, 'sit')
      if (last !== 'fan') faceOpen(s, c)
      return push(s, c, last === 'fan' ? act('hold', Math.round(between(s, 2000, 3000)), 'sit') : act('fan', Math.round(between(s, 2500, 3500)), 'sit'))
    }
  }
}

// ---------------------------------------------------------------------------
// Touch

/** A touch at `x` (lane units): on Kit, a reaction; elsewhere in the lane while it idles, a look. */
export function touchKit(prev: KitState, p: KitProps, x: number): KitState {
  if (isCalm(p) || prev.isGone) return prev
  const s = copy(prev)
  const isOnKit = x >= s.x - 1 && x <= s.x + KIT_W + 1
  if (!isOnKit) {
    if (s.mood === 'idle' && !p.isBusy && s.t - s.reactedAt >= COOLDOWN_MS) notice(s, x)
    return s
  }
  s.taps = [...s.taps.filter(t => s.t - t < TAP_WINDOW_MS), s.t]
  if (s.taps.length >= DIZZY_TAPS && s.act.kind !== 'dizzy') {
    s.taps = []
    react(s, 'dizzy')
    return s
  }
  if (s.t - s.reactedAt < COOLDOWN_MS) return s
  if (NAPS.has(s.act.kind) || s.posture === 'down') react(s, 'startled')
  else if (p.isWorking) react(s, 'glance')
  else react(s, nextReaction(s))
  return s
}

/** The next reaction from a shuffled round of all of them: every one before any repeats, never twice running. */
function nextReaction(s: KitState): ActKind {
  if (s.bag.length === 0) {
    const bag = [...REACTIONS]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1))
      ;[bag[i], bag[j]] = [bag[j]!, bag[i]!]
    }
    if (bag[0] === s.lastReaction) bag.push(bag.shift()!)
    s.bag = bag
  }
  return s.bag.shift() ?? 'purr'
}

const REACTION_MS: Partial<Record<ActKind, number>> = { purr: 1800, hop: 750, spin: 1600, blush: 1500, earflick: 800, boop: 900, roll: 2200, highfive: 1100, startled: 1300, glance: 900, dizzy: 2200 }

function react(s: KitState, kind: ActKind): void {
  interrupt(s)
  const c = cursorOf(s)
  const dur = REACTION_MS[kind] ?? 1000
  if (kind === 'roll') {
    toPosture(s, c, 'down')
    push(s, c, act('roll', dur, 'down'))
    toPosture(s, c, 'sit')
  } else if (kind === 'purr') {
    toPosture(s, c, 'sit')
    push(s, c, act('purr', dur, 'sit'))
  } else if (kind === 'startled') {
    push(s, c, act('startled', dur, c.posture))
  } else {
    if (c.posture === 'down') toPosture(s, c, 'sit')
    push(s, c, act(kind, dur, c.posture))
  }
  s.reactedAt = s.t
  if (REACTIONS.includes(kind)) s.lastReaction = kind
}

function notice(s: KitState, x: number): void {
  interrupt(s)
  const c = cursorOf(s)
  const center = c.x + KIT_W / 2
  if (c.posture === 'down') toPosture(s, c, 'sit')
  face(s, c, x - center)
  push(s, c, act('notice', 900, c.posture))
  if (rand(s) < 0.5) {
    walkTo(s, c, x - KIT_W / 2 - Math.sign(x - center) * 4, 'stroll')
    toPosture(s, c, 'sit')
  }
  s.reactedAt = s.t
}

// ---------------------------------------------------------------------------
// Poses: what is drawn, the same words for both surfaces

export type Body = 'stand' | 'walkA' | 'walkB' | 'sit' | 'crouch' | 'hop' | 'curl' | 'lie' | 'stretch' | 'roll' | 'front' | 'frontStand' | 'back'
export type Eyes = 'open' | 'blink' | 'closed' | 'happy' | 'wide' | 'up' | 'down' | 'back' | 'focus' | 'half' | 'dizzy' | 'squint'
export type Mouth = 'none' | 'smile' | 'open' | 'yawn' | 'gasp' | 'wavy' | 'blep' | 'cat'
export type Ears = 'up' | 'back' | 'flick' | 'perk' | 'droop'
export type Arms =
  | 'rest'
  | 'wave'
  | 'cheer'
  | 'typeA'
  | 'typeB'
  | 'face'
  | 'scratchA'
  | 'scratchB'
  | 'groom'
  | 'hold'
  | 'poke'
  | 'fanA'
  | 'fanB'
  | 'reach'
  | 'chin'
  | 'warm'
export type Prop = 'keyboard' | 'book' | 'bookFlip' | 'glasses' | 'magnifier' | 'notes' | 'fireA' | 'fireB' | 'fireC' | 'stick' | 'flag' | 'fan' | 'leaf'

export type Pose = {
  body: Body
  facing: 1 | -1
  eyes: Eyes
  mouth: Mouth
  ears: Ears
  /** The tail's swing, -1 (low) to 1 (high). */
  tail: number
  arms: Arms
  blush: boolean
  props: Prop[]
  /** Lifted off the ground (half units), and nudged along (units: a wiggle). */
  dy: number
  dx: number
  /** A breath in: Desktop draws the body a pixel fuller. */
  breath: boolean
}

export type ParticleKind = 'heart' | 'spark' | 'confetti' | 'z' | 'bigZ' | 'bang' | 'question' | 'dots' | 'note' | 'sweat' | 'star' | 'butterfly' | 'leaf' | 'bubble' | 'spinner' | 'ember'

/** Something drawn beside Kit: where (lane units across, half units up), which frame, which color. */
export type Particle = { kind: ParticleKind; x: number; y: number; frame: number; tone: number }

export type Drawable = { x: number; pose: Pose; particles: Particle[]; isGone: boolean; isDim: boolean; caption: string }

/** How high Kit's ear tips are above the ground, in half units, by body. */
const TOP: Record<Body, number> = { stand: 9, walkA: 9, walkB: 9, hop: 9, frontStand: 9, sit: 8, front: 8, back: 8, crouch: 7, curl: 5, lie: 6, stretch: 7, roll: 6 }
const SIDE: ReadonlySet<Body> = new Set<Body>(['stand', 'walkA', 'walkB', 'sit', 'crouch', 'hop', 'curl', 'lie', 'stretch', 'roll'])

const bodyOf = (posture: Posture): Body => (posture === 'stand' ? 'stand' : posture === 'sit' ? 'sit' : 'curl')
const beat = (e: number, ms: number): number => Math.floor(e / ms)
const alt = (e: number, ms: number): boolean => beat(e, ms) % 2 === 0
const isBlink = (t: number, v: number): boolean => (t + (v % 997)) % (3100 + (v % 5) * 260) < 150
const swing = (t: number, period: number): number => Math.sin((t / period) * Math.PI * 2)

function basePose(s: KitState): Pose {
  return {
    body: bodyOf(s.posture),
    facing: s.facing,
    eyes: isBlink(s.t, s.act.v) ? 'blink' : 'open',
    mouth: 'none',
    ears: 'up',
    tail: swing(s.t, 2600) * 0.6,
    arms: 'rest',
    blush: false,
    props: [],
    dy: 0,
    dx: 0,
    breath: swing(s.t, 2400) > 0.55,
  }
}

/** The front-facing body for the posture Kit is in. */
const frontOf = (posture: Posture): Body => (posture === 'stand' ? 'frontStand' : 'front')

/** The pose Kit is in, from the act and how far into it Kit is. */
export function poseOf(s: KitState, p: KitProps): Pose {
  const a = s.act
  const e = s.t - a.t0
  const o = basePose(s)
  const v = a.v
  switch (a.kind) {
    case 'hold': {
      // Now and then a glance: back over its shoulder, up, or at you.
      const look = v % 6
      const mid = e > 900 && e < 1900
      if (mid && look === 0) o.eyes = 'back'
      else if (mid && look === 1) o.eyes = 'up'
      else if (mid && look === 2 && s.posture !== 'down') o.body = frontOf(s.posture)
      if (s.mood === 'tired') o.eyes = 'half'
      if (s.mood === 'celebrate') {
        o.eyes = 'happy'
        o.mouth = 'smile'
      }
      if (s.mood === 'worried') o.mouth = 'wavy'
      if (s.posture === 'down') o.eyes = 'closed'
      return o
    }
    case 'walk': {
      if (a.style === 'stop') return o
      const stepMs = a.style === 'stroll' || a.style === 'enter' || a.style === 'exit' ? 220 : 320
      o.body = alt(e, stepMs) ? 'walkA' : 'walkB'
      o.tail = swing(s.t, 900) * 0.8
      if (a.style === 'magnify') {
        o.props = ['magnifier']
        o.arms = 'hold'
        o.eyes = 'down'
      } else if (a.style === 'exit') {
        o.props = ['notes']
        o.mouth = 'smile'
      } else if (a.style === 'trudge') {
        o.eyes = 'half'
        o.mouth = 'wavy'
      } else if (a.style === 'pace') o.eyes = isBlink(s.t, v) ? 'blink' : 'up'
      return o
    }
    case 'turn':
      o.body = s.posture === 'down' ? 'curl' : frontOf(s.posture)
      o.eyes = s.posture === 'down' ? 'closed' : 'open'
      return o
    case 'sitDown':
    case 'standUp':
      o.body = 'crouch'
      return o
    case 'lieDown':
    case 'getUp':
      o.body = 'lie'
      o.eyes = 'half'
      return o
    case 'gone':
      return o
    case 'stretch':
      if (e < 250 || e > 1450) o.body = 'crouch'
      else {
        o.body = 'stretch'
        o.eyes = 'closed'
        o.mouth = e > 500 && e < 1100 ? 'yawn' : 'cat'
        o.tail = 1
      }
      return o
    case 'yawn':
      if (e > 200 && e < 1300) {
        o.eyes = 'closed'
        o.mouth = 'yawn'
        o.ears = 'back'
      } else if (e >= 1300) o.eyes = 'half'
      return o
    case 'scratch':
      o.arms = alt(e, 160) ? 'scratchA' : 'scratchB'
      o.eyes = 'squint'
      o.ears = alt(e, 320) ? 'flick' : 'up'
      return o
    case 'groom':
      o.arms = beat(e, 380) % 3 === 2 ? 'rest' : 'groom'
      o.eyes = 'closed'
      o.mouth = alt(e, 380) ? 'blep' : 'none'
      return o
    case 'swish':
      o.eyes = e < 1800 ? 'back' : 'open'
      o.tail = swing(e, 700)
      return o
    case 'look':
      o.eyes = e < 800 ? 'up' : e < 1700 ? 'back' : isBlink(s.t, v) ? 'blink' : 'open'
      o.ears = e < 800 ? 'perk' : 'up'
      return o
    case 'watch':
      o.eyes = isBlink(s.t, v) ? 'blink' : 'down'
      return o
    case 'butterfly': {
      o.eyes = 'up'
      o.ears = 'perk'
      if ((e > 1500 && e < 1900) || (e > 2300 && e < 2700)) o.arms = 'reach'
      if (e > 2800 && e < 3300) {
        o.body = 'hop'
        o.dy = Math.round(2 * Math.sin(((e - 2800) / 500) * Math.PI))
        o.arms = 'reach'
      }
      if (e > 3500) o.mouth = 'smile'
      return o
    }
    case 'pounce':
      if (e < 900) {
        o.body = 'crouch'
        o.eyes = 'focus'
        o.ears = 'perk'
        o.tail = swing(e, 300)
      } else if (e < 1400) {
        o.body = 'hop'
        o.dy = Math.round(2 * Math.sin(((e - 900) / 500) * Math.PI))
        o.eyes = 'wide'
        o.arms = 'reach'
      } else if (e < 1600) o.body = 'crouch'
      else {
        o.eyes = 'happy'
        o.mouth = 'smile'
        o.props = ['leaf']
      }
      return o
    case 'sneeze':
      if (e < 500) {
        o.eyes = 'squint'
        o.mouth = 'open'
      } else if (e < 800) {
        o.eyes = 'closed'
        o.mouth = 'open'
        o.ears = 'back'
        o.dy = 1
      } else o.eyes = 'blink'
      return o
    case 'nod':
      o.eyes = beat(e, 900) % 3 === 2 ? 'closed' : 'half'
      o.ears = 'droop'
      return o
    case 'ponder':
      o.eyes = isBlink(s.t, v) ? 'blink' : 'up'
      if (a.posture === 'sit') o.arms = 'chin'
      return o
    case 'type': {
      const burst = beat(e, 1500) % 4 !== 3
      o.props = ['keyboard']
      o.arms = burst ? (alt(e, 140) ? 'typeA' : 'typeB') : 'typeA'
      o.eyes = burst ? 'down' : isBlink(s.t, v) ? 'blink' : 'focus'
      return o
    }
    case 'check':
      o.props = ['keyboard']
      o.eyes = e < 900 ? 'up' : 'blink'
      o.ears = 'perk'
      return o
    case 'read':
      o.props = beat(e, 1700) % 4 === 3 && e % 1700 < 250 ? ['bookFlip', 'glasses'] : ['book', 'glasses']
      o.arms = 'hold'
      o.eyes = isBlink(s.t, v) ? 'blink' : 'down'
      return o
    case 'magnify':
      o.props = ['magnifier']
      o.arms = 'hold'
      o.eyes = e < 1000 ? 'down' : 'wide'
      return o
    case 'watchTest':
      o.eyes = e % 2400 > 1700 ? 'back' : isBlink(s.t, v) ? 'blink' : 'up'
      o.tail = swing(s.t, 520)
      o.ears = 'perk'
      return o
    case 'dance': {
      // Beats: a hop, a landing, a turn to you and round, arms up, and once more.
      const b = beat(e, 200)
      const steps: Body[] = ['crouch', 'hop', 'stand', 'frontStand', 'stand', 'frontStand', 'stand', 'crouch', 'hop', 'stand', 'frontStand', 'stand', 'hop']
      o.body = steps[b % steps.length] ?? 'stand'
      // Round once on the fifth beat: you, the other way, you again.
      if (b % steps.length === 4) o.facing = s.facing === 1 ? -1 : 1
      if (o.body === 'hop') o.dy = 2
      o.arms = o.body === 'hop' || o.body === 'frontStand' ? 'cheer' : 'rest'
      o.eyes = 'happy'
      o.mouth = 'open'
      o.tail = swing(e, 400)
      return o
    }
    case 'happy':
      o.eyes = 'happy'
      o.mouth = 'smile'
      o.tail = swing(s.t, 1100)
      if (e % 1800 > 1500) o.dy = 1
      return o
    case 'startle':
      o.eyes = 'wide'
      o.mouth = 'gasp'
      o.ears = 'up'
      if (e < 220) o.dy = 1
      if (s.posture === 'down') o.body = 'curl'
      return o
    case 'facepalm':
      o.body = frontOf(s.posture === 'down' ? 'sit' : s.posture)
      o.arms = 'face'
      o.eyes = 'closed'
      o.ears = 'back'
      o.mouth = 'wavy'
      return o
    case 'sweat':
      o.eyes = alt(e, 700) ? 'wide' : 'half'
      o.mouth = 'wavy'
      o.ears = 'back'
      return o
    case 'wait':
      o.body = 'front'
      o.eyes = isBlink(s.t, v) ? 'blink' : 'open'
      o.ears = e % 2600 > 2300 ? 'flick' : 'up'
      o.blush = true
      return o
    case 'pickup':
      if (e < 250) o.body = 'crouch'
      else if (e < 500) {
        o.body = 'hop'
        o.dy = 1
      }
      if (e >= 250) o.props = ['notes']
      o.mouth = 'smile'
      return o
    case 'nap':
      o.body = 'curl'
      o.eyes = 'closed'
      o.ears = e % 5000 > 4700 ? 'flick' : 'up'
      o.tail = 0
      return o
    case 'doze':
      o.eyes = 'closed'
      o.ears = 'droop'
      return o
    case 'tend':
    case 'poke': {
      const flame = beat(s.t, 170) % 3
      o.props = [flame === 0 ? 'fireA' : flame === 1 ? 'fireB' : 'fireC']
      if (a.kind === 'poke') {
        o.props.push('stick')
        o.arms = alt(e, 250) ? 'poke' : 'hold'
        o.eyes = 'focus'
      } else {
        o.arms = 'warm'
        o.eyes = isBlink(s.t, v) ? 'blink' : 'happy'
      }
      return o
    }
    case 'fan':
      o.props = ['fan']
      o.arms = alt(e, 260) ? 'fanA' : 'fanB'
      o.eyes = 'half'
      o.mouth = 'wavy'
      return o
    case 'stamp':
      if (e < 300) o.body = 'crouch'
      else if (e < 650) {
        o.body = 'hop'
        o.dy = 2
        o.arms = 'cheer'
      } else {
        o.props = ['flag']
        o.eyes = 'happy'
        o.mouth = 'smile'
        o.arms = e < 1200 ? 'wave' : 'rest'
      }
      return o
    case 'greet':
      if (e < 1200) {
        o.body = e < 200 || e > 1000 ? 'crouch' : 'stretch'
        o.eyes = 'closed'
        o.mouth = e > 300 && e < 900 ? 'yawn' : 'none'
      } else {
        o.eyes = e < 1600 ? 'wide' : 'open'
        o.ears = 'perk'
      }
      return o
    case 'purr':
      o.eyes = 'happy'
      o.mouth = 'cat'
      o.blush = true
      o.tail = swing(s.t, 800)
      return o
    case 'hop':
      if (e < 150 || (e > 520 && e < 680)) o.body = 'crouch'
      else if (e <= 520) {
        o.body = 'hop'
        o.dy = Math.round(3 * Math.sin(((e - 150) / 370) * Math.PI))
      }
      o.eyes = 'happy'
      o.mouth = 'smile'
      return o
    case 'spin': {
      // Round twice: the side it faces, you, the far side, its back; at the end you again, then as it was.
      const b = beat(e, 200)
      const k = b % 4
      const isStanding = s.posture === 'stand'
      if (b >= 7 || k === 1) o.body = frontOf(s.posture)
      else if (k === 2) {
        o.facing = s.facing === 1 ? -1 : 1
        o.body = isStanding ? 'stand' : 'sit'
      } else if (k === 3) o.body = isStanding ? 'frontStand' : 'back'
      o.eyes = 'happy'
      o.dy = b < 7 ? 1 : 0
      return o
    }
    case 'blush':
      o.body = frontOf(s.posture)
      o.blush = true
      o.eyes = 'happy'
      o.mouth = 'smile'
      o.dx = e < 1100 && alt(e, 130) ? 0.5 : 0
      return o
    case 'earflick':
      o.ears = alt(e, 150) ? 'flick' : 'up'
      o.eyes = e < 300 ? 'blink' : 'open'
      return o
    case 'boop':
      o.body = frontOf(s.posture)
      o.eyes = e < 450 ? 'squint' : 'happy'
      o.mouth = e < 450 ? 'none' : 'smile'
      o.ears = e < 450 ? 'back' : 'up'
      return o
    case 'roll':
      o.body = 'roll'
      o.eyes = 'happy'
      o.mouth = 'smile'
      o.tail = swing(e, 500)
      o.dx = alt(e, 260) ? 0 : 0.5
      return o
    case 'highfive':
      o.body = frontOf(s.posture)
      o.arms = e > 150 ? 'wave' : 'rest'
      o.eyes = e > 450 ? 'happy' : 'open'
      o.mouth = 'smile'
      return o
    case 'startled':
      if (s.posture === 'down') {
        o.body = 'curl'
        o.eyes = e < 700 ? 'wide' : 'half'
        o.dy = e < 200 ? 1 : 0
      } else {
        o.eyes = e < 700 ? 'wide' : 'half'
        o.mouth = e < 700 ? 'gasp' : 'wavy'
        o.dy = e < 220 ? 1 : 0
      }
      o.ears = e < 700 ? 'up' : 'droop'
      return o
    case 'glance':
      o.body = frontOf(s.posture === 'down' ? 'sit' : s.posture)
      if (s.posture === 'down') o.body = 'curl'
      o.eyes = 'open'
      o.ears = 'perk'
      return o
    case 'notice':
      o.eyes = 'open'
      o.ears = 'perk'
      return o
    case 'dizzy':
      o.eyes = 'dizzy'
      o.mouth = 'wavy'
      o.ears = 'droop'
      o.dx = beat(e, 200) % 2 === 0 ? 0 : 0.5
      if (s.posture === 'down') o.body = 'curl'
      return o
  }
}

/** Where Kit's head is, for what floats beside it: the body's middle, its ear tips, its front. */
function anchorOf(s: KitState, pose: Pose): { cx: number; head: number; top: number; front: number } {
  const cx = s.x + pose.dx + KIT_W / 2
  const isSide = SIDE.has(pose.body)
  return { cx, head: cx + (isSide ? pose.facing * 2.5 : 0), top: TOP[pose.body] + pose.dy, front: cx + (isSide ? pose.facing * 8 : 7) }
}

/** What floats beside Kit in this act: hearts, sparks, confetti, Zzz, a question mark... */
export function particlesOf(s: KitState, p: KitProps, pose: Pose): Particle[] {
  const a = s.act
  const e = s.t - a.t0
  const at = anchorOf(s, pose)
  const f = pose.facing
  const out: Particle[] = []
  const add = (kind: ParticleKind, x: number, y: number, frame = 0, tone = 0) => out.push({ kind, x, y, frame, tone })
  const rising = (kind: ParticleKind, spawn: number, life: number, i: number, dx: number, height: number) => {
    const age = e - spawn
    if (age < 0 || age > life) return
    const u = age / life
    add(kind, at.head + f * dx + Math.sin(u * 3 + i) * 0.8, at.top + 1 + u * height, i, i)
  }
  switch (a.kind) {
    case 'hold':
      if (s.mood === 'tired' && e % 2200 < 900) add('sweat', at.head + f * 5, at.top - 1 - (e % 2200) / 450)
      break
    case 'walk':
      if (a.style === 'trudge' && e % 2000 < 800) add('sweat', at.head + f * 5, at.top - 1 - (e % 2000) / 400)
      break
    case 'ponder':
      add('dots', at.head + f * 2, at.top + 2, (beat(e, 420) % 3) + 1)
      break
    case 'type':
      if (e % 1500 < 220) add('spark', at.front + f * 1.5, 4.5)
      break
    case 'watchTest':
      add('spinner', at.head + f * 6.5, at.top + 0.5, beat(s.t, 110) % 8)
      break
    case 'dance':
      if (e > 150)
        for (let i = 0; i < 14; i++) {
          const life = 1800 + ((a.v >> (i % 16)) % 5) * 120
          const age = e - 150 - (i % 4) * 90
          if (age < 0 || age > life) continue
          const u = age / life
          const x0 = at.cx + (i - 6.5) * 1.5 + ((a.v >> i) % 3) - 1
          add('confetti', x0 + Math.sin(u * 6 + i) * 1.2, 15 - u * 13 - (i % 3), i % 3, i % 6)
        }
      break
    case 'happy':
      if (e % 2600 < 1200) rising('note', 0, 1200, 0, 3, 4)
      break
    case 'startle':
      if (e < 650) add('bang', at.head + f * 1, at.top + 2.5)
      break
    case 'facepalm':
      add('sweat', at.head - f * 5, at.top - 1 - (e % 1200) / 500)
      break
    case 'sweat':
      add('sweat', at.head + f * 5, at.top - 1 - (e % 1100) / 450)
      if (e % 1600 > 800) add('sweat', at.head - f * 5, at.top - 2 - (e % 800) / 400)
      break
    case 'wait':
      add('question', at.cx + 0.5, at.top + 2.5 + (alt(e, 600) ? 0 : 0.5))
      break
    case 'nap':
      for (let k = 0; k < 3; k++) {
        const u = ((e + k * 1300) % 3900) / 3900
        add(u > 0.5 ? 'bigZ' : 'z', at.head + f * (2 + u * 5) + Math.sin(u * 6) * 0.6, at.top + 1 + u * 7)
      }
      if (a.v % 3 === 0 && e > 3000 && e < 7500) add('bubble', at.head - f * 3, at.top + 3.5, beat(e - 3000, 450) > 1 ? 2 : beat(e - 3000, 450))
      break
    case 'doze':
    case 'nod':
      if (e % 3200 < 2000) add('z', at.head + f * 3 + ((e % 3200) / 2000) * 1.5 * f, at.top + 1 + ((e % 3200) / 2000) * 3)
      break
    case 'tend':
      for (let k = 0; k < 2; k++) {
        const u = ((e + k * 650) % 1300) / 1300
        add('ember', at.front + f * (2.5 + Math.sin(u * 5 + k)), 4 + u * 6, 0, k)
      }
      break
    case 'poke':
      if (e > 250 && e < 950) for (let k = 0; k < 4; k++) add('spark', at.front + f * (2 + (k - 1.5) * ((e - 250) / 350)), 5 + ((e - 250) / 700) * 4 + (k % 2), 0, k)
      break
    case 'fan':
      if (e % 2400 < 900) add('sweat', at.head - f * 5, at.top - 1 - (e % 2400) / 450)
      break
    case 'stamp':
      if (e > 650 && e < 1100) add('spark', at.cx + f * 13, 12, 0, 0)
      break
    case 'greet':
      if (e > 1200 && e < 1900) add('bang', at.head + f * 1, at.top + 2.5)
      break
    case 'purr':
      for (let k = 0; k < 3; k++) rising('heart', k * 450, 1200, k, 2 + k, 5)
      break
    case 'blush':
      rising('heart', 200, 1100, 0, 0, 4)
      break
    case 'boop':
      if (e < 400) add('spark', at.head + f * 5, at.top - 3)
      break
    case 'roll':
      for (let k = 0; k < 2; k++) rising('heart', 300 + k * 700, 1100, k, k * 2 - 1, 5)
      break
    case 'highfive':
      if (e > 300 && e < 650) add('spark', at.cx + 8.5, at.top + 1.5)
      break
    case 'startled':
      if (e < 750) add('bang', at.head + f * 1, at.top + 2.5)
      break
    case 'glance':
      if (e < 650) add('bang', at.head + f * 1.5, at.top + 2)
      break
    case 'notice':
      if (e < 700) add('question', at.head + f * 2, at.top + 2)
      break
    case 'dizzy':
      for (let k = 0; k < 3; k++) {
        const angle = e / 260 + (k * Math.PI * 2) / 3
        add('star', at.head + Math.cos(angle) * 4, at.top + 0.5 + Math.sin(angle) * 1.2, beat(e, 200) % 2, k)
      }
      break
    case 'butterfly': {
      if (e > 3800) break
      const away = e > 3200 ? (e - 3200) / 600 : 0
      const bx = at.cx + f * (5 + 3 * Math.sin(e / 500)) + f * away * 8
      const by = 12 + 1.5 * Math.cos(e / 330) + away * 4
      add('butterfly', bx, by, alt(e, 170) ? 0 : 1, 0)
      break
    }
    case 'pounce':
      if (e < 950) add('leaf', at.front + f * 2.5, 13 - (e / 950) * 10, alt(e, 240) ? 0 : 1)
      break
    case 'sneeze':
      if (e > 500 && e < 800) add('spark', at.head + f * 6, at.top - 4)
      break
    default:
      break
  }
  return out
}

/** One still pose for a mood (Reduce motion, a strained machine), and the one mark that says it. */
export function stillOf(mood: KitMood, facing: 1 | -1): { pose: Pose; mark: ParticleKind | null } {
  const o: Pose = { body: 'sit', facing, eyes: 'open', mouth: 'none', ears: 'up', tail: 0, arms: 'rest', blush: false, props: [], dy: 0, dx: 0, breath: false }
  let mark: ParticleKind | null = null
  switch (mood) {
    case 'think':
      o.body = 'stand'
      o.eyes = 'up'
      mark = 'dots'
      break
    case 'work':
      o.props = ['keyboard']
      o.arms = 'typeA'
      o.eyes = 'down'
      break
    case 'search':
      o.props = ['book', 'glasses']
      o.arms = 'hold'
      o.eyes = 'down'
      break
    case 'test':
      o.eyes = 'up'
      mark = 'spinner'
      break
    case 'celebrate':
      o.eyes = 'happy'
      o.mouth = 'smile'
      break
    case 'worried':
      o.eyes = 'wide'
      o.mouth = 'wavy'
      mark = 'bang'
      break
    case 'waiting':
      o.body = 'front'
      o.blush = true
      mark = 'question'
      break
    case 'handoff':
      o.body = 'stand'
      o.props = ['notes']
      break
    case 'sleepy':
      o.eyes = 'half'
      o.ears = 'droop'
      break
    case 'sleep':
      o.body = 'curl'
      o.eyes = 'closed'
      mark = 'z'
      break
    case 'dim':
      o.eyes = 'closed'
      o.ears = 'droop'
      break
    case 'tend':
      o.props = ['fireA']
      o.arms = 'warm'
      break
    case 'tired':
      o.eyes = 'half'
      o.mouth = 'wavy'
      break
    default:
      break
  }
  return { pose: o, mark }
}

/** What to draw now: Kit's place, its pose, what floats beside it. */
export function drawableOf(s: KitState, p: KitProps): Drawable {
  if (isCalm(p)) {
    const still = stillOf(s.mood, s.facing)
    const at = anchorOf(s, still.pose)
    const particles: Particle[] =
      still.mark === null ? [] : [{ kind: still.mark, x: still.mark === 'spinner' ? at.head + s.facing * 6.5 : at.head + s.facing, y: still.mark === 'spinner' ? at.top + 0.5 : at.top + 2.5, frame: still.mark === 'dots' ? 3 : 0, tone: 0 }]
    return { x: s.x, pose: still.pose, particles, isGone: false, isDim: s.mood === 'dim', caption: p.caption }
  }
  const pose = poseOf(s, p)
  return { x: s.x, pose, particles: s.isGone ? [] : particlesOf(s, p, pose), isGone: s.isGone, isDim: s.mood === 'dim', caption: p.caption }
}

// ---------------------------------------------------------------------------
// The terminal: a 20 × 10 sprite of palette letters, five rows of half blocks

const T_COLOR: Record<string, string> = {
  o: '#D97757',
  l: '#EBA084',
  d: '#A9553A',
  k: '#2A1B16',
  w: '#F4EFE6',
  p: '#F0A08C',
  b: '#6FA8F5',
  g: '#9A9AA0',
  y: '#F2C14E',
  r: '#E5603F',
  n: '#F6D9C4',
  e: '#7DBE6A',
  c: '#8A5A3C',
  m: '#5E5E66',
}
/** The same creature, faded: the cache is about to lapse. */
const T_DIM: Record<string, string> = { ...T_COLOR, o: '#B47A66', l: '#C79A88', d: '#8C5A48', n: '#D9C2B5' }

export const T_W = 20
export const T_H = 10

/** The body, fourteen wide, drawn from column 3: ear rows, then the round head-body with its arm nubs. */
const T_EARS: Record<Ears, [string, string]> = {
  up: ['...o......o...', '...oo....oo...'],
  perk: ['....o......o..', '...oo....oo...'],
  back: ['..............', '..ooo....ooo..'],
  flick: ['...o..........', '...oo....ooo..'],
  droop: ['..............', '.oo........oo.'],
}
const T_BODY = ['..oooooooooo..', '.oolloooooooo.', '.oooooooooooo.', 'dooooooooooood', '.oooooooooooo.', '..dddddddddd..']

type Px = [number, number, string]

/** Eyes: a pattern per eye (rows from body row 4), placed at two columns. */
const T_EYE: Record<Eyes, { rows: string[]; dy?: number }> = {
  open: { rows: ['wk', 'kk'] },
  blink: { rows: ['..', 'kk'] },
  closed: { rows: ['..', 'dd'] },
  happy: { rows: ['.k.', 'k.k'] },
  wide: { rows: ['ww', 'wk'] },
  up: { rows: ['wk', 'kk'], dy: -1 },
  down: { rows: ['wk', 'kk'], dy: 1 },
  back: { rows: ['kw', 'kk'] },
  focus: { rows: ['dd', 'kk'] },
  half: { rows: ['dd', 'kd'] },
  dizzy: { rows: ['kw', 'wk'] },
  squint: { rows: ['k.', '.k'] },
}

function eyePixels(eyes: Eyes, cols: [number, number]): Px[] {
  const spec = T_EYE[eyes]
  const out: Px[] = []
  cols.forEach((col, i) => {
    // The second of a squinting pair mirrors the first: > <.
    const rows = eyes === 'squint' && i === 1 ? spec.rows.map(r => [...r].reverse().join('')) : spec.rows
    const start = eyes === 'happy' ? col - 1 + i : col
    rows.forEach((row, r) => [...row].forEach((ch, x) => ch !== '.' && out.push([4 + r + (spec.dy ?? 0), start + x, ch])))
  })
  return out
}

/** Arms: the front nub moved (body coordinates, facing right); '.' clears a pixel. */
const T_ARMS: Record<Arms, Px[]> = {
  rest: [],
  wave: [[5, 13, '.'], [3, 14, 'd'], [2, 14, 'o']],
  cheer: [[5, 13, '.'], [5, 0, '.'], [3, 14, 'd'], [2, 14, 'o'], [3, -1, 'd'], [2, -1, 'o']],
  typeA: [[5, 13, '.'], [6, 14, 'd']],
  typeB: [[5, 13, '.'], [7, 14, 'd']],
  face: [[5, 13, '.'], [4, 12, 'd'], [5, 12, 'd'], [4, 13, 'o']],
  scratchA: [[5, 13, '.'], [2, 12, 'd']],
  scratchB: [[5, 13, '.'], [1, 12, 'd']],
  groom: [[5, 13, '.'], [6, 11, 'd'], [6, 12, 'o']],
  hold: [[5, 13, '.'], [5, 14, 'd']],
  poke: [[5, 13, '.'], [6, 14, 'd']],
  fanA: [[5, 13, '.'], [3, 14, 'd']],
  fanB: [[5, 13, '.'], [4, 14, 'd']],
  reach: [[5, 13, '.'], [2, 14, 'd'], [3, 14, 'o']],
  chin: [[5, 13, '.'], [6, 10, 'd']],
  warm: [[5, 13, '.'], [6, 14, 'd'], [5, 0, '.'], [6, 1, 'd']],
}

const T_MOUTH: Record<Mouth, Px[]> = {
  none: [],
  smile: [[6, 9, 'd']],
  cat: [[6, 9, 'd']],
  open: [[6, 9, 'k']],
  yawn: [[6, 9, 'k'], [7, 9, 'r']],
  gasp: [[6, 9, 'k']],
  wavy: [[6, 8, 'd'], [6, 10, 'd']],
  blep: [[6, 9, 'p']],
}

/** The tail, in box coordinates relative to the body's top row, by its swing (low, middle, high). */
const T_TAIL: Record<'stand' | 'sit' | 'hop', [Px[], Px[], Px[]]> = {
  stand: [
    [[6, 3, 'o'], [6, 2, 'o'], [6, 1, 'o'], [5, 0, 'n']],
    [[6, 3, 'o'], [6, 2, 'o'], [5, 1, 'o'], [4, 1, 'n']],
    [[6, 3, 'o'], [5, 2, 'o'], [4, 1, 'o'], [3, 1, 'n']],
  ],
  sit: [
    [[7, 3, 'o'], [7, 2, 'o'], [7, 1, 'o'], [7, 0, 'n']],
    [[7, 3, 'o'], [7, 2, 'o'], [7, 1, 'o'], [6, 0, 'n']],
    [[7, 3, 'o'], [7, 2, 'o'], [6, 1, 'o'], [5, 1, 'n']],
  ],
  hop: [
    [[6, 3, 'o'], [6, 2, 'o'], [7, 1, 'o'], [7, 0, 'n']],
    [[6, 3, 'o'], [6, 2, 'o'], [5, 1, 'o'], [5, 0, 'n']],
    [[6, 3, 'o'], [5, 2, 'o'], [4, 2, 'o'], [3, 1, 'n']],
  ],
}

const T_FEET: Record<'stand' | 'walkA' | 'walkB' | 'tucked', string> = {
  stand: '..dd......dd..',
  walkA: '.dd........dd.',
  walkB: '...dd....dd...',
  tucked: '...dd....dd...',
}

/** Whole sprites for the bodies that are not the round body upright: box coordinates, facing right. */
const T_WHOLE: Partial<Record<Body, string[]>> = {
  curl: [
    '....................',
    '....................',
    '....................',
    '....................',
    '...........o...o....',
    '..........oo..ooo...',
    '......ooooooooooo...',
    '....oolloooooooooo..',
    '...ooooooooooooooo..',
    '..nnoodddddddddddd..',
  ],
  lie: [
    '....................',
    '....................',
    '....................',
    '....................',
    '...........o....o...',
    '..........oo...ooo..',
    '.......oooooooooooo.',
    '.....oolloooooooooo.',
    '..n.ooooooooooooooo.',
    '.nn..ddddddddddd.dd.',
  ],
  stretch: [
    '....................',
    '.n..................',
    '..o.................',
    '..oooooo............',
    '..ooooooooooo.o...o.',
    '...ooollooooooo..oo.',
    '....ooooooooooooooo.',
    '....dooooooooooooooo',
    '....dd.......ooooooo',
    '....dd.....ddddddddd',
  ],
  roll: [
    '....................',
    '....................',
    '....................',
    '....................',
    '......d.d..d.d......',
    '......o.o..o.o......',
    '...oonnnnnnnnnnoo...',
    '..oooonnnnnnnnoooooo',
    '..ooooooooooooooooo.',
    '...ddddddddddddd..oo',
  ],
}

/** Eye places (body columns) for side bodies, and for front-facing ones. */
const T_SIDE_EYES: [number, number] = [7, 10]
const T_FRONT_EYES: [number, number] = [4, 8]

const blank = (): string[][] => Array.from({ length: T_H }, () => Array.from({ length: T_W }, () => '.'))

/** Kit as palette letters: ten rows of twenty, facing the pose's way. */
export function terminalSprite(pose: Pose): string[] {
  const grid = blank()
  const put = (row: number, col: number, ch: string) => {
    if (row >= 0 && row < T_H && col >= 0 && col < T_W) grid[row]![col] = ch
  }
  const whole = T_WHOLE[pose.body]
  if (whole !== undefined) {
    whole.forEach((line, r) => [...line].forEach((ch, x) => ch !== '.' && put(r, x, ch)))
    // Eyes and faces on the whole sprites, at their own places.
    const face: Record<string, { row: number; cols: [number, number] }> = { curl: { row: 8, cols: [12, 15] }, lie: { row: 8, cols: [12, 15] }, stretch: { row: 7, cols: [14, 17] }, roll: { row: 7, cols: [15, 18] } }
    const at = face[pose.body]
    if (at !== undefined) {
      const eyes = pose.body === 'curl' && pose.eyes !== 'wide' && pose.eyes !== 'half' ? 'closed' : pose.eyes
      const shift = at.row - 5
      for (const [r, c, ch] of eyePixels(eyes, at.cols)) put(r + shift, c, ch)
      if (pose.blush) {
        put(at.row + 1, at.cols[0] - 2, 'p')
        put(at.row + 1, at.cols[1] + 2, 'p')
      }
    }
    if (pose.body === 'roll' || pose.body === 'curl') {
      // The tail sways: its tip moves a pixel.
      if (pose.body === 'roll' && pose.tail > 0.3) put(6, 2, 'n')
    }
    return pose.facing === 1 ? grid.map(r => r.join('')) : grid.map(r => [...r].reverse().join(''))
  }
  const isFront = pose.body === 'front' || pose.body === 'frontStand' || pose.body === 'back'
  const isStanding = pose.body === 'stand' || pose.body === 'walkA' || pose.body === 'walkB' || pose.body === 'frontStand'
  const top = pose.body === 'hop' ? 0 : isStanding ? 1 : 2
  const ears = pose.body === 'crouch' ? 'back' : pose.ears
  const rows = [...T_EARS[ears], ...T_BODY]
  const at = (r: number, c: number, ch: string) => put(top + r, c + 3, ch)
  // The tail first, behind the body.
  const swingIndex = pose.tail < -0.33 ? 0 : pose.tail > 0.33 ? 2 : 1
  if (!isFront) {
    const set = pose.body === 'hop' ? T_TAIL.hop : isStanding ? T_TAIL.stand : T_TAIL.sit
    for (const [r, c, ch] of set[swingIndex]!) put(top + r, c, ch)
  }
  rows.forEach((line, r) => [...line].forEach((ch, x) => ch !== '.' && at(r, x, ch)))
  if (pose.body === 'back') {
    // Seen from behind: the tail up the middle, no face.
    for (const [r, c, ch] of [[6, 9, 'd'], [5, 9, 'd'], [4, 10, 'd'], [3, 10, 'n']] as Px[]) at(r, c, ch)
  } else if (isFront) {
    // Facing you: the tail peeks out at one side.
    for (const [r, c, ch] of [[6, 14, 'o'], [5, 15, 'o'], [4, 15, 'n']] as Px[]) at(r, c, ch)
  }
  if (isStanding) [...T_FEET[pose.body === 'walkA' ? 'walkA' : pose.body === 'walkB' ? 'walkB' : 'stand']].forEach((ch, x) => ch !== '.' && at(8, x, ch))
  if (pose.body === 'hop') [...T_FEET.tucked].forEach((ch, x) => ch !== '.' && at(8, x, ch))
  if (pose.body !== 'back') {
    const eyes = pose.body === 'crouch' && pose.eyes === 'open' ? 'focus' : pose.eyes
    for (const [r, c, ch] of eyePixels(eyes, isFront ? T_FRONT_EYES : T_SIDE_EYES)) at(r, c, ch)
    const mouthCol = isFront ? 6 : 9
    for (const [r, c, ch] of T_MOUTH[pose.mouth]) at(r, c - 9 + mouthCol, ch)
    if (pose.blush) {
      at(6, isFront ? 2 : 6, 'p')
      at(6, isFront ? 10 : 12, 'p')
    }
  }
  for (const [r, c, ch] of T_ARMS[pose.arms]) at(r, c, ch)
  for (const prop of pose.props) for (const [r, c, ch] of T_PROPS[prop]) put(prop === 'notes' || prop === 'glasses' ? top + r : r, c, ch)
  return pose.facing === 1 ? grid.map(r => r.join('')) : grid.map(r => [...r].reverse().join(''))
}

/** Props, facing right: box rows (the notes and glasses move with the body), box columns. */
const T_PROPS: Record<Prop, Px[]> = {
  keyboard: [[8, 16, 'm'], [8, 17, 'g'], [8, 18, 'm'], [8, 19, 'g'], [9, 16, 'm'], [9, 17, 'm'], [9, 18, 'm'], [9, 19, 'm']],
  book: [[6, 17, 'c'], [6, 18, 'w'], [7, 17, 'c'], [7, 18, 'w'], [8, 17, 'c'], [8, 18, 'c']],
  bookFlip: [[5, 18, 'w'], [6, 17, 'c'], [6, 18, 'w'], [7, 17, 'c'], [7, 18, 'c'], [8, 17, 'c']],
  glasses: [],
  magnifier: [[4, 18, 'g'], [5, 17, 'g'], [5, 18, 'b'], [5, 19, 'g'], [6, 18, 'g'], [7, 17, 'c']],
  notes: [[-1, 8, 'g'], [-1, 9, 'w'], [-1, 10, 'w'], [-1, 11, 'g'], [0, 8, 'g'], [0, 9, 'w'], [0, 10, 'w'], [0, 11, 'g']],
  fireA: [[6, 18, 'y'], [7, 17, 'r'], [7, 18, 'y'], [7, 19, 'r'], [8, 18, 'r'], [9, 17, 'c'], [9, 18, 'c'], [9, 19, 'c']],
  fireB: [[6, 17, 'y'], [7, 17, 'y'], [7, 18, 'r'], [7, 19, 'y'], [8, 18, 'y'], [9, 17, 'c'], [9, 18, 'c'], [9, 19, 'c']],
  fireC: [[5, 18, 'y'], [6, 18, 'r'], [7, 17, 'r'], [7, 18, 'y'], [8, 18, 'r'], [9, 17, 'c'], [9, 18, 'c'], [9, 19, 'c']],
  stick: [[7, 17, 'c'], [8, 18, 'c']],
  flag: [[1, 19, 'r'], [1, 18, 'r'], [2, 19, 'r'], [3, 19, 'g'], [4, 19, 'g'], [5, 19, 'g'], [6, 19, 'g'], [7, 19, 'g'], [8, 19, 'g'], [9, 19, 'g']],
  fan: [[2, 18, 'e'], [3, 17, 'e'], [3, 18, 'e'], [3, 19, 'e'], [4, 18, 'e']],
  leaf: [[9, 17, 'e'], [9, 18, 'y']],
}

/** One terminal cell: a glyph and its colors. */
export type Cell = { glyph: string; color?: string; background?: string }

/** Particles in the terminal: glyphs a terminal font has (Cascadia Mono, Menlo and their kind), one cell wide. */
const GLYPH: Record<ParticleKind, { glyphs: string[]; colors: string[] }> = {
  heart: { glyphs: ['♥'], colors: ['#E8536B'] },
  spark: { glyphs: ['*'], colors: ['#F2C14E', '#F2A33A', '#EBA084', '#F2C14E'] },
  confetti: { glyphs: ['•', '▪', '*'], colors: ['#F2C14E', '#6FA8F5', '#E5603F', '#7DBE6A', '#D97757', '#B58CE0'] },
  z: { glyphs: ['z'], colors: ['#9A9AA0'] },
  bigZ: { glyphs: ['Z'], colors: ['#9A9AA0'] },
  bang: { glyphs: ['!'], colors: ['#F2A33A'] },
  question: { glyphs: ['?'], colors: ['#D97757'] },
  dots: { glyphs: ['.', '..', '...', '...'], colors: ['#9A9AA0'] },
  note: { glyphs: ['♪'], colors: ['#9A9AA0'] },
  sweat: { glyphs: ['·'], colors: ['#6FA8F5'] },
  star: { glyphs: ['*', '+'], colors: ['#F2C14E', '#F2A33A', '#F2C14E'] },
  butterfly: { glyphs: ['ж'], colors: ['#6FA8F5'] },
  leaf: { glyphs: ['♣'], colors: ['#7DBE6A'] },
  bubble: { glyphs: ['°', 'o', 'O'], colors: ['#9A9AA0'] },
  spinner: { glyphs: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'], colors: ['#6FA8F5'] },
  ember: { glyphs: ['·'], colors: ['#F2A33A', '#E5603F'] },
}

/** The lane in the terminal: `columns` cells across, five rows, Kit's half blocks and what floats beside it. */
export function terminalLane(d: Drawable, columns: number): Cell[][] {
  const width = Math.max(1, columns)
  const art: (string | null)[][] = Array.from({ length: T_H }, () => Array.from({ length: width }, () => null))
  const palette = d.isDim ? T_DIM : T_COLOR
  if (!d.isGone) {
    const sprite = terminalSprite(d.pose)
    // Lifted: up by as many rows as the sprite has empty above it.
    const headroom = sprite.findIndex(r => /[^.]/.test(r))
    const lift = Math.min(Math.max(0, d.pose.dy), Math.max(0, headroom))
    const left = Math.round(d.x + d.pose.dx)
    sprite.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        const y = r - lift
        const x = left + c
        if (ch !== '.' && y >= 0 && y < T_H && x >= 0 && x < width) art[y]![x] = palette[ch] ?? null
      }),
    )
  }
  const cells: Cell[][] = Array.from({ length: T_H / 2 }, (_, y) =>
    Array.from({ length: width }, (_, x): Cell => {
      const up = art[2 * y]![x] ?? undefined
      const down = art[2 * y + 1]![x] ?? undefined
      if (up === undefined && down === undefined) return { glyph: ' ' }
      if (up === undefined) return { glyph: '▄', color: down }
      if (down === undefined || down === up) return { glyph: down === up ? '█' : '▀', color: up }
      return { glyph: '▀', color: up, background: down }
    }),
  )
  for (const p of d.particles) {
    const spec = GLYPH[p.kind]
    const glyph = spec.glyphs[p.frame % spec.glyphs.length] ?? ''
    const color = spec.colors[p.tone % spec.colors.length]
    // Above the lane's top (five rows leave little room over Kit's ears): on its top row instead.
    const row = Math.max(0, Math.floor((T_H - 1 - Math.round(p.y)) / 2))
    if (row >= T_H / 2) continue
    // A glyph lands on empty cells only: beside Kit, never over it.
    let col = Math.round(p.x)
    for (let tries = 0; tries < 6; tries++, col += d.pose.facing) {
      const span = [...glyph]
      if (span.every((_, i) => cells[row]![col + i]?.glyph === ' ')) {
        span.forEach((g, i) => (cells[row]![col + i] = { glyph: g, color }))
        break
      }
    }
  }
  return cells
}

/** A row's cells as runs of one style, trailing blanks dropped: a few Texts a row, not one per cell. */
export function runsOf(cells: readonly Cell[]): Cell[] {
  let end = cells.length
  while (end > 0 && cells[end - 1]!.glyph === ' ' && cells[end - 1]!.background === undefined) end--
  const out: Cell[] = []
  for (const c of cells.slice(0, end)) {
    const last = out[out.length - 1]
    if (last !== undefined && last.color === c.color && last.background === c.background) last.glyph += c.glyph
    else out.push({ ...c })
  }
  return out
}

// ---------------------------------------------------------------------------
// Desktop: 40 × 24 art pixels at three CSS pixels each, shaded and outlined, one image a frame

/** Desktop's art box, in art pixels: twice the terminal's detail. */
export const D_W = 40
export const D_H = 24
/** CSS pixels per art pixel. */
export const D_PX = 3
/** The lane's height in art pixels: Kit and room above its head. */
export const D_LANE_H = 28
/** A Desktop cell's width in CSS pixels, near enough: a touch arrives in cells. */
export const D_CELL_PX = 7.5

const D_COLOR = {
  outline: '#5B2C1E',
  base: '#D97757',
  light: '#EDA286',
  shade: '#C2633F',
  deep: '#A8502F',
  belly: '#F6D2BE',
  bellyShade: '#EDBBA2',
  ear: '#F2A08A',
  eye: '#2A1B16',
  shine: '#FFFFFF',
  lid: '#B85C3C',
  blush: '#F08A80',
  tongue: '#E5603F',
  cream: '#F7E3D3',
}
type DPalette = typeof D_COLOR
const D_DIM: DPalette = { ...D_COLOR, base: '#B47A66', light: '#C99A88', shade: '#A06A57', deep: '#8C5A48', belly: '#DCC3B6', bellyShade: '#CDB2A4', ear: '#CFA093', cream: '#E0D2C8', outline: '#5E4038' }

/** A raster of colors with, per pixel, the layer that drew it (for outlines between layers). */
type Raster = { w: number; ht: number; color: (string | null)[]; layer: Int16Array }

const raster = (w: number, ht: number): Raster => ({ w, ht, color: Array.from({ length: w * ht }, () => null), layer: new Int16Array(w * ht) })

function plot(r: Raster, x: number, y: number, color: string, layer: number): void {
  if (x < 0 || y < 0 || x >= r.w || y >= r.ht) return
  r.color[y * r.w + x] = color
  r.layer[y * r.w + x] = layer
}

type Ell = { cx: number; cy: number; rx: number; ry: number; rot?: number }

/** Fills an ellipse, each pixel colored by its place in it (u across, v down, both -1 to 1). */
function fillEllipse(r: Raster, e: Ell, layer: number, tone: (u: number, v: number) => string): void {
  const rot = e.rot ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const reach = Math.max(e.rx, e.ry) + 1
  for (let y = Math.floor(e.cy - reach); y <= Math.ceil(e.cy + reach); y++)
    for (let x = Math.floor(e.cx - reach); x <= Math.ceil(e.cx + reach); x++) {
      const dx = x + 0.5 - e.cx
      const dy = y + 0.5 - e.cy
      const u = (dx * cos + dy * sin) / e.rx
      const v = (-dx * sin + dy * cos) / e.ry
      if (u * u + v * v <= 1) plot(r, x, y, tone(u, v), layer)
    }
}

type Pt = [number, number]

function fillTriangle(r: Raster, a: Pt, b: Pt, c: Pt, layer: number, color: string): void {
  const minX = Math.floor(Math.min(a[0], b[0], c[0]))
  const maxXp = Math.ceil(Math.max(a[0], b[0], c[0]))
  const minY = Math.floor(Math.min(a[1], b[1], c[1]))
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]))
  const side = (p: Pt, q: Pt, x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxXp; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const d1 = side(a, b, px, py)
      const d2 = side(b, c, px, py)
      const d3 = side(c, a, px, py)
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0
      if (!(hasNeg && hasPos)) plot(r, x, y, color, layer)
    }
}
/** A tail: discs along a curve from the body to its tip, the tip in cream. */
function fillTail(r: Raster, from: Pt, ctrl: Pt, to: Pt, radius: number, layer: number, pal: DPalette): void {
  const steps = 14
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * ctrl[0] + t * t * to[0]
    const y = (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * ctrl[1] + t * t * to[1]
    const rad = radius * (1 - 0.18 * t)
    fillEllipse(r, { cx: x, cy: y, rx: rad, ry: rad }, layer, (u, v) => (t > 0.8 ? pal.cream : v > 0.35 ? pal.shade : pal.base))
  }
}

/** The inner outline: a pixel on a layer's edge (next to nothing, or to a layer behind it) turns dark. */
function outline(r: Raster, color: string): void {
  const edge: number[] = []
  for (let y = 0; y < r.ht; y++)
    for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x
      const layer = r.layer[i]!
      if (layer === 0) continue
      const near = [x > 0 ? i - 1 : -1, x < r.w - 1 ? i + 1 : -1, y > 0 ? i - r.w : -1, y < r.ht - 1 ? i + r.w : -1]
      if (near.some(j => j < 0 || r.layer[j]! === 0 || r.layer[j]! < layer)) edge.push(i)
    }
  for (const i of edge) r.color[i] = color
}

/** Stamps a small bitmap: letters into colors, '.' left alone. */
function stamp(r: Raster, x0: number, y0: number, rows: readonly string[], colors: Record<string, string>, layer = 90): void {
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && colors[ch] !== undefined && plot(r, Math.round(x0) + x, Math.round(y0) + y, colors[ch]!, layer)))
}

/** The body's shape for each pose, facing right: the round body, the ears, the belly, the feet, the tail, the face. */
type Geo = {
  body: Ell
  ears: [Pt, Pt, Pt][]
  /** Ears seen from behind: no pink inside. */
  isEarBack?: boolean
  belly: Ell | null
  /** Feet and paws: the far ones behind the body, the near ones in front of it. */
  far: Ell[]
  near: Ell[]
  tail: [Pt, Pt, Pt] | null
  tailInFront: boolean
  tailWidth: number
  eyes: [Pt, Pt] | null
  /** Where the mouth goes (top left of its bitmap's middle), and where the arm hangs at rest. */
  mouth: Pt | null
  arm: Pt | null
  face: 'side' | 'front' | 'none'
}

/** The top edge of an ellipse at column x: the first pixel row inside it. */
function topAt(e: Ell, x: number): number {
  const rot = e.rot ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  for (let y = Math.floor(e.cy - e.rx - e.ry); y < e.cy + e.rx + e.ry; y++) {
    const dx = x + 0.5 - e.cx
    const dy = y + 0.5 - e.cy
    const u = (dx * cos + dy * sin) / e.rx
    const v = (-dx * sin + dy * cos) / e.ry
    if (u * u + v * v <= 1) return y
  }
  return e.cy
}

/** An ear standing on the body between columns a and b (its base `depth` into the body), its tip at column `tip`, `rise` above the base. */
function earOn(e: Ell, a: number, b: number, tip: number, rise: number, depth = 1.6): [Pt, Pt, Pt] {
  const ya = topAt(e, a) + depth
  const yb = topAt(e, b) + depth
  return [[a, ya], [b, yb], [tip, Math.min(ya, yb) - rise]]
}

function geoOf(body: Body, tail: number, breath: boolean): Geo {
  const sw = tail * 2.4
  const lift = breath ? 0.4 : 0
  switch (body) {
    case 'stand':
    case 'walkA':
    case 'walkB':
    case 'hop': {
      const isHop = body === 'hop'
      const cy = (isHop ? 11.4 : body === 'walkB' ? 12.6 : 13) - lift
      const e: Ell = { cx: 21, cy, rx: 12, ry: 7.8 + lift }
      const feet: [number, number] = isHop ? [16, 26] : body === 'walkA' ? [13.8, 27.4] : body === 'walkB' ? [17.6, 24.2] : [15, 26.4]
      const fy = isHop ? 19.4 : 21.5
      return {
        body: e,
        ears: [earOn(e, 11.5, 17.6, 12.2, 6.6), earOn(e, 24.4, 30.5, 29.8, 6.6)],
        belly: { cx: 24.6, cy: cy + 3.3, rx: 7, ry: 4.2 },
        far: [{ cx: feet[0], cy: fy, rx: 2.8, ry: 1.6 }],
        near: [{ cx: feet[1], cy: fy, rx: 2.8, ry: 1.6 }],
        tail: [[10.5, cy + 3.6], [2.6, cy + 3 - sw], [3.4 - sw * 0.4, cy - 5.6 - sw]],
        tailInFront: false,
        tailWidth: 2.3,
        eyes: [[22, Math.round(cy - 3.2)], [28, Math.round(cy - 3.2)]],
        mouth: [25.5, Math.round(cy - 3.2) + 4],
        arm: [32, cy + 3.6],
        face: 'side',
      }
    }
    case 'sit':
    case 'crouch': {
      const isCrouch = body === 'crouch'
      const e: Ell = isCrouch ? { cx: 21, cy: 16.4, rx: 13, ry: 6.6 } : { cx: 21, cy: 14.4 - lift, rx: 11.4, ry: 8.4 + lift }
      const eyeY = Math.round(e.cy - (isCrouch ? 2.4 : 3.4))
      return {
        body: e,
        ears: isCrouch ? [earOn(e, 11, 17, 8.4, 3.4), earOn(e, 23.5, 29.5, 25, 4.4)] : [earOn(e, 12.2, 18, 12.6, 6.6), earOn(e, 24, 29.8, 29.4, 6.6)],
        belly: { cx: 24.4, cy: e.cy + 3.6, rx: 6.8, ry: 4.4 },
        far: [{ cx: 13.8, cy: 21.8, rx: 3.6, ry: 1.7 }],
        near: [{ cx: 28.2, cy: 22.2, rx: 2.7, ry: 1.3 }],
        tail: [[10.5, 21.4], [2.6, 23.4 - sw * 0.3], [2.4 - sw * 0.3, 16.4 - sw * 1.4]],
        tailInFront: false,
        tailWidth: 2.3,
        eyes: [[22, eyeY], [28, eyeY]],
        mouth: [25.5, eyeY + 4],
        arm: [31.4, e.cy + 3.6],
        face: 'side',
      }
    }
    case 'front':
    case 'frontStand':
    case 'back': {
      const isStanding = body === 'frontStand'
      const e: Ell = isStanding ? { cx: 20, cy: 13 - lift, rx: 11.8, ry: 7.8 + lift } : { cx: 20, cy: 14.4 - lift, rx: 11.6, ry: 8.4 + lift }
      const isBack = body === 'back'
      const eyeY = Math.round(e.cy - 3.2)
      return {
        body: e,
        ears: [earOn(e, 11, 17, 10.6, 6.8), earOn(e, 23, 29, 29.4, 6.8)],
        isEarBack: isBack,
        belly: isBack ? null : { cx: 20, cy: e.cy + 3.8, rx: 6.8, ry: 4.2 },
        far: [],
        near: isStanding
          ? [{ cx: 15, cy: 21.5, rx: 2.8, ry: 1.6 }, { cx: 25, cy: 21.5, rx: 2.8, ry: 1.6 }]
          : isBack
            ? []
            : [{ cx: 15.6, cy: 21.9, rx: 2.9, ry: 1.7 }, { cx: 24.4, cy: 21.9, rx: 2.9, ry: 1.7 }],
        tail: isBack
          ? [[20, e.cy + e.ry - 1.5], [22 + sw, e.cy + 1], [18.5 - sw, e.cy - 5]]
          : [[30, isStanding ? 17.6 : 21.2], [37.4, isStanding ? 18 : 22.2], [36.2 + sw * 0.4, isStanding ? 9.6 - sw : 15.2 - sw]],
        tailInFront: isBack,
        tailWidth: isBack ? 1.7 : 2.2,
        eyes: isBack ? null : [[15, eyeY], [23, eyeY]],
        mouth: isBack ? null : [20, eyeY + 4],
        arm: null,
        face: isBack ? 'none' : 'front',
      }
    }
    case 'curl':
    case 'lie': {
      // A loaf: the round body settled on the ground (its bottom cut flat), the head at the front.
      const isLie = body === 'lie'
      const e: Ell = { cx: 19.6, cy: 18.4 - lift * 0.5, rx: 12.6, ry: 6.6 + lift * 0.5 }
      return {
        body: e,
        ears: isLie ? [earOn(e, 19.2, 25.6, 21, 7, 1.2), earOn(e, 26, 31, 32.6, 6.4, 1.2)] : [earOn(e, 19.2, 25.6, 21, 6.4, 1.2), earOn(e, 26, 31, 32.4, 5.8, 1.2)],
        belly: null,
        far: [],
        near: isLie ? [{ cx: 32.6, cy: 22.4, rx: 2.8, ry: 1.3 }] : [],
        tail: isLie ? [[8, 20.6], [2.4, 22.6], [2, 18.4 - sw]] : [[8.4, 21.4], [18, 25.8], [31, 22.4]],
        tailInFront: !isLie,
        tailWidth: 2.1,
        eyes: [[24, 17], [29, 17]],
        mouth: null,
        arm: null,
        face: 'side',
      }
    }
    case 'stretch': {
      // A play bow: the back end up, the chest down, the front paws reaching forward.
      const e: Ell = { cx: 19, cy: 14.6, rx: 12.6, ry: 6.2, rot: 0.3 }
      return {
        body: e,
        ears: [earOn(e, 21, 27.4, 22.4, 6.4, 1.2), earOn(e, 27.6, 32.4, 33.8, 5.8, 1.2)],
        belly: null,
        far: [{ cx: 10.6, cy: 19.6, rx: 2.4, ry: 3.4 }],
        near: [{ cx: 32.6, cy: 21.8, rx: 5.6, ry: 1.6 }],
        tail: [[8.6, 10.8], [2.4, 8], [5 + sw * 0.5, 1.4]],
        tailInFront: false,
        tailWidth: 2.2,
        eyes: [[27, topAt(e, 27) + 3], [31, topAt(e, 31) + 3]],
        mouth: null,
        arm: null,
        face: 'side',
      }
    }
    case 'roll': {
      // Rolled over for a belly rub: lying back, the belly up to you, paws in the air, a happy face.
      const e: Ell = { cx: 19.4, cy: 18.2, rx: 12.6, ry: 5.8 }
      return {
        body: e,
        ears: [earOn(e, 22.4, 27, 24.4, 5.4, 1.2), earOn(e, 26.6, 31.4, 33.8, 5.2, 1.2)],
        belly: { cx: 18.4, cy: 18.8, rx: 8.4, ry: 3.8 },
        far: [
          { cx: 11.4, cy: 12.6, rx: 2.3, ry: 2.4 },
          { cx: 19.6, cy: 11.6, rx: 2.3, ry: 2.4 },
        ],
        near: [{ cx: 15.4, cy: 12, rx: 2.3, ry: 2.4 }],
        tail: [[7.4, 19.6], [1.4, 18.6 - sw], [2.4, 13.4 - sw]],
        tailInFront: false,
        tailWidth: 2.1,
        eyes: [[25, 15], [29, 15]],
        mouth: [27.5, 18],
        arm: null,
        face: 'side',
      }
    }
  }
}

/** Eye bitmaps, top left at the eye's place: k dark, w white, d a lid in the body's shade, p pink. */
const D_EYE: Record<Eyes, string[]> = {
  open: ['wk', 'kk', 'kk'],
  blink: ['..', '..', 'kk'],
  closed: ['..', '..', 'kk'],
  happy: ['.k.', 'k.k'],
  wide: ['ww', 'wk', 'ww'],
  up: ['wk', 'kk', '..'],
  down: ['..', 'wk', 'kk'],
  back: ['kw', 'kk', 'kk'],
  focus: ['dd', 'kk', 'kk'],
  half: ['..', 'dd', 'kk'],
  dizzy: ['k.k', '.k.', 'k.k'],
  squint: ['k..', '.kk', 'k..'],
}

const D_MOUTH: Record<Mouth, string[]> = {
  none: [],
  smile: ['k..k', '.kk.'],
  cat: ['k.k.k', '.k.k.'],
  open: ['.kk.', 'krrk', '.kk.'],
  yawn: ['.kk.', 'krrk', 'krrk', '.kk.'],
  gasp: ['.k.', 'k.k', '.k.'],
  wavy: ['.k.k', 'k.k.'],
  blep: ['k..k', '.kk.', '.rr.'],
}

/** The near arm by gesture, as an offset from the body's middle (facing right), its size, and a far arm. */
const D_ARM: Record<Arms, { at: Pt; rx: number; ry: number; far?: Pt; front?: Pt } | null> = {
  rest: null,
  wave: { at: [11.6, -5.4], rx: 2.1, ry: 2.6, front: [11, -4.4] },
  cheer: { at: [11.2, -5.8], rx: 2.1, ry: 2.6, far: [-9.4, -6.2], front: [10.8, -5] },
  typeA: { at: [11, 5.2], rx: 2.6, ry: 1.6 },
  typeB: { at: [11.8, 6], rx: 2.6, ry: 1.5 },
  face: { at: [7.4, -2.4], rx: 2.9, ry: 2.5, front: [3.6, -2.2] },
  scratchA: { at: [6, -7.6], rx: 2.2, ry: 2.2 },
  scratchB: { at: [7.2, -6.6], rx: 2.2, ry: 2.2 },
  groom: { at: [7.4, 1.4], rx: 2.3, ry: 2.2 },
  hold: { at: [10.6, 2.2], rx: 2.3, ry: 1.9 },
  poke: { at: [12.2, 4.4], rx: 2.8, ry: 1.5 },
  fanA: { at: [11.2, -5], rx: 2.1, ry: 2.3 },
  fanB: { at: [11.8, -2.4], rx: 2.1, ry: 2.3 },
  reach: { at: [10.6, -7.4], rx: 2, ry: 2.6 },
  chin: { at: [7.8, 2.4], rx: 2.2, ry: 2 },
  warm: { at: [11.6, 3.8], rx: 2.5, ry: 1.7, far: [9.6, 4.8] },
}

const PROP_COLORS: Record<string, string> = {
  k: '#2A1B16',
  w: '#F4EFE6',
  g: '#9A9AA0',
  m: '#4A4A52',
  b: '#8CC0FF',
  B: '#5E97E0',
  c: '#8A5A3C',
  C: '#6B4429',
  y: '#F2C14E',
  r: '#E5603F',
  R: '#C8452B',
  e: '#7DBE6A',
  E: '#5A9A4A',
  s: '#C7C7CE',
}

/** Props as bitmaps (facing right) and where each sits, from the body's middle. */
const D_PROP: Record<Prop, { rows: string[]; at: (g: Geo) => Pt }> = {
  keyboard: { rows: ['.mmmmmmmmm.', 'mswswswswsm', 'mwswswswswm', '.mmmmmmmmm.'], at: g => [g.body.cx + 7, 19.6] },
  book: { rows: ['CwwwwcwwwwC', 'CwsswcwsswC', 'CwwwwcwwwwC', 'CwsswcwsswC', '.CccccccccC'], at: g => [g.body.cx + 3.4, g.body.cy + 1.6] },
  bookFlip: { rows: ['......ww...', 'CwwwwcwswwC', 'CwsswcwwwwC', 'CwwwwcwsswC', 'CwsswcwwwwC', 'CccccccccCC'], at: g => [g.body.cx + 3.4, g.body.cy + 0.6] },
  glasses: { rows: ['mmmm..mmmm', 'm..m..m..m', 'm..mmmm..m', 'm..m..m..m', 'mmmm..mmmm'], at: g => [(g.eyes?.[0]?.[0] ?? 22) - 1, (g.eyes?.[0]?.[1] ?? 10) - 1] },
  magnifier: { rows: ['....ggg..', '...gbbwg.', '..gbbbbwg', '..gbbbbbg', '..gBbbbbg', '...gBbbg.', '..c.ggg..', '.c.......', 'C........'], at: g => [g.body.cx + 10.2, g.body.cy - 6.6] },
  notes: { rows: ['.gggggg.', 'gwwwwwwg', 'gwssswwg', 'gwwwwwwg', 'gwsswwwg', '.gggggg.'], at: g => [g.body.cx - 4, g.body.cy - g.body.ry - 5.4] },
  fireA: { rows: ['...y....', '..yry...', '..rryr..', '.rryyr..', '.ryyyRr.', '..Ryyr..', 'CccCcccC', '.CC..CC.'], at: g => [g.body.cx + 11.4, 16] },
  fireB: { rows: ['....y...', '...ry...', '..ryyr..', '.rryyrr.', '.Ryyyrr.', '..ryyR..', 'CccCcccC', '.CC..CC.'], at: g => [g.body.cx + 11.4, 16] },
  fireC: { rows: ['........', '...yr...', '..ryyr..', '..ryyr..', '.rryyyr.', '..RyyR..', 'CccCcccC', '.CC..CC.'], at: g => [g.body.cx + 11.4, 16] },
  stick: { rows: ['c...', '.c..', '..c.', '...c'], at: g => [g.body.cx + 12.6, g.body.cy + 4.6] },
  flag: { rows: ['grrrr', 'grRrr', 'grrr.', 'g....', 'g....', 'g....', 'g....', 'g....', 'g....', 'g....', 'g....', 'g....', 'g....', 'g....', 'C....'], at: () => [35, 8] },
  fan: { rows: ['..ee.', '.eEee', 'eeEee', '.eeE.', '..eEc', '....c'], at: g => [g.body.cx + 10.6, g.body.cy - 11] },
  leaf: { rows: ['.ee', 'eEe', 'ye.'], at: g => [g.body.cx + 10.6, 20] },
}

function eyeRows(eyes: Eyes, index: number): string[] {
  const rows = D_EYE[eyes]
  return eyes === 'squint' && index === 1 ? rows.map(r => [...r].reverse().join('')) : rows
}

/** Kit on Desktop: a 40 × 24 grid of colors (null: see-through), facing the pose's way. */
export function desktopSprite(pose: Pose, isDim = false): (string | null)[][] {
  const pal = isDim ? D_DIM : D_COLOR
  const g = geoOf(pose.body, pose.tail, pose.breath)
  const r = raster(D_W, D_H)
  const body = g.body
  const bodyTone = (u: number, v: number): string => {
    const light = -0.5 * u - 0.85 * v
    if (v > 0.74) return pal.deep
    if (light > 0.88) return pal.light
    if (light < -0.52) return pal.shade
    return pal.base
  }
  const limb = (u: number, v: number) => (v > 0.35 ? pal.shade : pal.base)
  const arm = D_ARM[pose.arms]
  const isSide = g.face === 'side'
  const armAt = (off: Pt): Ell => ({ cx: body.cx + off[0], cy: body.cy + off[1], rx: arm?.rx ?? 2.2, ry: arm?.ry ?? 2 })
  // Back to front: the tail, the far arm and feet, the ears and body with its belly and face, the near feet, the near arm.
  if (g.tail !== null && !g.tailInFront) fillTail(r, g.tail[0], g.tail[1], g.tail[2], g.tailWidth, 1, pal)
  if (arm?.far !== undefined && isSide) fillEllipse(r, armAt(arm.far), 2, () => pal.shade)
  for (const foot of g.far) fillEllipse(r, foot, 3, limb)
  for (const [i, ear] of g.ears.entries()) {
    const [a, b] = ear
    let tip = ear[2]
    // Ears: back flat, flicked (the near one folds), perked forward, drooping to the sides.
    if (pose.ears === 'back') tip = [tip[0] - 3.4, tip[1] + 3]
    else if (pose.ears === 'droop') tip = [tip[0] + (i === 0 ? -4 : 4), tip[1] + 4.2]
    else if (pose.ears === 'perk') tip = [tip[0] + 1.6, tip[1] + 0.4]
    else if (pose.ears === 'flick' && i === 1) tip = [tip[0] + 2.6, tip[1] + 3]
    fillTriangle(r, a, b, tip, 4, pal.base)
    if (g.isEarBack === true) continue
    // The inner ear, pink, the ear drawn smaller about its own middle (and a little lower, into the head).
    const mid: Pt = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3 + 0.8]
    const inset = (p: Pt, k: number): Pt => [p[0] + (mid[0] - p[0]) * k, p[1] + (mid[1] - p[1]) * k]
    fillTriangle(r, inset(a, 0.42), inset(b, 0.42), inset(tip, 0.36), 4, pal.ear)
  }
  fillEllipse(r, body, 4, bodyTone)
  if (g.belly !== null) fillEllipse(r, g.belly, 4, (u, v) => (v > 0.45 ? pal.bellyShade : pal.belly))
  // The face, on the body's own layer (no outline round it), under any paw raised to it.
  const faceColors: Record<string, string> = { k: isDim ? '#3A2A24' : D_COLOR.eye, w: D_COLOR.shine, d: pal.shade, p: pal.blush, r: pal.tongue }
  if (g.eyes !== null) {
    const eyes = pose.body === 'curl' && (pose.eyes === 'open' || pose.eyes === 'blink') ? 'closed' : pose.eyes
    g.eyes.forEach((at, i) => stamp(r, at[0] + (eyes === 'back' ? -1 : eyes === 'happy' || eyes === 'dizzy' || eyes === 'squint' ? -0.5 : 0), at[1], eyeRows(eyes, i), faceColors, 4))
    const mouth = D_MOUTH[pose.mouth]
    if (g.mouth !== null && mouth.length > 0) stamp(r, g.mouth[0] - mouth[0]!.length / 2, g.mouth[1], mouth, faceColors, 4)
    if (pose.blush) {
      stamp(r, g.eyes[0][0] - 3, g.eyes[0][1] + 3, ['pp'], faceColors, 4)
      stamp(r, g.eyes[1][0] + 3, g.eyes[1][1] + 3, ['pp'], faceColors, 4)
    }
  }
  for (const foot of g.near) fillEllipse(r, foot, 5, limb)
  if (g.tail !== null && g.tailInFront) fillTail(r, g.tail[0], g.tail[1], g.tail[2], g.tailWidth, 6, pal)
  if (arm !== null && g.face !== 'none') {
    const near: Pt = g.face === 'front' ? (arm.front ?? [arm.at[0] + 1.4, arm.at[1]]) : arm.at
    fillEllipse(r, armAt(near), 7, limb)
    if (arm.far !== undefined && g.face === 'front') fillEllipse(r, armAt([-near[0], near[1]]), 7, limb)
  } else if (g.arm !== null && isSide) fillEllipse(r, { cx: g.arm[0], cy: g.arm[1], rx: 2.3, ry: 2 }, 7, limb)
  outline(r, pal.outline)
  if (pose.body === 'roll') for (const paw of [...g.far, ...g.near]) plot(r, Math.round(paw.cx - 0.5), Math.round(paw.cy - 1), pal.ear, 8)
  for (const prop of pose.props) {
    const spec = D_PROP[prop]
    const [x, y] = spec.at(g)
    stamp(r, x, y, spec.rows, PROP_COLORS)
  }
  const grid = Array.from({ length: D_H }, (_, y) => Array.from({ length: D_W }, (_, x) => r.color[y * D_W + x] ?? null))
  return pose.facing === 1 ? grid : grid.map(row => [...row].reverse())
}

/** Bitmaps of what floats beside Kit, with their colors by tone. */
const D_PARTICLE: Record<ParticleKind, { frames: string[][]; colors: string[] }> = {
  heart: { frames: [['.x.x.', 'xxxxx', '.xxx.', '..x..']], colors: ['#E8536B', '#F07A8E', '#E8536B'] },
  spark: { frames: [['.x.', 'xxx', '.x.']], colors: ['#F2C14E', '#F2A33A', '#FFE08A', '#F2C14E'] },
  confetti: { frames: [['xx', 'xx'], ['xxx'], ['x', 'x', 'x']], colors: ['#F2C14E', '#6FA8F5', '#E5603F', '#7DBE6A', '#D97757', '#B58CE0'] },
  z: { frames: [['xxx', '.x.', 'xxx']], colors: ['#9A9AA0'] },
  bigZ: { frames: [['xxxx', '..x.', '.x..', 'xxxx']], colors: ['#9A9AA0'] },
  bang: { frames: [['xx', 'xx', 'xx', 'xx', '..', 'xx']], colors: ['#F2A33A'] },
  question: { frames: [['.xxx.', 'x...x', '...x.', '..x..', '.....', '..x..']], colors: ['#D97757'] },
  dots: { frames: [['x'], ['x.x'], ['x.x.x'], ['x.x.x']], colors: ['#9A9AA0'] },
  note: { frames: [['.xx', '.x.', '.x.', 'xx.', 'xx.']], colors: ['#9A9AA0'] },
  sweat: { frames: [['.x.', 'xxx', 'xxx', '.x.']], colors: ['#6FA8F5'] },
  star: { frames: [['.x.', 'xxx', '.x.'], ['x.x', '.x.', 'x.x']], colors: ['#F2C14E', '#F2A33A', '#FFE08A'] },
  butterfly: { frames: [['xx.xx', 'xxkxx', '.x.x.'], ['.x.x.', '.xkx.', '..k..']], colors: ['#6FA8F5'] },
  leaf: { frames: [['.xx', 'xxx', 'x..'], ['xx.', 'xxx', '..x']], colors: ['#7DBE6A'] },
  bubble: { frames: [['x'], ['.x.', 'x.x', '.x.'], ['..xxxxx..', '.x.....x.', 'x...bb..x', 'x..bbbb.x', 'x...bb..x', '.x.....x.', '..xxxxx..']], colors: ['#B8B8BE'] },
  spinner: { frames: [], colors: ['#6FA8F5'] },
  ember: { frames: [['x']], colors: ['#F2A33A', '#E5603F'] },
}

/** The spinner: a ring of eight dots, one lit, going round. */
const SPIN_RING: Pt[] = [[1, 0], [2, 0], [3, 1], [3, 2], [2, 3], [1, 3], [0, 2], [0, 1]]

/** The width of the Desktop lane, in CSS pixels, for a region `columns` cells wide. */
export function desktopLanePx(columns: number): number {
  if (columns <= 0) return 360
  return Math.round(clamp(columns * D_CELL_PX, 240, 560))
}

/** Lane units in a Desktop lane `px` wide. */
export const desktopLaneUnits = (px: number): number => Math.floor(px / (D_PX * 2))

/** The Desktop lane as art pixels: a grid of colors (null: see-through), Kit then what floats beside it, and its shadow. */
export function desktopLane(d: Drawable, px: number): { grid: (string | null)[][]; shadow: { cx: number; rx: number; opacity: number } | null } {
  const w = Math.max(KIT_W * 2, Math.floor(px / D_PX))
  const ht = D_LANE_H
  const grid: (string | null)[][] = Array.from({ length: ht }, () => Array.from({ length: w }, () => null))
  const put = (x: number, y: number, color: string) => {
    if (x >= 0 && y >= 0 && x < w && y < ht) grid[y]![x] = color
  }
  let shadow: { cx: number; rx: number; opacity: number } | null = null
  if (!d.isGone) {
    const left = Math.round((d.x + d.pose.dx) * 2)
    const top = ht - D_H - Math.round(d.pose.dy * 2)
    desktopSprite(d.pose, d.isDim).forEach((row, y) => row.forEach((c, x) => c !== null && put(left + x, top + y, c)))
    const lifted = Math.max(0, d.pose.dy)
    const body = d.pose.body
    const span = body === 'curl' || body === 'lie' || body === 'roll' || body === 'stretch' ? 14 : 11
    shadow = { cx: left + D_W / 2, rx: span - lifted, opacity: 0.16 - lifted * 0.03 }
  }
  for (const p of d.particles) {
    const spec = D_PARTICLE[p.kind]
    const color = spec.colors[p.tone % spec.colors.length] ?? '#9A9AA0'
    const cx = Math.round(p.x * 2)
    const cy = ht - 1 - Math.round(p.y * 2)
    if (p.kind === 'spinner') {
      SPIN_RING.forEach(([x, y], i) => put(cx - 2 + x, cy - 2 + y, i === p.frame % 8 ? color : '#C7C7CE'))
      continue
    }
    const rows = spec.frames[p.frame % Math.max(1, spec.frames.length)] ?? []
    const x0 = cx - Math.floor((rows[0]?.length ?? 1) / 2)
    const y0 = cy - Math.floor(rows.length / 2)
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && put(x0 + x, y0 + y, ch === 'k' ? '#2A1B16' : ch === 'b' ? '#6FA8F5' : color)))
  }
  return { grid, shadow }
}

/** The whole lane on Desktop as one SVG: a soft shadow, then one path per color (crisp pixels). */
export function desktopSvg(d: Drawable, px: number): string {
  const { grid, shadow } = desktopLane(d, px)
  const w = grid[0]?.length ?? 0
  const ht = grid.length
  // Runs of one color in a row become one rectangle in that color's path.
  const paths = new Map<string, string>()
  grid.forEach((row, y) => {
    let x = 0
    while (x < w) {
      const color = row[x]
      let end = x + 1
      while (end < w && row[end] === color) end++
      if (color !== null && color !== undefined) paths.set(color, `${paths.get(color) ?? ''}M${x} ${y}h${end - x}v1h${x - end}z`)
      x = end
    }
  })
  const title = d.caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const ground =
    shadow === null
      ? ''
      : `<ellipse cx="${shadow.cx * D_PX}" cy="${(ht - 1) * D_PX}" rx="${(shadow.rx * D_PX).toFixed(1)}" ry="${(1.5 * D_PX).toFixed(1)}" fill="#000" fill-opacity="${shadow.opacity.toFixed(2)}" shape-rendering="auto"/>`
  let body = ''
  for (const [color, dPath] of paths) body += `<path fill="${color}" d="${dPath}"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * D_PX}" height="${ht * D_PX}" viewBox="0 0 ${w * D_PX} ${ht * D_PX}" shape-rendering="crispEdges">` +
    `<style>:root{color-scheme:light dark}</style><title>${title}</title>${ground}<g transform="scale(${D_PX})">${body}</g></svg>`
  )
}

/** The Desktop lane's image size for a lane `px` wide: whole art pixels. */
export const desktopSize = (px: number): { width: number; height: number } => ({ width: Math.max(KIT_W * 2, Math.floor(px / D_PX)) * D_PX, height: D_LANE_H * D_PX })

/** Kit held still in its mood's pose, as one image: where a surface draws no surface module (VS Code). */
export function kitStillSvg(view: CompanionView, px: number): { source: string; width: number; height: number } {
  const p: KitProps = { ...view, surface: 'desktop', isReduced: true }
  const s = createKit(p, { lane: desktopLaneUnits(px), home: 2, seed: 1, isEntering: false })
  return { source: desktopSvg(drawableOf(s, p), px), ...desktopSize(px) }
}

// ---------------------------------------------------------------------------
// The surface module: the model on the surface's clock, drawn on each frame that changes

type Lane = { units: number; home: number; px: number; columns: number }
type Instance = { state: KitState; props: KitProps; key: string; drawnAt: number; lane: Lane; isFailed: boolean }
type View = { id: number; n: number }

const instances = new Map<number, Instance>()
let nextId = 1
/** Contexts Kit has walked into: a fresh context's entrance plays once, never again on a redraw. */
const entered = new Set<number>()
/** Where the last Kit stood on each surface, and its lane's width: a Kit drawn again (a new instance) appears there. */
const lastSpots = new Map<KitProps['surface'], { x: number; facing: 1 | -1; columns: number }>()

const laneOf = (p: KitProps, columns: number): Lane => {
  if (p.surface === 'desktop') {
    const px = desktopLanePx(columns)
    return { units: desktopLaneUnits(px), home: 2, px, columns }
  }
  const units = Math.max(KIT_W, columns)
  return { units, home: Math.round((units - KIT_W) * 0.33), px: 0, columns }
}

/** What a frame shows, as a string: a tick that changes nothing draws nothing. */
function keyOf(d: Drawable, surface: KitProps['surface']): string {
  const scale = surface === 'desktop' ? 2 : 1
  const pose = { ...d.pose, tail: Math.round(d.pose.tail * 2), x: Math.round((d.x + d.pose.dx) * scale) }
  const particles = d.particles.map(p => `${p.kind}${Math.round(p.x * scale)},${Math.round(p.y * scale)},${p.frame},${p.tone}`)
  return JSON.stringify([pose, particles, d.isGone, d.isDim])
}

function fail(id: number, surface: ClientSurface<View>, err: unknown): void {
  const inst = instances.get(id)
  if (inst !== undefined) inst.isFailed = true
  surface.post({ fault: String(err instanceof Error ? err.message : err).slice(0, 160) })
}

function mount(props: KitProps, surface: ClientSurface<View>): number {
  const id = nextId++
  // Before its first layout a region has no width: the last Kit's lane stands in for it (else a usual one).
  const spot = lastSpots.get(props.surface)
  const lane = laneOf(props, surface.columns > 0 ? surface.columns : (spot?.columns ?? (props.surface === 'terminal' ? 100 : 0)))
  const context = props.contextStartedAt
  const isEntering = props.isFresh && context !== null && !entered.has(context)
  if (props.isFresh && context !== null) entered.add(context)
  const state = createKit(props, { lane: lane.units, home: lane.home, seed: Math.imul(id, 2654435761) ^ (context ?? 0), isEntering, x: spot?.x, facing: spot?.facing })
  instances.set(id, { state, props, key: '', drawnAt: -BUSY_FRAME_MS, lane, isFailed: false })
  // A few instances at most: one per drawing of the status bar.
  while (instances.size > 8) instances.delete(instances.keys().next().value!)
  surface.setState({ id, n: 0 })
  surface.every(TICK_MS[props.surface], () => tick(id, surface))
  surface.onPointer(ev => touch(id, surface, ev))
  return id
}

function redraw(id: number, surface: ClientSurface<View>): void {
  surface.setState({ id, n: (surface.state?.n ?? 0) + 1 })
}

function tick(id: number, surface: ClientSurface<View>): void {
  const inst = instances.get(id)
  if (inst === undefined || inst.isFailed) return
  try {
    const before = inst.state.seen.context
    inst.state = stepKit(inst.state, inst.props, TICK_MS[inst.props.surface])
    const context = inst.state.seen.context
    if (context !== before && context !== null && inst.props.isFresh) entered.add(context)
    if (!inst.state.isGone && inst.state.x >= 0) lastSpots.set(inst.props.surface, { x: inst.state.x, facing: inst.state.facing, columns: inst.lane.columns })
    const d = drawableOf(inst.state, inst.props)
    const key = keyOf(d, inst.props.surface)
    if (key === inst.key) return
    if (inst.props.isBusy && inst.state.t - inst.drawnAt < BUSY_FRAME_MS) return
    inst.key = key
    inst.drawnAt = inst.state.t
    redraw(id, surface)
  } catch (err) {
    fail(id, surface, err)
  }
}

function touch(id: number, surface: ClientSurface<View>, ev: ClientPointerEvent): void {
  const inst = instances.get(id)
  if (inst === undefined || inst.isFailed || ev.type !== 'down') return
  try {
    // Desktop reports cells; Kit's lane counts six CSS pixels a unit.
    const x = inst.props.surface === 'desktop' ? ((ev.x + 0.5) * D_CELL_PX) / (D_PX * 2) : ev.x + 0.5
    inst.state = touchKit(inst.state, inst.props, x)
    redraw(id, surface)
  } catch (err) {
    fail(id, surface, err)
  }
}

export default function KitClient(props: KitProps, surface: ClientSurface<View>): RenderElement {
  const { Box, Text } = surface.elements
  const known = surface.state === undefined ? undefined : instances.get(surface.state.id)
  let id = known === undefined ? -1 : surface.state!.id
  try {
    if (id < 0) id = mount(props, surface)
    const inst = instances.get(id)!
    if (inst.isFailed) return <Box key="kit" height={props.surface === 'terminal' ? 5 : 0} />
    inst.props = props
    // Laid out at a new width: Kit stays where it is, within the lane.
    if (surface.columns > 0 && surface.columns !== inst.lane.columns) {
      const lane = laneOf(props, surface.columns)
      if (lane.units !== inst.lane.units) inst.state = resizeKit(inst.state, lane.units, lane.home)
      inst.lane = lane
    }
    const lane = inst.lane
    const d = drawableOf(inst.state, props)
    if (props.surface === 'desktop') {
      const art = { type: 'Svg', props: { source: desktopSvg(d, lane.px), alt: props.caption, ...desktopSize(lane.px) } } as unknown as RenderElement
      return (
        <Box key="kit" flexDirection="row">
          {art}
        </Box>
      )
    }
    const rows = terminalLane(d, lane.units)
    return (
      <Box key="kit" flexDirection="column" height={5}>
        {rows.map((cells, y) => {
          const runs = runsOf(cells)
          // An empty row still takes its line: Kit stands on the lane's bottom row.
          return (
            <Text key={`kit-row-${y}`} wrap="truncate-end">
              {runs.length === 0
                ? ' '
                : runs.map((c, i) => (
                    <Text key={`kit-${y}-${i}`} color={c.color} backgroundColor={c.background}>
                      {c.glyph}
                    </Text>
                  ))}
            </Text>
          )
        })}
      </Box>
    )
  } catch (err) {
    if (id >= 0) fail(id, surface, err)
    else surface.post({ fault: String(err instanceof Error ? err.message : err).slice(0, 160) })
    return <Box key="kit" height={props.surface === 'terminal' ? 5 : 0} />
  }
}
