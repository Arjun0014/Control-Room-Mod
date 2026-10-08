/**
 * Subagent Control: decides each spawn against the session's policy and the
 * live count of running agents (from `$.agent.list()`). Enforced through
 * `agent.offer` / `agent.spawn`, never through prompting alone.
 */

import type { AgentInfo } from 'claude-code'

import type { SubagentMode } from '../core/settings'

const ENDED = new Set(['completed', 'failed', 'killed'])

/** Agents that count against the limit: not ended; teammates only when asked. */
export function activeAgents(list: readonly AgentInfo[], countTeammates: boolean): AgentInfo[] {
  return list.filter(a => !ENDED.has(a.status) && (countTeammates || a.teammateId === undefined))
}

export type SpawnInput = {
  mode: SubagentMode
  limit: number
  active: number
  isTeammate: boolean
  countTeammates: boolean
  type: string
  description: string
  /** Spawns the person allowed for the rest of the session (Ask → "Allow all"). */
  isAllowedForSession: boolean
}

export type SpawnDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; question: string }

export function decideSpawn(input: SpawnInput): SpawnDecision {
  if (input.isTeammate && !input.countTeammates) return { action: 'allow' }
  switch (input.mode) {
    case 'unrestricted':
      return { action: 'allow' }
    case 'block':
      return {
        action: 'deny',
        reason: 'Control Room: subagents are disabled in this session. Do the work directly in the main conversation.',
      }
    case 'ask':
      if (input.isAllowedForSession) return { action: 'allow' }
      return {
        action: 'ask',
        question: `Claude wants to start a ${input.isTeammate ? 'teammate' : 'subagent'} (${input.type}: ${input.description}). Allow it?`,
      }
    case 'limit':
      if (input.active < input.limit) return { action: 'allow' }
      return {
        action: 'deny',
        reason: `Control Room: the subagent limit is ${input.limit} and ${input.active} ${input.active === 1 ? 'is' : 'are'} already running. Wait for one to finish, or do this part directly.`,
      }
  }
}

/** Whether agent types should be listed for the model at all. */
export const isOffered = (mode: SubagentMode): boolean => mode !== 'block'

export const ASK_OPTIONS = ['Allow', 'Deny', 'Allow all this session'] as const
