/**
 * View models: render-ready projections of the Runtime, one per `$.state`
 * atom. Pure functions of the runtime's state; the publisher decides when
 * to publish them.
 *
 * The plain-language status helpers below are the product's one voice: the
 * HUD, the Control Centre, the status line and `/cr status` all say the same
 * thing the same way ("Hands off at 70%", "Watching for early stops").
 */

import type {
  ActivityView,
  ChainRunView,
  FileChangeView,
  MissionView,
  ChainView,
  FocusModel,
  HudModel,
  PaneModel,
  PermissionsView,
  QuestView,
  ResourcesView,
  SpinnerModel,
  StatusView,
  SystemId,
  TimelineKind,
  Tone,
  TurnTimelineView,
} from '../../types'
import { MIN_ENGINE } from '../constants'
import * as fmt from '../core/format'
import { findProfile, isModified } from '../core/profiles'
import { relativeTo, shortPath } from '../core/text'
import { readingTone } from '../ui/theme'
import { versionAtLeast } from '../core/version'
import type { ActivityItem, FileChange } from '../features/activity'
import { isHandoffActive } from '../features/autopilot'
import * as Chain from '../features/chain'
import { GROUP_LABEL, GROUP_ORDER, attentionOf, groupOf, isOpen, nowOf, turnSummaryOf } from '../features/digest'
import { ACHIEVEMENTS, levelOf, runQuestOf } from '../features/quest'
import { type ValidationSummary, summarize } from '../features/validation'
import { answerStyleLabel } from '../core/answers'
import type { Runtime } from './runtime'

function contextTone(rt: Runtime): Tone {
  const tokens = rt.usage.tokens
  if (tokens === undefined) return 'muted'
  const threshold = rt.settings.autopilot.enabled ? rt.autopilot.threshold : null
  const window = rt.usage.window
  const ref = threshold ?? (window === undefined ? null : window * 0.9)
  if (ref === null) return 'normal'
  if (tokens >= ref) return 'bad'
  if (tokens >= ref * 0.85) return 'warn'
  return 'good'
}

// ---------------------------------------------------------------------------
// Plain-language status

const EFFORT_NAME: Record<string, string> = { max: 'Maximum effort', xhigh: 'Extra-high effort', high: 'High effort', keep: 'Policy only' }
const LEVEL_NAME: Record<string, string> = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', custom: 'Custom' }
const STRATEGY_NAME: Record<string, string> = { off: 'Off', balanced: 'Balanced', performance: 'Performance', economy: 'Economy', custom: 'Custom' }

/**
 * A handoff waiting for the person: calm when they asked for it ("Wait for
 * me"), red only when something went wrong (no notes, clearing refused).
 */
const awaitingTone = (rt: Runtime): Tone => (rt.autopilot.lastError === null ? 'accent' : 'bad')

/** "70%" or "700k": the threshold as the person set it. */
export function thresholdText(rt: Runtime): string {
  const a = rt.settings.autopilot
  return a.thresholdMode === 'percent' ? `${a.thresholdPercent}%` : fmt.tokens(rt.autopilot.threshold ?? a.thresholdTokens)
}

export function autopilotStatus(rt: Runtime): StatusView {
  if (!rt.settings.autopilot.enabled) return { text: 'Off', tone: 'muted' }
  switch (rt.autopilot.state) {
    case 'off':
    case 'armed':
      return { text: `Hands off at ${thresholdText(rt)}`, tone: 'normal' }
    case 'pending':
      return { text: 'Handoff soon', tone: 'warn' }
    case 'requested':
    case 'handoff':
    case 'verifying':
      return { text: 'Writing the handoff', tone: 'accent' }
    case 'clearing':
    case 'compacting':
      return { text: 'Starting fresh', tone: 'accent' }
    case 'resuming':
      return { text: 'Resuming', tone: 'accent' }
    case 'awaiting':
      return { text: 'Waiting for you', tone: awaitingTone(rt) }
  }
}

export function frontierStatus(rt: Runtime): StatusView {
  const f = rt.settings.frontier
  if (!f.enabled) return { text: 'Off', tone: 'muted' }
  if (f.effort !== 'keep' && rt.frontier.isEffortSupported === false) return { text: 'Policy on · this model has no effort setting', tone: 'normal' }
  return { text: EFFORT_NAME[f.effort] ?? 'On', tone: 'normal' }
}

