/**
 * The orchestration layer's model: what a run holds over time, as plain data kept with the run
 * (docs/ORCHESTRATION.md).
 *
 *   Mission Queue    work the person gave Claude for later, each item due at a boundary
 *   Decision Inbox   choices Claude left for the person, each with its answer once given
 *   Watchers         the run parked until a time, each with the run's checkpoint when it parked
 *   Run Budget       optional limits on the run's cost, wall-clock time and handoffs
 *
 * Everything here belongs to the run, so it survives /clear, handoffs, reloads and a resumed
 * session; nothing here runs a timer or calls the engine (app/operations.ts does). Pure: each
 * function takes the operations and returns new ones.
 */

import type { QueueTarget, WatchStrategy } from '../../types'
import { tokens as fmtTokens } from '../core/format'
import { clean } from '../core/text'
import { untilWords } from './when'

export type { QueueTarget, WatchStrategy }

// ---------------------------------------------------------------------------
// Shapes

export type QueueStatus = 'queued' | 'due' | 'sending' | 'unsure' | 'delivered' | 'cancelled'

export type QueueItem = {
  id: string
  text: string
  target: QueueTarget
  status: QueueStatus
  createdAt: number
  /** For After the current milestone: the milestone under way when it was added (its key and subject). */
  milestoneKey: string | null
  milestone: string | null
  dueAt: number | null
  sentAt: number | null
  deliveredAt: number | null
  /** How it reached Claude: a prompt of its own, a note with tool results, a fresh context's first message. */
  via: 'prompt' | 'note' | 'fresh' | null
}

export type DecisionStatus = 'open' | 'answered' | 'sending' | 'unsure' | 'delivered' | 'withdrawn'

export type Decision = {
  id: string
  question: string
  context: string | null
  options: string[]
  allowText: boolean
  urgency: 'low' | 'normal' | 'high'
  isBlocking: boolean
  milestone: string | null
  createdAt: number
  status: DecisionStatus
  answer: string | null
  answeredAt: number | null
  deliveredAt: number | null
  via: 'prompt' | 'note' | 'context' | 'fresh' | null
}

/** The run's fingerprint when a watcher parked it: any turn, any change of milestones or of context since means it moved on. */
export type Checkpoint = { at: number; sessionId: string | null; turns: number; plan: string }

export type SmartChoice = { mode: 'warm' | 'fresh'; hold: boolean; reason: string; at: number }

export type WatcherStatus = 'armed' | 'paused' | 'due' | 'stale' | 'waking' | 'done' | 'dismissed'

export type Watcher = {
  id: string
  label: string
  createdAt: number
  wakeAt: number
  strategy: WatchStrategy
  status: WatcherStatus
  milestone: string | null
  /** Null while armed during a turn: taken when that turn ends. */
  checkpoint: Checkpoint | null
  decided: SmartChoice | null
  source: 'person' | 'scout' | 'carried'
  firedAt: number | null
  endedAt: number | null
  outcome: string | null
  /** Why it waits for the person instead of waking by itself (set when due). */
  needs: string | null
}

export type BudgetKey = 'cost' | 'time' | 'handoffs'
export type BudgetAction = 'notify' | 'ask' | 'finish'

export type Budget = {
  costUsd: number | null
  durationMs: number | null
  handoffs: number | null
  atLimit: BudgetAction
  /** Limits already said to be near (80%) and reached, so each is said once. */
  warned: BudgetKey[]
  reached: BudgetKey[]
  /** The person let automation go on past these limits; a newly reached one asks again. */
  approved: BudgetKey[]
}

export type OpsLogEntry = { at: number; text: string }

export type RunOps = {
  v: 1
  seq: { q: number; d: number; w: number }
  /**
   * Turns the person started (and work they pushed into the run), counted at each turn's end: a
   * watcher's checkpoint compares it, so Project Sentinel's own turns (a wake, queued work it
   * delivered at a boundary) never make a parked run read as changed.
   */
  personTurns: number
  queue: QueueItem[]
  decisions: Decision[]
  watchers: Watcher[]
  budget: Budget | null
  log: OpsLogEntry[]
}

export const OPS_LIMITS = {
  queueOpen: 30,
  decisionsOpen: 20,
  watchersOpen: 10,
  /** Finished items kept for the record, per kind. */
  kept: 10,
  log: 30,
  queueText: 4000,
  question: 300,
  context: 800,
  option: 80,
  answer: 2000,
  label: 80,
} as const

