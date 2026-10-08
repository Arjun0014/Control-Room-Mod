import { describe, expect, test } from 'claude-code/testing'

import { CAPTION, type Mood, type MoodInput, companionView, moodOf } from '../hooks/features/companion'
import {
  COOLDOWN_MS,
  D_H,
  D_W,
  DIZZY_TAPS,
  HOLD_MS,
  KIT_W,
  SETTLE_MS,
  T_H,
  T_W,
  type Body,
  type Drawable,
  type KitProps,
  type KitState,
  createKit,
  desktopSprite,
  desktopSvg,
  drawableOf,
  kitStillSvg,
  resizeKit,
  runsOf,
  stepKit,
  terminalLane,
  terminalSprite,
  touchKit,
} from '../hooks/kit.client'

const MOODS: readonly Mood[] = ['idle', 'think', 'work', 'search', 'test', 'celebrate', 'worried', 'waiting', 'handoff', 'wake', 'sleepy', 'dim', 'sleep', 'tend', 'tired']

const NOW = 10_000_000
const base: MoodInput = {
  now: NOW,
  isWorking: false,
  source: null,
  toolKind: null,
  isCheckRunning: false,
  isFailing: false,
  autopilotState: 'armed',
  isGreen: false,
  turnEndedAt: NOW - 1000,
  hasTurned: true,
  contextStartedAt: NOW - 600_000,
  contextShare: 0.3,
  isKeepingWarm: false,
}

const props = (o: Partial<KitProps> = {}): KitProps => ({
  surface: 'desktop',
  mood: 'idle',
  caption: 'Kit sits by',
  isReduced: false,
  isBusy: false,
  isStrained: false,
  isWorking: false,
  hour: 14,
  contextStartedAt: 1,
  isFresh: false,
  done: 0,
  greenAt: null,
  fails: 0,
  refreshAt: null,
  ...o,
})

const LANE = 80
const TICK = 100
const kitOf = (p: KitProps, o: { isEntering?: boolean; x?: number; seed?: number } = {}) => createKit(p, { lane: LANE, home: 2, seed: o.seed ?? 7, isEntering: o.isEntering ?? false, x: o.x })

type Frame = { s: KitState; d: Drawable }

/** Runs Kit for `ms` a tick at a time (100 ms, Desktop's), its props from `at(t)`, touching it where `touch(t)` says; every state with its drawing. */
function run(s0: KitState, at: (t: number) => KitProps, ms: number, touch: (t: number, s: KitState) => number | null = () => null, tick = TICK): Frame[] {
  const frames: Frame[] = []
  let s = s0
  for (let t = tick; t <= ms; t += tick) {
    const p = at(t)
    s = stepKit(s, p, tick)
    const x = touch(t, s)
    if (x !== null) s = touchKit(s, p, x)
    frames.push({ s, d: drawableOf(s, p) })
  }
  return frames
}

/** A small seeded generator for the tests' own choices. */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Bodies by how Kit holds itself: a change between two classes goes through a transition frame. */
const CLASS: Record<Body, string> = { stand: 'S', walkA: 'S', walkB: 'S', frontStand: 'S', hop: 'S', stretch: 'S', sit: 'T', front: 'T', back: 'T', crouch: 'C', lie: 'L', curl: 'D', roll: 'D' }
// Crouching down and lying flat are one motion: a crouch may meet a lie.
const NEXT_TO = new Set(['SS', 'TT', 'CC', 'LL', 'DD', 'SC', 'CS', 'TC', 'CT', 'TL', 'LT', 'LD', 'DL', 'CL', 'LC'])
const FACING_FREE: ReadonlySet<Body> = new Set<Body>(['front', 'frontStand', 'back'])