export function guardStatus(rt: Runtime): StatusView {
  if (!rt.settings.guard.enabled) return { text: 'Off', tone: 'muted' }
  const eff = rt.effective.guard
  if (!eff.isActive) return { text: eff.reason ?? 'Paused', tone: 'muted' }
  if (rt.guard.turnBlocks > 0) return { text: `Kept Claude going ${rt.guard.turnBlocks}× this turn`, tone: 'warn' }
  if (rt.guard.sessionBlocks > 0) return { text: `Kept Claude going ${rt.guard.sessionBlocks}× this session`, tone: 'normal' }
  return { text: 'Watching for early stops', tone: 'normal' }
}

export function routerStatus(rt: Runtime): StatusView {
  const s = rt.settings.router.strategy
  return { text: STRATEGY_NAME[s] ?? s, tone: s === 'off' ? 'muted' : 'normal' }
}

export function subagentStatus(rt: Runtime): StatusView {
  const s = rt.settings.subagents
  const running = rt.runningSubagents
  const live = running > 0 ? ` · ${running} running` : ''
  switch (s.mode) {
    case 'unrestricted':
      return { text: `No limit${live}`, tone: 'normal' }
    case 'block':
      return { text: 'Off', tone: 'warn' }
    case 'ask':
      return { text: `Ask each time${live}`, tone: 'normal' }
    case 'limit':
      return { text: `Up to ${s.limit} at once${live}`, tone: running >= s.limit ? 'warn' : 'normal' }
  }
}

