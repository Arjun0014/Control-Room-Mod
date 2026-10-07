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
  ChainView,
  FocusModel,
  HudModel,
  PaneModel,
  PermissionsView,
  ResourcesView,
  SpinnerModel,
  StatusView,
  SystemId,
  Tone,
} from '../../types'
import { MIN_ENGINE } from '../constants'
import * as fmt from '../core/format'
import { findProfile, isModified } from '../core/profiles'
import { relativeTo, shortPath } from '../core/text'
import { readingTone } from '../ui/theme'
import { versionAtLeast } from '../core/version'
import { isHandoffActive } from '../features/autopilot'
import * as Chain from '../features/chain'
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
  else if (rt.autopilot.state === 'pending') alert = { kind: 'pending', text: 'Claude is finishing this step, then hands off to a fresh context.', tone: 'warn' }
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
    session: { run: rt.run?.number ?? null, index: rt.run === null ? 1 : (Chain.currentSession(rt.run)?.index ?? 1) },
    alert,
  }
}

/** The live status bar for Claude Code's own status line (`/cr hud status`): readings and events only. */
export function statusLineOf(hud: HudModel): string {
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`)
  const parts = [`◆ Context ${pct(hud.ctx.pct)}`, fmt.cost(hud.cost.usd)]
  if (hud.load !== null) parts.push(`CPU ${pct(hud.load.cpu)}`, `RAM ${pct(hud.load.ram)}`)
  if (hud.agents.running > 0) parts.push(fmt.plural(hud.agents.running, 'agent'))
  if (hud.autopilot.isOn && hud.autopilot.state !== 'off' && hud.autopilot.state !== 'armed') parts.push(hud.autopilot.text)
  if (hud.guard.isOn && hud.guard.continued > 0) parts.push(`Kept going ×${hud.guard.continued}`)
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

export function activityOf(rt: Runtime): ActivityView {
  const files = rt.activity.changeList()
  const selected = rt.ui.selectedPath === null ? null : (rt.activity.changes.get(rt.ui.selectedPath) ?? null)
  return {
    summary: rt.activity.summaryLine({ subagentsRunning: rt.runningSubagents }),
    turn: rt.activity.turn.index,
    sessionTools: rt.activity.sessionTools,
    items: rt.activity.items
      .slice(-60)
      .reverse()
      .map(i => ({
        id: i.id,
        tool: i.tool,
        kind: i.kind,
        label: i.label,
        status: i.status,
        startedAt: i.startedAt,
        endedAt: i.endedAt,
        isSubagent: i.agentId !== null,
        heavy: i.heavy,
      })),
    files: files.slice(0, 60).map(f => ({
      path: f.path,
      display: shortPath(relativeTo(f.path, rt.root), 56),
      added: f.added,
      removed: f.removed,
      edits: f.edits,
      isCreated: f.isCreated,
      isDeleted: f.isDeleted,
      lastAt: f.lastAt,
    })),
    totals: rt.activity.totals(),
    selectedPath: selected?.path ?? null,
    selectedHunks: selected?.hunks ?? '',
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
