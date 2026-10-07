/**
 * Activity and change tracking for Focus View: every tool call as one
 * compact record, per-turn and per-session counters, what is running now,
 * and the files Claude changed with their hunks (from the tools' own
 * structured results: Edit/Write `structuredPatch`, Bash `bashEditDiff`).
 *
 * Presentation data only: nothing here changes what Claude reads.
 */

import { LIMITS } from '../constants'
import { plural } from '../core/format'
import { clean, shortPath } from '../core/text'
import { type HeavyKind, heavyKinds, heavyLabel } from './resources/heavy'
import { type ValidationKind, type ValidationRun, type ValidationStatus, validationKindOf } from './validation'

export type ActivityKind = 'read' | 'search' | 'edit' | 'shell' | 'web' | 'agent' | 'task' | 'mcp' | 'other'

export type ActivityItem = {
  id: string
  tool: string
  kind: ActivityKind
  /** Compact label: the command, the file, the query. */
  label: string
  /** `denied`: refused by a rule, a policy or the person; `held`: the Resource Governor kept it back. */
  status: 'running' | 'ok' | 'error' | 'denied' | 'held'
  /** Why it failed or was refused: the first line of the tool's answer. */
  reason: string | null
  /** The check a shell command runs (tests, build, ...), or null. */
  validation: ValidationKind | null
  /** A shell command interrupted before it finished (by the person or a timeout). */
  isInterrupted: boolean
  startedAt: number
  endedAt: number | null
  agentId: string | null
  turn: number
  heavy: HeavyKind[]
  /** Background task id when a shell command was sent to the background. */
  backgroundTaskId: string | null
}

export type FileChange = {
  path: string
  added: number
  removed: number
  /** False when no tool reported the lines (a file a shell command created, a diff the engine skipped). */
  hasDiff: boolean
  edits: number
  isCreated: boolean
  isDeleted: boolean
  lastAt: number
  firstTurn: number
  lastTurn: number
  /** Unified-diff hunks (most recent last), capped for display. */
  hunks: string
}

export type TurnStats = { index: number; startedAt: number | null; endedAt: number | null; tools: number; errors: number; files: Set<string> }

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

const KIND_OF: Record<string, ActivityKind> = {
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  LS: 'search',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  MultiEdit: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  TaskCreate: 'task',
  TaskUpdate: 'task',
  TaskList: 'task',
  TaskGet: 'task',
  TaskStop: 'task',
  TodoWrite: 'task',
}