/** Machine load. `attention` is set only when it needs a look; the HUD shows nothing otherwise. */
export function loadStatus(rt: Runtime): StatusView & { isOn: boolean; attention: string | null; level: string } {
  const r = rt.settings.resources
  const level = LEVEL_NAME[r.level] ?? r.level
  if (r.level === 'off') return { isOn: false, attention: null, level, text: 'Off', tone: 'muted' }
  const m = rt.monitor
  const p = m.pressure
  if (m.status === 'unavailable') return { isOn: true, attention: 'Load unavailable', level, text: 'Readings unavailable', tone: 'muted' }
  if (m.status !== 'live' || p.level === 'unknown') return { isOn: true, attention: null, level, text: 'Starting…', tone: 'muted' }
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`)
  const tone: Tone = p.level === 'ok' ? 'good' : p.level === 'elevated' ? 'warn' : 'bad'
  const driver = p.driver === 'ram' ? `Memory ${pct(p.ram)}` : `CPU ${pct(p.cpu)}`
  return { isOn: true, attention: p.level === 'ok' ? null : driver, level, text: `CPU ${pct(p.cpu)} · Memory ${pct(p.ram)}`, tone }
}

export function focusStatus(rt: Runtime): StatusView {
  const f = rt.settings.focus
  if (!f.enabled) return { text: 'Off', tone: 'muted' }
  return { text: f.tools === 'hidden' ? 'Tool calls hidden' : 'Compact transcript', tone: 'normal' }
}

export function qaStatus(rt: Runtime): StatusView {
  return rt.settings.qa.enabled ? { text: 'Verify before done', tone: 'normal' } : { text: 'Off', tone: 'muted' }
}

/** The answer style in force: the person's own Claude Code output style outranks it. */
export function answersStatus(rt: Runtime): StatusView {
  if (rt.nativeOutputStyle !== null) return { text: `Claude Code style: ${rt.nativeOutputStyle}`, tone: 'muted' }
  const style = rt.settings.answers.style
  return { text: answerStyleLabel(style), tone: style === 'standard' ? 'muted' : 'normal' }
}

export function statusOf(rt: Runtime): Record<SystemId, StatusView> {
  const load = loadStatus(rt)
  return {
    autopilot: autopilotStatus(rt),
    frontier: frontierStatus(rt),
    qa: qaStatus(rt),
    guard: guardStatus(rt),
    router: routerStatus(rt),
    subagents: subagentStatus(rt),
    load: load.isOn ? { text: `${load.level} · ${load.text}`, tone: load.tone } : { text: 'Off', tone: 'muted' },
    focus: focusStatus(rt),
    answers: answersStatus(rt),
  }
}

export function profileOf(rt: Runtime): { id: string; name: string; isModified: boolean } {
  const profile = findProfile(rt.settings, rt.settings.profile)
  return { id: rt.settings.profile, name: profile?.name ?? 'Custom', isModified: isModified(rt.settings) }
}

export function runLabelOf(rt: Runtime): string {
  if (rt.run === null) return 'No run yet'
  const s = Chain.currentSession(rt.run)
  return `Run ${rt.run.number} · Session ${s?.index ?? 1}`
}


function liveLoadOf(rt: Runtime): HudModel['load'] {
  if (rt.monitor.status === 'off') return null
  const latest = rt.monitor.status === 'live' ? rt.monitor.latest() : null
  const ceilings = rt.effective.resources.ceilings
  const cpu = latest?.cpu ?? null
  const ram = latest?.ram ?? null
  return {
    cpu,
    ram,
    cpuTone: readingTone(cpu, ceilings?.cpu ?? null, { warn: 75, bad: 90 }),
    ramTone: readingTone(ram, ceilings?.ram ?? null, { warn: 80, bad: 92 }),
    cpuSeries: rt.monitor.cpuSeries(8),
    ramSeries: rt.monitor.ramSeries(8),
  }
}

// ---------------------------------------------------------------------------
// Signal: shared by the status bar and Activity

/** The main conversation's calls in the current (or last) turn, oldest first. */
const turnItemsOf = (rt: Runtime): ActivityItem[] => rt.activity.items.filter(i => i.turn === rt.activity.turn.index && i.agentId === null)

const validationNow = (rt: Runtime, now: number): ValidationSummary[] => summarize(rt.activity.validationRuns(), now)

const nowLine = (rt: Runtime) => nowOf({ isTurnRunning: rt.turn.isRunning, running: rt.activity.runningItems(), progress: rt.progress })

// ---------------------------------------------------------------------------
// Projections

export function hudOf(rt: Runtime): HudModel {
  const tokens = rt.usage.tokens ?? null
  const window = rt.usage.window ?? null
  const pct = tokens !== null && window !== null && window > 0 ? Math.round((100 * tokens) / window) : (rt.usage.pct ?? null)
  const totals = rt.run === null ? null : Chain.totals(rt.run, Date.now())
  const ap = autopilotStatus(rt)
  const s = rt.settings
  let alert: HudModel['alert'] = null
  if (rt.autopilot.state === 'awaiting') alert = { kind: 'awaiting', text: rt.autopilot.note, tone: awaitingTone(rt) }
  else if (rt.monitor.pressure.level === 'critical' && s.resources.level !== 'off') alert = { kind: 'load', text: 'Your machine is under heavy load. Claude was asked to ease off.', tone: 'bad' }
  else if (rt.autopilot.state === 'pending') alert = { kind: 'pending', text: 'Finishing this step, then handing off', tone: 'warn' }
  const now = Date.now()
  const validation = validationNow(rt, now)
  return {
    isVisible: s.ui.hud === 'band' || s.ui.hud === 'both',
    isPaneOpen: rt.ui.isPaneOpen,
    ctx: { tokens, window, pct, threshold: s.autopilot.enabled ? rt.autopilot.threshold : null, tone: contextTone(rt) },
    cost: { usd: rt.usage.costUsd ?? null, runUsd: totals?.costUsd ?? null, isRunPartial: totals?.isCostPartial ?? false },
    profile: profileOf(rt),
    frontier: { isOn: s.frontier.enabled, effort: s.frontier.enabled ? (EFFORT_NAME[s.frontier.effort] ?? null) : null },
    autopilot: { isOn: s.autopilot.enabled, state: rt.autopilot.state, text: ap.text, tone: ap.tone },
    load: liveLoadOf(rt),
    agents: { running: rt.runningSubagents, limit: s.subagents.mode === 'limit' ? s.subagents.limit : null, mode: s.subagents.mode },
    guard: { isOn: s.guard.enabled, continued: rt.guard.turnBlocks },
    session: { run: rt.run?.number ?? null, index: rt.run === null ? 1 : (Chain.currentSession(rt.run)?.index ?? 1), handoffs: totals?.handoffs ?? 0 },
    alert,
    work: workOf(rt),
    now: nowLine(rt),
    failing: validation.filter(v => v.isFailing).map(v => v.label),
    attention: barAttentionOf(rt, now),
    activity: hudActivityOf(rt, now),
    checks: validation.map(v => ({ label: v.label, status: v.status })),
    quest: questHudOf(rt),
    cache: rt.cache.hud(rt.clock()),
    objective: rt.run?.objective ?? null,
    isAnimated: !s.ui.reducedMotion,
  }
}

/**
 * The status bar's count of calls that need a look. A failing check is left
 * out: the bar already shows it failing, by name.
 */
function barAttentionOf(rt: Runtime, now: number): number {
  const items = turnItemsOf(rt)
  const checks = new Set(items.filter(i => i.validation !== null).map(i => i.id))
  return attentionOf(items, now).filter(a => isOpen(a) && !(a.kind === 'failed' && checks.has(a.id))).length
}

/** A running call is worth timing in the status bar after this long. */
const LONG_CALL_MS = 20_000

/**
 * The status bar's top line. While a turn runs: what Claude is doing, the
 * milestone it serves, and how long a slow call has been running. Once it
 * ends: what the turn did, in counted words. Nothing before the first turn.
 */
function hudActivityOf(rt: Runtime, now: number): HudModel['activity'] {
  const turn = rt.activity.turn
  if (turn.index === 0 && !rt.turn.isRunning) return null
  const p = rt.progress
  const tasks = rt.plan.tasks
  const milestone = p.current === null ? null : { subject: p.current.subject, index: tasks.indexOf(p.current) + 1, total: tasks.length }
  if (rt.turn.isRunning) {
    const line = nowLine(rt) ?? { text: 'Thinking', source: 'thinking' as const }
    const longest = rt.activity
      .runningItems()
      .filter(i => i.agentId === null)
      .reduce((ms, i) => Math.max(ms, now - i.startedAt), 0)
    return { state: 'working', text: line.text, source: line.source, milestone, runningMs: longest >= LONG_CALL_MS ? longest : null, durationMs: null }
  }
  const items = turnItemsOf(rt)
  const files = rt.activity.changeList()
  const ctx = { root: rt.root, handoffFile: rt.settings.autopilot.handoffFile }
  const lines = turnSummaryOf({
    items,
    changed: files.filter(f => turn.files.has(f.path)),
    groupOf: path => groupOf(path, ctx),
    validation: validationNow(rt, now),
    attention: attentionOf(items, now),
    milestonesDone: Math.max(0, p.done - rt.turnStartDone),
  })
  // The changes by count alone ("Changed 4 files"), so the checks after them stay in view.
  const [first, second] = lines.map((line, i) => (i === 0 && line.startsWith('Changed ') ? (line.split(' · ')[0] ?? line) : line))
  return {
    state: 'done',
    text: first === undefined ? 'Replied, no tools used' : second === undefined ? first : `${first} · ${second}`,
    source: 'summary',
    milestone,
    runningMs: null,
    durationMs: turn.startedAt === null || turn.endedAt === null ? null : turn.endedAt - turn.startedAt,
  }
}

function questHudOf(rt: Runtime): HudModel['quest'] {
  if (rt.settings.answers.style !== 'quest') return null
  const l = levelOf(rt.quest.xp)
  return { level: l.level, xp: rt.quest.xp, intoLevel: rt.quest.xp - l.floor, levelSpan: l.next - l.floor, runXp: runQuestOf(rt.run?.quest).xp }
}

function workOf(rt: Runtime): HudModel['work'] {
  const p = rt.progress
  if (p.total === 0) return null
  return { done: p.done, total: p.total, current: p.current === null ? null : (p.current.activeForm ?? p.current.subject) }
}

/** The live status bar for Claude Code's own status line (`/cr hud status`): the run in one line. */
export function statusLineOf(hud: HudModel): string {
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`)
  const isHigh = (t: Tone) => t === 'warn' || t === 'bad'
  const parts = [`◆ Context ${pct(hud.ctx.pct)}`]
  if (hud.work !== null) parts.push(`Work ${hud.work.done}/${hud.work.total}`)
  if (hud.cache !== null) parts.push(`Cache ${hud.cache.text}`)
  if (hud.autopilot.isOn && hud.autopilot.state !== 'off' && hud.autopilot.state !== 'armed') parts.push(hud.autopilot.text)
  if (hud.now !== null) parts.push(hud.now.text)
  if (hud.failing.length > 0) parts.push(`${hud.failing.join(', ')} failing`)
  if (hud.attention > 0) parts.push(`${fmt.plural(hud.attention, 'issue')}`)
  if (hud.load !== null && isHigh(hud.load.cpuTone)) parts.push(`CPU ${pct(hud.load.cpu)}`)
  if (hud.load !== null && isHigh(hud.load.ramTone)) parts.push(`RAM ${pct(hud.load.ram)}`)
  if (hud.agents.running > 0) parts.push(fmt.plural(hud.agents.running, 'agent'))
  if (hud.guard.isOn && hud.guard.continued > 0) parts.push(`Kept going ×${hud.guard.continued}`)
  parts.push(`Run ${fmt.cost(hud.cost.runUsd ?? hud.cost.usd)}${hud.cost.isRunPartial ? '+' : ''}`)
  return parts.join(' · ')
}

