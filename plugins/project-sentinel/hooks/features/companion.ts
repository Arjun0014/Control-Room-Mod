/**
 * The companion: Kit, a small Claude-orange creature that lives in a lane above the status bar
 * (off unless the person turns it on) and shows, by what it does, what the run is doing: pacing
 * while Claude thinks, typing while it works, reading while it searches, watching a check,
 * dancing at a green finish, worried by a failure, waiting with a question mark when the person
 * is needed, fanning itself on a busy machine, tending a small fire while Keep warm holds the
 * cache, dozing as the cache nears its expiry, carrying the notes off at a handoff and walking
 * back in with the fresh context.
 *
 * Pure: the mood is a function of the status bar's state and the time, and the props are plain
 * data. Kit itself (what it does between redraws, its art, a touch) is its surface module,
 * hooks/kit.client.tsx, which plays on the surface's own clock.
 */

import type { CompanionView, KitMood } from '../../types'

export type Mood = KitMood

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

/** A fresh context: Kit walks in when it is drawn within this long of the context's start. */
export const FRESH_MS = 60_000

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
  if (!m.hasTurned) return m.contextStartedAt !== null && m.now - m.contextStartedAt < FRESH_MS ? 'wake' : 'idle'
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

/** What Kit is doing, in words: the drawing's alt text, and a tooltip. */
export const CAPTION: Record<Mood, string> = {
  idle: 'Kit sits by, waiting for the next turn',
  think: 'Kit paces while Claude thinks',
  work: 'Kit types away while Claude works',
  search: 'Kit reads while Claude searches',
  test: 'Kit watches the check run',
  celebrate: 'Kit celebrates a green finish',
  worried: 'Kit is worried: something failed',
  waiting: 'Kit waits: the run needs you, or a result',
  handoff: 'Kit carries the handoff notes to the fresh context',
  wake: 'Kit is back for the fresh context',
  sleepy: 'Kit is getting sleepy',
  dim: 'Kit dozes: the prompt cache is about to lapse',
  sleep: 'Kit is asleep',
  tend: 'Kit keeps the cache warm while you are away',
  tired: 'Kit is tired: the machine is busy or the context nearly full',
}

/** Everything Kit's surface module needs, as plain data (the surface is added where it is drawn). */
export function companionView(input: {
  mood: Mood
  now: number
  hour: number
  isReduced: boolean
  isBusy: boolean
  isStrained: boolean
  isWorking: boolean
  contextStartedAt: number | null
  done: number
  greenAt: number | null
  fails: number
  refreshAt: number | null
}): CompanionView {
  return {
    mood: input.mood,
    caption: CAPTION[input.mood],
    isReduced: input.isReduced,
    isBusy: input.isBusy,
    isStrained: input.isStrained,
    isWorking: input.isWorking,
    hour: input.hour,
    contextStartedAt: input.contextStartedAt,
    isFresh: input.contextStartedAt !== null && input.now - input.contextStartedAt < FRESH_MS,
    done: input.done,
    greenAt: input.greenAt,
    fails: input.fails,
    refreshAt: input.refreshAt,
  }
}
