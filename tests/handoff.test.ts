import { describe, expect, test } from 'claude-code/testing'

import type { ToolCallResult } from 'claude-code'

import { Runtime } from '../hooks/app/runtime'
import * as Views from '../hooks/app/views'
import { defaultSettings } from '../hooks/core/settings'
import type { Settings } from '../hooks/core/settings'
import { type HandoffRecord, continuityOf, continuityToast, handoffRecordOf, healthOf, scoreOf } from '../hooks/features/handoff'
import { emptyPlan, fromMilestones, planOf, progressOf } from '../hooks/features/plan'
import { continuationContext, handoffPrompt } from '../hooks/features/prompts'
import { fakeHost } from './fixtures/fake-host'

const facts = {
  hasPlan: true,
  isPlanUpdated: true,
  current: { key: 'rewrite the hot loop', subject: 'Rewrite the hot loop' },
  isPlanSettled: false,
  isNotesWritten: true,
  handoffFile: 'NEXT_SESSION_PROMPT.md',
  docsEdited: ['/work/README.md', '/work/docs/DESIGN.md'],
  checks: [{ label: 'Tests', status: 'passing' }],
  isClaudeMdEdited: false,
}

const record = (patch: Partial<HandoffRecord> = {}): HandoffRecord => ({
  at: 1,
  fromSession: 1,
  toSession: 2,
  via: 'clear',
  health: healthOf(facts),
  currentKey: 'rewrite the hot loop',
  currentSubject: 'Rewrite the hot loop',
  done: 1,
  total: 3,
  continuity: null,
  ...patch,
})

const picked = {
  handoffFile: 'NEXT_SESSION_PROMPT.md',
  reads: ['/work/NEXT_SESSION_PROMPT.md', '/work/README.md'],
  isDoc: (p: string) => p.endsWith('.md'),
  isPlanUpdated: true,
  tasks: [
    { key: 'profile', subject: 'Profile', status: 'completed' },
    { key: 'rewrite the hot loop', subject: 'Rewrite the hot loop', status: 'in_progress' },
    { key: 'run the suite', subject: 'Run the suite', status: 'pending' },
  ],
  done: 1,
  current: { key: 'rewrite the hot loop', subject: 'Rewrite the hot loop' },
  edits: 2,
  checks: 0,
}

describe('run state', () => {
  test('milestones may be verifying, with their evidence, or blocked, with what blocks them', () => {
    const plan = fromMilestones(
      emptyPlan(),
      {
        milestones: [
          { title: 'Fix the parser', status: 'completed', evidence: '42 of 42 tests pass' },
          { title: 'Port the renderer', status: 'verifying', doing: 'Checking the golden images', evidence: 'golden images match' },
          { title: 'Deploy', status: 'blocked', blocker: 'needs the deploy key' },
          { title: 'Write the docs', status: 'pending' },
        ],
      },
      1,
      1000,
    )
    const p = progressOf(plan)
    expect(p.done).toBe(1)
    expect(p.current?.subject).toBe('Port the renderer')
    expect(p.current?.detail).toBe('golden images match')
    expect(p.blocked.map(t => [t.subject, t.detail])).toEqual([['Deploy', 'needs the deploy key']])
    expect(p.next?.subject).toBe('Write the docs')
    // Stored and read back, nothing is lost.
    expect(planOf(JSON.parse(JSON.stringify(plan))).tasks.map(t => t.detail)).toEqual(['42 of 42 tests pass', 'golden images match', 'needs the deploy key', null])
    // The fresh context is told which are being verified and what blocks the others.
    const context = continuationContext({ runNumber: 3, sessionNumber: 4, handoffPath: '/w/NEXT_SESSION_PROMPT.md', policies: [], milestones: plan.tasks })
    expect(context).toContain('[verifying] Port the renderer')
    expect(context).toContain('[blocked: needs the deploy key] Deploy')
  })

  test('the handoff prompt names the four places, each for what it is for, without prescribing the notes', () => {
    const prompt = handoffPrompt({ tokens: 712_000, window: 1_000_000, handoffFile: 'NEXT_SESSION_PROMPT.md', runNumber: 3, sessionNumber: 4, planTool: 'mcp__control-room__milestones' })
    expect(prompt).toContain('`mcp__control-room__milestones`')
    expect(prompt).toContain('canonical record of progress')
    expect(prompt).toContain('blocked with its blocker')
    expect(prompt).toContain("The project's own documentation")
    expect(prompt).toContain('CLAUDE.md: only for durable instructions')
    expect(prompt).toContain('Never use it as a progress log')
    expect(prompt).toContain('the prompt you would want to receive')
    expect(prompt).toContain('You decide its contents')
    // Claude Code's own task list knows no verifying or blocked; without any, run state is not asked for.
    expect(handoffPrompt({ tokens: undefined, window: undefined, handoffFile: 'N.md', runNumber: null, sessionNumber: 1, planTool: 'your task list (TodoWrite or the Task tools)' })).not.toContain('blocker')
    expect(handoffPrompt({ tokens: undefined, window: undefined, handoffFile: 'N.md', runNumber: null, sessionNumber: 1, planTool: null })).not.toContain('milestones')
  })
})