export function paneOf(rt: Runtime): PaneModel {
  const a = rt.autopilot
  const isBusy = isHandoffActive(a.state) && a.state !== 'pending'
  return {
    tab: rt.ui.tab,
    openPicker: rt.ui.openPicker,
    status: statusOf(rt),
    activitySub: rt.ui.activitySub,
    settings: rt.settings,
    profileLabel: rt.profileLabel,
    runLabel: runLabelOf(rt),
    engine: { version: rt.engineVersion, isSupported: rt.engineVersion === null || versionAtLeast(rt.engineVersion, MIN_ENGINE) },
    surfaces: rt.surfaces,
    autopilot: {
      state: a.state,
      note: a.note,
      threshold: a.threshold,
      isClamped: a.isClamped,
      autoCompactAt: rt.autoCompactAt ?? null,
      tokens: rt.usage.tokens ?? null,
      window: rt.usage.window ?? null,
      handoffPath: rt.handoffPath(),
      lastError: a.lastError,
      completed: a.completed,
      canHandoff: rt.settings.autopilot.enabled && !isBusy,
      canFresh: a.state === 'awaiting' || a.state === 'armed' || a.state === 'pending',
      canSnooze: a.state === 'pending' || a.state === 'awaiting',
    },
    agents: {
      running: rt.agents.list
        .filter(x => !['completed', 'failed', 'killed'].includes(x.status))
        .slice(0, 8)
        .map(x => ({ id: x.id, type: x.type, description: x.description, status: x.status })),
      spawned: rt.agents.spawned,
      denied: rt.agents.denied,
      asked: rt.agents.asked,
    },
    router: {
      lastDecision: rt.router.lastDecision,
      resolved: [...rt.router.known.entries()].map(([alias, id]) => ({ alias, id })),
      unavailable: [...rt.router.unavailable],
    },
    guard: {
      turn: rt.guard.turnBlocks,
      session: rt.guard.sessionBlocks,
      last: rt.guard.last === null ? null : { verdict: rt.guard.last.verdict, score: rt.guard.last.score, reasons: rt.guard.last.reasons.slice(0, 4), at: rt.guard.last.at },
      isActive: rt.effective.guard.isActive,
      reason: rt.effective.guard.reason,
    },
    frontier: {
      lastEffort: rt.frontier.lastEffort,
      isEffortSupported: rt.frontier.isEffortSupported,
      isComposeReached: rt.compose.isReached ? true : rt.composeObserved ? false : null,
    },
    notes: rt.notes,
    savedAt: rt.savedAt,
    planSource: rt.planSource,
    nativeOutputStyle: rt.nativeOutputStyle,
    cache: rt.cache.view(rt.clock()),
    handoff: handoffOf(rt),
  }
}

