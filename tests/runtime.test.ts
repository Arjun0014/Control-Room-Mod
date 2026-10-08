import { describe, expect, test } from 'claude-code/testing'

import type { ToolCallResult } from 'claude-code'

import type { ResourcesView } from '../types'
import { Runtime } from '../hooks/app/runtime'
import * as Views from '../hooks/app/views'
import { defaultSettings, systemsOf } from '../hooks/core/settings'
import type { Settings } from '../hooks/core/settings'
import { fakeHost, flush } from './fixtures/fake-host'

async function started(patch: (s: Settings) => void, options: Parameters<typeof fakeHost>[0] = {}) {
  const f = fakeHost(options)
  const s = defaultSettings()
  patch(s)
  f.kept.store['settings.v1'] = s
  const rt = new Runtime()
  rt.bind(f.host)
  await rt.onSessionStart({ cwd: options.cwd ?? '/work', surface: 'terminal', isInteractive: true })
  await f.advance(200)
  return { rt, ...f }
}

const step = (tokens: number, stop: 'tool_use' | 'end_turn') => ({
  turnId: 't1',
  index: 0,
  answer: '',
  toolUses: [],
  stopReason: stop,
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
})

describe('runtime', () => {
  test('crossing the threshold mid-turn tells Claude to finish the current unit (no user prompt needed)', async () => {
    const { rt, kept } = await started(s => {
      s.autopilot.enabled = true
      s.autopilot.thresholdMode = 'tokens'
      s.autopilot.thresholdTokens = 100_000
    })
    rt.onTurnStart({ turnId: 't1', text: 'build it' })
    const e = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 }
    rt.stepResponse(e, {}, step(120_000, 'tool_use'))
    await flush()
    expect(rt.autopilot.state).toBe('pending')
    expect(kept.appended.some(t => t.includes('Finish the logical unit of work'))).toBe(true)
  })

  test('the final step of a turn does not send a pointless notice; the turn end starts the handoff', async () => {
    const { rt, kept, live, advance } = await started(s => {
      s.autopilot.enabled = true
      s.autopilot.thresholdMode = 'tokens'
      s.autopilot.thresholdTokens = 100_000
    })
    rt.onTurnStart({ turnId: 't1', text: 'build it' })
    rt.stepResponse({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 }, {}, step(120_000, 'end_turn'))
    expect(kept.appended).toEqual([])
    live.usage = { ...live.usage, context: { tokens: 120_000, window: 1_000_000, percent: 12 } }
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'done' })
    await advance(300)
    expect(kept.submitted.some(t => t.includes('final handoff'))).toBe(true)
  })

  test('changing the resource level or modes tells Claude at once', async () => {
    const { rt, kept } = await started(() => undefined)
    rt.update(s => {
      s.resources.level = 'low'
    })
    rt.update(s => {
      s.frontier.enabled = true
    })
    await flush()
    expect(kept.appended.some(t => t.includes('## Resource Governor: LOW'))).toBe(true)
    expect(kept.appended.some(t => t.includes('Frontier Max is now ON'))).toBe(true)
  })

  test('machine pressure from the sampler reaches Claude, and extra heavy jobs are held back', async () => {
    const { rt, kept, advance } = await started(
      s => {
        s.resources.level = 'medium'
      },
      { cwd: 'C:\\work', samplerLines: ['P 96 1000000 10000000'] },
    )
    await advance(500)
    expect(kept.spawned[0]?.[0]).toBe('windows')
    expect(rt.monitor.pressure.level).toBe('critical')
    expect(kept.appended.some(t => t.includes('Resource pressure CRITICAL'))).toBe(true)
    expect(await rt.beforeTool('Bash', { command: 'npm run build' }, 'b1', undefined)).toBeNull()
    const refusal = await rt.beforeTool('Bash', { command: 'npm test' }, 'b2', undefined)
    expect(refusal).toContain('not starting another heavy job')
    expect(await rt.beforeTool('Bash', { command: 'git status' }, 'b3', undefined)).toBeNull()
  })

  test('live readings without a limit still reach the panel; the status line names them only when high', async () => {
    const { rt, kept, advance } = await started(
      s => {
        s.resources.level = 'off'
        s.ui.liveLoad = true
      },
      { cwd: 'C:\\work', samplerLines: ['P 42 4000000000 10000000000'] },
    )
    await advance(500)
    // No ceilings, so no pressure is evaluated; the readings themselves still show.
    expect(rt.monitor.pressure.level).toBe('unknown')
    const view = kept.published.resources as ResourcesView
    expect(view.status).toBe('live')
    expect(view.cpu).toBe(42)
    expect(view.ram).toBe(60)
    expect(view.ceilings).toBeNull()
    // Calm readings stay in the panel; the status line keeps to the run.
    expect(Views.statusLineOf(Views.hudOf(rt))).not.toContain('CPU')
    expect(Views.hudOf(rt).load?.cpu).toBe(42)
    expect(kept.appended.some(t => t.includes('Resource pressure'))).toBe(false)
  })

  test('a busy machine shows in the status line while it is busy', async () => {
    const { rt, advance } = await started(
      s => {
        s.resources.level = 'off'
        s.ui.liveLoad = true
      },
      { cwd: 'C:\\work', samplerLines: ['P 42 800000000 10000000000'] },
    )
    await advance(500)
    expect(Views.statusLineOf(Views.hudOf(rt))).toContain('RAM 92%')
    expect(Views.statusLineOf(Views.hudOf(rt))).not.toContain('CPU')
  })

  test('a person\'s /clear rolls the chain over and resets the turn state; ours carries the continuation context', async () => {
    const { rt, live } = await started(s => {
      s.autopilot.enabled = true
    })
    live.sessionId = 'S2'
    await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S2' })
    expect(rt.takeFreshContext()).toBeNull()
    expect(rt.run?.sessions.map(s => s.end)).toEqual(['clear', null])
    rt.autopilot = { ...rt.autopilot, state: 'clearing' }
    await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S3' })
    // The fresh context's first message carries the notes, once.
    expect(rt.takeFreshContext()).toContain('NEXT_SESSION_PROMPT.md')
    expect(rt.takeFreshContext()).toBeNull()
    expect(rt.run?.sessions.map(s => s.start)).toEqual(['startup', 'clear', 'handoff'])
  })

  test('a /clear that never resets the session is a failed clear: compaction takes over', async () => {
    const { rt, kept, advance } = await started(s => {
      s.autopilot.enabled = true
    })
    rt.autopilot = { ...rt.autopilot, state: 'awaiting' }
    rt.startFreshContext()
    await advance(2000)
    expect(kept.commands).toContain('clear')
    expect(rt.autopilot.state).toBe('clearing')
    await advance(16_000)
    expect(rt.autopilot.lastError).toBe('the context was not cleared')
    expect(kept.compacted).toBe(1)
  })

  test('a /clear whose fresh session start goes unseen still counts once the session id changed', async () => {
    const { rt, kept, live, advance } = await started(s => {
      s.autopilot.enabled = true
    })
    rt.autopilot = { ...rt.autopilot, state: 'awaiting' }
    rt.startFreshContext()
    await advance(2000)
    live.sessionId = 'S2'
    await advance(16_000)
    expect(kept.compacted).toBe(0)
    expect(kept.submitted.some(t => t.includes('Context Autopilot continuation'))).toBe(true)
  })

  test('a handoff waiting by choice reads calm; one that went wrong reads red', async () => {
    const { rt } = await started(s => {
      s.autopilot.enabled = true
    })
    rt.autopilot = { ...rt.autopilot, state: 'awaiting', lastError: null }
    expect(Views.hudOf(rt).alert).toMatchObject({ kind: 'awaiting', tone: 'accent' })
    expect(Views.autopilotStatus(rt).tone).toBe('accent')
    rt.autopilot = { ...rt.autopilot, lastError: 'the context was not cleared' }
    expect(Views.hudOf(rt).alert).toMatchObject({ kind: 'awaiting', tone: 'bad' })
    expect(Views.autopilotStatus(rt).tone).toBe('bad')
  })

  test('the guard blocks at most the configured number of times per turn', async () => {
    const { rt } = await started(s => {
      s.guard.enabled = true
      s.guard.modelCheck = false
      s.guard.maxPerTurn = 1
    })
    rt.onPromptSubmit('Implement the parser and tests', { kind: 'composer' })
    rt.onTurnStart({ turnId: 't1', text: 'Implement the parser and tests' })
    const lazy = "You'll need to implement the rest yourself. TODO: errors."
    expect(await rt.onStop({ stopHookActive: false, lastMessage: lazy, background: [], wakeups: [], permissionMode: 'default' })).toContain('No-Lazy-Exit Guard')
    expect(await rt.onStop({ stopHookActive: true, lastMessage: `${lazy} Also docs.`, background: [], wakeups: [], permissionMode: 'default' })).toBeNull()
  })

  test('the guard stands down while a handoff is pending', async () => {
    const { rt } = await started(s => {
      s.guard.enabled = true
      s.guard.modelCheck = false
      s.autopilot.enabled = true
      s.autopilot.thresholdMode = 'tokens'
      s.autopilot.thresholdTokens = 50_000
    })
    rt.onTurnStart({ turnId: 't1', text: 'Implement the parser and tests' })
    rt.stepResponse({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 }, {}, step(60_000, 'tool_use'))
    expect(rt.autopilot.state).toBe('pending')
    expect(await rt.onStop({ stopHookActive: false, lastMessage: "You'll need to finish it yourself. TODO.", background: [], wakeups: [], permissionMode: 'default' })).toBeNull()
  })

  test('settings survive a new Runtime (persistence) and invalid stored values are repaired', async () => {
    const f = fakeHost()
    f.kept.store['settings.v1'] = { frontier: { enabled: true, effort: 'ludicrous' }, permissions: { dangerous: 'allow' } }
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(rt.settings.frontier.enabled).toBe(true)
    expect(rt.settings.frontier.effort).toBe('max')
    // Allow was removed in 1.4.0: a saved one reads as Default (Claude Code decides), never Ask.
    expect(rt.settings.permissions.dangerous).toBe('default')
    expect(rt.notes.join(' ')).toContain('reset to safe defaults')
  })

  test('a saved Allow reads as Default, in the settings and custom profiles alike, is named once and saved so', async () => {
    const f = fakeHost()
    const custom = { id: 'fast', name: 'Fast', createdAt: 1, systems: { ...systemsOf(defaultSettings()), permissions: { ...defaultSettings().permissions, delete: 'allow', install: 'allow' } } }
    f.kept.store['settings.v1'] = { ...defaultSettings(), permissions: { ...defaultSettings().permissions, delete: 'allow', network: 'allow' }, customProfiles: [custom] }
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(rt.settings.permissions.delete).toBe('default')
    expect(rt.settings.permissions.network).toBe('default')
    expect(rt.settings.customProfiles[0]?.systems.permissions.delete).toBe('default')
    expect(rt.settings.customProfiles[0]?.systems.permissions.install).toBe('default')
    const note = rt.notes.join(' ')
    expect(note).toContain('Allow was removed')
    expect(note).toContain('Deleting files')
    expect(note).toContain('Network access')
    expect(note).toContain('Package installs')
    expect(note).not.toContain('reset to safe defaults')
    await f.advance(2000)
    const saved = f.kept.store['settings.v1'] as Settings
    expect(saved.permissions.delete).toBe('default')
    expect(saved.customProfiles[0]?.systems.permissions.install).toBe('default')
    // Saved once: the next session has nothing to say about it.
    const next = new Runtime()
    next.bind(f.host)
    await next.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(next.notes.join(' ')).not.toContain('Allow was removed')
  })

  test('a reload in the middle of a handoff carries it on instead of starting a second one', async () => {
    const { rt, kept, live, advance, host } = await started(s => {
      s.autopilot.enabled = true
      s.autopilot.thresholdMode = 'tokens'
      s.autopilot.thresholdTokens = 100_000
    })
    rt.onTurnStart({ turnId: 't1', text: 'build it' })
    live.usage = { ...live.usage, context: { tokens: 120_000, window: 1_000_000, percent: 12 } }
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'done' })
    await advance(300)
    expect(rt.autopilot.state).toBe('requested')
    // The handoff moves on when its own turn begins, recognised by its prompt, not when the prompt was sent.
    await rt.onTurnStart({ turnId: 't2', text: kept.submitted.at(-1)! })
    expect(rt.autopilot.state).toBe('handoff')
    expect(kept.submitted.filter(t => t.includes('final handoff')).length).toBe(1)
    expect(kept.autopilotRecord?.state).toBe('handoff')

    // The plugin reloads while Claude writes the notes: a fresh Runtime over the same engine state.
    const reloaded = new Runtime()
    reloaded.bind(host)
    await reloaded.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await advance(200)
    expect(reloaded.autopilot.state).toBe('handoff')
    // The handoff turn ends with the context still past the threshold: no second handoff prompt.
    await reloaded.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'notes written' })
    await advance(3000)
    expect(kept.submitted.filter(t => t.includes('final handoff')).length).toBe(1)
    expect(kept.commands).toContain('clear')
  })

  test('after a reload, milestones finished earlier are not counted as this turn’s', async () => {
    const { rt, advance, host } = await started(() => undefined)
    rt.onTurnStart({ turnId: 't1', text: 'build it' })
    rt.recordMilestones({ milestones: [{ title: 'A', status: 'completed' }, { title: 'B', status: 'completed' }, { title: 'C', status: 'in_progress' }] }, undefined)
    expect(Views.activityOf(rt).turnSummary.lines).toContain('Finished 2 milestones')
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'done' })
    await advance(3000)
    const reloaded = new Runtime()
    reloaded.bind(host)
    await reloaded.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await advance(200)
    expect(reloaded.progress().done).toBe(2)
    expect(Views.activityOf(reloaded).turnSummary.lines.join(' ')).not.toContain('Finished')
  })

  test('across a fresh context the context meter starts over; work progress and the run cost carry on', async () => {
    const { rt, kept, advance } = await started(() => undefined)
    rt.onPromptSubmit('Rebuild the renderer and keep the tests green.', { kind: 'composer' })
    rt.onTurnStart({ turnId: 't1', text: 'Rebuild the renderer and keep the tests green.' })
    const todos = [
      { content: 'Profile the renderer', status: 'completed', activeForm: 'Profiling the renderer' },
      { content: 'Rewrite the hot loop', status: 'in_progress', activeForm: 'Rewriting the hot loop' },
      { content: 'Run the regression suite', status: 'pending', activeForm: 'Running the regression suite' },
    ]
    await rt.beforeTool('TodoWrite', { todos }, 'u1', undefined)
    rt.afterTool('TodoWrite', { todos }, 'u1', { result: { oldTodos: [], newTodos: todos } } as unknown as ToolCallResult)
    expect(Views.hudOf(rt).work).toEqual({ done: 1, total: 3, current: 'Rewriting the hot loop', track: ['done', 'now', 'open'] })
    expect(Views.hudOf(rt).now?.text).toBe('Rewriting the hot loop')
    // The headline says it in Claude's words, with where it sits in the plan.
    expect(Views.hudOf(rt).headline).toEqual({ state: 'working', text: 'Rewriting the hot loop', detail: 'step 2 of 3', tone: 'info' })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'done' })
    await advance(2000)
    const runKey = Object.keys(kept.store).find(k => k.startsWith('run.v1.'))!
    expect((kept.store[runKey] as { plan: { tasks: unknown[] } }).plan.tasks).toHaveLength(3)

    await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S2' })
    expect(rt.usage.tokens).toBeUndefined()
    const hud = Views.hudOf(rt)
    expect(hud.work).toEqual({ done: 1, total: 3, current: 'Rewriting the hot loop', track: ['done', 'now', 'open'] })
    // The first session's $0.50 stays in the run's cost while the fresh session starts at nothing.
    expect(hud.cost.runUsd).toBe(0.5)
    expect(Views.missionOf(rt).objective).toBe('Rebuild the renderer and keep the tests green.')
    expect(Views.missionOf(rt).session).toBe(2)
  })

  test('without a task list in Claude Code, Claude gets the milestones tool and a policy; with one, nothing is added', async () => {
    const { rt, kept } = await started(() => undefined)
    expect(kept.registeredTools).toEqual(['milestones'])
    expect(rt.planSource).toBe('milestones')
    expect(rt.policies().map(s => s.name)).toContain('Run progress')
    const answer = rt.recordMilestones({ milestones: [{ title: 'Fix the parser', status: 'completed' }, { title: 'Add tests', status: 'in_progress', doing: 'Adding tests' }] }, undefined)
    expect(answer).toContain('1 of 2 milestones done')
    expect(Views.hudOf(rt).work).toEqual({ done: 1, total: 2, current: 'Adding tests', track: ['done', 'now'] })
    // A subagent's list is its own.
    rt.recordMilestones({ milestones: [{ title: 'Other', status: 'pending' }] }, 'agent-1')
    expect(Views.hudOf(rt).work?.total).toBe(2)

    const f = fakeHost()
    f.live.tools = ['Bash', 'TodoWrite']
    const withTasks = new Runtime()
    withTasks.bind(f.host)
    await withTasks.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(f.kept.registeredTools).toEqual([])
    expect(withTasks.planSource).toBe('tasks')
    expect(withTasks.policies().map(s => s.name)).not.toContain('Run progress')
  })

  test('a fresh context that starts near the handoff point gets room to work: the live loop, replayed', async () => {
    // Live on 2.1.293: hands off at 64k, a base of about 60k; every fresh context handed off after its first turn.
    const { rt, kept, live, advance } = await started(s => {
      s.autopilot.enabled = true
      s.autopilot.thresholdMode = 'tokens'
      s.autopilot.thresholdTokens = 64_000
    })
    const at = (turnId: string, index: number, tokens: number, stop: 'tool_use' | 'end_turn') => rt.stepResponse({ turnId, index, model: 'claude-opus-5-5', messageCount: 3 }, {}, { ...step(tokens, stop), turnId, index })
    rt.onTurnStart({ turnId: 't1', text: 'Work through the roadmap.' })
    at('t1', 0, 66_000, 'tool_use')
    await flush()
    expect(rt.autopilot.state).toBe('pending')
    live.usage = { ...live.usage, context: { tokens: 69_000, window: 1_000_000, percent: 7 } }
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'step 1 done' })
    await advance(300)
    const handoff = kept.submitted.at(-1) ?? ''
    await rt.onTurnStart({ turnId: 'h1', text: `The control-room plugin sent a message:\n${handoff}` })
    expect(rt.autopilot.state).toBe('handoff')
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'handoff written' })
    await advance(2000)
    expect(kept.commands).toContain('clear')
    live.sessionId = 'S2'
    await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S2' })
    await advance(1000)
    const continuation = kept.submitted.at(-1) ?? ''
    expect(continuation).toContain('Context Autopilot continuation')
    await rt.onTurnStart({ turnId: 'c1', text: `The control-room plugin sent a message:\n${continuation}` })
    expect(rt.autopilot.state).toBe('armed')
    // Reading itself in, as seen live: 44k at the first request, 66k after the notes, the docs and the code.
    at('c1', 0, 44_000, 'tool_use')
    at('c1', 1, 66_000, 'tool_use')
    await flush()
    expect(rt.autopilot.state).toBe('armed')
    // It starts working by sending its milestones: room from 66k, so it hands off at 86k, said once.
    rt.recordMilestones({ milestones: [{ title: 'Temperature module', status: 'completed' }, { title: 'Pressure module', status: 'in_progress', doing: 'Writing the pressure module' }] }, undefined)
    await flush()
    expect(Views.hudOf(rt).ctx.threshold).toBe(86_000)
    expect(kept.toasts.some(t => t.includes('hands off at 86k'))).toBe(true)
    at('c1', 2, 74_000, 'tool_use')
    await flush()
    expect(rt.autopilot.state).toBe('armed')
    live.usage = { ...live.usage, context: { tokens: 78_000, window: 1_000_000, percent: 8 } }
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'steps 2 and 3 done' })
    await advance(300)
    expect(rt.autopilot.state).toBe('armed')
    expect(kept.submitted.filter(t => t.includes('final handoff')).length).toBe(1)
  })

  test('views are published for every render site', async () => {
    const { kept } = await started(() => undefined)
    for (const key of ['hud', 'pane', 'resources', 'chain', 'activity', 'permissions', 'focus', 'spinner']) {
      expect(kept.published[key], key).toBeDefined()
    }
  })
})