describe('handoff health', () => {
  test('counts what the handoff left in each place; what was not needed is neither good nor missing', () => {
    const all = healthOf(facts)
    expect(all.map(c => [c.id, c.state])).toEqual([
      ['runState', 'ok'],
      ['milestone', 'ok'],
      ['notes', 'ok'],
      ['docs', 'ok'],
      ['validation', 'ok'],
      ['claudeMd', 'none'],
    ])
    expect(all.find(c => c.id === 'docs')?.detail).toBe('README.md, DESIGN.md')
    expect(all.find(c => c.id === 'validation')?.detail).toBe('Tests passing')
    expect(scoreOf(all)).toMatchObject({ ok: 5, of: 5 })
    const thin = healthOf({ ...facts, isPlanUpdated: false, current: null, docsEdited: [], checks: [], isNotesWritten: false })
    expect(thin.filter(c => c.state === 'missing').map(c => c.id)).toEqual(['runState', 'milestone', 'notes', 'validation'])
    expect(scoreOf(thin)).toMatchObject({ ok: 0, of: 4 })
    // A run with no milestones at all is not marked down for them.
    expect(healthOf({ ...facts, hasPlan: false }).slice(0, 2).map(c => c.state)).toEqual(['none', 'none'])
    // Seen live: the handoff came between milestones (one done, the next not begun) with the list just sent: a clean stop.
    const between = healthOf({ ...facts, current: null, next: { subject: 'Pressure module' } }).find(c => c.id === 'milestone')
    expect(between).toMatchObject({ state: 'ok', detail: 'Next: Pressure module' })
    // Without the list sent again, nothing says where the work stands.
    expect(healthOf({ ...facts, isPlanUpdated: false, current: null, next: { subject: 'Pressure module' } }).find(c => c.id === 'milestone')?.state).toBe('missing')
  })

  test('continuity: the notes and docs read, the run state restored, the milestone picked up, the work resumed', () => {
    const ok = continuityOf(picked, record())
    expect(ok.every(c => c.state === 'ok')).toBe(true)
    expect(continuityToast(ok)).toBe('Fresh context picked up the work: 5 of 5 checks')
    // Moving on to a later milestone counts as picking up; starting over at an earlier one does not.
    const later = continuityOf({ ...picked, tasks: [{ key: 'run the suite', subject: 'Run the suite', status: 'in_progress' }], done: 2, current: { key: 'run the suite', subject: 'Run the suite' } }, record())
    expect(later.find(c => c.id === 'milestone')).toMatchObject({ state: 'ok', detail: 'Moved on: Run the suite' })
    const earlier = continuityOf({ ...picked, tasks: [{ key: 'profile', subject: 'Profile', status: 'in_progress' }, { key: 'rewrite the hot loop', subject: 'Rewrite the hot loop', status: 'pending' }], done: 0, current: { key: 'profile', subject: 'Profile' } }, record())
    expect(earlier.find(c => c.id === 'milestone')?.state).toBe('missing')
    const lazy = continuityOf({ ...picked, reads: [], isPlanUpdated: false, edits: 0 }, record())
    expect(lazy.filter(c => c.state === 'missing').map(c => c.id)).toEqual(['notesRead', 'runState', 'milestone', 'docsRead', 'resumed'])
    expect(continuityToast(lazy)).toContain('0 of 5: handoff notes read, run state restored')
  })

  test('a stored record is validated: anything malformed reads as none', () => {
    const stored = JSON.parse(JSON.stringify(record({ continuity: continuityOf(picked, record()) })))
    expect(handoffRecordOf(stored)).toEqual(stored)
    expect(handoffRecordOf({ at: 'yesterday' })).toBeNull()
    expect(handoffRecordOf({ ...stored, health: [{ id: 'x', label: 'X', state: 'great', detail: 7 }] })?.health).toEqual([{ id: 'x', label: 'X', state: 'none', detail: '' }])
  })
})

let ids = 0