/** The run's latest handoff, as Context shows it. */
function handoffOf(rt: Runtime): PaneModel['handoff'] {
  const h = rt.run?.lastHandoff
  if (h === undefined || h === null || rt.run === null) return null
  const index = Chain.currentSession(rt.run)?.index ?? 1
  return {
    at: h.at,
    fromSession: h.fromSession,
    toSession: h.toSession,
    via: h.via,
    health: h.health,
    continuity: h.continuity,
    isChecking: h.toSession !== null && h.continuity === null && h.toSession === index,
  }
}

export function resourcesOf(rt: Runtime): ResourcesView {
  const ceilings = rt.effective.resources.ceilings
  // The newest reading, as the status bar shows it. Pressure (a smoothed
  // window) exists only under ceilings; readings alone still have values.
  const latest = rt.monitor.status === 'live' ? rt.monitor.latest() : null
  return {
    status: rt.monitor.status,
    platform: rt.monitor.platform,
    cpu: latest?.cpu ?? null,
    ram: latest?.ram ?? null,
    level: rt.monitor.pressure.level,
    ceilings: ceilings === null ? null : { cpu: ceilings.cpu, ram: ceilings.ram, maxHeavy: ceilings.maxHeavy },
    cpuSeries: rt.monitor.cpuSeries(40),
    ramSeries: rt.monitor.ramSeries(40),
    background: [...rt.activity.background.values()].slice(0, 10),
    heavyRunning: rt.activity.runningHeavy().map(i => i.label).slice(0, 5),
    refused: rt.resourceStats.refused,
    noticesSent: rt.resourceStats.noticesSent,
    error: rt.monitor.error,
  }
}

