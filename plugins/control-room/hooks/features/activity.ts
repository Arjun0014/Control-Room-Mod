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

export type ActivityKind = 'read' | 'search' | 'edit' | 'shell' | 'web' | 'agent' | 'task' | 'mcp' | 'other'

export type ActivityItem = {
  id: string
  tool: string
  kind: ActivityKind
  /** Compact label: the command, the file, the query. */
  label: string
  status: 'running' | 'ok' | 'error' | 'denied'
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
  edits: number
  isCreated: boolean
  isDeleted: boolean
  lastAt: number
  firstTurn: number
  lastTurn: number
  /** Unified-diff hunks (most recent last), capped for display. */
  hunks: string
}

export type TurnStats = { index: number; startedAt: number | null; tools: number; errors: number; files: Set<string> }

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

/** File changes a finished tool call reports in its structured result. */
export function changesOf(tool: string, result: unknown): { path: string; hunks: Hunk[]; isCreated: boolean; isDeleted: boolean }[] {
  if (!isRecord(result)) return []
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    if (result.staged === true) return []
    const path = str(result.filePath)
    if (path === '') return []
    return [{ path, hunks: hunksOf(result.structuredPatch), isCreated: result.type === 'create', isDeleted: false }]
  }
  if (tool === 'NotebookEdit') {
    const path = str(result.notebook_path) || str(result.notebookPath) || str(result.filePath)
    return path === '' ? [] : [{ path, hunks: [], isCreated: false, isDeleted: false }]
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const diff = result.bashEditDiff
    if (!isRecord(diff) || !Array.isArray(diff.files)) return []
    return diff.files
      .filter(isRecord)
      .map(f => ({ path: str(f.filePath), hunks: hunksOf(f.hunks), isCreated: f.created === true, isDeleted: f.deleted === true }))
      .filter(f => f.path !== '')
  }
  return []
}

export class ActivityTracker {
  items: ActivityItem[] = []
  private running = new Map<string, ActivityItem>()
  turn: TurnStats = { index: 0, startedAt: null, tools: 0, errors: 0, files: new Set() }
  sessionTools = 0
  changes = new Map<string, FileChange>()
  /** Background shell tasks Claude started that have not been seen to end. */
  background = new Map<string, { id: string; label: string; since: number }>()

  turnStarted(now: number): void {
    this.turn = { index: this.turn.index + 1, startedAt: now, tools: 0, errors: 0, files: new Set() }
  }

  turnEnded(): void {
    this.turn = { ...this.turn, startedAt: null }
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

  finished(input: { id: string; status: 'ok' | 'error' | 'denied'; result: unknown; now: number }): FileChange[] {
    const item = this.running.get(input.id) ?? this.items.find(i => i.id === input.id)
    this.running.delete(input.id)
    if (!item) return []
    item.status = input.status
    item.endedAt = input.now
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
        added: (prev?.added ?? 0) + counts.added,
        removed: (prev?.removed ?? 0) + counts.removed,
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
    this.turn = { index: 0, startedAt: null, tools: 0, errors: 0, files: new Set() }
    this.sessionTools = 0
  }

  clearChanges(): void {
    this.changes.clear()
  }
}