export const kindOf = (tool: string): ActivityKind =>
  KIND_OF[tool] ?? (tool.startsWith('mcp__') ? 'mcp' : 'other')

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** One compact label for a tool call, safe to draw. */
export function labelOf(tool: string, input: Record<string, unknown>): string {
  switch (kindOf(tool)) {
    case 'shell':
      return clean(str(input.command).split('\n')[0], 120)
    case 'read':
    case 'edit':
      return shortPath(str(input.file_path) || str(input.notebook_path) || str(input.path), 64)
    case 'search':
      return clean(str(input.pattern) || str(input.path), 80)
    case 'web': {
      const url = str(input.url)
      if (url !== '') {
        try {
          return clean(new URL(url).host + new URL(url).pathname, 80)
        } catch {
          return clean(url, 80)
        }
      }
      return clean(str(input.query), 80)
    }
    case 'agent':
      return clean(str(input.description) || str(input.subagent_type) || 'subagent', 80)
    case 'task':
      return clean(str(input.subject) || str(input.task_id) || str(input.taskId) || tool, 80)
    case 'mcp': {
      const [, server, name] = tool.split('__')
      return clean(`${server ?? ''} · ${name ?? ''}`, 80)
    }
    default:
      return clean(str(input.skill) || str(input.description) || tool, 80)
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function hunksOf(v: unknown): Hunk[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (h): h is Hunk =>
      isRecord(h) && typeof h.oldStart === 'number' && typeof h.newStart === 'number' && Array.isArray(h.lines),
  )
}

function hunkText(hunks: readonly Hunk[]): string {
  return hunks
    // eslint-disable-next-line no-control-regex
    .map(h => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.map(l => l.replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, '').slice(0, 400)).join('\n')}`)
    .join('\n')
}

function countLines(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) added += 1
      else if (l.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}

/** Keeps whole hunks from the end so the text stays a parseable unified diff. */
export function capHunks(text: string, max: number): string {
  if (text.length <= max) return text
  const parts = text.split(/\n(?=@@ )/)
  const kept: string[] = []
  let size = 0
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!
    if (size + p.length + 1 > max) break
    kept.unshift(p)
    size += p.length + 1
  }
  return kept.join('\n')
}

/** Lines shown for a new file the diff left empty; its full count is kept apart. */
const NEW_FILE_LINES = 200

/** A file written whole: its content as one added hunk, since the engine's patch is empty for a create. */
function createdHunks(content: string): { hunks: Hunk[]; added: number } {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length === 0) return { hunks: [], added: 0 }
  const shown = lines.slice(0, NEW_FILE_LINES)
  return { hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: shown.length, lines: shown.map(l => `+${l}`) }], added: lines.length }
}

export type ReportedChange = { path: string; hunks: Hunk[]; isCreated: boolean; isDeleted: boolean; hasDiff: boolean; added?: number }

/** File changes a finished tool call reports in its structured result. */
export function changesOf(tool: string, result: unknown): ReportedChange[] {
  if (!isRecord(result)) return []
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    if (result.staged === true) return []
    const path = str(result.filePath)
    if (path === '') return []
    const hunks = hunksOf(result.structuredPatch)
    const isCreated = result.type === 'create'
    if (isCreated && hunks.length === 0 && typeof result.content === 'string') {
      const created = createdHunks(result.content)
      return [{ path, hunks: created.hunks, isCreated, isDeleted: false, hasDiff: true, added: created.added }]
    }
    // An update without hunks changed nothing, or its diff was skipped: no lines to show either way.
    return [{ path, hunks, isCreated, isDeleted: false, hasDiff: hunks.length > 0 }]
  }
  if (tool === 'NotebookEdit') {
    const path = str(result.notebook_path) || str(result.notebookPath) || str(result.filePath)
    return path === '' ? [] : [{ path, hunks: [], isCreated: false, isDeleted: false, hasDiff: false }]
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const diff = result.bashEditDiff
    if (!isRecord(diff) || !Array.isArray(diff.files)) return []
    const isUnavailable = diff.unavailable === true || diff.skipped === true
    return diff.files
      .filter(isRecord)
      .map(f => {
        const hunks = hunksOf(f.hunks)
        return { path: str(f.filePath), hunks, isCreated: f.created === true, isDeleted: f.deleted === true, hasDiff: !isUnavailable && hunks.length > 0 }
      })
      .filter(f => f.path !== '')
  }
  return []
}

/** The first meaningful line of a tool's answer: why it failed or was refused. */
export function reasonOf(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const line = text
    .replace(/<\/?[a-z_-]+>/gi, ' ')
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l !== '' && !/^error:?$/i.test(l))
  return line === undefined ? null : clean(line, 140)
}

/** How a check ended: a command sent to the background has no outcome Control Room can see. */
export function validationStatusOf(i: ActivityItem): ValidationStatus {
  if (i.status === 'running') return 'running'
  if (i.status === 'denied' || i.status === 'held') return 'blocked'
  if (i.isInterrupted) return 'stopped'
  if (i.status === 'error') return 'failed'
  return i.backgroundTaskId !== null ? 'background' : 'passed'
}

export class ActivityTracker {
  items: ActivityItem[] = []
  private running = new Map<string, ActivityItem>()
  turn: TurnStats = { index: 0, startedAt: null, endedAt: null, tools: 0, errors: 0, files: new Set() }
  sessionTools = 0
  changes = new Map<string, FileChange>()
  /** Background shell tasks Claude started that have not been seen to end. */
  background = new Map<string, { id: string; label: string; since: number }>()

  turnStarted(now: number): void {
    this.turn = { index: this.turn.index + 1, startedAt: now, endedAt: null, tools: 0, errors: 0, files: new Set() }
  }

  /** The turn's numbers stay readable (Activity's "this turn") until the next one starts. */
  turnEnded(now: number = Date.now()): void {
    this.turn = { ...this.turn, endedAt: now }
    for (const [id, item] of this.running) {
      if (item.kind !== 'shell' || item.backgroundTaskId === null) this.running.delete(id)
    }
  }

  started(input: { id: string; tool: string; input: Record<string, unknown>; agentId: string | undefined; now: number }): ActivityItem {
    const command = kindOf(input.tool) === 'shell' ? str(input.input.command) : ''
    const item: ActivityItem = {
      id: input.id,
      tool: input.tool,
      kind: kindOf(input.tool),
      label: labelOf(input.tool, input.input),
      status: 'running',
      reason: null,
      validation: command === '' ? null : validationKindOf(command),
      isInterrupted: false,
      startedAt: input.now,
      endedAt: null,
      agentId: input.agentId ?? null,
      turn: this.turn.index,
      heavy: command === '' ? [] : heavyKinds(command),
      backgroundTaskId: null,
    }
    this.running.set(item.id, item)
    this.items.push(item)
    if (this.items.length > LIMITS.activityItems) this.items.splice(0, this.items.length - LIMITS.activityItems)
    this.turn.tools += 1
    this.sessionTools += 1
    return item
  }

  /**
   * A call refused before it ran: by the Permission Policy (`denied`) or held
   * back by the Resource Governor (`held`). Kept so Activity can say why.
   */
  refused(input: { id: string; tool: string; input: Record<string, unknown>; agentId: string | undefined; now: number; status: 'denied' | 'held'; reason: string }): ActivityItem {
    const item = this.started(input)
    this.running.delete(item.id)
    item.status = input.status
    item.reason = clean(input.reason, 140)
    item.endedAt = input.now
    return item
  }

  finished(input: { id: string; status: 'ok' | 'error' | 'denied'; result: unknown; text?: string; now: number }): FileChange[] {
    const item = this.running.get(input.id) ?? this.items.find(i => i.id === input.id)
    this.running.delete(input.id)
    if (!item) return []
    item.status = input.status
    item.endedAt = input.now
    if (input.status !== 'ok') item.reason = reasonOf(input.text)
    if (isRecord(input.result) && input.result.interrupted === true) item.isInterrupted = true
    if (input.status === 'error') this.turn.errors += 1
    if (isRecord(input.result) && typeof input.result.backgroundTaskId === 'string' && input.status === 'ok') {
      item.backgroundTaskId = input.result.backgroundTaskId
      this.background.set(item.backgroundTaskId, { id: item.backgroundTaskId, label: item.label, since: input.now })
    }
    if (input.status !== 'ok') return []
    const changed: FileChange[] = []
    for (const c of changesOf(item.tool, input.result)) {
      const prev = this.changes.get(c.path)
      const counts = countLines(c.hunks)
      const text = c.hunks.length > 0 ? hunkText(c.hunks) : ''
      const next: FileChange = {
        path: c.path,
        added: (prev?.added ?? 0) + (c.added ?? counts.added),
        removed: (prev?.removed ?? 0) + counts.removed,
        hasDiff: (prev?.hasDiff ?? false) || c.hasDiff,
        edits: (prev?.edits ?? 0) + 1,
        isCreated: (prev?.isCreated ?? false) || c.isCreated,
        isDeleted: c.isDeleted,
        lastAt: input.now,
        firstTurn: prev?.firstTurn ?? this.turn.index,
        lastTurn: this.turn.index,
        hunks: capHunks(text === '' ? (prev?.hunks ?? '') : prev?.hunks ? `${prev.hunks}\n${text}` : text, LIMITS.hunkChars),
      }
      this.changes.delete(c.path)
      this.changes.set(c.path, next)
      this.turn.files.add(c.path)
      changed.push(next)
    }
    while (this.changes.size > LIMITS.changedFiles) {
      const oldest = this.changes.keys().next().value
      if (oldest === undefined) break
      this.changes.delete(oldest)
    }
    return changed
  }

  /** A background task Claude stopped (TaskStop) or that reported its end. */
  backgroundEnded(taskId: string): void {
    this.background.delete(taskId)
  }

  /** Every check Claude ran in this context, oldest first. */
  validationRuns(): ValidationRun[] {
    const out: ValidationRun[] = []
    for (const i of this.items) {
      if (i.validation === null || i.agentId !== null) continue
      out.push({ kind: i.validation, command: i.label, status: validationStatusOf(i), startedAt: i.startedAt, endedAt: i.endedAt, turn: i.turn })
    }
    return out
  }

  runningItems(): ActivityItem[] {
    return [...this.running.values()]
  }

  /** Heavy jobs running now: foreground ones and Claude's background shells. */
  runningHeavy(): ActivityItem[] {
    const fg = this.runningItems().filter(i => i.heavy.length > 0 && i.status === 'running')
    const bg = this.items.filter(i => i.backgroundTaskId !== null && this.background.has(i.backgroundTaskId) && i.heavy.length > 0)
    return [...fg, ...bg.filter(b => !fg.includes(b))]
  }

  /** `Working · 27 tools · 6 files changed · tests running`. */
  summaryLine(input: { subagentsRunning: number }): string {
    const parts = ['Working', plural(this.turn.tools, 'tool')]
    if (this.turn.files.size > 0) parts.push(`${plural(this.turn.files.size, 'file')} changed`)
    if (this.turn.errors > 0) parts.push(plural(this.turn.errors, 'error'))
    const labels = new Set<string>()
    for (const item of this.runningItems()) for (const k of item.heavy) labels.add(heavyLabel(k))
    parts.push(...[...labels].slice(0, 2))
    if (input.subagentsRunning > 0) parts.push(`${plural(input.subagentsRunning, 'agent')} running`)
    return parts.join(' · ')
  }

  /** Everything the session changed, newest first. */
  changeList(): FileChange[] {
    return [...this.changes.values()].reverse()
  }

  totals(): { files: number; added: number; removed: number } {
    let added = 0
    let removed = 0
    for (const c of this.changes.values()) {
      added += c.added
      removed += c.removed
    }
    return { files: this.changes.size, added, removed }
  }

  /**
   * A fresh context (/clear): the activity list and counters start over.
   * Changed files are kept — they belong to the run, and a handoff should
   * not hide what the previous context changed.
   */
  reset(): void {
    this.items = []
    this.running.clear()
    this.turn = { index: 0, startedAt: null, endedAt: null, tools: 0, errors: 0, files: new Set() }
    this.sessionTools = 0
  }

  clearChanges(): void {
    this.changes.clear()
  }
}
