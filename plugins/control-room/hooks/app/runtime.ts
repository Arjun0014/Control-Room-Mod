/**
 * The Runtime: Control Room's composition root. It owns the live model,
 * receives every engine event from `register.tsx`, asks the policy engine
 * what is in force, runs the feature logic, performs effects through the
 * Host, and marks view models dirty for the publisher.
 *
 * Module memory survives /clear (the module is not reloaded), so the run,
 * the settings and the autopilot carry straight into the fresh context.
 */

import type {
  AgentInfo,
  AgentOfferInput,
  AgentSpawnInput,
  CommandRunResult,
  PromptOrigin,
  RenderSurface,
  SessionCompactResult,
  SessionEndInput,
  SessionStartInput,
  SessionUsage,
  ToolCallResult,
  TurnStepInput,
  TurnStepResult,
} from 'claude-code'

import type { PermissionLogEntry, TabId } from '../../types'
import { COMMAND, LIMITS, MIN_ENGINE, PANE_ID, PANE_TITLE, SHORT_COMMAND, STORE_KEYS } from '../constants'
import { type Effective, POLICY_SECTION_ID, effective, policySections, policyText } from '../core/policy'
import { applyProfile, findProfile, profileLabel } from '../core/profiles'
import { PERMISSION_LABEL, type Settings, clone, defaultSettings, normalizeSettings } from '../core/settings'
import { clean } from '../core/text'
import { versionAtLeast } from '../core/version'
import { ActivityTracker } from '../features/activity'
import * as Autopilot from '../features/autopilot'
import * as Chain from '../features/chain'
import * as Handoff from '../features/handoff'
import * as Plan from '../features/plan'
import * as Quest from '../features/quest'
import { VALIDATION_LABEL, summarize } from '../features/validation'
import { groupOf } from '../features/digest'
import { answerStyleLabel } from '../core/answers'
import { type GuardAssessment, assessExit, isRepeat } from '../features/guard'
import * as Guard from '../features/guard'
import { adjustVerdict, decisionFor, denyMessage, editPathOf, findingsFor, isEditTool, isShellTool } from '../features/permissions/decide'
import * as prompts from '../features/prompts'
import { type Pressure, gateHeavy, isOver } from '../features/resources/pressure'
import { heavyKinds, heavyLabel } from '../features/resources/heavy'
import { type Family, classifyTask, familyOf, routeMain, routeSubagent } from '../features/router'
import { activeAgents, decideSpawn, isOffered } from '../features/subagents'
import type { Host } from '../host'
import { ResourceMonitor } from './monitor'
import { Debounced, findRunBySession, loadHistory, loadSettings, nextRunNumber, saveRun } from './persist'
import { CacheGuardian } from './cacheGuardian'
import { handleCommand } from './commands'
import { Publisher } from './publisher'
import * as CacheModel from '../features/cache'
import * as fmt from '../core/format'

type TurnKind = 'person' | 'handoff' | 'retry' | 'continuation' | 'other'

type TurnState = {
  id: string | null
  isRunning: boolean
  kind: TurnKind
  request: string
  toolCount: number
  editCount: number
  pressureNoticeSent: boolean
}

export type UsageFigures = { tokens: number | undefined; window: number | undefined; pct: number | undefined; costUsd: number | undefined }

const OWN_PLUGIN = 'control-room'

const isOwnPrompt = (origin: PromptOrigin | undefined): boolean => origin?.kind === 'plugin' && origin.name === OWN_PLUGIN

const isPersonOrigin = (origin: PromptOrigin | undefined): boolean =>
  origin === undefined || origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk'

export class Runtime {
  host: Host | null = null
  settings: Settings = defaultSettings()
  isLoaded = false
  loading: Promise<void> | null = null

  root = ''
  cwd = ''
  sessionId: string | null = null
  engineVersion: string | null = null
  surfaces: RenderSurface[] = []
  permissionMode: string | undefined
  sessionModel = ''
  usage: UsageFigures = { tokens: undefined, window: undefined, pct: undefined, costUsd: undefined }
  autoCompactAt: number | undefined

  autopilot: Autopilot.Autopilot = Autopilot.initialAutopilot()
  run: Chain.Run | null = null
  history: Chain.Run[] = []
  activity = new ActivityTracker()
  monitor: ResourceMonitor

  turn: TurnState = { id: null, isRunning: false, kind: 'other', request: '', toolCount: 0, editCount: 0, pressureNoticeSent: false }
  guard = { turnBlocks: 0, sessionBlocks: 0, lastBlockedAnswer: '', last: null as (GuardAssessment & { at: number }) | null }
  router = {
    turnModel: null as string | null,
    lastDecision: null as string | null,
    /** Model ids the engine reported answering this session, by family: the only ids a request is routed to. */
    known: new Map<Family, string>(),
    /** Families whose routed model the engine refused this session. */
    unavailable: new Set<string>(),
    /** True when the router sent the last turn to another model than the session's. */
    wasRouted: false,
  }
  agents = { list: [] as AgentInfo[], spawned: 0, denied: 0, asked: 0, allowAll: false, poll: null as { cancel: () => void } | null }
  permissionLog: PermissionLogEntry[] = []
  permissionCounts = { denied: 0, asked: 0, allowed: 0 }
  resourceStats = { refused: 0, noticesSent: 0, lastNoticeAt: 0, lastNoticeLevel: 'ok' as string }
  frontier = { lastEffort: null as string | null, isEffortSupported: null as boolean | null }
  compose = { isReached: false, deliveredFallback: false, isLikelyBypassed: false }

  ui = {
    tab: 'overview' as TabId,
    activitySub: 'summary' as 'summary' | 'raw',
    showGenerated: false,
    selectedPath: null as string | null,
    expanded: new Set<string>(),
    isPaneOpen: false,
    openPicker: null as string | null,
  }
  notes: string[] = []
  savedAt: number | null = null

  /** Quest log: lifetime XP and achievements (kept while the Quest log style is chosen). */
  quest: Quest.QuestState = Quest.emptyQuest()
  /** Checks of each kind that already paid XP this turn, so re-running a passing check earns nothing. */
  private questGreen = new Set<string>()
  /** The person's own Claude Code output style, as the last system prompt reported it; it outranks the answer style. */
  nativeOutputStyle: string | null = null

  /** Milestones finished when the turn began, so the turn's summary can count its own. */
  turnStartDone = 0

  /** The handoff turn, for Handoff Health: the first activity turn it counts from, and whether the milestones were sent again in it. */
  private handoffTurn = { fromTurn: -1, isPlanUpdated: false }
  /** Files the main conversation read in this context: the continuity check after a handoff looks for the notes and the docs. */
  private reads: string[] = []

  /** The prompt cache: telemetry, the miss doctor, Keep warm and stable policies. */
  readonly cache: CacheGuardian
  /** What the last settings change was, in words, for a policy-caused cache miss. */
  private policyReason: string | null = null

  /** What the next plugin-submitted turn is, so turn.start can label it. */
  private expecting: TurnKind | null = null
  private startSource: { source: string; sessionId: string } | null = null
  /** True from Control Room's own /clear until the fresh session it makes is seen (or the wait ends). */
  private isOwnClear = false
  /** Resolves when classic.SessionStart{clear} reports the fresh session of Control Room's own /clear. */
  private onOwnClearSeen: (() => void) | null = null
  private commandsRegistered = new Set<string>()

  readonly publisher: Publisher
  private readonly saveSettings: Debounced<Settings>
  private readonly saveRunLater: Debounced<Chain.Run>
  private readonly saveQuest: Debounced<Quest.QuestState>

  constructor() {
    this.publisher = new Publisher(() => this.host, this)
    this.saveSettings = new Debounced<Settings>(() => this.host, (host, value) => host.storeSet(STORE_KEYS.settings, value), LIMITS.persistDebounceMs)
    this.saveRunLater = new Debounced<Chain.Run>(() => this.host, (host, run) => saveRun(host, run), LIMITS.persistDebounceMs)
    this.saveQuest = new Debounced<Quest.QuestState>(() => this.host, (host, value) => host.storeSet(STORE_KEYS.quest, value), LIMITS.persistDebounceMs)
    this.monitor = new ResourceMonitor(
      (pressure, previous) => this.onPressure(pressure, previous),
      () => this.publisher.mark('resources', 'hud', 'pane'),
    )
    this.cache = new CacheGuardian({
      host: () => this.host,
      now: () => this.clock(),
      settings: () => this.settings,
      isTurnRunning: () => this.turn.isRunning,
      contextTokens: () => this.usage.tokens ?? 0,
      standDown: () => this.keepWarmStandDown(),
      changed: () => this.publisher.mark('hud', 'pane'),
      missed: miss => this.onCacheMiss(miss),
      verdict: verdict => this.onKeepWarmVerdict(verdict),
    })
  }

  // -------------------------------------------------------------------------
  // The prompt cache

  /** Milliseconds since the epoch: the system clock, or a test's manual one. Every cache figure is timed by it. */
  clock(): number {
    return this.host?.time?.() ?? Date.now()
  }

