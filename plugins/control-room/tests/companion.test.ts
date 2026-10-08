import { describe, expect, test } from 'claude-code/testing'

import { type Mood, type MoodInput, PALETTE, SPRITE_H, SPRITE_W, animationOf, frame, mirrored, moodOf, svgCompanion } from '../hooks/features/companion'

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

describe('companion', () => {
  test('every mood is frames of the sprite’s size, ten pixel rows (five terminal rows), in its palette', () => {
    for (const mood of MOODS) {
      const a = animationOf(mood, { isReduced: false, isBusy: false })
      expect(a.frames.length, mood).toBeGreaterThan(0)
      for (const f of a.frames) {
        expect(f.length, mood).toBe(SPRITE_H)
        for (const row of f) {
          expect(row.length, mood).toBe(SPRITE_W)
          for (const ch of row) expect(ch === '.' || a.palette[ch] !== undefined, `${mood}: ${ch}`).toBe(true)
        }
      }
      expect(a.caption, mood).toContain('Kit')
    }
    expect(mirrored(['ab..', 'c...'])).toEqual(['..ba', '...c'])
  })

  test('the sprite stands on its feet on the bottom row; sitting, it rests on its base; hopping, its feet leave the ground', () => {
    const bottom = (rows: string[]) => rows[SPRITE_H - 1] ?? ''
    expect(bottom(frame('stand'))).toMatch(/^\.\.dd\.+dd\.+$/)
    expect(bottom(frame('sit'))).toMatch(/d{10}/)
    expect(bottom(frame('hop'))).toBe('.'.repeat(SPRITE_W))
    // Two eyes, each two by two with a glint, looking the way it faces.
    expect(frame('stand').join('').split('k').length - 1).toBe(6)
    expect(frame('stand').join('')).toContain('w')
    // A fire stays on the ground whether Kit stands or sits beside it.
    const fire = (rows: string[]) => rows.map(r => r.slice(15)).join('|')
    expect(fire(frame('sit', 'open', ['fireA']))).toBe(fire(frame('stand', 'open', ['fireA'])))
    for (const ch of new Set([...frame('stand', 'wide', ['magnifier', 'sweatA', 'note', 'gasp']).join('')])) expect(ch === '.' || PALETTE[ch] !== undefined).toBe(true)
  })

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
    expect(animationOf('dim', { isReduced: false, isBusy: false }).palette.o).not.toBe(PALETTE.o)
  })

  test('Kit walks off with the notes at a handoff and back in with the fresh context; thinking, it paces with pauses', () => {
    expect(animationOf('handoff', { isReduced: false, isBusy: false }).walk).toBe('exit')
    expect(animationOf('wake', { isReduced: false, isBusy: false }).walk).toBe('enter')
    expect(animationOf('think', { isReduced: false, isBusy: false }).walk).toBe('patrol')
    // Most moods stay put: calm by design.
    const still = MOODS.filter(m => animationOf(m, { isReduced: false, isBusy: false }).walk === 'none')
    expect(still.length).toBeGreaterThanOrEqual(9)
  })

  test('reduced motion and a machine at its limit hold one frame still; a busy machine plays it slower', () => {
    const still = animationOf('work', { isReduced: true, isBusy: false })
    expect(still).toMatchObject({ fps: 0, walk: 'none' })
    expect(still.frames.length).toBe(1)
    expect(animationOf('think', { isReduced: false, isBusy: true, isStrained: true })).toMatchObject({ fps: 0, walk: 'none' })
    const busy = animationOf('search', { isReduced: false, isBusy: true })
    expect(busy.fps).toBeLessThanOrEqual(2)
    expect(busy.walk).toBe('slow')
  })

  test('Desktop draws Kit as a transparent SVG that animates itself, inside its own bounds, and holds still under reduced motion', () => {
    const pacing = svgCompanion(animationOf('think', { isReduced: false, isBusy: false }), 300)
    expect(pacing).toContain('<style>:root{color-scheme:light dark}</style>')
    expect(pacing).toContain('<animateTransform')
    expect(pacing).toContain('calcMode="discrete"')
    expect(pacing).toContain('<title>Kit paces while Claude thinks</title>')
    // No ground line of its own (the lane sits above the headline, not on an edge), and nothing drawn off the image.
    expect(pacing).not.toContain('<line')
    for (const m of pacing.matchAll(/<text x="(-?[\d.]+)"/g)) expect(Number(m[1]) + 12).toBeGreaterThanOrEqual(0)
    const leaving = svgCompanion(animationOf('handoff', { isReduced: false, isBusy: false }), 300)
    expect(leaving).toContain('fill="freeze"')
    const sitting = svgCompanion(animationOf('test', { isReduced: false, isBusy: false }), 300)
    expect(sitting).not.toContain('animateTransform')
    expect(sitting).toContain('⠋')
    const still = svgCompanion(animationOf('work', { isReduced: true, isBusy: false }), 300)
    expect(still).not.toContain('<animate')
  })
})