function runView(run: Chain.Run, now: number): ChainRunView {
  const t = Chain.totals(run, now)
  return {
    id: run.id,
    number: run.number,
    startedAt: run.startedAt,
    status: run.status,
    root: shortPath(run.root, 48),
    sessions: run.sessions.map(s => ({
      index: s.index,
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      start: s.start,
      end: s.end,
      peakTokens: s.peakTokens,
      window: s.window,
      costUsd: s.costUsd,
      turns: s.turns,
      endNote: s.endNote,
      transitions: s.transitions.length,
    })),
    costUsd: t.costUsd,
    isCostPartial: t.isCostPartial,
    turns: t.turns,
    handoffs: t.handoffs,
    durationMs: t.durationMs,
  }
}

export function chainOf(rt: Runtime): ChainView {
  const now = Date.now()
  return {
    current: rt.run === null ? null : runView(rt.run, now),
    history: rt.history.slice(0, 8).map(r => runView(r, now)),
  }
}

/** Milestones shown around the work under way: a few done, the current one, a few next. */
const PLAN_WINDOW = { done: 2, shown: 7 }

export function missionOf(rt: Runtime): MissionView {
  const p = rt.progress
  const tasks = rt.plan.tasks
  let plan: MissionView['plan'] = null
  if (tasks.length > 0) {
    const done = tasks.filter(t => t.status === 'completed')
    const open = tasks.filter(t => t.status !== 'completed')
    const shownOpen = open.slice(0, Math.max(1, PLAN_WINDOW.shown - Math.min(PLAN_WINDOW.done, done.length)))
    const shownDone = done.slice(-Math.max(PLAN_WINDOW.done, PLAN_WINDOW.shown - shownOpen.length))
    plan = {
      done: p.done,
      total: p.total,
      tasks: [...shownDone, ...shownOpen].map(t => ({ subject: t.subject, status: t.status, isCurrent: t === p.current, detail: t.detail })),
      earlier: done.length - shownDone.length,
      later: open.length - shownOpen.length,
    }
  }
  const totals = rt.run === null ? null : Chain.totals(rt.run, Date.now())
  return {
    objective: rt.run?.objective ?? null,
    plan,
    now: nowLine(rt)?.text ?? null,
    next: p.next === null ? null : p.next.subject,
    isWorking: rt.turn.isRunning,
    session: rt.run === null ? 1 : (Chain.currentSession(rt.run)?.index ?? 1),
    handoffs: totals?.handoffs ?? 0,
  }
}

function fileView(rt: Runtime, f: FileChange): FileChangeView {
  return {
    path: f.path,
    display: shortPath(relativeTo(f.path, rt.root), 56),
    added: f.added,
    removed: f.removed,
    hasDiff: f.hasDiff,
    edits: f.edits,
    isCreated: f.isCreated,
    isDeleted: f.isDeleted,
    lastAt: f.lastAt,
  }
}

