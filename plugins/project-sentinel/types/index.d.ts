// Control Room's type contract: the settings schema and every view model the
// plugin keeps in `$.state` for its render sites. Self-contained by design
// (no imports); the hooks module imports these types from '../types'.

// ---------------------------------------------------------------------------
// Settings

/** Default leaves the call to Claude Code; Ask always asks the person first; Deny never runs it. */
export type PermissionState = 'default' | 'ask' | 'deny'

export type PermissionCategory =
  | 'install'
  | 'network'
  | 'download'
  | 'edit'
  | 'editOutside'
  | 'delete'
  | 'commit'
  | 'push'
  | 'gitDestructive'
  | 'deploy'
  | 'dangerous'

export type ModelAlias = 'session' | 'haiku' | 'sonnet' | 'opus' | 'fable'
export type RouterStrategy = 'off' | 'balanced' | 'performance' | 'economy' | 'custom'
export type ResourceLevel = 'off' | 'low' | 'medium' | 'high' | 'custom'
export type ResourceEnforcement = 'inform' | 'limit' | 'strict'
export type SubagentMode = 'unrestricted' | 'block' | 'ask' | 'limit'
export type GuardStrictness = 'lenient' | 'standard' | 'strict'
export type ContinuationMethod = 'clear' | 'compact' | 'manual'
export type FrontierEffort = 'max' | 'xhigh' | 'high' | 'keep'
export type HudPlacement = 'band' | 'status' | 'both' | 'off'
/**
 * How Claude writes to the person: Claude Code's own way, bottom line first,
 * Simplified Technical English (after ASD-STE100's writing rules), mission-control
 * status calls, or a quest log with XP for verified progress.
 */
export type AnswerStyle = 'standard' | 'brief' | 'ste' | 'mission' | 'quest'

export type ControlRoomSettings = {
  version: 1
  profile: string
  autopilot: {
    enabled: boolean
    thresholdMode: 'tokens' | 'percent'
    thresholdTokens: number
    thresholdPercent: number
    continuation: ContinuationMethod
    fallbackToCompact: boolean
    handoffFile: string
    autoContinue: boolean
  }
  frontier: { enabled: boolean; effort: FrontierEffort; subagentEffort: boolean }
  qa: { enabled: boolean }
  guard: { enabled: boolean; strictness: GuardStrictness; maxPerTurn: number; maxPerSession: number; modelCheck: boolean }
  router: {
    strategy: RouterStrategy
    mainLoop: boolean
    subagents: boolean
    custom: {
      trivial: ModelAlias
      simple: ModelAlias
      standard: ModelAlias
      hard: ModelAlias
      explore: ModelAlias
      plan: ModelAlias
      general: ModelAlias
    }
  }
  subagents: { mode: SubagentMode; limit: number; countTeammates: boolean }
  focus: { enabled: boolean; tools: 'compact' | 'hidden'; results: boolean; diffs: boolean; spinner: boolean }
  resources: { level: ResourceLevel; cpu: number; ram: number; intervalSec: number; enforcement: ResourceEnforcement }
  permissions: Record<PermissionCategory, PermissionState>
  /**
   * `milestones`: where Claude Code offers no task list of its own, give Claude Control Room's
   * milestones tool and ask it to keep the run's milestones, so run progress has something to count.
   */
  progress: { milestones: boolean }
  /** How Claude writes its messages to the person (never code, files or commit messages). */
  answers: { style: AnswerStyle }
  /**
   * The prompt cache. `keepWarm`: refresh it before it lapses while the person is away (a fork of
   * the last request), for at most `maxIdleMinutes` of idle time and only from `minTokens` of
   * context. `guardModelSwitch`: ask before a model switch forfeits a large warm cache.
   * `stablePolicies`: while the cache is warm, keep Control Room's system-prompt section as it was
   * and tell Claude of setting changes as notes.
   */
  cache: { keepWarm: boolean; maxIdleMinutes: number; minTokens: number; guardModelSwitch: boolean; stablePolicies: boolean }
  /**
   * `liveLoad`: machine-wide CPU and memory in the status bar (runs the sampler). `companion`: the
   * pixel companion on the status bar. `reducedMotion`: still drawings instead of animation.
   */
  ui: { hud: HudPlacement; toasts: boolean; openOnStart: boolean; liveLoad: boolean; companion: boolean; reducedMotion: boolean }
  customProfiles: ControlRoomCustomProfile[]
}

export type ControlRoomSystems = Pick<
  ControlRoomSettings,
  'autopilot' | 'frontier' | 'qa' | 'guard' | 'router' | 'subagents' | 'focus' | 'resources' | 'permissions' | 'progress' | 'answers' | 'cache'
