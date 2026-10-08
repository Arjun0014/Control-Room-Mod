/**
 * The Host: Control Room's one door to the engine.
 *
 * `register.tsx` builds it from `$` (the only file that spells `$.noun.method`,
 * as `claude plugin validate` requires); every other module works against
 * this interface. Members are thin and named for the engine call they make.
 */

import type {
  AgentInfo,
  CommandInfo,
  CommandRunResult,
  CommandSpec,
  FsStat,
  ModelForkResult,
  PaneCloseArgs,
  PaneOpenArgs,
  ProcessRunResult,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  PromptSubmitResult,
  RenderSurface,
  ToolInfo,
  ToolSpec,
  SessionCompactResult,
  SessionUsage,
  SessionVersion,
  Settings as EngineSettings,
  Timer,
  ToolCallResult,
  UiOpenResult,
  UiPane,
} from 'claude-code'

import type {
  ActivityView,
  AutopilotRecord,
  ChainView,
  FocusModel,
  HudModel,
  PaneModel,
  PermissionsView,
  ResourcesView,
  SpinnerModel,
} from '../types'

export type SpawnStream = AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> & { readonly result: Promise<ProcessSpawnResult> }

export type Host = {
  pluginRoot: string
  /** A synchronous clock for tests (a manual one); absent, the system clock. Not an engine call. */
  time?: () => number

  now(): Promise<number>
  after(ms: number, fn: () => void): Timer
  every(ms: number, fn: () => void): Timer

  sessionId(): Promise<string>
  sessionRoot(): Promise<string>
  sessionModel(): Promise<string>
  usage(): Promise<SessionUsage>
  /** Usage with the local `summary` breakdown (auto-compact threshold); no network. */
  usageSummary(): Promise<SessionUsage>
  version(): Promise<SessionVersion>
  surfaces(): Promise<readonly RenderSurface[]>
  /** A hidden user-role row Claude reads at its next request (mid-turn too). */
  appendForModel(text: string): Promise<boolean>
  compact(instructions: string): Promise<SessionCompactResult>

  submit(text: string): Promise<PromptSubmitResult>
  /** Runs /clear (an Autopilot handoff's fresh context): the only slash command Control Room runs. */
  clearContext(): Promise<CommandRunResult>
  registerCommand(spec: CommandSpec): Promise<unknown>
  listCommands(): Promise<CommandInfo[]>

  listAgents(): Promise<AgentInfo[]>
  /** The tools the model can call now (to see whether Claude Code offers a task list). */
  listTools(): Promise<readonly ToolInfo[]>
  /** Offers the model one of Control Room's own tools; resolves to its full name (`mcp__control-room__<name>`). */
  registerTool(spec: ToolSpec): Promise<string>
  stopTask(taskId: string): Promise<ToolCallResult>
  classify(text: string, labels: readonly string[], model?: string): Promise<string | undefined>
  /** One tool-less completion over the main thread's last request (Keep warm): never added to the transcript. */
  fork(prompt: string): Promise<ModelForkResult>

  toast(text: string, timeoutMs?: number): void
  status(text: string | undefined): void
  open(pane: PaneOpenArgs): Promise<UiOpenResult>
  close(pane: PaneCloseArgs): Promise<void>
  panes(): Promise<readonly UiPane[]>
  /** Brings the top of the Control Room pane into view (after a section change, or "Back to top"). */
  scrollPaneToTop(): Promise<void>
  /** Asks the person in Claude Code's own question dialog (AskUserQuestion); rejects when dismissed or with nobody to ask. */
  ask(question: string, options: readonly string[], header?: string): Promise<string>
  /** What Claude Code's own permission check would decide for a call (its rules and the mode), running nothing. */
  checkTool(tool: string, input: Record<string, unknown>): Promise<{ decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string }>
  copy(text: string, surface?: RenderSurface): Promise<boolean>

  readText(path: string): Promise<string>
  stat(path: string, resolve: boolean): Promise<FsStat>
  exists(path: string): Promise<boolean>

  storeGet(key: string): Promise<unknown>
  storeSet(key: string, value: unknown): Promise<void>
  storeDelete(key: string): Promise<void>

  settings(source?: 'policy' | 'user' | 'project' | 'local'): Promise<EngineSettings>

  /** Starts the machine-wide CPU and memory sampler for the platform: a fixed command, one line every SAMPLER_EVERY_SEC. */
  spawnSampler(platform: 'windows' | 'macos'): SpawnStream
  /** Whether the session's folder is in a Git repository (its root), else null. */
  repoRoot(): Promise<string | null>
  /** `git status --porcelain=v1 --branch` in the session's folder (read-only; Git runs with repo hooks off). */
  gitStatus(): Promise<ProcessRunResult>

  publishHud(value: HudModel): Promise<void>
  publishPane(value: PaneModel): Promise<void>
  publishResources(value: ResourcesView): Promise<void>
  publishChain(value: ChainView): Promise<void>
  publishActivity(value: ActivityView): Promise<void>
  publishPermissions(value: PermissionsView): Promise<void>
  publishFocus(value: FocusModel): Promise<void>
  publishSpinner(value: SpinnerModel): Promise<void>

  /** The handoff in flight, in `$.state`: survives a reload of the plugin, not a restart or /clear. */
  saveAutopilotRecord(record: AutopilotRecord | null): Promise<void>
  loadAutopilotRecord(): Promise<AutopilotRecord | null>

  /** Re-runs agent listings (Subagent Control changed what is offered). */
  invalidateDescribes(): void
  /** Has the engine ask for a fresh conversation's first-message context blocks again (after Control Room's own /clear). */
  invalidatePromptContext(): void

  /** One line in Claude Code's debug log only (`claude --debug`), never on screen. Absent in tests. */
  trace?(text: string): void
}
