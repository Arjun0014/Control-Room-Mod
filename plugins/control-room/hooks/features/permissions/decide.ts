/**
 * Permission decisions for one tool call.
 *
 * `tool.call` refuses Deny categories outright (before any dialog, in every
 * permission mode, main loop and subagents alike). `tool.check` then adjusts
 * the engine's verdict: Ask forces approval even where a rule or the mode
 * would allow; Allow turns an engine *ask* into an allow for categories that
 * permit it. Invariants, enforced here and tested:
 *   - an engine `deny` is never loosened;
 *   - nothing is auto-allowed in plan mode;
 *   - a mixed command (one part unconfigured) is never auto-allowed.
 */

import type { PermissionCategory, PermissionState } from '../../core/settings'
import { CATEGORY_INFO, type Decision, type Finding, classifyMcp, classifyShell, strictest } from './categories'

export const SHELL_TOOLS = ['Bash', 'PowerShell'] as const
export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'] as const
export const NETWORK_TOOLS = ['WebFetch', 'WebSearch'] as const

export const isShellTool = (tool: string): boolean => (SHELL_TOOLS as readonly string[]).includes(tool)
export const isEditTool = (tool: string): boolean => (EDIT_TOOLS as readonly string[]).includes(tool)

/** The path an editing tool writes, when it names one. */
export function editPathOf(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.notebook_path ?? input.path
  return typeof p === 'string' && p.trim() !== '' ? p : null
}

/**
 * Findings for a tool call. `isInsideProject` answers for edit tools (the
 * runtime resolves real paths; null when the path could not be placed, which
 * counts as outside — the conservative reading).
 */
export function findingsFor(tool: string, input: Record<string, unknown>, isInsideProject: boolean | null): Finding[] {
  if (isShellTool(tool)) {
    const command = typeof input.command === 'string' ? input.command : ''
    return classifyShell(command)
  }
  if (isEditTool(tool)) {
    const path = editPathOf(input) ?? '?'
    return [{ category: isInsideProject === true ? 'edit' : 'editOutside', evidence: `${tool} ${path}` }]
  }
  if ((NETWORK_TOOLS as readonly string[]).includes(tool)) {
    const target = typeof input.url === 'string' ? input.url : typeof input.query === 'string' ? `search: ${input.query}` : tool
    return [{ category: 'network', evidence: `${tool} ${target}` }]
  }
  if (tool.startsWith('mcp__')) return classifyMcp(tool)
  return []
}

export function decisionFor(findings: readonly Finding[], states: Record<PermissionCategory, PermissionState>): Decision {
  return strictest(findings, states)
}

export function denyMessage(decision: Decision): string {
  const label = decision.category === null ? 'this action' : CATEGORY_INFO[decision.category].label
  return `Control Room Permission Policy: "${label}" is set to Deny in this session (${decision.evidence ?? 'matched'}). Do not retry it or work around it; continue without it, or tell the user it is needed.`
}

export function askReason(decision: Decision): string {
  const label = decision.category === null ? 'This action' : CATEGORY_INFO[decision.category].label
  return `Control Room: ${label} needs approval (${decision.evidence ?? 'policy'})`
}

export type EngineVerdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string; hook?: string }

/** The verdict after the session's policy, never looser than allowed. */
export function adjustVerdict(input: {
  engine: EngineVerdict
  decision: Decision
  permissionMode: string | undefined
}): EngineVerdict {
  const { engine, decision } = input
  if (engine.decision === 'deny') return engine
  switch (decision.state) {
    case 'default':
      return engine
    case 'deny':
      return { decision: 'deny', reason: denyMessage(decision) }
    case 'ask':
      return engine.decision === 'ask' ? { ...engine, reason: engine.reason ?? askReason(decision) } : { decision: 'ask', reason: askReason(decision) }
    case 'allow': {
      if (engine.decision !== 'ask') return engine
      if (input.permissionMode === 'plan') return engine
      if (decision.category === null || CATEGORY_INFO[decision.category].loosest !== 'allow') return engine
      return { decision: 'allow', reason: `Control Room Permission Policy allows ${CATEGORY_INFO[decision.category].label.toLowerCase()}` }
    }
  }
}

/** The states the UI offers for a category, loosest last. */
export function statesFor(category: PermissionCategory): PermissionState[] {
  const loosest = CATEGORY_INFO[category].loosest
  return loosest === 'allow' ? ['default', 'allow', 'ask', 'deny'] : ['default', 'ask', 'deny']
}

export function clampState(category: PermissionCategory, state: PermissionState): PermissionState {
  return statesFor(category).includes(state) ? state : 'ask'
}