>

export type ControlRoomCustomProfile = { id: string; name: string; createdAt: number; systems: ControlRoomSystems }

// ---------------------------------------------------------------------------
// View models

export type Tone = 'normal' | 'muted' | 'good' | 'warn' | 'bad' | 'accent' | 'info'

/**
 * What the run is doing now, as the status bar's headline says it: working on a milestone,
 * thinking, running a check, waiting for the person or for a result that will come by itself (a
 * background job, a scheduled wake-up), blocked, handing off, the last turn's outcome, or the
 * whole plan done.
 */
export type HudState = 'ready' | 'idle' | 'thinking' | 'working' | 'validating' | 'waitingUser' | 'waitingExternal' | 'blocked' | 'handoff' | 'done' | 'complete' | 'failing'

export type HudHeadline = {
  state: HudState
  /** The words: what Claude is doing, or what the run waits for ("Rewriting the cache scheduler"). */
  text: string
  /** Quiet context after them: where in the plan, how long ("step 3 of 8 · 2m 14s"). */
  detail: string | null
  tone: Tone
}

/** One stop on the work track: done, the one under way, being verified, waiting or blocked, to come. */
export type TrackStop = 'done' | 'now' | 'verify' | 'held' | 'open'

/** Something that needs a look, as a chip at the status bar's right ("Tests failing", "RAM 92%"). */
export type HudChip = { key: string; text: string; tone: Tone }

export type HudModel = {
  isVisible: boolean
  /** The status bar's first line: what is happening, in words. */
  headline: HudHeadline
  /** What needs a look, most pressing first; empty when all is calm. */
  chips: HudChip[]
  isPaneOpen: boolean
  ctx: { tokens: number | null; window: number | null; pct: number | null; threshold: number | null; tone: Tone }
  cost: { usd: number | null; runUsd: number | null; isRunPartial: boolean }
  /** The applied profile; `isModified` when settings changed since it was applied. */
  profile: { id: string; name: string; isModified: boolean }
  frontier: { isOn: boolean; effort: string | null }
  /** `text` is the plain-language state ("Hands off at 70%", "Writing the handoff"). */
  autopilot: { isOn: boolean; state: string; text: string; tone: Tone }
  /** Live machine-wide readings while the sampler runs (status bar, governor); null otherwise. */
  load: { cpu: number | null; ram: number | null; cpuTone: Tone; ramTone: Tone; cpuSeries: number[]; ramSeries: number[] } | null
  agents: { running: number; limit: number | null; mode: string }
  guard: { isOn: boolean; continued: number }
  session: { run: number | null; index: number; handoffs: number }
  alert: { kind: 'pending' | 'awaiting' | 'load'; text: string; tone: Tone } | null
  /** Run progress from Claude's own task list (milestones done of total), one stop per milestone; null until it keeps one. */
  work: { done: number; total: number; current: string | null; track: TrackStop[] } | null
  /** What Claude is doing right now, while a turn runs. */
  now: { text: string; source: 'plan' | 'tool' | 'thinking' } | null
  /** Checks whose latest run failed ("Tests"). */
  failing: string[]
  /** This turn's calls that still need a look: unresolved failures and refusals. */
  attention: number
  /**
   * The status bar's top line: what Claude is doing while a turn runs, or what
   * the last turn did once it ends; null before the first turn of a context.
   */
  activity: HudActivity | null
  /** The latest run of each kind of check in this context, strongest first ("Tests" passed). */
  checks: { label: string; status: ValidationStatus }[]
  /** Quest log only: the level and XP earned from verified progress; null otherwise. */
  quest: QuestHud | null
  /** The prompt cache at a glance; null before the first request of a context. */
  cache: HudCache | null
  /** The run's objective, for the top line before the first turn of a context; null when none is known. */
  objective: string | null
  /** Whether Desktop may animate (the current milestone's pulse); off under reduced motion. */
  isAnimated: boolean
  /** The companion's animation for what Claude is doing now; null while it is off. */
  companion: CompanionView | null
  /** The project's Git state in a line ("main · 3 uncommitted"), read in the terminal only; null elsewhere or outside a repository. */
  git: string | null
}

/** What Kit, the optional companion, is doing: one of fifteen moods, from what the run is doing. */
export type KitMood =
  | 'idle'
  | 'think'
  | 'work'
  | 'search'
  | 'test'
  | 'celebrate'
  | 'worried'
  | 'waiting'
  | 'handoff'
  | 'wake'
  | 'sleepy'
  | 'dim'
  | 'sleep'
  | 'tend'
  | 'tired'