export const emptyOps = (): RunOps => ({ v: 1, seq: { q: 0, d: 0, w: 0 }, personTurns: 0, queue: [], decisions: [], watchers: [], budget: null, log: [] })

// ---------------------------------------------------------------------------
// Reading what the store holds: anything malformed is dropped, never trusted.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const strOrNull = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : null)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : d)

const TARGETS: readonly QueueTarget[] = ['boundary', 'turn', 'milestone', 'fresh']
const QUEUE_STATUSES: readonly QueueStatus[] = ['queued', 'due', 'sending', 'unsure', 'delivered', 'cancelled']
const DECISION_STATUSES: readonly DecisionStatus[] = ['open', 'answered', 'sending', 'unsure', 'delivered', 'withdrawn']
const WATCHER_STATUSES: readonly WatcherStatus[] = ['armed', 'paused', 'due', 'stale', 'waking', 'done', 'dismissed']
const STRATEGIES: readonly WatchStrategy[] = ['smart', 'warm', 'fresh']
const BUDGET_KEYS: readonly BudgetKey[] = ['cost', 'time', 'handoffs']

function queueItemOf(v: unknown): QueueItem | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.text !== 'string' || v.text.trim() === '') return null
  return {
    id: v.id.slice(0, 12),
    text: v.text.slice(0, OPS_LIMITS.queueText),
    target: oneOf(v.target, TARGETS, 'boundary'),
    status: oneOf(v.status, QUEUE_STATUSES, 'queued'),
    createdAt: num(v.createdAt),
    milestoneKey: strOrNull(v.milestoneKey, 200),
    milestone: strOrNull(v.milestone, 200),
    dueAt: numOrNull(v.dueAt),
    sentAt: numOrNull(v.sentAt),
    deliveredAt: numOrNull(v.deliveredAt),
    via: v.via === 'prompt' || v.via === 'note' || v.via === 'fresh' ? v.via : null,
  }
}

function decisionOf(v: unknown): Decision | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.question !== 'string' || v.question.trim() === '') return null
  const options = Array.isArray(v.options) ? v.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map(o => o.slice(0, OPS_LIMITS.option)).slice(0, 4) : []
  const via = v.via === 'prompt' || v.via === 'note' || v.via === 'context' || v.via === 'fresh' ? v.via : null
  return {
    id: v.id.slice(0, 12),
    question: v.question.slice(0, OPS_LIMITS.question),
    context: strOrNull(v.context, OPS_LIMITS.context),
    options,
    allowText: v.allowText === true || options.length === 0,
    urgency: oneOf(v.urgency, ['low', 'normal', 'high'] as const, 'normal'),
    isBlocking: v.isBlocking === true,
    milestone: strOrNull(v.milestone, 200),
    createdAt: num(v.createdAt),
    status: oneOf(v.status, DECISION_STATUSES, 'open'),
    answer: strOrNull(v.answer, OPS_LIMITS.answer),
    answeredAt: numOrNull(v.answeredAt),
    deliveredAt: numOrNull(v.deliveredAt),
    via,
  }
}

function storedCheckpoint(v: unknown): Checkpoint | null {
  if (!isRecord(v)) return null
  return { at: num(v.at), sessionId: strOrNull(v.sessionId, 100), turns: num(v.turns), plan: str(v.plan, 64) }
}

function smartOf(v: unknown): SmartChoice | null {
  if (!isRecord(v) || (v.mode !== 'warm' && v.mode !== 'fresh')) return null
  return { mode: v.mode, hold: v.hold === true, reason: str(v.reason, 200), at: num(v.at) }
}

function watcherOf(v: unknown): Watcher | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.label !== 'string' || numOrNull(v.wakeAt) === null) return null
  return {
    id: v.id.slice(0, 12),
    label: v.label.slice(0, OPS_LIMITS.label) || 'the result',
    createdAt: num(v.createdAt),
    wakeAt: num(v.wakeAt),
    strategy: oneOf(v.strategy, STRATEGIES, 'smart'),
    status: oneOf(v.status, WATCHER_STATUSES, 'armed'),
    milestone: strOrNull(v.milestone, 200),
    checkpoint: storedCheckpoint(v.checkpoint),
    decided: smartOf(v.decided),
    source: oneOf(v.source, ['person', 'scout', 'carried'] as const, 'person'),
    firedAt: numOrNull(v.firedAt),
    endedAt: numOrNull(v.endedAt),
    outcome: strOrNull(v.outcome, 200),
    needs: strOrNull(v.needs, 200),
  }
}