/** Every pair of drawn frames in a row, checked: no jump in place, facing or posture. */
function expectNoJumps(frames: readonly Frame[], tick = TICK): void {
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!.d
    const b = frames[i]!.d
    if (a.isGone || b.isGone) continue
    const where = `${frames[i]!.s.t} ms, ${frames[i - 1]!.s.act.kind} → ${frames[i]!.s.act.kind}`
    // Walking at four units a second at most, a pounce's leap at under eight: never a jump.
    expect(Math.abs(b.x - a.x), `moved too far at ${where}`).toBeLessThanOrEqual((8 * tick) / 1000 + 1e-9)
    if (a.pose.facing !== b.pose.facing) expect(FACING_FREE.has(a.pose.body) || FACING_FREE.has(b.pose.body), `turned without a turn frame at ${where}`).toBe(true)
    expect(NEXT_TO.has(CLASS[a.pose.body] + CLASS[b.pose.body]), `${a.pose.body} → ${b.pose.body} at ${where}`).toBe(true)
  }
}

describe('companion', () => {
  test('the mood follows what the run is doing', () => {
    expect(moodOf({ ...base, isWorking: true, source: 'tool', toolKind: 'edit' })).toBe('work')
    expect(moodOf({ ...base, isWorking: true, source: 'thinking' })).toBe('think')
    expect(moodOf({ ...base, isWorking: true, source: 'tool', toolKind: 'read' })).toBe('search')
    expect(moodOf({ ...base, isWorking: true, source: 'tool', toolKind: 'shell', isCheckRunning: true })).toBe('test')
    expect(moodOf({ ...base, isWorking: true, source: 'plan', toolKind: 'edit', contextShare: 0.95 })).toBe('tired')
    expect(moodOf({ ...base, isWorking: true, source: 'plan', toolKind: 'edit', isBusy: true })).toBe('tired')
    expect(moodOf({ ...base, autopilotState: 'handoff', isWorking: true })).toBe('handoff')
    expect(moodOf({ ...base, autopilotState: 'awaiting' })).toBe('waiting')
    expect(moodOf({ ...base, isWaiting: true })).toBe('waiting')
    expect(moodOf({ ...base, isFailing: true })).toBe('worried')
    expect(moodOf({ ...base, isGreen: true })).toBe('celebrate')
    expect(moodOf({ ...base, isGreen: true, turnEndedAt: NOW - 120_000 })).toBe('idle')
    expect(moodOf({ ...base, hasTurned: false, contextStartedAt: NOW - 10_000 })).toBe('wake')
    expect(moodOf({ ...base, turnEndedAt: NOW - 12 * 60_000 })).toBe('sleepy')
    expect(moodOf({ ...base, turnEndedAt: NOW - 40 * 60_000 })).toBe('sleep')
    // While Keep warm holds the cache, Kit tends its fire instead of dozing off, and as it refreshes.
    expect(moodOf({ ...base, turnEndedAt: NOW - 40 * 60_000, isKeepingWarm: true })).toBe('tend')
    expect(moodOf({ ...base, isRefreshing: true })).toBe('tend')
    // The cache about to lapse with nothing to refresh it: Kit dozes, faded.
    expect(moodOf({ ...base, isCacheNear: true })).toBe('dim')
  })

  test('the hooks side hands Kit plain data: its mood in words, a fresh context for a minute, the moments to mark', () => {
    for (const mood of MOODS) expect(CAPTION[mood], mood).toContain('Kit')
    const view = companionView({ mood: 'work', now: NOW, hour: 23, isReduced: false, isBusy: false, isStrained: false, isWorking: true, contextStartedAt: NOW - 30_000, done: 2, greenAt: null, fails: 1, refreshAt: null })
    expect(view).toMatchObject({ mood: 'work', caption: CAPTION.work, isFresh: true, hour: 23, done: 2, fails: 1 })
    expect(companionView({ ...view, now: NOW + 40_000, contextStartedAt: NOW - 30_000 }).isFresh).toBe(false)
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })

  test('every pose draws: twenty by ten letters in the terminal, forty by twenty-four colors on Desktop, mirrored facing left', () => {
    const bodies: Body[] = ['stand', 'walkA', 'walkB', 'sit', 'crouch', 'hop', 'curl', 'lie', 'stretch', 'roll', 'front', 'frontStand', 'back']
    for (const body of bodies) {
      const pose = { body, facing: 1 as const, eyes: 'open' as const, mouth: 'smile' as const, ears: 'up' as const, tail: 0, arms: 'rest' as const, blush: true, props: [], dy: 0, dx: 0, breath: false }
      const t = terminalSprite(pose)
      expect(t.length, body).toBe(T_H)
      for (const row of t) expect(row.length, body).toBe(T_W)
      expect(t.join('').replace(/\./g, '').length, body).toBeGreaterThan(30)
      expect(terminalSprite({ ...pose, facing: -1 })).toEqual(t.map(r => [...r].reverse().join('')))
      const d = desktopSprite(pose)
      expect(d.length, body).toBe(D_H)
      for (const row of d) expect(row.length, body).toBe(D_W)
      expect(d.flat().filter(c => c !== null).length, body).toBeGreaterThan(150)
      expect(desktopSprite({ ...pose, facing: -1 })).toEqual(d.map(r => [...r].reverse()))
      // Outlined: the body's edge is dark; and dim (the cache about to lapse) changes the colors.
      expect(d.flat()).toContain('#5B2C1E')
      expect(desktopSprite(pose, true).flat()).not.toContain('#D97757')
    }
    // Standing, its feet are on the lane's bottom row (terminal) or the row above the shadow (Desktop).
    const stand = terminalSprite({ body: 'stand', facing: 1, eyes: 'open', mouth: 'none', ears: 'up', tail: 0, arms: 'rest', blush: false, props: [], dy: 0, dx: 0, breath: false })
    expect(stand[T_H - 1]).toMatch(/d/)
  })

  test('a new Kit rests where it is put, settled in its mood; a fresh one walks in from beyond the left edge to its place', () => {
    const resting = kitOf(props({ mood: 'idle' }), { x: 30 })
    expect(resting).toMatchObject({ x: 30, posture: 'sit', isGone: false, mood: 'idle' })
    const entering = kitOf(props({ mood: 'wake', isFresh: true }), { isEntering: true })
    expect(entering.x).toBe(-KIT_W)
    const frames = run(entering, () => props({ mood: 'wake', isFresh: true }), 12_000)
    const xs = frames.map(f => f.s.x)
    // In from the left, steadily, then still at its place.
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1]! - 1e-9 || frames[i]!.s.act.kind !== 'walk')).toBe(true)
    expect(frames.find(f => f.s.x === 2)).toBeDefined()
    expect(frames.some(f => f.s.act.kind === 'greet')).toBe(true)
    expectNoJumps(frames)
  })

  test('never a jump: through every mood, at random moments, with touches, Kit only walks, turns through a turn frame and sits or stands through a crouch', () => {
    // Desktop's tick and the terminal's: a turn frame is never skipped between two of the terminal's frames.
    for (const [seed, tick] of [[1, 100], [2, 100], [3, 100], [4, 200], [5, 200], [6, 200]] as const) {
      const r = seeded(seed)
      const moods: { at: number; mood: Mood }[] = []
      for (let t = 0; t < 240_000; t += 300 + Math.floor(r() * 6000)) moods.push({ at: t, mood: MOODS[Math.floor(r() * MOODS.length)]! })
      const moodAt = (t: number) => [...moods].reverse().find(m => m.at <= t)?.mood ?? 'idle'
      const at = (t: number) => props({ mood: moodAt(t), isWorking: ['think', 'work', 'search', 'test', 'tired'].includes(moodAt(t)), done: Math.floor(t / 50_000), greenAt: t > 120_000 ? 120_000 : null, fails: Math.floor(t / 90_000), refreshAt: t > 200_000 ? 200_000 : null, contextStartedAt: t > 150_000 ? 150_000 : 1, isFresh: t > 150_000 && t < 210_000 })
      const touches = new Set<number>()
      for (let i = 0; i < 40; i++) touches.add(Math.floor(r() * 1200) * 200)
      const frames = run(kitOf(at(0), { seed }), at, 240_000, (t, s) => (touches.has(t) ? s.x + (r() < 0.8 ? 10 : 40) : null), tick)
      expectNoJumps(frames, tick)
      // It went everywhere it should: walking, sitting, a reaction or two, and gone at a handoff.
      const kinds = new Set(frames.map(f => f.s.act.kind))
      expect(kinds.has('walk'), `seed ${seed}`).toBe(true)
      expect(frames.every(f => f.s.isGone || (f.s.x >= -KIT_W && f.s.x <= LANE + 2))).toBe(true)
    }
  })

  test('a mood settles: a flicker between tool calls changes nothing, a new mood waits until it has held, and holds a while once it applies', () => {
    const work = props({ mood: 'work', isWorking: true })
    const steady = run(kitOf(work), () => work, 20_000)
    // Work and reading every 300 ms: Kit keeps working, the very same acts as with work alone.
    const flicker = run(kitOf(work), t => props({ mood: Math.floor(t / 300) % 2 === 0 ? 'work' : 'search', isWorking: true }), 20_000)
    expect(flicker.every(f => f.s.mood === 'work')).toBe(true)
    const acts = (frames: Frame[]) => frames.map(f => `${f.s.act.kind}@${f.s.act.t0}`).filter((k, i, all) => all.indexOf(k) === i)
    expect(acts(flicker)).toEqual(acts(steady))
    // A real change applies after it has held SETTLE_MS (and the old mood HOLD_MS).
    const change = run(kitOf(props({ mood: 'idle' })), t => props({ mood: t < 5000 ? 'idle' : 'think', isWorking: t >= 5000 }), 10_000)
    const settled = change.find(f => f.s.mood === 'think')!
    expect(settled.s.t).toBeGreaterThanOrEqual(5000 + SETTLE_MS)
    expect(settled.s.t).toBeLessThanOrEqual(5000 + SETTLE_MS + 2 * TICK)
    // Back to idle a moment after: think holds HOLD_MS first.
    const back = run(settled.s, t => props({ mood: 'idle', isWorking: false }), 6000)
    const idleAgain = back.find(f => f.s.mood === 'idle')!
    expect(idleAgain.s.t - settled.s.t).toBeGreaterThanOrEqual(HOLD_MS)
    // A failure, a question, a handoff, a finish apply at once.
    for (const mood of ['worried', 'waiting', 'handoff', 'celebrate'] as const) {
      const now = run(kitOf(props({ mood: 'work', isWorking: true })), () => props({ mood }), 200)
      expect(now[0]!.s.mood, mood).toBe(mood)
    }
  })

  test('at a handoff Kit carries the notes off to the right and stays gone; a new mood brings a fresh Kit in from the left', () => {
    const at = (t: number) => props({ mood: t < 20_000 ? 'handoff' : 'wake', contextStartedAt: t < 20_000 ? 1 : 20_000, isFresh: t >= 20_000 })
    const frames = run(kitOf(props({ mood: 'work', isWorking: true }), { x: 30 }), at, 40_000)
    const leaving = frames.filter(f => f.s.t < 20_000 && f.s.act.kind === 'walk' && f.s.act.style === 'exit')
    expect(leaving.length).toBeGreaterThan(0)
    expect(leaving.every(f => f.d.pose.props.includes('notes'))).toBe(true)
    expect(frames.find(f => f.s.t === 19_900)?.s.isGone).toBe(true)
    // Back in from beyond the left edge, then home.
    const back = frames.filter(f => f.s.t > 20_000)
    expect(back[0]!.s.x).toBeLessThan(0)
    expect(back.some(f => f.s.act.kind === 'walk' && f.s.act.style === 'enter')).toBe(true)
    expect(back[back.length - 1]!.s.isGone).toBe(false)
    expectNoJumps(frames)
  })

  test('a fresh context while Kit is in view: a stretch and a look, never a re-entrance', () => {
    const at = (t: number) => props({ mood: 'idle', contextStartedAt: t < 3000 ? 1 : 3000, isFresh: t >= 3000 })
    const frames = run(kitOf(props(), { x: 25 }), at, 8000)
    expect(frames.some(f => f.s.act.kind === 'greet')).toBe(true)
    expect(frames.every(f => f.s.x >= 0)).toBe(true)
  })

  test('a touch is a reaction, every one before any repeats and never the same twice in a row; a pause between, and many touches make it dizzy', () => {
    let s = kitOf(props(), { x: 20 })
    const seen: string[] = []
    for (let round = 0; round < 16; round++) {
      s = run(s, () => props(), 3000).at(-1)!.s
      s = touchKit(s, props(), s.x + 10)
      s = run(s, () => props(), 500).at(-1)!.s
      seen.push(s.lastReaction ?? '')
    }
    expect(new Set(seen.slice(0, 8)).size).toBe(8)
    expect(new Set(seen.slice(8)).size).toBe(8)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1])
    // Within the cooldown a second touch changes nothing.
    const once = touchKit(run(kitOf(props(), { x: 20 }), () => props(), 2000).at(-1)!.s, props(), 30)
    const twice = touchKit(stepKit(once, props(), COOLDOWN_MS / 3), props(), 30)
    expect(twice.lastReaction).toBe(once.lastReaction)
    // Five touches in a few seconds: dizzy.
    let d = run(kitOf(props(), { x: 20 }), () => props(), 2000).at(-1)!.s
    for (let i = 0; i < DIZZY_TAPS; i++) d = touchKit(stepKit(d, props(), 400), props(), d.x + 10)
    expect(run(d, () => props(), 2500).some(f => f.s.act.kind === 'dizzy')).toBe(true)
  })

  test('asleep, a touch startles Kit; while Claude works it only looks up; a touch beside it, idle, turns its head there', () => {
    const asleep = run(kitOf(props({ mood: 'sleep' })), () => props({ mood: 'sleep' }), 5000).at(-1)!.s
    expect(asleep.posture).toBe('down')
    const startled = run(touchKit(asleep, props({ mood: 'sleep' }), asleep.x + 10), () => props({ mood: 'sleep' }), 300)
    expect(startled.some(f => f.s.act.kind === 'startled')).toBe(true)
    const working = run(kitOf(props({ mood: 'work', isWorking: true })), () => props({ mood: 'work', isWorking: true }), 3000).at(-1)!.s
    const looked = run(touchKit(working, props({ mood: 'work', isWorking: true }), working.x + 10), () => props({ mood: 'work', isWorking: true }), 500)
    expect(looked.some(f => f.s.act.kind === 'glance')).toBe(true)
    const idle = run(kitOf(props(), { x: 10 }), () => props(), 3000).at(-1)!.s
    const noticed = run(touchKit(idle, props(), 70), () => props(), 2000)
    expect(noticed.some(f => f.s.act.kind === 'notice')).toBe(true)
    // Touching nothing while it works or is away does nothing.
    expect(touchKit(working, props({ mood: 'work', isWorking: true }), 75)).toEqual(working)
  })

  test('moments: a milestone done plants a flag, a green finish is a dance, a failure a facepalm, a refresh pokes the fire; none replays on a new Kit', () => {
    const quiet = run(kitOf(props(), { x: 20 }), () => props(), 2000).at(-1)!.s
    const marks: [Partial<KitProps>, string][] = [
      [{ done: 1 }, 'stamp'],
      [{ greenAt: 5 }, 'dance'],
      [{ fails: 1 }, 'facepalm'],
      [{ refreshAt: 9 }, 'poke'],
    ]
    for (const [change, kind] of marks) {
      const frames = run(quiet, () => props(change), 4000)
      expect(frames.some(f => f.s.act.kind === kind), kind).toBe(true)
    }
    const fresh = run(kitOf(props({ done: 3, greenAt: 5, fails: 2, refreshAt: 9 }), { x: 20 }), () => props({ done: 3, greenAt: 5, fails: 2, refreshAt: 9 }), 6000)
    for (const kind of ['stamp', 'dance', 'facepalm', 'poke']) expect(fresh.some(f => f.s.act.kind === kind), kind).toBe(false)
  })

  test('calm: Reduce motion and a strained machine hold one still pose; a busy machine never walks', () => {
    for (const calm of [{ isReduced: true }, { isStrained: true }] as Partial<KitProps>[]) {
      for (const mood of MOODS) {
        const p = props({ mood, ...calm })
        const frames = run(kitOf(p, { x: 20 }), () => p, 8000, (t, s) => (t === 3000 ? s.x + 10 : null))
        const first = JSON.stringify(frames[0]!.d)
        expect(frames.every(f => JSON.stringify(f.d) === first), `${mood} still`).toBe(true)
        expect(frames[0]!.d.particles.length).toBeLessThanOrEqual(1)
        expect(frames[0]!.d.isGone).toBe(false)
      }
    }
    const busy = (t: number) => props({ mood: t < 30_000 ? 'idle' : 'think', isBusy: true, isWorking: t >= 30_000 })
    const frames = run(kitOf(busy(0), { x: 20 }), busy, 90_000)
    expect(frames.filter(f => f.s.act.kind === 'walk' && f.s.act.style !== 'stop').length).toBe(0)
  })

  test('a narrower lane keeps Kit inside it, where it was', () => {
    const s = kitOf(props(), { x: 60 })
    expect(resizeKit(s, 50, 2).x).toBe(50 - KIT_W)
    expect(resizeKit(s, 120, 2).x).toBe(60)
  })

  test('the terminal lane: five rows of half blocks, Kit where the model says, what floats beside it on empty cells only', () => {
    const s = kitOf(props({ surface: 'terminal' }), { x: 12 })
    const d = drawableOf(s, props({ surface: 'terminal' }))
    const rows = terminalLane(d, 60)
    expect(rows.length).toBe(5)
    for (const row of rows) expect(row.length).toBe(60)
    const text = rows.map(r => r.map(c => c.glyph).join(''))
    expect(text.join('')).toMatch(/[▀▄█]/)
    // Nothing left of its box.
    for (const line of text) expect(line.slice(0, 12).trim()).toBe('')
    const withMark = terminalLane({ ...d, particles: [{ kind: 'question', x: 30, y: 9, frame: 0, tone: 0 }] }, 60)
    expect(withMark.flat().some(c => c.glyph === '?')).toBe(true)
    // Runs: a row is a few styled pieces, trailing blanks dropped.
    const runs = runsOf(rows[4]!)
    expect(runs.length).toBeLessThan(20)
    expect(runs.map(r => r.glyph).join('').length).toBeLessThanOrEqual(60)
    // Gone: an empty lane.
    expect(terminalLane({ ...d, isGone: true }, 60).flat().every(c => c.glyph === ' ')).toBe(true)
  })

  test('Desktop draws one image a frame: crisp pixels, a path per color, transparent in both themes, small enough at any width', () => {
    const p = props({ mood: 'celebrate' })
    const frames = run(kitOf(props(), { x: 30 }), () => p, 3000)
    const busiest = frames.reduce((a, f) => (f.d.particles.length > a.d.particles.length ? f : a), frames[0]!)
    expect(busiest.d.particles.length).toBeGreaterThan(5)
    const svg = desktopSvg(busiest.d, 560)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain('<style>:root{color-scheme:light dark}</style>')
    expect(svg).toContain('<title>Kit sits by</title>')
    expect(svg).not.toContain('<animate')
    expect(svg.length).toBeLessThan(40_000)
    // One path per color: no color twice.
    const fills = [...svg.matchAll(/<path fill="([^"]+)"/g)].map(m => m[1])
    expect(new Set(fills).size).toBe(fills.length)
    // The still image for surfaces without a surface module.
    const still = kitStillSvg({ ...props({ mood: 'waiting' }) }, 360)
    expect(still).toMatchObject({ width: 360, height: 84 })
    expect(still.source).toContain('<path')
  })
})
