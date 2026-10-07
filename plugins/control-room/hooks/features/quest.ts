/**
 * Quest log: a light game layer over verified progress, shown while the
 * person chose the Quest log answer style.
 *
 * XP is awarded only for outcomes Control Room counts itself: a milestone
 * Claude marked done, a check that passes (or passes again after failing), a
 * plan finished, a handoff whose notes were verified. Never for activity
 * (lines written, files touched, tool calls), which would reward churn, and
 * never for anything Claude merely says. Each outcome pays once: a milestone
 * once per run, a check's first pass once per turn. Pure: the runtime decides
 * when an event happened.
 */

import { clean } from '../core/text'

export type QuestEventKind = 'milestone' | 'green' | 'comeback' | 'fullClear' | 'handoff'

export const XP: Record<QuestEventKind, number> = { milestone: 50, green: 10, comeback: 30, fullClear: 100, handoff: 40 }

export type AchievementId = 'first-green' | 'comeback' | 'full-clear' | 'clean-handoff' | 'relay' | 'long-haul'

export const ACHIEVEMENTS: readonly { id: AchievementId; name: string; hint: string }[] = [
  { id: 'first-green', name: 'First green', hint: 'A check passes' },
  { id: 'comeback', name: 'Comeback', hint: 'A failing check passes again' },
  { id: 'full-clear', name: 'Full clear', hint: 'Every milestone of a plan of three or more' },
  { id: 'clean-handoff', name: 'Clean handoff', hint: 'Autopilot hands off with verified notes' },
  { id: 'relay', name: 'Relay', hint: 'One run across three contexts' },
  { id: 'long-haul', name: 'Long haul', hint: 'Ten milestones done in one run' },
]

const UNLOCKED_BY: Partial<Record<QuestEventKind, AchievementId>> = {
  green: 'first-green',
  comeback: 'comeback',
  fullClear: 'full-clear',
  handoff: 'clean-handoff',
}

export type QuestAward = { at: number; xp: number; text: string }

/** Lifetime progress, kept in the plugin store. */
export type QuestState = { v: 1; xp: number; unlocked: Partial<Record<AchievementId, number>>; recent: QuestAward[] }

/** A run's share: its XP, and the milestones already paid for (by their key). */
export type RunQuest = { xp: number; paid: string[] }

export const emptyQuest = (): QuestState => ({ v: 1, xp: 0, unlocked: {}, recent: [] })

export const emptyRunQuest = (): RunQuest => ({ xp: 0, paid: [] })

/** Level n starts at 50·n·(n−1) XP: 0, 100, 300, 600, 1000, 1500 … */
export function levelOf(xp: number): { level: number; floor: number; next: number } {
  const x = Math.max(0, Math.floor(xp))
  let level = 1
  while (50 * (level + 1) * level <= x) level += 1
  return { level, floor: 50 * level * (level - 1), next: 50 * (level + 1) * level }
}

export type Award = { state: QuestState; xp: number; levelUp: number | null; unlocked: AchievementId[] }

/** One event: its XP, its line in the log, and the achievement it unlocks the first time. */
export function award(state: QuestState, event: { kind: QuestEventKind; text: string }, now: number): Award {
  const xp = XP[event.kind]
  const before = levelOf(state.xp).level
  const unlocked: AchievementId[] = []
  const next: QuestState = {
    v: 1,
    xp: state.xp + xp,
    unlocked: { ...state.unlocked },
    recent: [{ at: now, xp, text: clean(event.text, 90) }, ...state.recent].slice(0, RECENT_MAX),
  }
  const id = UNLOCKED_BY[event.kind]
  if (id !== undefined && next.unlocked[id] === undefined) {
    next.unlocked[id] = now
    unlocked.push(id)
  }
  const after = levelOf(next.xp).level
  return { state: next, xp, levelUp: after > before ? after : null, unlocked }
}

/** Achievements a run earns by its shape: three contexts, ten milestones. No XP. */
export function unlockForRun(state: QuestState, run: { sessions: number; milestonesDone: number }, now: number): { state: QuestState; unlocked: AchievementId[] } {
  const unlocked: AchievementId[] = []
  const add = (id: AchievementId, isEarned: boolean) => {
    if (isEarned && state.unlocked[id] === undefined && !unlocked.includes(id)) unlocked.push(id)
  }
  add('relay', run.sessions >= 3)
  add('long-haul', run.milestonesDone >= 10)
  if (unlocked.length === 0) return { state, unlocked }
  const next = { ...state, unlocked: { ...state.unlocked } }
  for (const id of unlocked) next.unlocked[id] = now
  return { state: next, unlocked }
}

export const achievementName = (id: AchievementId): string => ACHIEVEMENTS.find(a => a.id === id)?.name ?? id

const RECENT_MAX = 8

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** A stored quest, validated: anything malformed starts over at zero. */
export function questOf(raw: unknown): QuestState {
  if (!isRecord(raw)) return emptyQuest()
  const unlocked: Partial<Record<AchievementId, number>> = {}
  if (isRecord(raw.unlocked)) {
    for (const a of ACHIEVEMENTS) {
      const at = raw.unlocked[a.id]
      if (typeof at === 'number' && Number.isFinite(at)) unlocked[a.id] = at
    }
  }
  const recent = Array.isArray(raw.recent)
    ? raw.recent
        .filter(isRecord)
        .map(r => ({ at: count(r.at), xp: count(r.xp), text: typeof r.text === 'string' ? clean(r.text, 90) : '' }))
        .filter(r => r.text !== '')
        .slice(0, RECENT_MAX)
    : []
  return { v: 1, xp: count(raw.xp), unlocked, recent }
}

/** A run's stored quest share, validated. */
export function runQuestOf(raw: unknown): RunQuest {
  if (!isRecord(raw)) return emptyRunQuest()
  const paid = Array.isArray(raw.paid) ? raw.paid.filter((x): x is string => typeof x === 'string').slice(-200) : []
  return { xp: count(raw.xp), paid }
}