function budgetOf(v: unknown): Budget | null {
  if (!isRecord(v)) return null
  const positive = (x: unknown): number | null => {
    const n = numOrNull(x)
    return n !== null && n > 0 ? n : null
  }
  const keys = (x: unknown): BudgetKey[] => (Array.isArray(x) ? x.filter((k): k is BudgetKey => (BUDGET_KEYS as readonly unknown[]).includes(k)) : [])
  const b: Budget = {
    costUsd: positive(v.costUsd),
    durationMs: positive(v.durationMs),
    handoffs: positive(v.handoffs) === null ? null : Math.round(positive(v.handoffs)!),
    atLimit: oneOf(v.atLimit, ['notify', 'ask', 'finish'] as const, 'ask'),
    warned: keys(v.warned),
    reached: keys(v.reached),
    approved: keys(v.approved),
  }
  return b.costUsd === null && b.durationMs === null && b.handoffs === null ? null : b
}

/** The operations a stored run holds, validated; a run from before 1.6.0 holds none. */
export function opsOf(raw: unknown): RunOps {
  if (!isRecord(raw)) return emptyOps()
  const seq = isRecord(raw.seq) ? raw.seq : {}
  const list = <T>(v: unknown, of: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(of).filter((x): x is T => x !== null) : [])
  const log = Array.isArray(raw.log)
    ? raw.log.filter(isRecord).map(e => ({ at: num(e.at), text: str(e.text, 200) })).filter(e => e.text !== '').slice(0, OPS_LIMITS.log)
    : []
  return {
    v: 1,
    seq: { q: Math.max(0, Math.floor(num(seq.q))), d: Math.max(0, Math.floor(num(seq.d))), w: Math.max(0, Math.floor(num(seq.w))) },
    personTurns: Math.max(0, Math.floor(num(raw.personTurns))),
    queue: list(raw.queue, queueItemOf).slice(-(OPS_LIMITS.queueOpen + OPS_LIMITS.kept)),
    decisions: list(raw.decisions, decisionOf).slice(-(OPS_LIMITS.decisionsOpen + OPS_LIMITS.kept)),
    watchers: list(raw.watchers, watcherOf).slice(-(OPS_LIMITS.watchersOpen + OPS_LIMITS.kept)),
    budget: budgetOf(raw.budget),
    log,
  }
}

/** True when the operations hold nothing worth showing: no open or recent item, no budget. */
export function isEmpty(ops: RunOps): boolean {
  return ops.queue.length === 0 && ops.decisions.length === 0 && ops.watchers.length === 0 && ops.budget === null
}

// ---------------------------------------------------------------------------
// The log

export function logged(ops: RunOps, at: number, text: string): RunOps {
  return { ...ops, log: [{ at, text: clean(text, 200) }, ...ops.log].slice(0, OPS_LIMITS.log) }
}

/** Keeps the open items and the newest few finished ones, in their order. */
function pruned<T extends { status: string }>(items: T[], isDone: (t: T) => boolean): T[] {
  const done = items.filter(isDone)
  const drop = new Set(done.slice(0, Math.max(0, done.length - OPS_LIMITS.kept)))
  return items.filter(t => !drop.has(t))
}

// ---------------------------------------------------------------------------
// Mission Queue

export const isQueueOpen = (q: QueueItem): boolean => q.status === 'queued' || q.status === 'due' || q.status === 'sending' || q.status === 'unsure'
const isQueueDone = (q: QueueItem): boolean => !isQueueOpen(q)

export const TARGET_WORDS: Record<QueueTarget, string> = {
  boundary: 'Next safe boundary',
  turn: 'After this turn',
  milestone: 'After the current milestone',
  fresh: 'After the handoff',
}

export function addQueueItem(
  ops: RunOps,
  input: { text: string; target: QueueTarget; now: number; milestone: { key: string; subject: string } | null },
): { ops: RunOps; item: QueueItem } | { error: string } {
  const text = input.text.trim().slice(0, OPS_LIMITS.queueText)
  if (text === '') return { error: 'Nothing to queue: write what Claude should do later.' }
  if (ops.queue.filter(isQueueOpen).length >= OPS_LIMITS.queueOpen) return { error: `The queue holds ${OPS_LIMITS.queueOpen} items at most: deliver or delete some first.` }
  const n = ops.seq.q + 1
  const isMilestone = input.target === 'milestone' && input.milestone !== null
  const item: QueueItem = {
    id: `Q-${n}`,
    text,
    target: input.target,
    status: 'queued',
    createdAt: input.now,
    milestoneKey: isMilestone ? input.milestone!.key : null,
    milestone: isMilestone ? input.milestone!.subject : null,
    dueAt: null,
    sentAt: null,
    deliveredAt: null,
    via: null,
  }
  const next = logged({ ...ops, seq: { ...ops.seq, q: n }, queue: [...ops.queue, item] }, input.now, `${item.id} queued (${TARGET_WORDS[item.target].toLowerCase()})`)
  return { ops: next, item }
}

