import { describe, expect, test } from 'claude-code/testing'

import { type Mood, type MoodInput, PALETTE, animationOf, mirrored, moodOf, svgCompanion } from '../hooks/features/companion'

const MOODS: readonly Mood[] = ['idle', 'think', 'work', 'search', 'test', 'celebrate', 'worried', 'waiting', 'handoff', 'wake', 'sleepy', 'sleep', 'tend', 'tired']

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
  test('every mood is frames of four pixel rows, one width per mood, in the palette', () => {
    for (const mood of MOODS) {
      const a = animationOf(mood, { isReduced: false, isBusy: false })
      expect(a.frames.length, mood).toBeGreaterThan(0)
      const widths = new Set(a.frames.map(f => f[0]?.length))
      expect(widths.size, mood).toBe(1)
      for (const f of a.frames) {
        expect(f.length, mood).toBe(4)
        for (const row of f) {
          expect(row.length, mood).toBe(f[0]?.length)
          for (const ch of row) expect(ch === '.' || PALETTE[ch] !== undefined, `${mood}: ${ch}`).toBe(true)
        }
      }
      expect(a.caption, mood).toContain('Kit')
    }
    expect(mirrored(['ab..', 'c...'])).toEqual(['..ba', '...c'])
  })

  test('the mood follows what Claude is doing', () => {
    expect(moodOf({ ...base, isWorking: true, source: 'tool', toolKind: 'edit' })).toBe('work')
    expect(moodOf({ ...base, isWorking: true, source: 'thinking' })).toBe('think')
    expect(moodOf({ ...base, isWorking: true, source: 'tool', toolKind: 'read' })).toBe('search')
    expect(moodOf({ ...base, isWorking: true, source: 'tool', toolKind: 'shell', isCheckRunning: true })).toBe('test')
    expect(moodOf({ ...base, isWorking: true, source: 'plan', toolKind: 'edit', contextShare: 0.95 })).toBe('tired')
    expect(moodOf({ ...base, autopilotState: 'handoff', isWorking: true })).toBe('handoff')
    expect(moodOf({ ...base, autopilotState: 'awaiting' })).toBe('waiting')
    expect(moodOf({ ...base, isFailing: true })).toBe('worried')
    expect(moodOf({ ...base, isGreen: true })).toBe('celebrate')
    expect(moodOf({ ...base, isGreen: true, turnEndedAt: NOW - 120_000 })).toBe('idle')
    expect(moodOf({ ...base, hasTurned: false, contextStartedAt: NOW - 10_000 })).toBe('wake')
    expect(moodOf({ ...base, turnEndedAt: NOW - 12 * 60_000 })).toBe('sleepy')
    expect(moodOf({ ...base, turnEndedAt: NOW - 40 * 60_000 })).toBe('sleep')
    // While Keep warm holds the cache, Kit tends it instead of dozing off.
    expect(moodOf({ ...base, turnEndedAt: NOW - 40 * 60_000, isKeepingWarm: true })).toBe('tend')
  })

  test('reduced motion holds one frame still; a busy machine plays it slower', () => {
    const still = animationOf('work', { isReduced: true, isBusy: false })
    expect(still).toMatchObject({ fps: 0, walk: 'none' })
    expect(still.frames.length).toBe(1)
    const busy = animationOf('handoff', { isReduced: false, isBusy: true })
    expect(busy.fps).toBeLessThanOrEqual(2)
    expect(busy.walk).toBe('normal')
  })

  test('Desktop draws Kit as an SVG that animates itself, and holds still under reduced motion', () => {
    const walking = svgCompanion(animationOf('work', { isReduced: false, isBusy: false }), 300)
    expect(walking).toContain('<animateTransform')
    expect(walking).toContain('calcMode="discrete"')
    expect(walking).toContain('<title>Kit trots along while Claude works</title>')
    const sitting = svgCompanion(animationOf('test', { isReduced: false, isBusy: false }), 300)
    expect(sitting).not.toContain('animateTransform')
    expect(sitting).toContain('⠋')
    const still = svgCompanion(animationOf('work', { isReduced: true, isBusy: false }), 300)
    expect(still).not.toContain('<animate')
  })
})
