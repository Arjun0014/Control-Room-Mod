// Control Room's type contract: the settings schema and every view model the
// plugin keeps in `$.state` for its render sites. Self-contained by design
// (no imports); the hooks module imports these types from '../types'.

// ---------------------------------------------------------------------------
// Settings

export type PermissionState = 'default' | 'allow' | 'ask' | 'deny'

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
  /** `liveLoad`: machine-wide CPU and memory in the status bar (runs the sampler). */
  ui: { hud: HudPlacement; toasts: boolean; openOnStart: boolean; liveLoad: boolean }
  customProfiles: ControlRoomCustomProfile[]
}

export type ControlRoomSystems = Pick<
  ControlRoomSettings,
  'autopilot' | 'frontier' | 'qa' | 'guard' | 'router' | 'subagents' | 'focus' | 'resources' | 'permissions'
>

export type ControlRoomCustomProfile = { id: string; name: string; createdAt: number; systems: ControlRoomSystems }

// ---------------------------------------------------------------------------
// View models

export type Tone = 'normal' | 'muted' | 'good' | 'warn' | 'bad' | 'accent' | 'info'

export type HudModel = {
  isVisible: boolean
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
  session: { run: number | null; index: number }
  alert: { kind: 'pending' | 'awaiting' | 'load'; text: string; tone: Tone } | null
  /** Run progress from Claude's own task list (milestones done of total); null until it keeps one. */
  work: { done: number; total: number; current: string | null } | null
  /** What Claude is doing right now, while a turn runs. */
  now: { text: string; source: 'plan' | 'tool' | 'thinking' } | null
  /** Checks whose latest run failed ("Tests"). */
  failing: string[]
  /** This turn's calls that still need a look: unresolved failures and refusals. */
  attention: number
}

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

export type SystemId = 'autopilot' | 'frontier' | 'qa' | 'guard' | 'router' | 'subagents' | 'load' | 'focus'

export type StatusView = { text: string; tone: Tone }

export type AgentView = { id: string; type: string; description: string; status: string }

export type PaneModel = {
  tab: TabId
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
    /** A window around the work under way; `earlier` finished and `later` open ones are left out. */
    tasks: { subject: string; status: string; isCurrent: boolean }[]
    earlier: number
    later: number
  } | null
  now: string | null
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
  status: 'passed' | 'failed' | 'running' | 'blocked' | 'background' | 'stopped'
  durationMs: number | null
  runs: number
  failures: number
  isRecovered: boolean
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
  outcome: 'denied' | 'asked' | 'allowed' | 'refused-heavy'
}

export type PermissionsView = { recent: PermissionLogEntry[]; denied: number; asked: number; allowed: number }

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
    'control-room': {
      hud: HudModel
      pane: PaneModel
      resources: ResourcesView
      chain: ChainView
      activity: ActivityView
      permissions: PermissionsView
      focus: FocusModel
      spinner: SpinnerModel
      autopilot: { record: AutopilotRecord | null }
    }
  }
}