/** One tool call of the main conversation, answered with `result`. */
async function call(rt: Runtime, tool: string, input: Record<string, unknown>, result: unknown = { stdout: 'ok', stderr: '', interrupted: false }) {
  const id = `u${++ids}`
  await rt.beforeTool(tool, input, id, undefined)
  rt.afterTool(tool, input, id, { result } as ToolCallResult)
}

const edit = (file: string) => [{ file_path: file, old_string: 'a', new_string: 'b\nc' }, { filePath: file, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }] }] as const

describe('handoff and continuity, end to end', () => {
  test('a handoff records what it left; the fresh context’s first turn is checked against it, and a toast says how it went', async () => {
    const f = fakeHost()
    const s: Settings = defaultSettings()
    s.autopilot.enabled = true
    f.kept.store['settings.v1'] = s
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await f.advance(200)
    const milestones = (current: string) => ({
      milestones: [
        { title: 'Profile the renderer', status: 'completed', evidence: 'flame graph taken' },
        { title: 'Rewrite the hot loop', status: current, doing: 'Rewriting the hot loop' },
        { title: 'Run the suite', status: 'pending' },
      ],
    })

    // The work so far, in the first context: milestones and a passing check.
    rt.onPromptSubmit('Rebuild the renderer and keep the tests green.', { kind: 'composer' })
    rt.onTurnStart({ turnId: 't1', text: 'Rebuild the renderer and keep the tests green.' })
    rt.recordMilestones(milestones('in_progress'), undefined)
    await call(rt, 'Bash', { command: 'npm test' })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'progress' })

    // The handoff turn: milestones sent again, a doc updated, the notes written.
    rt.requestHandoff()
    await f.advance(300)
    const prompt = f.kept.submitted.at(-1) ?? ''
    expect(prompt).toContain('`mcp__control-room__milestones`')
    rt.onTurnStart({ turnId: 'h1', text: prompt })
    rt.recordMilestones(milestones('in_progress'), undefined)
    const [docInput, docResult] = edit('/work/README.md')
    await call(rt, 'Edit', { ...docInput }, docResult)
    await call(rt, 'Write', { file_path: '/work/NEXT_SESSION_PROMPT.md', content: 'notes' }, { type: 'create', filePath: '/work/NEXT_SESSION_PROMPT.md', content: 'notes', structuredPatch: [], originalFile: null })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'handoff written' })
    await f.advance(100)
    const before = Views.paneOf(rt).handoff
    expect(before?.health.map(c => [c.id, c.state])).toEqual([
      ['runState', 'ok'],
      ['milestone', 'ok'],
      ['notes', 'ok'],
      ['docs', 'ok'],
      ['validation', 'ok'],
      ['claudeMd', 'none'],
    ])
    expect(before?.continuity).toBeNull()

    // Control Room clears the context; the fresh session starts and the continuation goes in.
    await f.advance(1300)
    expect(f.kept.commands).toContain('clear')
    f.live.sessionId = 'S2'
    await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S2' })
    await f.advance(600)
    expect(f.kept.submitted.at(-1)).toContain('Context Autopilot continuation')
    expect(Views.paneOf(rt).handoff).toMatchObject({ fromSession: 1, toSession: 2, isChecking: true })

    // The fresh context's first turn: it reads the notes and the README, restores the milestones and carries on.
    rt.onTurnStart({ turnId: 'c1', text: f.kept.submitted.at(-1) ?? '' })
    await call(rt, 'Read', { file_path: '/work/NEXT_SESSION_PROMPT.md' }, { type: 'text', file: { filePath: '/work/NEXT_SESSION_PROMPT.md', content: 'notes' } })
    await call(rt, 'Read', { file_path: '/work/README.md' }, { type: 'text', file: { filePath: '/work/README.md', content: 'readme' } })
    rt.recordMilestones(milestones('in_progress'), undefined)
    const [codeInput, codeResult] = edit('/work/src/render.ts')
    await call(rt, 'Edit', { ...codeInput }, codeResult)
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'carrying on' })
    const after = Views.paneOf(rt).handoff
    expect(after?.isChecking).toBe(false)
    expect(after?.continuity?.map(c => [c.id, c.state])).toEqual([
      ['notesRead', 'ok'],
      ['runState', 'ok'],
      ['milestone', 'ok'],
      ['docsRead', 'ok'],
      ['resumed', 'ok'],
    ])
    expect(f.kept.toasts).toContain('Fresh context picked up the work: 5 of 5 checks')
    // Kept with the run: a reload or a restart still shows it.
    await f.advance(2000)
    const runKey = Object.keys(f.kept.store).find(k => k.startsWith('run.v1.'))!
    expect(handoffRecordOf((f.kept.store[runKey] as { lastHandoff: unknown }).lastHandoff)?.continuity?.length).toBe(5)
  })
})