/**
 * Kit as the hooks module hands it to its surface module (hooks/kit.client.tsx): the mood,
 * what it is doing in words, the calm switches, whether a turn is running, the local hour
 * (night-time yawns), the context it belongs to (it walks in once per fresh context), and
 * one-shot signals as values the module compares with what it last saw: milestones done, a
 * green finish, failures, a Keep warm refresh. Plain data: everything Kit does between two
 * redraws of the status bar happens in the module, on the surface's own clock.
 */
export type CompanionView = {
  mood: KitMood
  caption: string
  isReduced: boolean
  /** The machine is busy: two frames a second at most, and no walking. */
  isBusy: boolean
  /** The machine is at its limit: one still pose. */
  isStrained: boolean
  isWorking: boolean
  hour: number
  /** When this context began (system clock), its identity for Kit; null before the first. */
  contextStartedAt: number | null
  /** The context began less than a minute ago: a Kit drawn now walks in from the left. */
  isFresh: boolean
  /** Milestones done in the run. */
  done: number
  /** When the last turn finished green; null when it did not. */
  greenAt: number | null
  /** Checks that failed in this context. */
  fails: number
  /** When Keep warm last refreshed the cache; null before it has. */
  refreshAt: number | null
}

export type CacheWarmth = 'none' | 'warm' | 'cold' | 'unknown'

export type HudCache = {
  warmth: CacheWarmth
  ttl: '5m' | '1h' | null
  /** Derived: the last request's time plus the TTL. */
  expiresAt: number | null
  /** Time left when published (republished each minute while it counts down), and as a share of the TTL. */
  leftMs: number | null
  fraction: number | null
  /** What the status bar says beside the clock: "52m", "warm", "cold", "rebuilt 300k". */
  text: string
  /** Quiet while warm; amber near the expiry with no refresh coming, or after a costly rebuild. */
  tone: Tone
  cachedTokens: number
  keepWarm: boolean
  nextRefreshAt: number | null
  /** A costly miss in the last few minutes that was not an expected rebuild. */
  recentMiss: { label: string; recached: number; severity: 'info' | 'warn'; at: number } | null
  /**
   * Whether the status bar shows it: while the person is away and the cache is worth keeping (its
   * time left, or that it lapsed), or just after a costly rebuild; never while Claude works.
   */
  isShown: boolean
  /** A turn is running: its requests keep the cache warm, so its time left is not worth a reading. */
  isInUse: boolean
}

export type CacheMissView = {
  at: number
  cause: string
  label: string
  kind: 'preventable' | 'lifecycle' | 'unavoidable'
  severity: 'info' | 'warn'
  recached: number
  detail: string
  advice: string
  isRefresh: boolean
}

/** The prompt cache in full, for Context: derived figures are named as such where they are drawn. */
export type CacheView = {
  warmth: CacheWarmth
  ttl: '5m' | '1h' | null
  ttlSource: 'engine' | 'observed' | 'probe' | 'stored' | 'plan' | null
  expiresAt: number | null
  lastRequestAt: number | null
  cachedTokens: number
  requests: number
  hitRatio: number | null
  read: number
  written: number
  model: string | null
  keepWarm: {
    isOn: boolean
    nextAt: number | null
    isProbe: boolean
    reason: string | null
    refreshes: number
    lastAt: number | null
    lastRead: number | null
    lastHit: boolean | null
    verified: 'unknown' | 'yes' | 'no'
    maxIdleMinutes: number
    isRefreshing: boolean
    error: string | null
  }
  misses: CacheMissView[]
  policies: { isStable: boolean; isHolding: boolean }
  guardModelSwitch: boolean
}

export type ValidationStatus = 'passed' | 'failed' | 'running' | 'blocked' | 'background' | 'stopped'

export type HudActivity = {
  state: 'working' | 'done'
  /** Working: what Claude is doing. Done: the last turn in counted words ("Changed 4 files · tests passing"). */
  text: string
  source: 'plan' | 'tool' | 'thinking' | 'summary'
  /** The milestone under way and where it sits in the plan ("2 of 5"). */
  milestone: { subject: string; index: number; total: number } | null
  /** Working: how long the longest running call has run, once it passes 20 s; null otherwise. */
  runningMs: number | null
  /** Done: how long the turn took. */
  durationMs: number | null
}

export type QuestHud = { level: number; xp: number; intoLevel: number; levelSpan: number; runXp: number }

export type TabId = 'overview' | 'context' | 'behavior' | 'guardrails' | 'activity' | 'setup'

