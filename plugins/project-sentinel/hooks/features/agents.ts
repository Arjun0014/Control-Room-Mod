/**
 * The Agent Command Center's facts: what Claude Code reports about the agents of this session, and
 * nothing it does not.
 *
 *   `$.agent.list()`   id, type, description, status, parent, name, teammate address
 *   `agent.spawn`      the model it resolved to, whether it runs in the background, a fork
 *   tool calls         what it is doing now (its latest call), how many it made
 *   `turn.complete`    its end: the first line of its answer, or why it stopped
 *
 * An agent is shown as running only while Claude Code lists it so. One this runtime saw end and
 * Claude Code has since dropped stays a few minutes as ended, then goes. After a reload, what only
 * the old runtime saw (its spawn) reads as not known. No cost per agent: Claude Code reports none.
 * Pure: the ledger is plain data the Runtime feeds.
 */

import type { AgentRowView } from '../../types'
import { clean } from '../core/text'

/** What Claude Code's agent list says of one agent (AgentInfo). */
export type ListedAgent = {
  id: string
  type: string
  description: string
  status: string
  parentId?: string
  name?: string
  teammateId?: string
}

export type AgentDetail = {
  id: string
  spawnedAt: number
  model: string | null
  isBackground: boolean | null
  isFork: boolean
  description: string
  type: string
  name: string | null
  parentId: string | null
  endedAt: number | null
  result: string | null
  isFailed: boolean
}

export type AgentLedger = Map<string, AgentDetail>

/** How long an agent Claude Code no longer lists stays shown, as ended. */
export const ENDED_SHOWN_MS = 10 * 60_000

const ALIVE = new Set(['pending', 'running', 'waiting', 'idle'])

export function noteSpawn(
  ledger: AgentLedger,
  input: { agentId: string; at: number; model: string | null; isBackground: boolean; isFork: boolean; description: string; type: string; name: string | null; parentId: string | null },
): void {
  ledger.set(input.agentId, {
    id: input.agentId,
    spawnedAt: input.at,
    model: input.model,
    isBackground: input.isBackground,
    isFork: input.isFork,
    description: clean(input.description, 80),
    type: clean(input.type, 40),
    name: input.name === null ? null : clean(input.name, 40),
    parentId: input.parentId,
    endedAt: null,
    result: null,
    isFailed: false,
  })
  // A long session's ended agents give way first.
  if (ledger.size > 40) {
    const oldest = [...ledger.values()].filter(a => a.endedAt !== null).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))[0]
    if (oldest !== undefined) ledger.delete(oldest.id)
  }
}

/** The model an agent's own requests report (its loop's turn.step). */
export function noteModel(ledger: AgentLedger, agentId: string, model: string): void {
  const a = ledger.get(agentId)
  if (a !== undefined && a.model !== model) ledger.set(agentId, { ...a, model })
}

/** An agent's loop ended (its turn.complete): the first line of its answer, or why it stopped. */
export function noteEnd(ledger: AgentLedger, agentId: string, input: { at: number; reason: 'answer' | 'aborted' | 'refusal' | 'error'; answer: string }): void {
  const a = ledger.get(agentId)
  const firstLine = input.answer
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !l.startsWith('```'))
  const result = input.reason === 'answer' ? (firstLine === undefined ? 'Finished' : clean(firstLine.replace(/^#+\s*/, ''), 140)) : input.reason === 'aborted' ? 'Stopped before it finished' : input.reason === 'refusal' ? 'Refused the task' : 'Ended with an error'
  const base: AgentDetail = a ?? { id: agentId, spawnedAt: input.at, model: null, isBackground: null, isFork: false, description: '', type: '', name: null, parentId: null, endedAt: null, result: null, isFailed: false }
  ledger.set(agentId, { ...base, endedAt: input.at, result, isFailed: input.reason !== 'answer' })
}

/**
 * The rows: every agent Claude Code lists (its status is the truth), then the ones this runtime saw
 * end that it no longer lists, for a few minutes. `activityOf` gives an agent's latest call and its
 * count, from the tool calls Project Sentinel saw.
 */
export function agentRows(
  ledger: AgentLedger,
  listed: readonly ListedAgent[],
  now: number,
  activityOf: (agentId: string) => { label: string | null; calls: number },
): AgentRowView[] {
  const rows: AgentRowView[] = []
  const seen = new Set<string>()
  for (const l of listed) {
    seen.add(l.id)
    const d = ledger.get(l.id)
    const alive = ALIVE.has(l.status)
    const act = activityOf(l.id)
    const isTeammate = l.teammateId !== undefined
    const isAddressable = isTeammate || l.name !== undefined || d?.isBackground === true
    rows.push({
      id: l.id,
      name: l.name ?? d?.name ?? null,
      type: l.type,
      description: clean(l.description || d?.description || '', 80),
      status: l.status,
      model: d?.model ?? null,
      isBackground: d?.isBackground ?? (isTeammate ? true : null),
      isFork: d?.isFork ?? false,
      parentId: l.parentId ?? d?.parentId ?? null,
      startedAt: d?.spawnedAt ?? null,
      endedAt: alive ? null : (d?.endedAt ?? null),
      activity: alive ? act.label : null,
      calls: act.calls,
      result: alive ? null : (d?.result ?? (l.status === 'killed' ? 'Stopped' : l.status === 'failed' ? 'Failed' : null)),
      isFailed: l.status === 'failed' || l.status === 'killed' || (d?.isFailed ?? false),
      // Claude Code's TaskStop takes background agents and teammates by id; SendMessage reaches them too.
      canStop: alive && isAddressable,
      canMessage: alive && isAddressable,
    })
  }
  for (const d of ledger.values()) {
    if (seen.has(d.id) || d.endedAt === null || now - d.endedAt > ENDED_SHOWN_MS) continue
    const act = activityOf(d.id)
    rows.push({
      id: d.id,
      name: d.name,
      type: d.type || 'agent',
      description: d.description,
      status: d.isFailed ? 'failed' : 'completed',
      model: d.model,
      isBackground: d.isBackground,
      isFork: d.isFork,
      parentId: d.parentId,
      startedAt: d.spawnedAt,
      endedAt: d.endedAt,
      activity: null,
      calls: act.calls,
      result: d.result,
      isFailed: d.isFailed,
      canStop: false,
      canMessage: false,
    })
  }
  // Running first, then waiting and idle, then the ended ones newest first.
  const rank = (r: AgentRowView) => (r.status === 'running' ? 0 : r.status === 'pending' ? 1 : r.status === 'waiting' ? 2 : r.status === 'idle' ? 3 : 4)
  return rows.sort((a, b) => rank(a) - rank(b) || (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0))
}

export const isAlive = (status: string): boolean => ALIVE.has(status)