export function editQueueItem(ops: RunOps, id: string, patch: { text?: string; target?: QueueTarget; milestone?: { key: string; subject: string } | null }): RunOps {
  return {
    ...ops,
    queue: ops.queue.map(q => {
      if (q.id !== id || (q.status !== 'queued' && q.status !== 'due')) return q
      const text = patch.text === undefined ? q.text : patch.text.trim().slice(0, OPS_LIMITS.queueText) || q.text
      const target = patch.target ?? q.target
      const m = target === 'milestone' ? (patch.milestone === undefined ? (q.milestoneKey === null ? null : { key: q.milestoneKey, subject: q.milestone ?? '' }) : patch.milestone) : null
      // A changed target is due afresh at its own boundary.
      return { ...q, text, target, milestoneKey: m?.key ?? null, milestone: m?.subject ?? null, status: target === q.target ? q.status : 'queued', dueAt: target === q.target ? q.dueAt : null }
    }),
  }
}

/** Moves an open item up (-1) or down (+1) among the open ones. */
export function moveQueueItem(ops: RunOps, id: string, delta: -1 | 1): RunOps {
  const open = ops.queue.filter(isQueueOpen)
  const i = open.findIndex(q => q.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= open.length) return ops
  const swapped = [...open]
  ;[swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!]
  return { ...ops, queue: [...ops.queue.filter(isQueueDone), ...swapped] }
}

export function cancelQueueItem(ops: RunOps, id: string, now: number): RunOps {
  const item = ops.queue.find(q => q.id === id)
  if (item === undefined || !isQueueOpen(item) || item.status === 'sending') return ops
  return logged({ ...ops, queue: pruned(ops.queue.map(q => (q.id === id ? { ...q, status: 'cancelled' as const, deliveredAt: null } : q)), isQueueDone) }, now, `${id} deleted`)
}

/** Delivery now, whatever its boundary (the person pressed Deliver now). */
export function forceDue(ops: RunOps, id: string, now: number): RunOps {
  return { ...ops, queue: ops.queue.map(q => (q.id === id && (q.status === 'queued' || q.status === 'unsure') ? { ...q, status: 'due' as const, dueAt: now } : q)) }
}

export type BoundaryEvent =
  /** A main turn ended cleanly. `completed`: milestone keys completed in the plan now; `planKeys`: every milestone's key. */
  | { kind: 'turnEnd'; completed: readonly string[]; planKeys: readonly string[]; current: string | null }
  /** Milestones newly completed while a turn runs. */
  | { kind: 'milestones'; completed: readonly string[]; planKeys: readonly string[]; current: string | null }
  /** A fresh context Project Sentinel started. */
  | { kind: 'fresh' }
  /** Nothing runs and the run is not parked: an item that waits only for the session to be free goes now. */
  | { kind: 'idle'; current: string | null }

/** Marks the queued items due at this boundary. */
export function queueDueAt(ops: RunOps, event: BoundaryEvent, now: number): RunOps {
  let isChanged = false
  const queue = ops.queue.map(q => {
    if (q.status !== 'queued') return q
    const isMilestoneDone = q.milestoneKey !== null && ('completed' in event ? event.completed.includes(q.milestoneKey) || !event.planKeys.includes(q.milestoneKey) : false)
    let isDue = false
    switch (event.kind) {
      case 'turnEnd':
        isDue = q.target === 'turn' || q.target === 'boundary' || (q.target === 'milestone' && (q.milestoneKey === null || isMilestoneDone))
        break
      case 'milestones':
        isDue = (q.target === 'boundary' && event.completed.length > 0) || (q.target === 'milestone' && q.milestoneKey !== null && isMilestoneDone)
        break
      case 'fresh':
        isDue = q.target === 'fresh'
        break
      case 'idle':
        isDue = q.target === 'turn' || q.target === 'boundary' || (q.target === 'milestone' && q.milestoneKey === null && event.current === null)
        break
    }
    if (!isDue) return q
    isChanged = true
    return { ...q, status: 'due' as const, dueAt: now }
  })
  return isChanged ? { ...ops, queue } : ops
}