/** Activity's two views: the summary (run, turn, attention, checks, changes) and every tool call. */
export type ActivitySub = 'summary' | 'raw'

export type AutopilotView = {
  state: string
  note: string
  threshold: number | null
  isClamped: boolean
  autoCompactAt: number | null
  tokens: number | null
  window: number | null
  handoffPath: string
  lastError: string | null
  completed: number
  canHandoff: boolean
  canFresh: boolean
  canSnooze: boolean
}

export type SystemId = 'autopilot' | 'frontier' | 'qa' | 'guard' | 'router' | 'subagents' | 'load' | 'focus' | 'answers'

export type StatusView = { text: string; tone: Tone }

export type AgentView = { id: string; type: string; description: string; status: string }

export type PaneModel = {
  tab: TabId
  /** Setup lists every change from the profile, not only the most telling few. */
  showAllChanges: boolean
  /** The expandable picker that is open, by key (terminal and mobile draw choices in place). */
  openPicker: string | null
  /** Each system in plain words, as the HUD, the status line and /cr status say it. */
  status: Record<SystemId, StatusView>
  activitySub: ActivitySub
  settings: ControlRoomSettings
  profileLabel: string
  runLabel: string
  engine: { version: string | null; isSupported: boolean }
  surfaces: string[]
  autopilot: AutopilotView
  agents: { running: AgentView[]; spawned: number; denied: number; asked: number }
  router: { lastDecision: string | null; resolved: { alias: string; id: string }[]; unavailable: string[] }
  guard: { turn: number; session: number; last: { verdict: string; score: number; reasons: string[]; at: number } | null; isActive: boolean; reason: string | null }
  frontier: { lastEffort: string | null; isEffortSupported: boolean | null; isComposeReached: boolean | null }
  notes: string[]
  savedAt: number | null
  /** Where run progress comes from: Claude Code's own task list, Control Room's milestones tool, or nothing. */
  planSource: 'tasks' | 'milestones' | 'none'
  /** The person's own Claude Code output style when one is chosen; it takes precedence over the answer style. */
  nativeOutputStyle: string | null
  cache: CacheView
  /** The run's latest handoff: what it left (health) and what the fresh context picked up (continuity); null before any. */
  handoff: HandoffView | null
}

/** One item of Handoff Health or Continuity: `none` is neither good nor missing (nothing to do, or not needed). */
export type HandoffCheckView = { id: string; label: string; state: 'ok' | 'missing' | 'none'; detail: string }

export type HandoffView = {
  at: number
  fromSession: number
  /** The session that picked the work up; null for a handoff that compacted, or before the clear. */
  toSession: number | null
  via: 'clear' | 'compact' | 'manual'
  health: HandoffCheckView[]
  /** Null until the fresh context's first turn ends. */
  continuity: HandoffCheckView[] | null
  /** True while the fresh context's first turn is still under way. */
  isChecking: boolean
}

export type ResourcesView = {
  status: 'off' | 'starting' | 'live' | 'unavailable'
  platform: string
  cpu: number | null
  ram: number | null
  level: 'unknown' | 'ok' | 'elevated' | 'high' | 'critical'
  ceilings: { cpu: number; ram: number; maxHeavy: number } | null
  cpuSeries: number[]
  ramSeries: number[]
  background: { id: string; label: string; since: number }[]
  heavyRunning: string[]
  refused: number
  noticesSent: number
  error: string | null
}

export type ChainSessionView = {
  index: number
  id: string
  startedAt: number
  endedAt: number | null
  start: string
  end: string | null
  peakTokens: number
  window: number | null
  costUsd: number | null
  turns: number
  endNote: string | null
  transitions: number
}

export type ChainRunView = {
  id: string
  number: number
  startedAt: number
  status: string
  root: string
  sessions: ChainSessionView[]
  costUsd: number | null
  isCostPartial: boolean
  turns: number
  handoffs: number
  durationMs: number
}

export type ChainView = { current: ChainRunView | null; history: ChainRunView[] }

export type ActivityItemView = {
  id: string
  tool: string
  kind: string
  label: string
  status: string
  reason: string | null
  startedAt: number
  endedAt: number | null
  isSubagent: boolean
  heavy: string[]
}

export type FileChangeView = {
  path: string
  display: string
  added: number
  removed: number
  /** False when no tool reported the lines: drawn "diff unavailable", never "+0 −0". */
  hasDiff: boolean
  edits: number
  isCreated: boolean
  isDeleted: boolean
  lastAt: number
}

