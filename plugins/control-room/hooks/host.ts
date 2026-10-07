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
  PaneCloseArgs,
  PaneOpenArgs,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  PromptSubmitResult,
  RenderSurface,
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
  runCommand(command: string, args?: string): Promise<CommandRunResult>
  registerCommand(spec: CommandSpec): Promise<unknown>
  listCommands(): Promise<CommandInfo[]>

  listAgents(): Promise<AgentInfo[]>
  stopTask(taskId: string): Promise<ToolCallResult>
  classify(text: string, labels: readonly string[], model?: string): Promise<string | undefined>

  toast(text: string, timeoutMs?: number): void
  status(text: string | undefined): void
  open(pane: PaneOpenArgs): Promise<UiOpenResult>
  close(pane: PaneCloseArgs): Promise<void>
  panes(): Promise<readonly UiPane[]>
  /** Brings the top of the Control Room pane into view (after a section change, or "Back to top"). */
  scrollPaneToTop(): Promise<void>
  ask(question: string, options: readonly string[], header?: string): Promise<string>
  copy(text: string, surface?: RenderSurface): Promise<boolean>

  readText(path: string): Promise<string>
  stat(path: string, resolve: boolean): Promise<FsStat>
  exists(path: string): Promise<boolean>

  storeGet(key: string): Promise<unknown>
  storeSet(key: string, value: unknown): Promise<void>
  storeDelete(key: string): Promise<void>

  settings(source?: 'policy' | 'user' | 'project' | 'local'): Promise<EngineSettings>

  spawn(argv: readonly string[]): SpawnStream

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
}