export const dueQueue = (ops: RunOps): QueueItem[] => ops.queue.filter(q => q.status === 'due')

export function markQueue(ops: RunOps, ids: readonly string[], status: 'sending' | 'delivered' | 'unsure' | 'due', now: number, via?: QueueItem['via']): RunOps {
  const set = new Set(ids)
  const queue = ops.queue.map(q => {
    if (!set.has(q.id)) return q
    if (status === 'sending') return { ...q, status, sentAt: now, via: via ?? q.via }
    if (status === 'delivered') return { ...q, status, deliveredAt: now, via: via ?? q.via }
    return { ...q, status }
  })
  const next = { ...ops, queue: pruned(queue, isQueueDone) }
  return status === 'delivered' ? logged(next, now, `${ids.join(', ')} delivered${via === 'note' ? ' with tool results' : via === 'fresh' ? ' into the fresh context' : ''}`) : next
}

// ---------------------------------------------------------------------------
// Decision Inbox

export const isDecisionOpen = (d: Decision): boolean => d.status === 'open'
/** Answered but not yet with Claude. */
export const isAnswerWaiting = (d: Decision): boolean => d.status === 'answered' || d.status === 'sending' || d.status === 'unsure'
const isDecisionDone = (d: Decision): boolean => d.status === 'delivered' || d.status === 'withdrawn'

export function addDecision(
  ops: RunOps,
  input: { question: unknown; context?: unknown; options?: unknown; allowText?: unknown; urgency?: unknown; blocking?: unknown; milestone?: unknown; now: number; currentMilestone: string | null },
): { ops: RunOps; decision: Decision } | { error: string } {
  const question = clean(typeof input.question === 'string' ? input.question : '', OPS_LIMITS.question)
  if (question.length < 4) return { error: 'A decision needs a question.' }
  if (ops.decisions.filter(isDecisionOpen).length >= OPS_LIMITS.decisionsOpen) return { error: `The Decision Inbox holds ${OPS_LIMITS.decisionsOpen} open questions at most; the user has not answered those yet.` }
  // The same question again while it is open is the same decision.
  const same = ops.decisions.find(d => isDecisionOpen(d) && d.question.toLowerCase() === question.toLowerCase())
  if (same !== undefined) return { ops, decision: same }
  const options = Array.isArray(input.options)
    ? [...new Set(input.options.filter((o): o is string => typeof o === 'string').map(o => clean(o, OPS_LIMITS.option)).filter(o => o !== ''))].slice(0, 4)
    : []
  const n = ops.seq.d + 1
  const decision: Decision = {
    id: `D-${n}`,
    question,
    context: typeof input.context === 'string' && input.context.trim() !== '' ? clean(input.context, OPS_LIMITS.context) : null,
    options,
    allowText: input.allowText === true || options.length === 0,
    urgency: input.urgency === 'low' || input.urgency === 'high' ? input.urgency : 'normal',
    isBlocking: input.blocking === true,
    milestone: typeof input.milestone === 'string' && input.milestone.trim() !== '' ? clean(input.milestone, 200) : input.currentMilestone,
    createdAt: input.now,
    status: 'open',
    answer: null,
    answeredAt: null,
    deliveredAt: null,
    via: null,
  }
  return { ops: logged({ ...ops, seq: { ...ops.seq, d: n }, decisions: [...ops.decisions, decision] }, input.now, `${decision.id} asked${decision.isBlocking ? ' (blocking)' : ''}`), decision }
}

export function answerDecision(ops: RunOps, id: string, answer: string, now: number): RunOps | { error: string } {
  const d = ops.decisions.find(x => x.id === id)
  if (d === undefined) return { error: `No decision ${id}.` }
  if (d.status !== 'open' && d.status !== 'answered') return { error: `${id} was already answered and sent to Claude.` }
  const text = answer.trim().slice(0, OPS_LIMITS.answer)
  if (text === '') return { error: 'An answer needs some words.' }
  return logged({ ...ops, decisions: ops.decisions.map(x => (x.id === id ? { ...x, status: 'answered' as const, answer: text, answeredAt: now } : x)) }, now, `${id} answered`)
}