/** The run at a glance: what it is for, how far it is, what is under way and next. */
export type MissionView = {
  objective: string | null
  /** Claude's milestones (its task list), or null while it keeps none. */
  plan: {
    done: number
    total: number
    /** A window around the work under way; `earlier` finished and `later` open ones are left out. `detail`: evidence, or what blocks it. */
    tasks: { subject: string; status: string; isCurrent: boolean; detail: string | null }[]
    earlier: number
    later: number
  } | null
  now: string | null
  /** What the run is doing or waiting for, as the status bar's headline tells it apart. */
  nowState: HudState
  next: string | null
  isWorking: boolean
  session: number
  handoffs: number
}

export type AttentionView = {
  id: string
  kind: 'failed' | 'blocked' | 'held' | 'running' | 'slow'
  title: string
  reason: string | null
  state: 'unresolved' | 'recovered' | null
  attempts: number
  /** How long it took (slow), or null. */
  durationMs: number | null
  /** When it started: a running call's elapsed time is drawn from this. */
  since: number
}

export type ValidationView = {
  kind: string
  label: string
  command: string
  status: ValidationStatus
  durationMs: number | null
  runs: number
  failures: number
  isRecovered: boolean
  /** Each run of this kind in this context, oldest first (the last 12): how the fixes went. */
  history: ValidationStatus[]
}

/** Where a turn's time went: one span per tool call of the main conversation, by kind. */
export type TimelineKind = 'read' | 'edit' | 'run' | 'check' | 'web' | 'agent' | 'other'

export type TurnTimelineView = {
  from: number
  /** The turn's end, or now while it runs. */
  to: number
  spans: { kind: TimelineKind; start: number; end: number; isFailed: boolean }[]
}

/** Quest log: XP for verified progress only, levels, and achievements. */
export type QuestView = {
  level: number
  xp: number
  /** XP into the current level, and the level's span (to the next one). */
  intoLevel: number
  levelSpan: number
  runXp: number
  /** The latest awards, newest first ("+50 · Milestone: Fix the renderer"). */
  recent: { at: number; xp: number; text: string }[]
  achievements: { id: string; name: string; hint: string; unlockedAt: number | null }[]
}

export type ChangeGroupView = { id: string; label: string; files: FileChangeView[] }

export type ActivityView = {
  /** The spinner's line: `Working · 27 tools · 6 files changed`. */
  summary: string
  turn: number
  sessionTools: number
  mission: MissionView
  /** What Claude did in the current (or last) turn, in a few counted lines. */
  turnSummary: { lines: string[]; isRunning: boolean; durationMs: number | null; tools: number }
  /** Where the turn's time went; null before the first tool call. */
  timeline: TurnTimelineView | null
  /** Quest log only; null otherwise. */
  quest: QuestView | null
  attention: AttentionView[]
  validation: ValidationView[]
  /** Changed files by kind, real project changes first; `generated` last. */
  groups: ChangeGroupView[]
  showGenerated: boolean
  /** Every tool call, newest first (the secondary view). */
  items: ActivityItemView[]
  totals: { files: number; added: number; removed: number }
  selectedPath: string | null
  selectedHunks: string
}

export type PermissionLogEntry = {
  at: number
  tool: string
  category: string
  state: string
  evidence: string
  /** Denied by a Deny category; approved or declined by the person when asked; held back on a busy machine. */
  outcome: 'denied' | 'approved' | 'declined' | 'refused-heavy'
}

export type PermissionsView = { recent: PermissionLogEntry[]; denied: number; asked: number }

export type FocusModel = { isOn: boolean; tools: 'compact' | 'hidden'; results: boolean; diffs: boolean; expanded: string[] }

export type SpinnerModel = { line: string | null }

/**
 * Context Autopilot's handoff in flight, kept in `$.state` so a reload of the
 * plugin mid-handoff resumes it instead of starting a second one. `$.state`
 * lasts as long as the session's process and starts empty after /clear, so
 * a record never outlives the context it belongs to.
 */
export type AutopilotRecord = {
  sessionId: string
  state: string
  triggeredTokens: number | null
  triggeredAt: number | null
  handoffSince: number | null
  retries: number
  snoozeUntil: number | null
  lastError: string | null
  note: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'project-sentinel': {
      hud: HudModel
      pane: PaneModel
      resources: ResourcesView
      chain: ChainView
      activity: ActivityView
      permissions: PermissionsView
      focus: FocusModel
      spinner: SpinnerModel
      autopilot: { record: AutopilotRecord | null }
      standby: { isNoted: boolean }
    }
    /** The plugin's former name: its status bar is only read, to tell whether Control Room still runs in the session. */
    'control-room': {
      hud: unknown
    }
  }
}
