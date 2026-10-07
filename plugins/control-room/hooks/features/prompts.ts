/**
 * Every word Control Room puts in front of the model, in one place, so the
 * wording can be reviewed as a whole. Pure functions of their inputs: a
 * policy section only changes when its inputs change (prompt cache safe).
 */

import * as fmt from '../core/format'
import type { FrontierEffort, ResourceEnforcement, SubagentMode } from '../core/settings'

// ---------------------------------------------------------------------------
// System prompt sections (stable text; delivered by prompt.compose).

export function frontierPolicy(effort: FrontierEffort): string {
  const effortLine =
    effort === 'keep'
      ? ''
      : `\nReasoning effort for this session is set to ${effort === 'max' ? 'the maximum the model supports' : effort}; use it — think the problem through before acting.`
  return [
    '## Frontier Max (Control Room)',
    'This session is being evaluated for frontier-level autonomous capability. It is judged on completeness, depth, implementation quality, persistence, robustness, validation, edge-case handling, self-correction and the work actually accomplished — not on how early you can stop.',
    '',
    'Operating standard:',
    '- Pursue the objective to genuine completion. Do not optimise for the minimum viable answer or the first plausible stopping point.',
    '- Investigate before acting: read the relevant code, documentation and tests, and verify assumptions against the real system instead of guessing.',
    '- Implement fully. No placeholders, stubs, TODOs or "left as an exercise" gaps in work that is in scope and feasible.',
    '- Validate aggressively: run the relevant tests, builds and checks; add tests for new behaviour; exercise edge cases and failure paths; fix what you find.',
    '- Self-correct: when something fails, find the root cause and fix it. Never report unverified success.',
    '- Do not hand feasible work back to the user. Stop to ask only for real external blockers: missing credentials or access, decisions that genuinely belong to the user, or actions outside your permissions.',
    '- When you finish, state what was done and how it was verified, and name any real remaining blocker explicitly.',
    `This standard works inside the session's other active Control Room policies (permissions, resource limits, subagent limits), which take precedence.${effortLine}`,
  ].join('\n')
}

export function qaPolicy(): string {
  return [
    '## Release / QA mode (Control Room)',
    'This session is preparing work for release. Correctness outranks speed and scope:',
    '- Prefer fixing, hardening and verifying existing work over starting new features.',
    '- Run the project\'s real validation (tests, type checks, linters, builds) and report the actual results.',
    '- Check regressions around every change, update user-facing docs and changelogs where behaviour changed, and never claim something works without evidence.',
    '- Flag risky changes (data migrations, public API changes, security-sensitive code) explicitly.',
  ].join('\n')
}

export function resourcePolicy(input: {
  level: string
  cpu: number
  ram: number
  maxHeavy: number
  enforcement: ResourceEnforcement
}): string {
  const enforced =
    input.enforcement === 'inform'
      ? 'Control Room reports pressure but does not block commands.'
      : input.enforcement === 'limit'
        ? 'While the machine is over a ceiling, Control Room refuses additional heavy jobs beyond the limit.'
        : 'While the machine is over a ceiling, Control Room refuses any new heavy job.'
  return [
    `## Resource Governor: ${input.level.toUpperCase()} (Control Room)`,
    `The user's machine has ceilings of CPU ${input.cpu}% and RAM ${input.ram}% for all work combined. They are ceilings, not targets: keep your local workload under them.`,
    `- Run at most ${fmt.plural(input.maxHeavy, 'heavy local job')} at a time (builds, full test suites, installs, containers, compilers, benchmarks).`,
    '- Prefer targeted validation (the tests for what changed) before full-suite runs; run a full suite once, at the end, not repeatedly.',
    '- Do not start parallel builds or test suites. Avoid unnecessary watchers and dev servers, and stop background processes you started once they are no longer needed.',
    '- Live pressure notices from Control Room may arrive mid-task; adapt promptly when they do.',
    enforced,
    'Reasoning depth is not limited by this policy — only local machine load is.',
  ].join('\n')
}