export function markDecisions(ops: RunOps, ids: readonly string[], status: 'sending' | 'delivered' | 'answered' | 'unsure' | 'withdrawn', now: number, via?: Decision['via']): RunOps {
  const set = new Set(ids)
  const decisions = ops.decisions.map(d => (set.has(d.id) ? { ...d, status, deliveredAt: status === 'delivered' ? now : d.deliveredAt, via: via ?? d.via } : d))
  const next = { ...ops, decisions: pruned(decisions, isDecisionDone) }
  return status === 'delivered' ? logged(next, now, `Answer to ${ids.join(', ')} delivered`) : status === 'withdrawn' ? logged(next, now, `${ids.join(', ')} withdrawn`) : next
}

// ---------------------------------------------------------------------------
// Watchers

export const isWatcherOpen = (w: Watcher): boolean => w.status === 'armed' || w.status === 'paused' || w.status === 'due' || w.status === 'stale' || w.status === 'waking'
const isWatcherDone = (w: Watcher): boolean => !isWatcherOpen(w)

/** The run's fingerprint now: a stable digest of its milestones, its turns and its context. */
export function checkpointNow(input: { now: number; sessionId: string | null; turns: number; tasks: readonly { key: string; status: string }[] }): Checkpoint {
  return { at: input.now, sessionId: input.sessionId, turns: input.turns, plan: planKey(input.tasks) }
}

/** A short, stable key for a plan's milestones and their statuses. */
export function planKey(tasks: readonly { key: string; status: string }[]): string {
  let h = 2166136261
  for (const t of tasks) {
    for (const ch of `${t.key}\u0000${t.status}\u0001`) {
      h ^= ch.charCodeAt(0)
      h = Math.imul(h, 16777619) >>> 0
    }
  }
  return `${tasks.length}:${h.toString(36)}`
}

/** What moved since a watcher parked the run, one phrase each; empty while it is still parked there. */
export function changesSince(cp: Checkpoint, now: Checkpoint): string[] {
  const why: string[] = []
  if (cp.sessionId !== null && now.sessionId !== null && cp.sessionId !== now.sessionId) why.push('the context was cleared')
  const turns = now.turns - cp.turns
  if (turns > 0) why.push(`${turns === 1 ? 'a turn' : `${turns} turns`} ran`)
  if (cp.plan !== now.plan) why.push('its milestones changed')
  return why
}

/** What moved since a watcher parked the run, in words, or null when it is still parked there. */
export function changedSince(cp: Checkpoint, now: Checkpoint): string | null {
  const why = changesSince(cp, now)
  return why.length === 0 ? null : `This run changed since the watcher was armed: ${why.join(', ')}.`
}

export function addWatcher(
  ops: RunOps,
  input: { label: string; wakeAt: number; strategy: WatchStrategy; now: number; milestone: string | null; checkpoint: Checkpoint | null; source: Watcher['source']; decided: SmartChoice | null },
): { ops: RunOps; watcher: Watcher } | { error: string } {
  if (ops.watchers.filter(isWatcherOpen).length >= OPS_LIMITS.watchersOpen) return { error: `A run holds ${OPS_LIMITS.watchersOpen} watchers at most.` }
  const n = ops.seq.w + 1
  const watcher: Watcher = {
    id: `W-${n}`,
    label: clean(input.label, OPS_LIMITS.label) || 'the result',
    createdAt: input.now,
    wakeAt: input.wakeAt,
    strategy: input.strategy,
    status: 'armed',
    milestone: input.milestone,
    checkpoint: input.checkpoint,
    decided: input.decided,
    source: input.source,
    firedAt: null,
    endedAt: null,
    outcome: null,
    needs: null,
  }
  return { ops: logged({ ...ops, seq: { ...ops.seq, w: n }, watchers: [...ops.watchers, watcher] }, input.now, `${watcher.id} armed for ${watcher.label}`), watcher }
}

export function patchWatcher(ops: RunOps, id: string, patch: Partial<Omit<Watcher, 'id'>>, log?: { at: number; text: string }): RunOps {
  const watchers = pruned(ops.watchers.map(w => (w.id === id ? { ...w, ...patch } : w)), isWatcherDone)
  const next = { ...ops, watchers }
  return log === undefined ? next : logged(next, log.at, log.text)
}

/** Armed watchers whose time has come, earliest first. */
export const dueWatchers = (ops: RunOps, now: number): Watcher[] => ops.watchers.filter(w => w.status === 'armed' && w.wakeAt <= now).sort((a, b) => a.wakeAt - b.wakeAt)