  /**
   * Keep warm stands down while the context is about to be cleared: a
   * handoff under way or due, whose /clear throws the cache away. A handoff
   * that compacts keeps it (compaction re-reads the whole conversation), and
   * so does the compact fallback while it runs. A handoff waiting for the
   * person ends in a fresh context, so it stands down then too.
   */
  keepWarmStandDown(): string | null {
    const a = this.settings.autopilot
    if (!a.enabled) return null
    const ap = this.autopilot
    if (ap.state === 'compacting') return null
    if (ap.state === 'awaiting' || ap.state === 'clearing' || ap.state === 'resuming') {
      return 'A handoff is starting a fresh context, so this cache is about to be discarded'
    }
    const tokens = this.usage.tokens ?? 0
    const isPastThreshold = ap.state === 'armed' && ap.threshold !== null && tokens >= ap.threshold && (ap.snoozeUntil === null || tokens >= ap.snoozeUntil)
    const isComing = ap.state === 'pending' || ap.state === 'requested' || ap.state === 'handoff' || ap.state === 'verifying' || isPastThreshold
    if (!isComing || a.continuation === 'compact') return null
    return isPastThreshold ? 'Past the handoff point: the next turn hands off to a fresh context' : 'A handoff will start a fresh context, so this cache is about to be discarded'
  }

  private onCacheMiss(miss: CacheModel.CacheMiss): void {
    this.publisher.mark('hud', 'pane')
    const host = this.host
    if (host === null || !this.settings.ui.toasts || miss.kind === 'lifecycle' || miss.severity !== 'warn') return
    host.toast(`Cache rebuilt: ${fmt.tokens(miss.recached)} tokens · ${CacheModel.CAUSE_LABEL[miss.cause]}`, 6000)
  }

  private onKeepWarmVerdict(verdict: 'yes' | 'no'): void {
    const host = this.host
    if (verdict === 'no') this.note('Keep warm did not keep the prompt cache warm on this setup, so it stopped. Context → Cache has the details.')
    if (host !== null && this.settings.ui.toasts) {
      host.toast(verdict === 'yes' ? 'Keep warm verified: the cache stayed warm past its old expiry' : 'Keep warm stopped: it did not keep the cache warm here', 6000)
    }
  }

  /**
   * Before a model switch the person makes: with a large warm cache, Claude
   * Code is asked to confirm, with what the switch re-sends uncached.
   */
  onPreModelSwitch(e: { from_model: string; to_model: string; source: string; context_tokens: number; prompt_cache_warm: boolean; cache_ttl: '5m' | '1h'; estimated_cache_write_usd: number }): string | null {
    if (e.cache_ttl === '5m' || e.cache_ttl === '1h') this.cache.noteTtl(e.cache_ttl)
    const s = this.settings.cache
    if (!s.guardModelSwitch || !e.prompt_cache_warm || e.from_model === e.to_model || e.context_tokens < LIMITS.guardSwitchTokens) return null
    if (e.source !== 'command' && e.source !== 'picker') return null
    const cost = Number.isFinite(e.estimated_cache_write_usd) && e.estimated_cache_write_usd > 0 ? ` (about ${fmt.cost(e.estimated_cache_write_usd)}, as Claude Code estimates it)` : ''
    return `Control Room: the prompt cache holds ${fmt.tokens(e.context_tokens)} tokens of this conversation for ${CacheModel.shortModel(e.from_model)}. Switching to ${CacheModel.shortModel(e.to_model)} sends them again uncached${cost}. Switching at the start of a fresh context avoids that.`
  }

  onPostModelSwitch(e: { from_model: string; to_model: string; cache_ttl: '5m' | '1h'; source: string }): void {
    const by = e.source === 'auto' || e.source === 'resume' ? 'engine' : 'person'
    if (e.cache_ttl === '5m' || e.cache_ttl === '1h') this.cache.noteModelSwitch({ from: e.from_model, to: e.to_model, ttl: e.cache_ttl, now: this.clock(), by })
    if (e.to_model !== '') this.sessionModel = e.to_model
  }

  // -------------------------------------------------------------------------
  // Binding and loading

  bind(host: Host): void {
    if (this.host === null) this.host = host
  }