/** The tool Control Room offers for milestones where Claude Code has no task list of its own. */
export const MILESTONES_TOOL = {
  name: 'milestones',
  description: [
    'Record the milestones of the work in progress, so the person sees how far the run is (Control Room shows done of total).',
    'Send the whole list each time: when multi-step work starts, and whenever a milestone starts or finishes. Keep it to the real steps of the objective, usually 3 to 10; a quick one-step request needs none.',
    'Mark exactly one milestone in_progress while you work on it, with `doing` in the present tense ("Running regression tests").',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      milestones: {
        type: 'array',
        description: 'Every milestone of the work, in order.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The milestone, in a few words ("Fix the renderer").' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            doing: { type: 'string', description: 'While in progress, what you are doing, in the present tense.' },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['milestones'],
  },
} as const

export function milestonesPolicy(tool: string): string {
  return [
    '## Run progress',
    `The person follows this run's progress in Control Room, counted from your milestones. For work with several steps, record its milestones with the \`${tool}\` tool as you begin (the whole list, 3 to 10 real steps), and send the list again each time a milestone starts or finishes. Give the one in progress a short present-tense \`doing\` line. Skip it for quick one-step requests. After a handoff, record the open milestones the handoff names before continuing.`,
  ].join('\n')
}

export function subagentPolicy(mode: SubagentMode, limit: number): string | null {
  switch (mode) {
    case 'unrestricted':
      return null
    case 'block':
      return '## Subagents (Control Room)\nSubagents are disabled in this session. Do the work directly in the main conversation; do not try to start agents.'
    case 'ask':
      return '## Subagents (Control Room)\nEvery subagent needs the user\'s approval in this session. Start one only when it clearly helps; a refusal is final for that task.'
    case 'limit':
      return `## Subagents (Control Room)\nAt most ${fmt.plural(limit, 'subagent')} may run at the same time in this session. Wait for running agents to finish before starting more, or do the work directly.`
  }
}

export function autopilotPolicy(thresholdTokens: number | null, handoffFile: string): string {
  const at = thresholdTokens === null ? 'its threshold' : `about ${fmt.tokens(thresholdTokens)} tokens`
  return [
    '## Context Autopilot (Control Room)',
    `When this context window reaches ${at}, Control Room will ask you to finish the current logical unit of work and then to write a handoff (including ${handoffFile}) before the context is cleared and a fresh session continues the work. Keep project documentation and handoff notes truthful and current so that a fresh session can pick up without this conversation.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Context Autopilot: mid-turn notice, handoff, continuation.

export function pendingNotice(input: { tokens: number; threshold: number; window: number | undefined }): string {
  const of = input.window ? ` of ${fmt.tokens(input.window)}` : ''
  return [
    `Control Room · Context Autopilot: this context window has reached ${fmt.tokens(input.tokens)} tokens${of} (handoff threshold ${fmt.tokens(input.threshold)}).`,
    'Finish the logical unit of work you are in the middle of and bring it to a clean, consistent state. Do not begin another large task or a new phase of work.',
    'When that unit is complete, end your turn with a brief summary. Control Room will then start the handoff turn (state check, docs, next-session notes) and continue the work in a fresh context.',
  ].join(' ')
}

export function pendingPromptReminder(): string {
  return 'Control Room · Context Autopilot is in HANDOFF PENDING: handle this request, keep the work in a clean, consistent state, and do not start other large tasks. A handoff and fresh-context continuation will follow.'
}

export function handoffPrompt(input: {
  tokens: number | undefined
  window: number | undefined
  handoffFile: string
  runNumber: number | null
  sessionNumber: number
}): string {
  const used = input.tokens === undefined ? '' : ` (${fmt.tokens(input.tokens)}${input.window ? ` of ${fmt.tokens(input.window)}` : ''} tokens used)`
  const where = input.runNumber === null ? '' : ` — run #${input.runNumber}, session ${input.sessionNumber}`
  return [
    `Context Autopilot — final handoff for this context window${used}${where}.`,
    '',
    'This context will be cleared after this turn and a fresh session will continue the work, with no memory of this conversation beyond what you leave in the project. Before that:',
    '',
    '1. Verify the current state of the work: what is done, what is in progress, what is broken or unverified.',
    "2. Update the project's existing documentation and handoff/plan files where they genuinely need it, so they are accurate.",
    '3. Record important unfinished work, open decisions and the current state where appropriate.',
    '4. Run the sensible minimum validation for what changed recently (targeted, within the active resource policy).',
    `5. Create or update \`${input.handoffFile}\` at the project root. Write whatever a fresh session needs to continue effectively — you decide its contents from the project and its existing documentation.`,
    '',
    'Do not start new feature work in this turn. When the handoff is written, end your turn with a short summary.',
  ].join('\n')
}

export function handoffRetryPrompt(handoffFile: string): string {
  return `Control Room could not find an updated \`${handoffFile}\` at the project root. The context will be cleared next, so this file is the fresh session's only link to this work: create or update it now (at the project root), then end your turn.`
}

export function continuationContext(input: {
  runNumber: number | null
  sessionNumber: number
  handoffPath: string
  policies: string[]
  /** The run's milestones as the previous context left its task list. */
  milestones?: readonly { subject: string; status: string }[]
}): string {
  const run = input.runNumber === null ? '' : ` (Control Room run #${input.runNumber}, session ${input.sessionNumber})`
  const lines = [
    `Control Room · Context Autopilot: this is a fresh context continuing earlier work${run}. The previous context was cleared on purpose after a handoff.`,
    `The handoff notes are in ${input.handoffPath}. Read them and the project documentation they point to before acting.`,
  ]
  if (input.policies.length > 0) lines.push(`Active Control Room policies remain in force: ${input.policies.join(', ')}.`)
  const milestones = input.milestones ?? []
  const open = milestones.filter(m => m.status !== 'completed')
  if (open.length > 0) {
    const done = milestones.length - open.length
    const list = open.map(m => `${m.status === 'in_progress' ? '[in progress] ' : ''}${m.subject}`).join('; ')
    lines.push(
      `The run's task list (${done} of ${milestones.length} milestones done) left these open: ${list}. Recreate your task list (or your milestones) from them, checked against the handoff notes, so the run's progress carries on.`,
    )
  }
  return lines.join(' ')
}

export function continuationPrompt(input: { handoffPath: string; sessionNumber: number }): string {
  return [
    `Context Autopilot continuation (session ${input.sessionNumber}). Start by reading \`${input.handoffPath}\` and the project documentation it refers to, then verify the current state of the work.`,
    'Then continue the work autonomously from where the previous session left off.',
    'If the handoff records a decision that genuinely needs the user, ask for it instead of guessing; otherwise keep going.',
  ].join(' ')
}

// ---------------------------------------------------------------------------
// Resource Governor notices (mid-turn, via session.append).

export function pressureNotice(input: {
  level: string
  cpu: number | null
  ram: number | null
  cpuCeiling: number
  ramCeiling: number
  backgroundTasks: string[]
}): string {
  const cpu = input.cpu === null ? 'CPU n/a' : `CPU ${Math.round(input.cpu)}% (ceiling ${input.cpuCeiling}%)`
  const ram = input.ram === null ? 'RAM n/a' : `RAM ${Math.round(input.ram)}% (ceiling ${input.ramCeiling}%)`
  const tasks =
    input.backgroundTasks.length === 0
      ? ''
      : ` Background work you started that is still running: ${input.backgroundTasks.join('; ')} — stop what is no longer needed (TaskStop).`
  return `Control Room · Resource pressure ${input.level.toUpperCase()}: ${cpu}, ${ram}. Reduce local load now: let running heavy jobs finish, do not launch additional builds or test suites until pressure drops, and prefer targeted checks.${tasks}`
}

export function pressureRecoveredNotice(input: { cpu: number | null; ram: number | null }): string {
  const cpu = input.cpu === null ? '' : ` CPU ${Math.round(input.cpu)}%`
  const ram = input.ram === null ? '' : ` RAM ${Math.round(input.ram)}%`
  return `Control Room · Resource pressure is back under the ceilings (${`${cpu}${ram}`.trim()}). Normal pacing within the resource policy may resume.`
}

export function resourceLevelChangedNotice(policy: string | null): string {
  return policy === null
    ? 'Control Room · The Resource Governor was turned off by the user: no machine-load ceilings apply any more.'
    : `Control Room · The user changed the resource policy. It applies from now on:\n${policy}`
}

export function heavyCommandRefusal(input: {
  reason: string
  cpu: number | null
  ram: number | null
  running: string[]
}): string {
  const now = [input.cpu === null ? null : `CPU ${Math.round(input.cpu)}%`, input.ram === null ? null : `RAM ${Math.round(input.ram)}%`]
    .filter(Boolean)
    .join(', ')
  const running = input.running.length === 0 ? '' : ` Already running: ${input.running.join('; ')}.`
  return `Control Room Resource Governor: not starting another heavy job now — ${input.reason}${now === '' ? '' : ` (${now})`}.${running} Wait for running work to finish, run a narrower command (targeted tests, one package), or continue with work that does not load the machine.`
}

// ---------------------------------------------------------------------------
// No-Lazy-Exit Guard.

export function guardBlock(input: { reasons: string[]; items: string[]; attempt: number; max: number }): string {
  const items = input.items.length === 0 ? '' : `\nUnfinished items you mentioned:\n${input.items.map(i => `- ${i}`).join('\n')}`
  return [
    `Control Room · No-Lazy-Exit Guard (${input.attempt}/${input.max}): this looks like a premature stop — ${input.reasons.join('; ')}.${items}`,
    'Complete the remaining in-scope, feasible work yourself now (implementation, tests, cleanup, validation) instead of handing it to the user.',
    'If something is genuinely blocked (missing credentials or access, a decision only the user can make, an action outside your permissions), say exactly that and stop. If everything in scope is done and verified, say so plainly and stop.',
  ].join('\n')
}

export const GUARD_CLASSIFIER_LABELS = ['complete', 'blocked', 'needs_user', 'optional_only', 'premature'] as const

export function guardClassifierText(request: string, answer: string): string {
  return [
    'Decide how an AI coding agent ended its turn.',
    'complete = the requested work is done (and verified where feasible).',
    'blocked = a real external blocker stops it (credentials, access, missing resources, permissions).',
    'needs_user = it needs a genuine decision or information only the user has.',
    'optional_only = the work is done; it merely suggests optional extras.',
    'premature = feasible in-scope work (implementation, tests, cleanup, validation) was left for the user or deferred without a real reason.',
    '',
    `USER REQUEST:\n${request}`,
    '',
    `AGENT'S FINAL MESSAGE:\n${answer}`,
  ].join('\n')
}