/** When the next armed watcher wakes; null with none. */
export function nextWakeAt(ops: RunOps): number | null {
  const at = ops.watchers.filter(w => w.status === 'armed').map(w => w.wakeAt)
  return at.length === 0 ? null : Math.min(...at)
}

/** The watcher that holds the run now: the earliest armed one, or one due and waiting. */
export function holdingWatcher(ops: RunOps): Watcher | null {
  const waiting = ops.watchers.filter(w => w.status === 'due' || w.status === 'stale' || w.status === 'waking')[0]
  if (waiting !== undefined) return waiting
  return ops.watchers.filter(w => w.status === 'armed').sort((a, b) => a.wakeAt - b.wakeAt)[0] ?? null
}

// ---------------------------------------------------------------------------
// Smart: hold the cache, or wake fresh

/** What a fresh context starts with (system prompt, tools, the notes, the docs), as cache-write tokens: an estimate for comparison only, never shown as a figure. */
const FRESH_START_TOKENS = 40_000
/** Holding is preferred until it costs about this many fresh starts: the conversation's nuance is worth something. */
const NUANCE_FACTOR = 3
/** One-hour cache: a refresh every fifty minutes (ten minutes before each expiry). */
const HOUR_REFRESH_MS = 50 * 60_000
/** The five-minute cache is not worth holding past this (refreshes every four minutes cost more than a rebuild). */
export const SHORT_HOLD_MAX_MS = 45 * 60_000

export type SmartInput = {
  now: number
  wakeAt: number
  ttl: '5m' | '1h' | null
  /** What the cache holds now (the last request's prompt). */
  cachedTokens: number
  /** When it lapses with no refresh; null while not known. */
  expiresAt: number | null
  /** The context's fill against its handoff point (or 90% of the window), 0–1+; null while not known. */
  contextShare: number | null
  /** Keep warm found it cannot hold the cache here. */
  isKeepWarmBroken: boolean
  /** A fresh context would have healthy resume state (features/resume.ts); why not when not. */
  resume: { isHealthy: boolean; problem: string | null }
  /** Below this the context is small: re-reading it cold costs little (the Cold Resume Guard's threshold). */
  smallTokens: number
}

/**
 * Smart's choice for a watcher, with its reason in words. Holding costs refreshes of this context
 * at cache-read prices (a tenth of input); a fresh start costs one fresh context's cache write,
 * and the conversation's nuance. It never holds the five-minute cache for long, holds nothing when
 * the cache outlives the wait, and keeps the conversation when a fresh resume is not ready.
 */
export function smartChoice(i: SmartInput): SmartChoice {
  const wait = Math.max(0, i.wakeAt - i.now)
  const waitW = `${untilWords(wait)} wait`
  const ctx = `${fmtTokens(i.cachedTokens)} context`
  const pick = (mode: 'warm' | 'fresh', hold: boolean, reason: string): SmartChoice => ({ mode, hold: mode === 'warm' && hold, reason, at: i.now })
  const isShort = i.ttl !== '1h'
  const canHold = !i.isKeepWarmBroken && (!isShort || wait <= SHORT_HOLD_MAX_MS)
  // The cache outlives the wait: nothing to hold, nothing to clear.
  if (i.expiresAt !== null && i.expiresAt - 60_000 > i.wakeAt) return pick('warm', false, `${waitW} · the cache lasts past the wake`)
  // Nothing (worth) cached: the conversation comes back cold either way, and it is small.
  if (i.cachedTokens < i.smallTokens) return pick('warm', false, `${waitW} · ${ctx}: a cold read costs little`)
  if (!i.resume.isHealthy) {
    const why = i.resume.problem === null ? 'fresh resume not ready' : `fresh resume not ready (${i.resume.problem.replace(/\.$/, '').toLowerCase()})`
    return canHold ? pick('warm', true, `${waitW} · ${why}`) : pick('warm', false, `${waitW} · ${why}; holding the cache that long costs more than re-reading it`)
  }
  if (i.contextShare !== null && i.contextShare >= 0.8) return pick('fresh', false, `${waitW} · context ${Math.round(i.contextShare * 100)}% of its handoff point · resume state ready`)
  if (i.isKeepWarmBroken) return pick('fresh', false, `${waitW} · Keep warm could not hold this cache · resume state ready`)
  if (isShort) {
    return wait <= SHORT_HOLD_MAX_MS
      ? pick('warm', true, `${waitW} · ${ctx} · a short hold of the ${i.ttl === '5m' ? '5-minute' : 'unproven'} cache`)
      : pick('fresh', false, `${waitW} · ${ctx} · holding a ${i.ttl === '5m' ? '5-minute' : 'short'} cache that long costs more than a fresh start`)
  }
  const refreshes = Math.max(1, Math.ceil(wait / HOUR_REFRESH_MS))
  const holdCost = refreshes * 0.1 * i.cachedTokens
  const freshCost = NUANCE_FACTOR * FRESH_START_TOKENS * 2
  if (holdCost <= freshCost) return pick('warm', true, `${waitW} · ${ctx} · about ${refreshes} refresh${refreshes === 1 ? '' : 'es'}, read from the cache`)
  return pick('fresh', false, `${waitW} · ${ctx} · resume state ready`)
}