export function activityOf(rt: Runtime): ActivityView {
  const now = Date.now()
  const files = rt.activity.changeList()
  const selected = rt.ui.selectedPath === null ? null : (rt.activity.changes.get(rt.ui.selectedPath) ?? null)
  const ctx = { root: rt.root, handoffFile: rt.settings.autopilot.handoffFile }
  const group = (path: string) => groupOf(path, ctx)
  const turnItems = turnItemsOf(rt)
  const attention = attentionOf(turnItems, now)
  const runs = rt.activity.validationRuns()
  const validation = summarize(runs, now)
  const turn = rt.activity.turn
  return {
    summary: rt.activity.summaryLine({ subagentsRunning: rt.runningSubagents }),
    turn: turn.index,
    sessionTools: rt.activity.sessionTools,
    mission: missionOf(rt),
    turnSummary: {
      lines: turnSummaryOf({
        items: turnItems,
        changed: files.filter(f => turn.files.has(f.path)),
        groupOf: group,
        validation,
        attention,
        milestonesDone: Math.max(0, rt.progress.done - rt.turnStartDone),
      }),
      isRunning: rt.turn.isRunning,
      durationMs: turn.startedAt === null ? null : (turn.endedAt ?? now) - turn.startedAt,
      tools: turn.tools,
    },
    timeline: timelineOf(turnItems, turn.startedAt, turn.endedAt ?? now, now),
    quest: questOf(rt),
    attention: attention.slice(0, 12).map(a => ({ id: a.id, kind: a.kind, title: a.title, reason: a.reason, state: a.state, attempts: a.attempts, durationMs: a.durationMs, since: a.since })),
    validation: validation.map(v => ({
      kind: v.kind,
      label: v.label,
      command: v.command,
      status: v.status,
      durationMs: v.durationMs,
      runs: v.runs,
      failures: v.failures,
      isRecovered: v.isRecovered,
      history: runs.filter(r => r.kind === v.kind).map(r => r.status).slice(-12),
    })),
    groups: GROUP_ORDER.map(id => ({ id, label: GROUP_LABEL[id], files: files.filter(f => group(f.path) === id).slice(0, 40).map(f => fileView(rt, f)) })).filter(g => g.files.length > 0),
    showGenerated: rt.ui.showGenerated,
    items: rt.activity.items
      .slice(-80)
      .reverse()
      .map(i => ({
        id: i.id,
        tool: i.tool,
        kind: i.kind,
        label: i.label,
        status: i.status,
        reason: i.reason,
        startedAt: i.startedAt,
        endedAt: i.endedAt,
        isSubagent: i.agentId !== null,
        heavy: i.heavy,
      })),
    totals: rt.activity.totals(),
    selectedPath: selected?.path ?? null,
    selectedHunks: selected?.hunks ?? '',
  }
}

const TIMELINE_KIND: Record<string, TimelineKind> = { read: 'read', search: 'read', edit: 'edit', shell: 'run', web: 'web', agent: 'agent' }

/** Where the turn's time went: one span per call of the main conversation, by kind, a check apart from other commands. */
export function timelineOf(items: readonly ActivityItem[], from: number | null, to: number, now: number): TurnTimelineView | null {
  if (from === null || items.length === 0) return null
  return {
    from,
    to: Math.max(to, from + 1),
    spans: items
      .filter(i => i.kind !== 'task')
      .map(i => ({
        kind: i.validation !== null ? 'check' : (TIMELINE_KIND[i.kind] ?? 'other'),
        start: Math.max(from, i.startedAt),
        end: i.endedAt ?? now,
        isFailed: i.status === 'error' || i.status === 'denied' || i.status === 'held',
      })),
  }
}

function questOf(rt: Runtime): QuestView | null {
  if (rt.settings.answers.style !== 'quest') return null
  const q = rt.quest
  const l = levelOf(q.xp)
  return {
    level: l.level,
    xp: q.xp,
    intoLevel: q.xp - l.floor,
    levelSpan: l.next - l.floor,
    runXp: runQuestOf(rt.run?.quest).xp,
    recent: q.recent.slice(0, 5),
    achievements: ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, hint: a.hint, unlockedAt: q.unlocked[a.id] ?? null })),
  }
}

export function permissionsOf(rt: Runtime): PermissionsView {
  return { recent: rt.permissionLog.slice(0, 20), ...rt.permissionCounts }
}

export function focusOf(rt: Runtime): FocusModel {
  const f = rt.settings.focus
  return { isOn: f.enabled, tools: f.tools, results: f.results, diffs: f.diffs, expanded: [...rt.ui.expanded].slice(-200) }
}

export function spinnerOf(rt: Runtime): SpinnerModel {
  const f = rt.settings.focus
  if (!f.enabled || !f.spinner || !rt.turn.isRunning) return { line: null }
  return { line: rt.activity.summaryLine({ subagentsRunning: rt.runningSubagents }) }
}