  /** Loads settings once (any hook may be the first to need them). */
  async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return
    if (this.loading === null) {
      this.loading = (async () => {
        const host = this.host
        if (host === null) return
        const loaded = await loadSettings(host)
        this.settings = loaded.settings
        this.quest = Quest.questOf(await host.storeGet(STORE_KEYS.quest).catch(() => undefined))
        if (loaded.wasRepaired) this.note('Some saved Control Room settings were invalid and were reset to safe defaults.')
        if (loaded.tightened.length > 0) {
          this.note(`${loaded.tightened.join(', ')} no longer offer${loaded.tightened.length === 1 ? 's' : ''} Allow, so Claude Code asks first.`)
          // Saved at once, so the note shows in one session rather than every one.
          this.saveSettings.schedule(this.settings)
        }
        this.isLoaded = true
      })().finally(() => {
        this.loading = null
      })
    }
    await this.loading
  }

  note(text: string): void {
    if (!this.notes.includes(text)) this.notes = [...this.notes, text].slice(-6)
    this.publisher.mark('pane')
  }

  get effective(): Effective {
    return effective(this.settings, {
      autopilot: this.autopilot.state,
      autopilotThreshold: this.autopilot.threshold,
      pressure: this.monitor.pressure.level,
      permissionMode: this.permissionMode,
    })
  }

  // -------------------------------------------------------------------------
  // Session lifecycle

  async onSessionStart(e: SessionStartInput): Promise<void> {
    const host = this.host
    if (host === null) return
    await this.ensureLoaded()
    this.cwd = e.cwd
    const [root, id, version, surfaces, model, panes] = await Promise.all([
      host.sessionRoot().catch(() => e.cwd),
      host.sessionId().catch(() => null),
      host.version().catch(() => null),
      host.surfaces().catch(() => [] as readonly RenderSurface[]),
      host.sessionModel().catch(() => ''),
      host.panes().catch(() => []),
    ])
    this.root = root
    this.sessionId = id
    this.engineVersion = version?.version ?? null
    this.surfaces = [...surfaces]
    this.sessionModel = model
    // A hot reload starts a fresh Runtime under a panel that is still open.
    this.ui.isPaneOpen = panes.some(p => p.id === PANE_ID)
    if (this.engineVersion !== null && !versionAtLeast(this.engineVersion, MIN_ENGINE)) {
      this.note(`Claude Code ${this.engineVersion} is older than ${MIN_ENGINE}, the version Control Room was verified on; some features may not work.`)
    }

    await this.registerCommands()
    await this.offerMilestones()
    // Managed settings seat Anthropic's sec-default guard, which continues prompt.compose past
    // user-installed mods; policies then ride the prompt as context instead.
    const policy = await host.settings('policy').catch(() => ({}))
    this.compose.isLikelyBypassed = Object.keys(policy).length > 0
    await this.attachRun()
    await this.cache.load()
    await this.refreshUsage(true)
    this.reconfigure({ isStartup: true })
    await this.recoverAutopilot()
    void this.refreshHistory()
    this.publisher.markAll()

    if (this.settings.ui.openOnStart) void host.open({ id: PANE_ID, title: PANE_TITLE }).catch(() => undefined)
  }

  /** The milestones tool's full name once offered to Claude; null while it is not. */
  milestonesTool: string | null = null
  /** Where run progress comes from in this session. */
  planSource: 'tasks' | 'milestones' | 'none' = 'none'

  /**
   * Run progress counts Claude's task list. Claude Code builds that offer
   * none (its task tools are off by default in 2.1.29x) get Control Room's
   * milestones tool instead, with a short policy, unless the person turned
   * it off. Where a task list exists it is used, and nothing is added.
   */
  async offerMilestones(): Promise<void> {
    const host = this.host
    if (host === null) return
    const tools = await host.listTools().catch(() => [] as readonly { name: string }[])
    if (tools.some(t => Plan.isPlanTool(t.name))) {
      this.planSource = 'tasks'
      this.publisher.mark('pane')
      return
    }
    if (!this.settings.progress.milestones) {
      this.planSource = this.milestonesTool === null ? 'none' : 'milestones'
      this.publisher.mark('pane')
      return
    }
    if (this.milestonesTool === null) {
      this.milestonesTool = await host
        .registerTool({ name: prompts.MILESTONES_TOOL.name, description: prompts.MILESTONES_TOOL.description, inputSchema: prompts.MILESTONES_TOOL.inputSchema as unknown as Record<string, unknown> })
        .catch(() => null)
    }
    this.planSource = this.milestonesTool === null ? 'none' : 'milestones'
    this.publisher.mark('pane')
  }

  /** The milestones tool's answer: the run plan updated from the whole list. A subagent's list is its own. */
  recordMilestones(input: Record<string, unknown>, agentId: string | undefined): string {
    if (!this.settings.progress.milestones) return 'Milestone tracking is off in Control Room; there is no need to call this tool.'
    if (agentId !== undefined || this.run === null) return 'Recorded.'
    const session = Chain.currentSession(this.run)?.index ?? 1
    // Claude's own statement of the objective, when it gives one, says it better than the request's first sentence.
    const objective = typeof input.objective === 'string' ? clean(input.objective, 140) : ''
    if (objective.length >= 8 && objective !== this.run.objective) {
      this.run = { ...this.run, objective }
      this.persistRun()
      this.publisher.mark('activity', 'hud')
    }
    this.setPlan(Plan.fromMilestones(this.plan, input, session, Date.now()))
    const p = this.progress
    return `Recorded: ${p.done} of ${p.total} milestones done${p.current === null ? '' : `, now: ${p.current.subject}`}.`
  }

  /** A new run plan from Claude's task list: kept with the run, and in the Quest log, newly finished milestones pay. */
  private setPlan(plan: Plan.Plan): void {
    if (this.run === null || plan === this.plan) return
    const before = Plan.progressOf(this.plan)
    const wasDone = new Set(this.plan.tasks.filter(t => t.status === 'completed').map(t => t.key))
    this.run = { ...this.run, plan }
    const after = this.progress
    if (this.turn.isRunning && (this.turn.kind === 'handoff' || this.turn.kind === 'retry')) this.handoffTurn.isPlanUpdated = true
    for (const t of plan.tasks) {
      if (t.status === 'completed' && !wasDone.has(t.key)) this.questEvent('milestone', `Milestone: ${t.subject}`, t.key)
    }
    if (after.total >= 3 && after.done === after.total && before.done < before.total) {
      this.questEvent('fullClear', `Full clear: ${after.done} of ${after.total} milestones`)
    }
    this.persistRun()
    this.publisher.mark('activity', 'hud', 'pane')
  }

  /**
   * Quest log: one verified outcome. Only while the person chose the Quest log
   * style; a milestone pays once per run (by `paidKey`).
   */
  private questEvent(kind: Quest.QuestEventKind, text: string, paidKey?: string): void {
    if (this.settings.answers.style !== 'quest' || this.run === null) return
    const share = Quest.runQuestOf(this.run.quest)
    if (paidKey !== undefined && share.paid.includes(paidKey)) return
    const result = Quest.award(this.quest, { kind, text }, Date.now())
    this.quest = result.state
    this.run = { ...this.run, quest: { xp: share.xp + result.xp, paid: paidKey === undefined ? share.paid : [...share.paid, paidKey].slice(-200) } }
    const shape = Quest.unlockForRun(this.quest, { sessions: this.run.sessions.length, milestonesDone: Quest.runQuestOf(this.run.quest).paid.length }, Date.now())
    this.quest = shape.state
    this.saveQuest.schedule(this.quest)
    this.persistRun()
    this.publisher.mark('hud', 'activity')
    if (!this.settings.ui.toasts) return
    for (const id of [...result.unlocked, ...shape.unlocked]) this.host?.toast(`Achievement: ${Quest.achievementName(id)}`, 5000)
    if (result.levelUp !== null) this.host?.toast(`Level ${result.levelUp}`, 4000)
  }

  /** Quest log: achievements a run earns by its shape (a third context), checked when it rolls over. */
  private questForRunShape(now: number): void {
    if (this.settings.answers.style !== 'quest' || this.run === null) return
    const shape = Quest.unlockForRun(this.quest, { sessions: this.run.sessions.length, milestonesDone: Quest.runQuestOf(this.run.quest).paid.length }, now)
    if (shape.unlocked.length === 0) return
    this.quest = shape.state
    this.saveQuest.schedule(this.quest)
    this.publisher.mark('hud', 'activity')
    if (this.settings.ui.toasts) for (const id of shape.unlocked) this.host?.toast(`Achievement: ${Quest.achievementName(id)}`, 5000)
  }

  /** The policy sections in force, with what this session offers. */
  policies(): ReturnType<typeof policySections> {
    return policySections(this.settings, this.autopilot.threshold, { milestonesTool: this.milestonesTool, nativeOutputStyle: this.nativeOutputStyle })
  }

  private async registerCommands(): Promise<void> {
    const host = this.host
    if (host === null) return
    const existing = new Set((await host.listCommands().catch(() => [])).map(c => c.name))
    try {
      await host.registerCommand({
        name: COMMAND,
        description: 'Open Control Room: context, behavior, guardrails, activity and setup',
        argumentHint: '[status|profile <name>|autopilot on|off|<70%|700k>|handoff|fresh|cache|frontier|focus|style <name>|resources <level>|agents <mode>]',
      })
      this.commandsRegistered.add(COMMAND)
    } catch (error) {
      this.note(`Could not register /${COMMAND}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!existing.has(SHORT_COMMAND) || this.commandsRegistered.has(SHORT_COMMAND)) {
      try {
        await host.registerCommand({ name: SHORT_COMMAND, description: 'Control Room (short for /control-room)', argumentHint: '[sub-command]' })
        this.commandsRegistered.add(SHORT_COMMAND)
      } catch {
        // The alias is a convenience only.
      }
    }
  }

  isOwnCommand(command: string): boolean {
    return command === COMMAND || (command === SHORT_COMMAND && this.commandsRegistered.has(SHORT_COMMAND))
  }

  /** Continues the run this session belongs to (reload, resume) or starts one. */
  private async attachRun(): Promise<void> {
    const host = this.host
    if (host === null || this.sessionId === null) return
    if (this.run !== null && this.run.sessions.some(s => s.id === this.sessionId)) return
    const now = await host.now()
    const existing = await findRunBySession(host, this.sessionId)
    if (existing !== null) {
      this.run = { ...existing, status: 'active', plan: Plan.planOf(existing.plan), lastHandoff: Handoff.handoffRecordOf(existing.lastHandoff) }
      // Milestones done before this runtime attached are no turn's doing.
      this.turnStartDone = this.progress.done
      return
    }
    const resumedFrom = this.startSource?.source === 'resume' ? this.startSource.sessionId : null
    const previous = resumedFrom === null ? null : await findRunBySession(host, resumedFrom)
    if (previous !== null) {
      this.run = Chain.rollOver({ ...previous, plan: Plan.planOf(previous.plan) }, { end: 'resume', endNote: 'resumed', nextId: this.sessionId, nextStart: 'resume', now })
    } else {
      this.run = Chain.newRun({
        id: Chain.runIdOf(now, Math.random()),
        number: await nextRunNumber(host),
        sessionId: this.sessionId,
        root: this.root,
        profile: this.settings.profile,
        start: this.startSource?.source === 'resume' ? 'resume' : 'startup',
        now,
      })
    }
    this.turnStartDone = this.progress.done
    this.persistRun()
  }

  async refreshHistory(): Promise<void> {
    const host = this.host
    if (host === null) return
    this.history = await loadHistory(host, this.run?.id ?? null).catch(() => [])
    this.publisher.mark('chain')
  }

  persistRun(isNow = false): void {
    if (this.run === null) return
    if (isNow) {
      const host = this.host
      if (host !== null) void saveRun(host, this.run).catch(() => undefined)
      return
    }
    this.saveRunLater.schedule(this.run)
  }

  /** classic.SessionStart: the one place a fresh context after /clear can be given context. */
  async onClassicSessionStart(input: { source: string; sessionId: string; model?: string }): Promise<string[]> {
    await this.ensureLoaded()
    if (input.source !== 'clear') {
      this.startSource = { source: input.source, sessionId: input.sessionId }
      if (input.source === 'compact') this.publisher.mark('chain', 'hud')
      return []
    }
    const host = this.host
    const now = host === null ? Date.now() : await host.now()
    const wasOurs = this.isOwnClear || this.autopilot.state === 'clearing'
    if (wasOurs) this.onOwnClearSeen?.()
    if (this.run !== null) {
      this.run = Chain.rollOver(this.run, {
        end: wasOurs ? 'handoff' : 'clear',
        endNote: wasOurs
          ? `handoff at ${this.autopilot.triggeredTokens === null ? 'manual request' : `${Math.round(this.autopilot.triggeredTokens / 1000)}k tokens`}`
          : 'cleared by you',
        nextId: input.sessionId,
        nextStart: wasOurs ? 'handoff' : 'clear',
        now,
      })
      this.persistRun(true)
      this.questForRunShape(now)
    }
    this.sessionId = input.sessionId
    this.usage = { tokens: undefined, window: this.usage.window, pct: undefined, costUsd: 0 }
    this.cache.resetForContext()
    this.reads = []
    if (wasOurs && this.run !== null) {
      const h = this.run.lastHandoff
      const index = Chain.currentSession(this.run)?.index ?? 1
      if (h !== undefined && h !== null && h.toSession === null && h.fromSession === index - 1) this.run = { ...this.run, lastHandoff: { ...h, toSession: index } }
    }
    this.activity.reset()
    this.guard = { turnBlocks: 0, sessionBlocks: 0, lastBlockedAnswer: '', last: null }
    this.compose = { ...this.compose, isReached: false, deliveredFallback: false }
    this.router.turnModel = null
    this.publisher.forgetPublished()
    this.publisher.markAll()
    if (!wasOurs) {
      this.stepAutopilot({ kind: 'externalClear' })
      return []
    }
    const policies = this.policies().map(s => s.name)
    const sessionNumber = this.run === null ? 1 : (Chain.currentSession(this.run)?.index ?? 1)
    return [
      prompts.continuationContext({
        runNumber: this.run?.number ?? null,
        sessionNumber,
        handoffPath: this.handoffPath(),
        policies,
        milestones: this.plan.tasks.map(t => ({ subject: t.subject, status: t.status, detail: t.detail })).slice(-30),
      }),
    ]
  }

  async onSessionEnd(e: SessionEndInput): Promise<void> {
    if (e.reason === 'clear') {
      this.publisher.forgetPublished()
      this.persistRun(true)
      return
    }
    this.monitor.stop()
    this.agents.poll?.cancel()
    this.cache.stop()
    if (this.run !== null) {
      const now = Date.now()
      const end: Chain.SessionEnd = e.reason === 'resume' ? 'resume' : e.reason === 'logout' ? 'logout' : e.reason === 'prompt_input_exit' ? 'exit' : 'other'
      this.run = Chain.endRun(this.run, end, now)
      const host = this.host
      if (host !== null) await saveRun(host, this.run).catch(() => undefined)
    }
    await this.saveSettings.flush()
    await this.saveQuest.flush()
  }

  // -------------------------------------------------------------------------
  // Usage, context and the autopilot

  handoffPath(): string {
    const sep = this.root.includes('\\') && !this.root.includes('/') ? '\\' : '/'
    const file = this.settings.autopilot.handoffFile.replace(/\//g, sep)
    return this.root === '' ? file : `${this.root.replace(/[\\/]+$/, '')}${sep}${file}`
  }

  async refreshUsage(withSummary = false): Promise<void> {
    const host = this.host
    if (host === null) return
    const usage = await (withSummary ? host.usageSummary() : host.usage()).catch(() => null)
    if (usage === null) return
    this.applyUsage(usage)
    if (withSummary) {
      const at = usage.context.breakdown?.autoCompactThreshold
      this.autoCompactAt = usage.context.breakdown?.isAutoCompactEnabled === false ? undefined : at
    }
  }

  applyUsage(usage: Pick<SessionUsage, 'context' | 'cost'>): void {
    const previousWindow = this.usage.window
    this.usage = {
      tokens: usage.context.tokens ?? this.usage.tokens,
      window: usage.context.window,
      pct: usage.context.percent ?? this.usage.pct,
      costUsd: usage.cost?.usd ?? this.usage.costUsd,
    }
    if (this.run !== null) {
      this.run = Chain.measure(this.run, { tokens: usage.context.tokens, window: usage.context.window, costUsd: usage.cost?.usd, model: this.sessionModel || undefined }, Date.now())
      this.persistRun()
    }
    if (previousWindow !== this.usage.window) this.configureAutopilot()
    this.publisher.mark('hud', 'pane', 'chain')
  }

  configureAutopilot(): void {
    const a = this.settings.autopilot
    const { threshold, isClamped } = Autopilot.resolveThreshold({
      mode: a.thresholdMode,
      tokens: a.thresholdTokens,
      percent: a.thresholdPercent,
      window: this.usage.window,
      autoCompactAt: this.autoCompactAt,
    })
    this.stepAutopilot({ kind: 'configure', enabled: a.enabled, threshold, isClamped })
  }

  stepAutopilot(event: Autopilot.AutopilotEvent): void {
    const a = this.settings.autopilot
    const result = Autopilot.step(this.autopilot, event, {
      continuation: a.continuation,
      fallbackToCompact: a.fallbackToCompact,
      autoContinue: a.autoContinue,
    })
    this.applyAutopilot(result)
  }

  private applyAutopilot(result: Autopilot.Step): void {
    const before = this.autopilot.state
    this.autopilot = result.model
    this.saveAutopilotRecord()
    this.publisher.mark('hud', 'pane')
    for (const effect of result.effects) void this.runEffect(effect)
    // A handoff coming or going changes whether the cache is worth keeping.
    if (before !== this.autopilot.state && !this.turn.isRunning) this.cache.schedule()
  }

  /** The last record written, so an unchanged machine writes nothing. */
  private savedRecord = 'null'

  /** Keeps the handoff in flight in `$.state`, where a reload of the plugin finds it. */
  private saveAutopilotRecord(): void {
    const host = this.host
    if (host === null) return
    const record = Autopilot.recordOf(this.autopilot, this.sessionId, Date.now())
    const key = JSON.stringify(record === null ? null : { ...record, at: 0 })
    if (key === this.savedRecord) return
    this.savedRecord = key
    void host.saveAutopilotRecord(record).catch(() => {
      this.savedRecord = 'unsaved'
    })
  }

  /**
   * After a reload: a handoff that was under way carries on from where its
   * record left it, so the context crossing the threshold again does not
   * start a second one. A restart or /clear leaves no record.
   */
  private async recoverAutopilot(): Promise<void> {
    const host = this.host
    if (host === null) return
    const record = await host.loadAutopilotRecord().catch(() => null)
    if (record === null) return
    this.savedRecord = JSON.stringify({ ...record, at: 0 })
    const result = Autopilot.recover(this.autopilot, record, { sessionId: this.sessionId })
    if (result.model === this.autopilot) return
    this.applyAutopilot(result)
  }

  private async runEffect(effect: Autopilot.AutopilotEffect): Promise<void> {
    const host = this.host
    if (host === null) return
    switch (effect.kind) {
      case 'appendPending':
        await host.appendForModel(prompts.pendingNotice({ tokens: effect.tokens, threshold: effect.threshold, window: effect.window }))
        return
      case 'notify':
        if (this.settings.ui.toasts) host.toast(effect.text, effect.level === 'error' ? 8000 : 5000)
        if (effect.level === 'error') this.note(effect.text)
        return
      case 'submitHandoff':
      case 'submitRetry': {
        const text =
          effect.kind === 'submitRetry'
            ? prompts.handoffRetryPrompt(this.settings.autopilot.handoffFile)
            : prompts.handoffPrompt({
                tokens: this.usage.tokens,
                window: this.usage.window,
                handoffFile: this.settings.autopilot.handoffFile,
                runNumber: this.run?.number ?? null,
                sessionNumber: this.run === null ? 1 : (Chain.currentSession(this.run)?.index ?? 1),
                planTool: this.planSource === 'milestones' ? this.milestonesTool : this.planSource === 'tasks' ? 'your task list (TodoWrite or the Task tools)' : null,
              })
        this.expecting = effect.kind === 'submitRetry' ? 'retry' : 'handoff'
        host.after(250, () => void this.submitOwn(text, effect.kind === 'submitRetry' ? 'retry' : 'handoff'))
        return
      }
      case 'verifyHandoff': {
        const isOk = await this.verifyHandoff()
        if (isOk) this.questEvent('handoff', 'Clean handoff: notes verified')
        this.recordHandoffHealth(isOk)
        this.stepAutopilot({ kind: 'handoffVerified', isOk, now: await host.now() })
        return
      }
      case 'clear':
        host.after(LIMITS.clearDelayMs, () => void this.runClear())
        return
      case 'compact':
        host.after(LIMITS.clearDelayMs, () => void this.runCompact())
        return
      case 'submitContinuation': {
        const text = prompts.continuationPrompt({
          handoffPath: this.handoffPath(),
          sessionNumber: this.run === null ? 1 : (Chain.currentSession(this.run)?.index ?? 1),
        })
        host.after(400, () => void this.submitOwn(text, 'continuation'))
        return
      }
    }
  }

  private async submitOwn(text: string, kind: TurnKind): Promise<void> {
    const host = this.host
    if (host === null) return
    this.expecting = kind
    try {
      const result = await host.submit(text)
      if (result.drop !== undefined) {
        this.expecting = null
        this.stepAutopilot({ kind: 'submitFailed', error: `prompt dropped: ${result.drop}` })
        return
      }
      const now = await host.now()
      if (kind === 'handoff') this.stepAutopilot({ kind: 'handoffStarted', now })
      if (kind === 'continuation') this.stepAutopilot({ kind: 'continuationStarted', now })
    } catch (error) {
      this.expecting = null
      this.stepAutopilot({ kind: 'submitFailed', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Handoff Health, read once the notes are checked: what the handoff turn
   * left in each of the four places (the milestones, the project's docs,
   * CLAUDE.md, the notes), and whether a check ran in this context.
   */
  private recordHandoffHealth(isNotesWritten: boolean): void {
    if (this.run === null) return
    const p = this.progress
    const ctx = { root: this.root, handoffFile: this.settings.autopilot.handoffFile }
    const from = this.handoffTurn.fromTurn
    const changed = from < 0 ? [] : this.activity.changeList().filter(f => f.lastTurn >= from)
    const isClaudeMd = (path: string) => /(^|[\\/])claude\.md$/i.test(path)
    const word: Record<string, string> = { passed: 'passing', failed: 'failing', running: 'running', blocked: 'blocked', background: 'in the background', stopped: 'stopped' }
    const checks = summarize(this.activity.validationRuns(), Date.now()).map(v => ({ label: v.label, status: word[v.status] ?? v.status }))
    const continuation = this.settings.autopilot.continuation
    const record: Handoff.HandoffRecord = {
      at: Date.now(),
      fromSession: Chain.currentSession(this.run)?.index ?? 1,
      toSession: null,
      via: continuation === 'compact' ? 'compact' : continuation === 'manual' ? 'manual' : 'clear',
      health: Handoff.healthOf({
        hasPlan: p.total > 0,
        isPlanUpdated: this.handoffTurn.isPlanUpdated,
        current: p.current === null ? null : { key: p.current.key, subject: p.current.subject },
        isPlanSettled: p.total > 0 && this.plan.tasks.every(t => t.status === 'completed' || t.status === 'blocked'),
        isNotesWritten,
        handoffFile: this.settings.autopilot.handoffFile,
        docsEdited: changed.filter(f => groupOf(f.path, ctx) === 'docs' && !isClaudeMd(f.path)).map(f => f.path),
        checks,
        isClaudeMdEdited: changed.some(f => isClaudeMd(f.path)),
      }),
      currentKey: p.current?.key ?? null,
      currentSubject: p.current?.subject ?? null,
      done: p.done,
      total: p.total,
      continuity: null,
    }
    this.run = { ...this.run, lastHandoff: record }
    this.persistRun()
    this.publisher.mark('pane')
  }

  /**
   * Continuity, read when the first turn of the context after a handoff
   * ends: the notes read, the run state restored, the milestone picked up
   * again, the project's docs read, the work resumed. One toast says how it went.
   */
  private checkContinuity(): void {
    const run = this.run
    const h = run?.lastHandoff
    if (run === null || h === undefined || h === null || h.toSession === null || h.continuity !== null) return
    const index = Chain.currentSession(run)?.index ?? 1
    if (h.toSession !== index) return
    const p = this.progress
    const ctx = { root: this.root, handoffFile: this.settings.autopilot.handoffFile }
    const continuity = Handoff.continuityOf(
      {
        handoffFile: this.settings.autopilot.handoffFile,
        reads: this.reads,
        isDoc: path => groupOf(path, ctx) === 'docs',
        isPlanUpdated: this.plan.session >= index && this.plan.updatedAt !== null,
        tasks: this.plan.tasks.map(t => ({ key: t.key, subject: t.subject, status: t.status })),
        done: p.done,
        current: p.current === null ? null : { key: p.current.key, subject: p.current.subject },
        edits: this.activity.items.filter(i => i.kind === 'edit' && i.status === 'ok' && i.agentId === null).length,
        checks: this.activity.validationRuns().length,
      },
      h,
    )
    this.run = { ...run, lastHandoff: { ...h, continuity } }
    this.persistRun()
    this.publisher.mark('pane')
    if (this.settings.ui.toasts) this.host?.toast(Handoff.continuityToast(continuity), 6000)
  }

  private async verifyHandoff(): Promise<boolean> {
    const host = this.host
    if (host === null) return false
    const since = this.autopilot.handoffSince ?? 0
    try {
      const stat = await host.stat(this.handoffPath(), false)
      return stat.kind === 'file' && stat.size > 0 && stat.mtimeMs >= since - 5000
    } catch {
      return false
    }
  }

  /**
   * Control Room's /clear. `$.command.run` resolves when the command has run,
   * which in the interactive terminal is before the engine has reset the
   * session; the Desktop host protocol resets first. Either way the fresh
   * session is waited for, so it is recognised as ours (handoff recorded,
   * fresh context seeded) and the continuation goes into it, numbered for it.
   */
  private async runClear(): Promise<void> {
    const host = this.host
    if (host === null) return
    const before = await host.sessionId().catch(() => null)
    let isSeen = false
    const seen = new Promise<void>(resolve => {
      this.onOwnClearSeen = () => {
        isSeen = true
        resolve()
      }
    })
    this.isOwnClear = true
    const settle = () => {
      this.isOwnClear = false
      this.onOwnClearSeen = null
    }
    try {
      await host.runCommand('clear')
    } catch (error) {
      settle()
      this.stepAutopilot({ kind: 'clearFailed', error: error instanceof Error ? clean(error.message, 160) : String(error) })
      return
    }
    if (!isSeen) await Promise.race([seen, new Promise<void>(resolve => host.after(LIMITS.clearSettleMs, resolve))])
    settle()
    // Without the fresh session's start, a new session id still proves the clear happened.
    const after = isSeen ? null : await host.sessionId().catch(() => null)
    if (!isSeen && (after === null || after === before)) {
      this.stepAutopilot({ kind: 'clearFailed', error: 'the context was not cleared' })
      return
    }
    this.stepAutopilot({ kind: 'clearDone', now: await host.now() })
  }

  private async runCompact(): Promise<void> {
    const host = this.host
    if (host === null) return
    try {
      const result: SessionCompactResult = await host.compact(
        `Context Autopilot handoff: keep the current task, its state, decisions, unfinished work and where the handoff notes are (${this.handoffPath()}).`,
      )
      if (result.skip !== undefined) {
        this.stepAutopilot({ kind: 'compactFailed', error: result.skip })
        return
      }
      if (this.run !== null) {
        this.run = Chain.recordTransition(this.run, { kind: 'handoff-compact', at: await host.now(), tokensBefore: result.tokensBefore ?? null, tokensAfter: result.tokensAfter ?? null })
        this.persistRun()
      }
      this.stepAutopilot({ kind: 'compactDone', now: await host.now() })
    } catch (error) {
      this.stepAutopilot({ kind: 'compactFailed', error: error instanceof Error ? clean(error.message, 160) : String(error) })
    }
  }

  // -------------------------------------------------------------------------
  // Prompts and turns

  /** Context added to a submitted prompt (reminders, policy fallback). */
  onPromptSubmit(text: string, origin: PromptOrigin | undefined): string[] {
    const context: string[] = []
    if (isOwnPrompt(origin)) return context
    if (isPersonOrigin(origin)) {
      this.turn.request = text
      this.noteObjective(text)
      if (this.autopilot.state === 'pending') context.push(prompts.pendingPromptReminder())
      this.planRoute(text)
    }
    const isComposeMissing = !this.compose.isReached && (this.composeObserved || this.compose.isLikelyBypassed)
    if (isComposeMissing && !this.compose.deliveredFallback) {
      const policy = policyText(this.policies())
      if (policy !== null) {
        context.push(policy)
        this.compose.deliveredFallback = true
      }
    }
    return context
  }

  /** True once a request went out, so an unreached compose hook means it is bypassed. */
  composeObserved = false

  /**
   * The run's objective: the person's latest substantial request (a short
   * "yes" or "continue" keeps the one before), cut to its first sentence.
   */
  private noteObjective(text: string): void {
    if (this.run === null) return
    const objective = Plan.objectiveOf(text)
    if (objective === null) return
    const isSubstantial = text.trim().length >= 40 || this.run.objective === undefined || this.run.objective === null
    if (!isSubstantial || this.run.objective === objective) return
    this.run = { ...this.run, objective }
    this.persistRun()
    this.publisher.mark('activity', 'hud')
  }

  /** Claude's milestones for this run. */
  get plan(): Plan.Plan {
    return this.run?.plan ?? Plan.emptyPlan()
  }

  get progress(): Plan.Progress {
    return Plan.progressOf(this.plan)
  }

  private planRoute(text: string): void {
    const eff = this.effective
    if (!eff.router.isMainLoop) {
      this.router.turnModel = null
      return
    }
    const { cls } = classifyTask(text)
    const decision = routeMain({
      router: this.settings.router,
      cls,
      sessionModel: this.sessionModel,
      contextTokens: this.usage.tokens ?? 0,
      isFrontier: eff.frontier.isActive,
      unavailable: this.router.unavailable,
      known: this.router.known,
      cache: { isWarm: CacheModel.warmthOf(this.cache.state, this.clock()) === 'warm', cachedTokens: this.cache.state.lastPrefix },
    })
    this.router.turnModel = decision.model
    this.router.lastDecision = decision.why
    this.publisher.mark('pane', 'hud')
  }

  onTurnStart(input: { turnId: string; text: string }): void {
    const kind: TurnKind = this.expecting ?? (input.text === '' ? 'other' : 'person')
    this.expecting = null
    this.turn = {
      id: input.turnId,
      isRunning: true,
      kind,
      request: kind === 'person' ? input.text || this.turn.request : input.text,
      toolCount: 0,
      editCount: 0,
      pressureNoticeSent: false,
    }
    if (kind !== 'person') this.router.turnModel = null
    this.cache.turnStarted()
    const host = this.host
    if (host !== null) void host.listTools().then(tools => this.cache.noteTools(tools.map(t => t.name))).catch(() => undefined)
    this.guard.turnBlocks = 0
    this.guard.lastBlockedAnswer = ''
    this.activity.turnStarted(Date.now())
    this.turnStartDone = this.progress.done
    if (kind === 'handoff') this.handoffTurn = { fromTurn: this.activity.turn.index, isPlanUpdated: false }
    this.questGreen.clear()
    this.publisher.mark('hud', 'pane', 'activity', 'spinner')
  }

  /** turn.step, before the request: the model and effort to send. */
  stepRequest(e: TurnStepInput): { model?: string; effort?: TurnStepInput['effort'] } {
    this.composeObserved = true
    const out: { model?: string; effort?: TurnStepInput['effort'] } = {}
    const eff = this.effective
    const isMain = e.agentId === undefined
    if (isMain && this.router.turnModel !== null && eff.router.isMainLoop && this.router.turnModel !== e.model) {
      out.model = this.router.turnModel
    }
    if (isMain && e.index === 0) {
      // A turn the router sends to another model than the last one (or back from one) rebuilds the cache: the router's doing.
      const sending = out.model ?? e.model
      const last = this.cache.state.model
      if (last !== null && sending !== last && (out.model !== undefined || this.router.wasRouted)) {
        this.cache.noteRouted(last, sending, out.model !== undefined ? (this.router.lastDecision ?? 'routed') : 'back to the session model')
      }
      this.router.wasRouted = out.model !== undefined
    }
    const wantsEffort = eff.frontier.effort !== null && (isMain || this.settings.frontier.subagentEffort)
    if (wantsEffort) {
      if (e.effort === undefined) {
        if (isMain) this.frontier.isEffortSupported = false
      } else if (typeof e.effort === 'string') {
        out.effort = eff.frontier.effort ?? e.effort
        if (isMain) {
          this.frontier.isEffortSupported = true
          this.frontier.lastEffort = out.effort ?? null
        }
      }
    } else if (isMain && typeof e.effort === 'string') {
      this.frontier.lastEffort = e.effort
    }
    if (isMain) {
      const effort = out.effort ?? e.effort
      this.cache.stepStarted(`${e.turnId}:${e.index}`, typeof effort === 'string' ? effort : typeof effort === 'number' ? String(effort) : null)
    }
    return out
  }

  /** turn.step, after the response: live context, model learning, mid-turn autopilot. */
  stepResponse(e: TurnStepInput, sent: { model?: string }, result: TurnStepResult): void {
    if (result.usage !== null) {
      const family = familyOf(result.usage.model)
      if (family !== null && this.router.known.get(family) !== result.usage.model) {
        this.router.known.set(family, result.usage.model)
        this.publisher.mark('pane')
      }
    }
    if (e.agentId !== undefined) return
    if (sent.model !== undefined && result.usage === null && result.stopReason === null) {
      const family = familyOf(sent.model)
      this.router.unavailable.add(family ?? sent.model)
      if (family !== null) this.router.known.delete(family)
      this.router.turnModel = null
      this.router.lastDecision = `${sent.model} was refused — the session model is kept`
      this.publisher.mark('pane', 'hud')
    }
    if (result.usage === null) return
    const u = result.usage
    this.cache.stepAnswered(`${e.turnId}:${e.index}`, u)
    const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
    this.usage = { ...this.usage, tokens, pct: this.usage.window ? Math.round((100 * tokens) / this.usage.window) : this.usage.pct }
    if (this.run !== null) this.run = Chain.measure(this.run, { tokens, window: this.usage.window, costUsd: undefined }, Date.now())
    this.publisher.mark('hud')
    if (result.stopReason === 'tool_use' && this.settings.autopilot.enabled) {
      this.stepAutopilot({ kind: 'context', tokens, window: this.usage.window, isInTurn: true, now: Date.now() })
    }
  }

  async onTurnComplete(input: { agentId: string | undefined; reason: 'answer' | 'aborted' | 'refusal' | 'error'; answer: string }): Promise<void> {
    if (input.agentId !== undefined) {
      void this.refreshAgents()
      return
    }
    this.turn = { ...this.turn, isRunning: false }
    this.activity.turnEnded()
    if (this.run !== null) this.run = Chain.countTurn(this.run, Date.now())
    await this.refreshUsage()
    const host = this.host
    const now = host === null ? Date.now() : await host.now()
    this.stepAutopilot({ kind: 'turnComplete', reason: input.reason, now })
    if (this.autopilot.state === 'armed' && input.reason !== 'aborted' && this.usage.tokens !== undefined) {
      this.stepAutopilot({ kind: 'context', tokens: this.usage.tokens, window: this.usage.window, isInTurn: false, now })
    }
    this.cache.turnEnded(this.clock())
    this.checkContinuity()
    this.persistRun()
    this.publisher.mark('hud', 'pane', 'activity', 'spinner', 'chain')
  }

  onMeasure(input: Pick<SessionUsage, 'context' | 'cost'>): void {
    this.applyUsage(input)
  }

  onCompacted(trigger: string, result: SessionCompactResult): void {
    if (result.skip !== undefined) return
    if (trigger === 'auto') this.stepAutopilot({ kind: 'engineCompacted' })
    if (this.run !== null && trigger !== 'precompute' && trigger !== 'plugin') {
      this.run = Chain.recordTransition(this.run, {
        kind: trigger === 'auto' ? 'auto-compact' : 'compact',
        at: Date.now(),
        tokensBefore: result.tokensBefore ?? null,
        tokensAfter: result.tokensAfter ?? null,
      })
      this.persistRun()
    }
    this.compose.deliveredFallback = false
    this.usage = { ...this.usage, tokens: result.tokensAfter ?? undefined }
    this.cache.noteCompact(this.clock())
    this.publisher.mark('hud', 'chain')
  }

  // -------------------------------------------------------------------------
  // System prompt

  composeSection(outputStyle?: { name: string } | null): { id: string; text: string; scope: 'session' } | null {
    this.compose.isReached = true
    const native = outputStyle === undefined || outputStyle === null ? null : clean(outputStyle.name, 60) || null
    if (native !== this.nativeOutputStyle) {
      this.nativeOutputStyle = native
      this.publisher.mark('pane')
    }
    // While the cache is warm, the section the system prompt already carries is sent again (stable policies).
    const text = this.cache.policyText(policyText(this.policies()), native, this.policyReason)
    return text === null ? null : { id: POLICY_SECTION_ID, text, scope: 'session' }
  }

  // -------------------------------------------------------------------------
  // No-Lazy-Exit Guard

  async onStop(input: { stopHookActive: boolean; lastMessage: string; backgroundCount: number; permissionMode: string | undefined }): Promise<string | null> {
    if (input.permissionMode !== undefined) this.permissionMode = input.permissionMode
    const eff = this.effective
    if (!eff.guard.isActive) return null
    if (this.turn.kind !== 'person' && this.turn.kind !== 'continuation') return null
    const threshold = this.autopilot.threshold
    if (this.settings.autopilot.enabled && threshold !== null && (this.usage.tokens ?? 0) >= threshold) return null
    const g = this.settings.guard
    if (this.guard.turnBlocks >= g.maxPerTurn || this.guard.sessionBlocks >= g.maxPerSession) return null
    if (input.stopHookActive && this.guard.lastBlockedAnswer !== '' && isRepeat(this.guard.lastBlockedAnswer, input.lastMessage)) return null

    const now = Date.now()
    let assessment = assessExit({
      request: this.turn.request.slice(-LIMITS.guardTextChars),
      answer: input.lastMessage.slice(-LIMITS.guardTextChars),
      toolCount: this.activity.turn.tools,
      editCount: this.activity.turn.files.size,
      strictness: g.strictness,
      hasBackgroundWork: input.backgroundCount > 0,
      permissionMode: this.permissionMode,
    })
    if (assessment.verdict === 'uncertain' && g.modelCheck) assessment = await this.classifyExit(assessment, input.lastMessage)
    this.guard.last = { ...assessment, at: now }
    this.publisher.mark('pane', 'hud')
    if (assessment.verdict !== 'block') return null

    this.guard.turnBlocks += 1
    this.guard.sessionBlocks += 1
    this.guard.lastBlockedAnswer = input.lastMessage
    if (this.settings.ui.toasts) this.host?.toast(`Kept Claude going: ${assessment.reasons[0] ?? 'unfinished work'}`, 4000)
    return prompts.guardBlock({ reasons: assessment.reasons.slice(0, 3), items: assessment.items, attempt: this.guard.turnBlocks, max: g.maxPerTurn })
  }

  private async classifyExit(assessment: GuardAssessment, answer: string): Promise<GuardAssessment> {
    const host = this.host
    if (host === null || Guard.isConversational(this.turn.request, this.activity.turn.tools)) return { ...assessment, verdict: 'allow' }
    try {
      const label = await host.classify(
        prompts.guardClassifierText(this.turn.request.slice(-3000), answer.slice(-4000)),
        prompts.GUARD_CLASSIFIER_LABELS,
      )
      if (label === 'premature') return { ...assessment, verdict: 'block', reasons: [...assessment.reasons, 'model check: premature'] }
      return { ...assessment, verdict: 'allow', reasons: [...assessment.reasons, `model check: ${label ?? 'unclear'}`] }
    } catch {
      return { ...assessment, verdict: 'allow', reasons: [...assessment.reasons, 'model check unavailable'] }
    }
  }

  // -------------------------------------------------------------------------
  // Tools: permissions, resources, activity

  /** Whether an edit path lands inside the project root (null when it cannot be placed). */
  private rootReal: string | null = null

  private async isInsideProject(path: string): Promise<boolean | null> {
    const host = this.host
    if (host === null || this.root === '') return null
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (this.rootReal === null) {
      const rootStat = await host.stat(this.root, true).catch(() => null)
      this.rootReal = normalize(rootStat?.realPath ?? this.root)
    }
    const rootReal = this.rootReal
    const abs = /^([A-Za-z]:[\\/]|[\\/])/.test(path) ? path : `${this.cwd || this.root}/${path}`
    const own = await host.stat(abs, true).catch(() => null)
    let real = own?.realPath
    if (real === undefined) {
      const cut = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'))
      const dir = await host.stat(cut <= 0 ? abs : abs.slice(0, cut), true).catch(() => null)
      if (dir?.realPath === undefined) return null
      real = `${dir.realPath}/${abs.slice(cut + 1)}`
    }
    const r = normalize(real)
    return r === rootReal || r.startsWith(`${rootReal}/`)
  }

  private logPermission(entry: Omit<PermissionLogEntry, 'at'>): void {
    this.permissionLog = [{ ...entry, at: Date.now() }, ...this.permissionLog].slice(0, 40)
    this.publisher.mark('permissions')
  }

  /** tool.call, before: policy deny and resource gate. Returns a refusal, or null to run. */
  async beforeTool(tool: string, input: Record<string, unknown>, id: string, agentId: string | undefined): Promise<string | null> {
    await this.ensureLoaded()
    const isEdit = isEditTool(tool)
    const path = isEdit ? editPathOf(input) : null
    const inside = path === null ? null : await this.isInsideProject(path)
    const findings = findingsFor(tool, input, inside)
    const decision = decisionFor(findings, this.settings.permissions)
    if (decision.state === 'deny' && decision.category !== null) {
      this.permissionCounts.denied += 1
      this.logPermission({ tool, category: decision.category, state: 'deny', evidence: clean(decision.evidence, 120), outcome: 'denied' })
      this.activity.refused({ id, tool, input, agentId, now: Date.now(), status: 'denied', reason: `Permission Policy: ${PERMISSION_LABEL[decision.category]} is set to Deny` })
      this.publisher.mark('activity', 'hud')
      return denyMessage(decision)
    }
    if (isShellTool(tool)) {
      const command = typeof input.command === 'string' ? input.command : ''
      const refusal = this.gateHeavy(command)
      if (refusal !== null) {
        this.resourceStats.refused += 1
        this.logPermission({ tool, category: 'resources', state: 'deny', evidence: clean(command, 120), outcome: 'refused-heavy' })
        this.activity.refused({ id, tool, input, agentId, now: Date.now(), status: 'held', reason: 'Held back: the machine is busy and other heavy jobs are running' })
        this.publisher.mark('resources', 'activity', 'hud')
        return refusal
      }
    }
    this.turn.toolCount += 1
    if (isEdit) this.turn.editCount += 1
    this.activity.started({ id, tool, input, agentId, now: Date.now() })
    this.publisher.mark('activity', 'spinner', 'hud')
    this.tickWhileRunning()
    return null
  }

  private ticker: { cancel: () => void } | null = null

  /** While a call runs, Activity's elapsed times and long-running notes refresh every few seconds. */
  private tickWhileRunning(): void {
    const host = this.host
    if (host === null || this.ticker !== null) return
    this.ticker = host.every(LIMITS.runningTickMs, () => {
      if (this.activity.runningItems().length === 0) {
        this.ticker?.cancel()
        this.ticker = null
      }
      this.publisher.mark('activity', 'hud')
    })
  }

  private gateHeavy(command: string): string | null {
    const ceilings = this.effective.resources.ceilings
    if (ceilings === null || heavyKinds(command).length === 0) return null
    const running = this.activity.runningHeavy()
    const gate = gateHeavy({ pressure: this.monitor.pressure, ceilings, running: running.length })
    if (gate.isAllowed) return null
    return prompts.heavyCommandRefusal({
      reason: gate.reason,
      cpu: this.monitor.pressure.cpu,
      ram: this.monitor.pressure.ram,
      running: running.map(r => `${r.label}${r.heavy[0] ? ` (${heavyLabel(r.heavy[0])})` : ''}`).slice(0, 3),
    })
  }

  /** tool.call, after. */
  afterTool(tool: string, input: Record<string, unknown>, id: string, result: ToolCallResult | undefined, agentId?: string): void {
    const status = result === undefined ? 'error' : result.deny !== undefined ? 'denied' : result.isError === true ? 'error' : 'ok'
    const now = Date.now()
    this.activity.finished({ id, status, result: result?.result, text: result?.deny ?? result?.text, now })
    // Claude's own task list is the run's plan; a subagent's list is its own business.
    if (status === 'ok' && agentId === undefined && Plan.isPlanTool(tool) && this.run !== null) {
      const session = Chain.currentSession(this.run)?.index ?? 1
      this.setPlan(Plan.applyTool(this.plan, { tool, input, result: result?.result, session, now }))
    }
    if (agentId === undefined) this.questForCheck(id)
    if (tool === 'Read' && status === 'ok' && agentId === undefined && typeof input.file_path === 'string') this.reads = [...this.reads, input.file_path].slice(-200)
    if (tool === 'TaskStop' && status === 'ok') {
      const taskId = typeof input.task_id === 'string' ? input.task_id : typeof input.shell_id === 'string' ? input.shell_id : null
      if (taskId !== null) this.activity.backgroundEnded(taskId)
    }
    if (tool === 'Agent') void this.refreshAgents()
    this.publisher.mark('activity', 'spinner', 'hud', 'resources', 'pane')
  }

  /**
   * Quest log: a check that just passed. Passing after its last run failed is
   * a comeback; otherwise its first pass in the turn pays. Re-running a
   * passing check earns nothing, and a background run has no outcome to count.
   */
  private questForCheck(id: string): void {
    if (this.settings.answers.style !== 'quest') return
    const item = this.activity.items.find(i => i.id === id)
    if (item === undefined || item.validation === null || item.status !== 'ok' || item.backgroundTaskId !== null || item.isInterrupted) return
    const kind = item.validation
    const own = this.activity.validationRuns().filter(r => r.kind === kind)
    const previous = own.at(-2)
    const label = VALIDATION_LABEL[kind]
    if (previous?.status === 'failed') {
      this.questGreen.add(kind)
      this.questEvent('comeback', `Comeback: ${label} pass again`)
    } else if (!this.questGreen.has(kind)) {
      this.questGreen.add(kind)
      this.questEvent('green', `${label} pass`)
    }
  }

  /** tool.check: the engine's verdict adjusted by the policy (never looser than allowed). */
  async checkTool(
    tool: string,
    input: unknown,
    verdict: { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string; hook?: string },
  ): Promise<{ decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string; hook?: string }> {
    await this.ensureLoaded()
    const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
    const path = isEditTool(tool) ? editPathOf(record) : null
    const inside = path === null ? null : await this.isInsideProject(path)
    const decision = decisionFor(findingsFor(tool, record, inside), this.settings.permissions)
    const adjusted = adjustVerdict({ engine: verdict, decision, permissionMode: this.permissionMode })
    if (decision.category !== null && adjusted.decision !== verdict.decision) {
      if (adjusted.decision === 'ask') this.permissionCounts.asked += 1
      if (adjusted.decision === 'allow') this.permissionCounts.allowed += 1
      this.logPermission({
        tool,
        category: decision.category,
        state: decision.state,
        evidence: clean(decision.evidence, 120),
        outcome: adjusted.decision === 'ask' ? 'asked' : adjusted.decision === 'allow' ? 'allowed' : 'denied',
      })
    }
    return adjusted
  }

  // -------------------------------------------------------------------------
  // Subagents

  isAgentOffered(_e: AgentOfferInput): boolean {
    return isOffered(this.settings.subagents.mode)
  }

  async onAgentSpawn(e: AgentSpawnInput): Promise<{ deny?: string; model?: string }> {
    await this.ensureLoaded()
    const s = this.settings.subagents
    await this.refreshAgents()
    const decision = decideSpawn({
      mode: s.mode,
      limit: s.limit,
      active: activeAgents(this.agents.list, s.countTeammates).length,
      isTeammate: e.isTeammate === true,
      countTeammates: s.countTeammates,
      type: clean(e.subagentType, 40),
      description: clean(e.description, 80),
      isAllowedForSession: this.agents.allowAll,
    })
    if (decision.action === 'deny') {
      this.agents.denied += 1
      this.publisher.mark('pane', 'hud')
      return { deny: decision.reason }
    }
    if (decision.action === 'ask') {
      this.agents.asked += 1
      const host = this.host
      const answer = host === null ? 'Deny' : await host.ask(decision.question, ['Allow', 'Deny', 'Allow all this session'], 'Subagent').catch(() => 'Deny')
      if (answer === 'Allow all this session') this.agents.allowAll = true
      if (answer !== 'Allow' && answer !== 'Allow all this session') {
        this.agents.denied += 1
        this.publisher.mark('pane', 'hud')
        return { deny: 'Control Room: the user did not approve this subagent. Do the work directly or ask the user.' }
      }
    }
    this.agents.spawned += 1
    const eff = this.effective
    const isWorkflowAgent = (e as { workflow?: unknown }).workflow !== undefined
    if (eff.router.isSubagents && !isWorkflowAgent) {
      const route = routeSubagent({
        router: this.settings.router,
        subagentType: e.subagentType,
        requested: e.model,
        isFork: e.fork,
        isTeammate: e.isTeammate === true,
        isFrontier: eff.frontier.isActive,
        sessionModel: this.sessionModel,
        unavailable: this.router.unavailable,
        known: this.router.known,
      })
      this.router.lastDecision = `subagent: ${route.why}`
      if (route.model !== null) return { model: route.model }
    }
    this.publisher.mark('pane', 'hud')
    return {}
  }

  async refreshAgents(): Promise<void> {
    const host = this.host
    if (host === null) return
    this.agents.list = await host.listAgents().catch(() => this.agents.list)
    const running = activeAgents(this.agents.list, true).length
    if (running > 0 && this.agents.poll === null) {
      this.agents.poll = host.every(5000, () => void this.refreshAgents())
    } else if (running === 0 && this.agents.poll !== null) {
      this.agents.poll.cancel()
      this.agents.poll = null
    }
    this.publisher.mark('pane', 'hud', 'spinner')
  }

  // -------------------------------------------------------------------------
  // Resource pressure

  private onPressure(pressure: Pressure, previous: Pressure): void {
    this.publisher.mark('resources', 'hud')
    if (pressure.level === previous.level) return
    const host = this.host
    const ceilings = this.effective.resources.ceilings
    if (host === null || ceilings === null) return
    const now = Date.now()
    const isEnteringOver = isOver(pressure) && !isOver(previous)
    const isCritical = pressure.level === 'critical' && previous.level !== 'critical'
    const isRecovered = !isOver(pressure) && isOver(previous) && pressure.level !== 'unknown'
    if ((isEnteringOver || isCritical) && now - this.resourceStats.lastNoticeAt > LIMITS.pressureNoticeGapMs / (isCritical ? 3 : 1)) {
      const background = [...this.activity.background.values()].map(b => `${b.id} (${b.label})`).slice(0, 4)
      void host.appendForModel(
        prompts.pressureNotice({ level: pressure.level, cpu: pressure.cpu, ram: pressure.ram, cpuCeiling: ceilings.cpu, ramCeiling: ceilings.ram, backgroundTasks: background }),
      )
      this.resourceStats.noticesSent += 1
      this.resourceStats.lastNoticeAt = now
      this.resourceStats.lastNoticeLevel = pressure.level
      this.turn.pressureNoticeSent = true
      if (this.settings.ui.toasts) host.toast(`Machine load ${pressure.level}. Claude was asked to ease off`, 5000)
    } else if (isRecovered && this.turn.pressureNoticeSent && this.turn.isRunning) {
      void host.appendForModel(prompts.pressureRecoveredNotice({ cpu: pressure.cpu, ram: pressure.ram }))
      this.turn.pressureNoticeSent = false
    }
  }

  // -------------------------------------------------------------------------
  // Settings changes (from the Control Centre, commands and profiles)

  /** Applies new settings: validates, persists, reconfigures, tells Claude what changed. */
  update(change: (draft: Settings) => Settings | void, options: { isProfile?: boolean } = {}): void {
    const before = this.settings
    const draft = clone(before)
    const returned = change(draft)
    const next = normalizeSettings(returned ?? draft)
    this.settings = next
    this.saveSettings.schedule(next)
    this.savedAt = Date.now()
    this.reconfigure({ before })
    this.publisher.markAll()
  }

  applyProfileById(id: string): boolean {
    const profile = findProfile(this.settings, id)
    if (profile === undefined) return false
    this.update(s => applyProfile(s, profile), { isProfile: true })
    if (this.settings.ui.toasts) this.host?.toast(`Profile ${profile.name} applied`, 3000)
    return true
  }

  /** Brings live systems in line with the settings, and informs Claude of material changes. */
  reconfigure(input: { before?: Settings; isStartup?: boolean }): void {
    const host = this.host
    const before = input.before
    this.configureAutopilot()
    if (!this.turn.isRunning) this.cache.schedule()
    if (host !== null) {
      const ceilings = this.effective.resources.ceilings
      const isLiveWanted = this.settings.ui.liveLoad && this.settings.ui.hud !== 'off'
      void this.monitor.configure(host, this.cwd || this.root, ceilings, this.settings.resources.intervalSec, isLiveWanted)
    }
    if (before === undefined || host === null) return
    const changes: string[] = []
    if (before.frontier.enabled !== this.settings.frontier.enabled) changes.push(`Frontier Max is now ${this.settings.frontier.enabled ? 'ON' : 'OFF'}`)
    if (before.qa.enabled !== this.settings.qa.enabled) changes.push(`Release/QA mode is now ${this.settings.qa.enabled ? 'ON' : 'OFF'}`)
    if (before.subagents.mode !== this.settings.subagents.mode || before.subagents.limit !== this.settings.subagents.limit) {
      changes.push(`subagent policy is now ${this.subagentLabel()}`)
      if ((before.subagents.mode === 'block') !== (this.settings.subagents.mode === 'block')) host.invalidateDescribes()
    }
    const resourceChanged =
      before.resources.level !== this.settings.resources.level ||
      before.resources.cpu !== this.settings.resources.cpu ||
      before.resources.ram !== this.settings.resources.ram ||
      before.resources.enforcement !== this.settings.resources.enforcement
    if (resourceChanged) {
      const section = this.policies().find(s => s.name.startsWith('Resource Governor'))
      void host.appendForModel(prompts.resourceLevelChangedNotice(section?.text ?? null))
    }
    if (before.progress.milestones !== this.settings.progress.milestones) {
      void this.offerMilestones()
      if (this.milestonesTool !== null) changes.push(`milestone tracking is now ${this.settings.progress.milestones ? 'on' : 'off'}`)
    }
    if (before.answers.style !== this.settings.answers.style && this.nativeOutputStyle === null) {
      changes.push(`the answer style is now ${answerStyleLabel(this.settings.answers.style)}${this.settings.answers.style === 'standard' ? ' (write as you normally would)' : ''}`)
    }
    if (changes.length > 0) this.policyReason = changes.join('; ')
    const policy = policyText(this.policies())
    if (this.cache.isHoldingPolicies() && this.cache.isPolicyHeld(policy)) {
      // The system prompt keeps its cached section: the policies now in force come as a note.
      void host.appendForModel(prompts.heldPoliciesNotice(changes, policy))
      this.cache.isHeldNoteSent = true
    } else if (this.cache.isHeldNoteSent && !this.cache.isPolicyHeld(policy)) {
      // Back to what the system prompt says: the earlier note no longer applies.
      void host.appendForModel(prompts.policiesRestoredNotice(changes))
      this.cache.isHeldNoteSent = false
    } else if (changes.length > 0) {
      void host.appendForModel(`Control Room · The user changed session settings: ${changes.join('; ')}. The updated policy is in your system prompt from your next request.`)
    }
    // Keep warm turned on again tries afresh, whatever it concluded about itself before.
    if (!before.cache.keepWarm && this.settings.cache.keepWarm) this.cache.resetVerdict()
    // A change of effort where it is known to rebuild the cache: say so while there is a large warm cache to lose.
    const effortOf = (s: Settings) => (s.frontier.enabled && s.frontier.effort !== 'keep' ? s.frontier.effort : null)
    if (effortOf(before) !== effortOf(this.settings) && this.settings.ui.toasts && this.cache.isEffortRebuilding(null)) {
      const cached = this.cache.state.lastPrefix
      if (CacheModel.warmthOf(this.cache.state, this.clock()) === 'warm' && cached >= this.settings.cache.minTokens) {
        host.toast(`Effort changes rebuild the prompt cache on ${CacheModel.shortModel(this.cache.state.model ?? '')}: the next request re-sends ${fmt.tokens(cached)} tokens`, 6000)
      }
    }
  }

  subagentLabel(): string {
    const s = this.settings.subagents
    switch (s.mode) {
      case 'unrestricted':
        return 'unrestricted'
      case 'block':
        return 'blocked'
      case 'ask':
        return 'ask each time'
      case 'limit':
        return `max ${s.limit}`
    }
  }

  get profileLabel(): string {
    return profileLabel(this.settings)
  }

  // -------------------------------------------------------------------------
  // Control Centre actions

  async openPane(isPersonAsking: boolean): Promise<boolean> {
    const host = this.host
    if (host === null) return false
    const opened = await host
      .open({ id: PANE_ID, title: PANE_TITLE, columns: 66, rows: 28, ...(isPersonAsking ? { focus: true as const } : {}) })
      .catch(() => null)
    this.ui.isPaneOpen = opened !== null
    this.publisher.markAll()
    return opened?.isPlaced === true
  }

  async closePane(): Promise<void> {
    await this.host?.close({ id: PANE_ID }).catch(() => undefined)
    this.ui.isPaneOpen = false
    this.publisher.mark('hud')
  }

  async togglePane(): Promise<'opened' | 'closed' | 'waiting'> {
    const host = this.host
    if (host === null) return 'closed'
    const isOpen = (await host.panes().catch(() => [])).some(p => p.id === PANE_ID)
    if (isOpen) {
      await this.closePane()
      return 'closed'
    }
    return (await this.openPane(true)) ? 'opened' : 'waiting'
  }

  setTab(tab: TabId): void {
    const isChange = this.ui.tab !== tab
    this.ui.tab = tab
    this.ui.openPicker = null
    this.publisher.mark('pane')
    // A new section starts at its top, wherever the last one was scrolled to.
    if (isChange) void this.host?.scrollPaneToTop().catch(() => undefined)
  }

  /** Opens one in-place picker (terminal, mobile), or closes it when it is the open one. */
  togglePicker(key: string | null): void {
    this.ui.openPicker = key === null || this.ui.openPicker === key ? null : key
    this.publisher.mark('pane')
  }

  toggleRow(id: string): void {
    if (this.ui.expanded.has(id)) this.ui.expanded.delete(id)
    else this.ui.expanded.add(id)
    this.publisher.mark('focus')
  }

  requestHandoff(): void {
    if (!this.settings.autopilot.enabled) {
      this.update(s => {
        s.autopilot.enabled = true
      })
    }
    void this.host?.now().then(now => this.stepAutopilot({ kind: 'manualHandoff', now }))
  }

  startFreshContext(): void {
    void this.host?.now().then(now => this.stepAutopilot({ kind: 'manualFresh', now }))
  }

  snoozeAutopilot(): void {
    this.stepAutopilot({ kind: 'snooze', tokens: this.usage.tokens ?? 0, window: this.usage.window })
  }

  async stopBackgroundTask(taskId: string): Promise<void> {
    const host = this.host
    if (host === null) return
    const result = await host.stopTask(taskId).catch(() => null)
    if (result !== null && result.deny === undefined) this.activity.backgroundEnded(taskId)
    this.publisher.mark('resources', 'activity')
  }

  selectChangedFile(path: string | null): void {
    this.ui.selectedPath = path
    this.publisher.mark('activity')
  }

  get runningSubagents(): number {
    return activeAgents(this.agents.list, true).length
  }

  /** The /control-room command. */
  async runCommand(args: string): Promise<CommandRunResult> {
    return handleCommand(this, args)
  }
}