/** The choice a watcher acts on: its own strategy, or Smart's decision. */
export function modeOf(w: Pick<Watcher, 'strategy' | 'decided'>): { mode: 'warm' | 'fresh'; hold: boolean } {
  if (w.strategy === 'warm') return { mode: 'warm', hold: true }
  if (w.strategy === 'fresh') return { mode: 'fresh', hold: false }
  return w.decided === null ? { mode: 'warm', hold: false } : { mode: w.decided.mode, hold: w.decided.hold }
}

export const STRATEGY_WORDS: Record<WatchStrategy, string> = { smart: 'Smart', warm: 'Keep warm', fresh: 'Fresh' }

// ---------------------------------------------------------------------------
// Run Budget

export type BudgetMetrics = { costUsd: number | null; isCostPartial: boolean; durationMs: number; handoffs: number }

export type BudgetCheck = {
  /** At 80% or more, not yet reached. */
  near: BudgetKey[]
  reached: BudgetKey[]
  /** Each limit in words: "Cost $16.29 of $30". */
  words: Record<BudgetKey, string | null>
}

const WORDS_OF: Record<BudgetKey, string> = { cost: 'Cost', time: 'Time', handoffs: 'Handoffs' }

function hoursWords(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export function checkBudget(b: Budget, m: BudgetMetrics): BudgetCheck {
  const share: Record<BudgetKey, number | null> = {
    cost: b.costUsd === null || m.costUsd === null ? null : m.costUsd / b.costUsd,
    time: b.durationMs === null ? null : m.durationMs / b.durationMs,
    handoffs: b.handoffs === null ? null : m.handoffs / b.handoffs,
  }
  const words: Record<BudgetKey, string | null> = {
    cost: b.costUsd === null ? null : `${WORDS_OF.cost} ${m.costUsd === null ? '—' : `$${m.costUsd.toFixed(2)}${m.isCostPartial ? '+' : ''}`} of $${b.costUsd.toFixed(b.costUsd % 1 === 0 ? 0 : 2)}`,
    time: b.durationMs === null ? null : `${WORDS_OF.time} ${hoursWords(m.durationMs)} of ${hoursWords(b.durationMs)}`,
    handoffs: b.handoffs === null ? null : `${WORDS_OF.handoffs} ${m.handoffs} of ${b.handoffs}`,
  }
  const reached = BUDGET_KEYS.filter(k => (share[k] ?? 0) >= 1)
  const near = BUDGET_KEYS.filter(k => !reached.includes(k) && (share[k] ?? 0) >= 0.8)
  return { near, reached, words }
}

export function setBudget(ops: RunOps, patch: Partial<Pick<Budget, 'costUsd' | 'durationMs' | 'handoffs' | 'atLimit'>> | null, now: number): RunOps {
  if (patch === null) return logged({ ...ops, budget: null }, now, 'Run budget removed')
  const base: Budget = ops.budget ?? { costUsd: null, durationMs: null, handoffs: null, atLimit: 'ask', warned: [], reached: [], approved: [] }
  const merged: Budget = { ...base, ...patch }
  // A limit raised or removed is said again when it is next near or reached.
  const kept = (k: BudgetKey) => (k === 'cost' ? merged.costUsd === base.costUsd : k === 'time' ? merged.durationMs === base.durationMs : merged.handoffs === base.handoffs)
  const budget = budgetOf({ ...merged, warned: merged.warned.filter(kept), reached: merged.reached.filter(kept), approved: merged.approved.filter(kept) })
  return logged({ ...ops, budget }, now, budget === null ? 'Run budget removed' : 'Run budget set')
}
