/**
 * Permission decisions for one tool call, all taken in `tool.call`, before
 * the call goes on to Claude Code's own permission check:
 *   - Deny refuses the call outright (before any dialog, in every permission
 *     mode, main loop and subagents alike);
 *   - Ask puts the call to the person first, unless Claude Code is about to
 *     ask them itself or refuses it anyway; their yes passes the call on, so
 *     Claude Code's rules and PreToolUse hooks still apply after it;
 *   - Default leaves it to Claude Code.
 * Control Room never answers a permission check itself, so it can never
 * loosen one: a settings deny stays a deny, plan mode stays plan mode.
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

export type EngineVerdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string; hook?: string }

/**
 * Whether Control Room asks the person about an Ask category itself, given
 * what Claude Code would decide (its `tool.check` verdict, from a query that
 * runs nothing). Claude Code refusing it: nothing to ask. Claude Code putting
 * it to the person's own dialog: that dialog is the question. Otherwise (it
 * would run without asking, a mode that answers for the person, an auto-mode
 * classifier, or no verdict at all) Control Room asks.
 */
export function isOwnQuestionNeeded(engine: EngineVerdict | null, permissionMode: string | undefined): boolean {
  if (engine === null) return true
  if (engine.decision === 'deny') return false
  if (engine.decision === 'allow') return true
  // An engine ask goes to the person's dialog, except in auto mode, where a classifier settles it.
  return permissionMode === 'auto'
}

/** The question put to the person for an Ask category, and the answers it offers. */
export const APPROVE = 'Run it'
export const DECLINE = "Don't run it"

/** What a call does, in a few words for the question: the command, the file, the address. */
export function callWords(tool: string, input: Record<string, unknown>, decision: Decision): string {
  const command = isShellTool(tool) && typeof input.command === 'string' ? input.command.trim().replace(/\s+/g, ' ') : null
  const text = command ?? (isEditTool(tool) ? `${tool} ${editPathOf(input) ?? ''}`.trim() : (decision.evidence ?? tool))
  return text.length > 140 ? `${text.slice(0, 139)}…` : text
}

export function approvalQuestion(decision: Decision, what: string): string {
  const label = decision.category === null ? 'This action' : CATEGORY_INFO[decision.category].label
  return `${label} is set to Ask in Control Room. Let Claude run this? ${what}`
}

/** What Claude reads when the person declined (or could not be asked). */
export function declineMessage(decision: Decision, answer: string | null): string {
  const label = decision.category === null ? 'this action' : CATEGORY_INFO[decision.category].label
  const said = answer !== null && answer.trim() !== '' && answer !== DECLINE ? ` The user said: "${answer.trim().slice(0, 300)}".` : ''
  if (answer === null) {
    return `Control Room Permission Policy: "${label}" is set to Ask and was not approved: the question was dismissed, or nobody could be asked in this session (${decision.evidence ?? 'matched'}). Do not retry it or work around it; continue without it, or tell the user it is needed.`
  }
  return `Control Room Permission Policy: the user declined "${label}" (${decision.evidence ?? 'matched'}).${said} Do not retry it or work around it; continue without it, or ask the user.`
}

/** The states the UI offers for a category, loosest first. */
export function statesFor(_category: PermissionCategory): PermissionState[] {
  return ['default', 'ask', 'deny']
}

/** A state picked or read for a category: a removed Allow is Default; anything unknown is Ask, the safe reading. */
export function clampState(category: PermissionCategory, state: string): PermissionState {
  if (state === 'allow') return 'default'
  return (statesFor(category) as string[]).includes(state) ? (state as PermissionState) : 'ask'
}
