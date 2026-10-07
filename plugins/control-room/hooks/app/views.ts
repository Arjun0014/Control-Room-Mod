/**
 * View models: render-ready projections of the Runtime, one per `$.state`
 * atom. Pure functions of the runtime's state; the publisher decides when
 * to publish them.
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
  Tone,
} from '../../types'
import { MIN_ENGINE } from '../constants'
import * as fmt from '../core/format'
import { relativeTo, shortPath } from '../core/text'
import { versionAtLeast } from '../core/version'
import * as Chain from '../features/chain'
import { isHandoffActive } from '../features/autopilot'
import type { Runtime } from './runtime'

const EFFORT_LABEL: Record<string, string> = { max: 'MAX', xhigh: 'XHIGH', high: 'HIGH' }

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

function autopilotLabel(rt: Runtime): { label: string; tone: Tone } {
  if (!rt.settings.autopilot.enabled) return { label: 'AUTO OFF', tone: 'muted' }
  const t = rt.autopilot.threshold
  switch (rt.autopilot.state) {
    case 'off':
    case 'armed': {
      const a = rt.settings.autopilot
      const target = a.thresholdMode === 'percent' && t === null ? `${a.thresholdPercent}%` : fmt.tokens(t ?? a.thresholdTokens)
      return { label: `AUTO ${target}`, tone: 'normal' }
    }
    case 'pending':
      return { label: 'HANDOFF PENDING', tone: 'warn' }
    case 'requested':
    case 'handoff':
    case 'verifying':
      return { label: 'HANDOFF', tone: 'accent' }
    case 'clearing':
    case 'compacting':
      return { label: 'FRESH CONTEXT…', tone: 'accent' }
    case 'resuming':
      return { label: 'RESUMING', tone: 'accent' }
    case 'awaiting':
      return { label: 'AUTO NEEDS YOU', tone: 'bad' }
  }
}

function resourcesLabel(rt: Runtime): { label: string; tone: Tone } {
  const r = rt.settings.resources
  if (r.level === 'off') return { label: 'RES OFF', tone: 'muted' }
  const name = r.level === 'custom' ? `${r.cpu}/${r.ram}` : r.level.slice(0, 3).toUpperCase()
  const p = rt.monitor.pressure
  const status = rt.monitor.status
  if (status === 'unavailable') return { label: `RES ${name} ?`, tone: 'muted' }
  if (status !== 'live' || p.level === 'unknown') return { label: `RES ${name}`, tone: 'normal' }
  const pct = p.driver === 'ram' ? p.ram : p.cpu
  const tone: Tone = p.level === 'ok' ? 'good' : p.level === 'elevated' ? 'warn' : 'bad'
  const mark = p.level === 'ok' ? '' : ` ${p.level === 'elevated' ? '▲' : '▲▲'}${pct === null ? '' : ` ${Math.round(pct)}%`}`
  return { label: `RES ${name}${mark}`, tone }
}

function agentsLabel(rt: Runtime): { label: string; tone: Tone } {
  const s = rt.settings.subagents
  const running = rt.runningSubagents
  switch (s.mode) {
    case 'unrestricted':
      return { label: running > 0 ? `AGENTS ${running}` : 'AGENTS ∞', tone: running > 0 ? 'info' : 'muted' }
    case 'block':
      return { label: 'AGENTS OFF', tone: 'warn' }
    case 'ask':
      return { label: running > 0 ? `AGENTS ${running} ASK` : 'AGENTS ASK', tone: 'normal' }
    case 'limit':
      return { label: `AGENTS ${running}/${s.limit}`, tone: running >= s.limit ? 'warn' : 'normal' }
  }
}

function guardLabel(rt: Runtime): { label: string; tone: Tone } {
  const eff = rt.effective
  if (!rt.settings.guard.enabled) return { label: 'GUARD OFF', tone: 'muted' }
  if (!eff.guard.isActive) return { label: 'GUARD ⏸', tone: 'muted' }
  if (rt.guard.turnBlocks > 0) return { label: `GUARD ${rt.guard.turnBlocks}/${rt.settings.guard.maxPerTurn}`, tone: 'warn' }
  return { label: 'GUARD ON', tone: 'good' }
}

function routerLabel(rt: Runtime): { label: string; tone: Tone } {
  const s = rt.settings.router.strategy
  if (s === 'off') return { label: 'ROUTER OFF', tone: 'muted' }
  const short = { balanced: 'BAL', performance: 'PERF', economy: 'ECO', custom: 'CUSTOM' }[s]
  return { label: `ROUTER ${short}`, tone: 'normal' }
}

export function runLabelOf(rt: Runtime): string {
  if (rt.run === null) return 'No run'
  const s = Chain.currentSession(rt.run)
  return `Run #${rt.run.number} · S${s?.index ?? 1}`
}

export function hudOf(rt: Runtime): HudModel {
  const tokens = rt.usage.tokens ?? null
  const window = rt.usage.window ?? null
  const pct = tokens !== null && window !== null && window > 0 ? Math.round((100 * tokens) / window) : (rt.usage.pct ?? null)
  const totals = rt.run === null ? null : Chain.totals(rt.run, Date.now())
  const ap = autopilotLabel(rt)
  let alert: HudModel['alert'] = null
  if (rt.autopilot.state === 'awaiting') alert = { text: rt.autopilot.note, tone: 'bad' }
  else if (rt.monitor.pressure.level === 'critical') alert = { text: 'Machine under heavy load — Claude was asked to reduce it', tone: 'bad' }
  else if (rt.autopilot.state === 'pending') alert = { text: 'Finishing the current unit of work, then handing off', tone: 'warn' }
  return {
    isVisible: rt.settings.ui.hud === 'band' || rt.settings.ui.hud === 'both',
    ctx: { tokens, window, pct, threshold: rt.settings.autopilot.enabled ? rt.autopilot.threshold : null, tone: contextTone(rt) },
    cost: { usd: rt.usage.costUsd ?? null, runUsd: totals?.costUsd ?? null, isRunPartial: totals?.isCostPartial ?? false },
    profile: { label: rt.profileLabel },
    autopilot: { label: ap.label, tone: ap.tone, state: rt.autopilot.state, isPending: rt.autopilot.state === 'pending' },
    frontier: { isOn: rt.settings.frontier.enabled, effort: rt.settings.frontier.enabled ? (EFFORT_LABEL[rt.settings.frontier.effort] ?? null) : null },
    guard: guardLabel(rt),
    resources: resourcesLabel(rt),
    agents: agentsLabel(rt),
    router: routerLabel(rt),
    focus: { isOn: rt.settings.focus.enabled },
    alert,
    run: { label: runLabelOf(rt) },
  }
}

/** The status-line form of the HUD: `CR · CTX 684k/1M 68% · $3.84 · FRONTIER MAX · AUTO 700k · RES MED · AGENTS OFF`. */
export function statusLineOf(hud: HudModel): string {
  const ctx = hud.ctx.tokens === null ? 'CTX —' : `CTX ${fmt.tokens(hud.ctx.tokens)}${hud.ctx.window ? `/${fmt.tokens(hud.ctx.window)}` : ''}${hud.ctx.pct === null ? '' : ` ${hud.ctx.pct}%`}`
  const parts = ['CR', ctx, fmt.cost(hud.cost.usd), hud.profile.label.toUpperCase()]
  if (hud.frontier.isOn && !hud.profile.label.toLowerCase().startsWith('frontier')) parts.push(`FRONTIER ${hud.frontier.effort ?? ''}`.trim())
  parts.push(hud.autopilot.label, hud.resources.label, hud.agents.label)
  return parts.join(' · ')
}

export function paneOf(rt: Runtime): PaneModel {
  const a = rt.autopilot
  const isBusy = isHandoffActive(a.state) && a.state !== 'pending'
  return {
    tab: rt.ui.tab,
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
  return {
    status: rt.monitor.status,
    platform: rt.monitor.platform,
    cpu: rt.monitor.pressure.cpu,
    ram: rt.monitor.pressure.ram,
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
