import { describe, expect, test } from 'claude-code/testing'

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
    expect(kept.spawned[0]?.[0]).toBe('powershell.exe')
    expect(rt.monitor.pressure.level).toBe('critical')
    expect(kept.appended.some(t => t.includes('Resource pressure CRITICAL'))).toBe(true)
    expect(await rt.beforeTool('Bash', { command: 'npm run build' }, 'b1', undefined)).toBeNull()
    const refusal = await rt.beforeTool('Bash', { command: 'npm test' }, 'b2', undefined)
    expect(refusal).toContain('not starting another heavy job')
    expect(await rt.beforeTool('Bash', { command: 'git status' }, 'b3', undefined)).toBeNull()
  })

  test('live readings without a limit still reach the panel and the status line', async () => {
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
    expect(Views.statusLineOf(Views.hudOf(rt))).toContain('CPU 42% · RAM 60%')
    expect(kept.appended.some(t => t.includes('Resource pressure'))).toBe(false)
  })

  test('a person\'s /clear rolls the chain over and resets the turn state; ours carries the continuation context', async () => {
    const { rt, live } = await started(s => {
      s.autopilot.enabled = true
    })
    live.sessionId = 'S2'
    const external = await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S2' })
    expect(external).toEqual([])
    expect(rt.run?.sessions.map(s => s.end)).toEqual(['clear', null])
    rt.autopilot = { ...rt.autopilot, state: 'clearing' }
    const ours = await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S3' })
    expect(ours.join(' ')).toContain('NEXT_SESSION_PROMPT.md')
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
    expect(await rt.onStop({ stopHookActive: false, lastMessage: lazy, backgroundCount: 0, permissionMode: 'default' })).toContain('No-Lazy-Exit Guard')
    expect(await rt.onStop({ stopHookActive: true, lastMessage: `${lazy} Also docs.`, backgroundCount: 0, permissionMode: 'default' })).toBeNull()
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
    expect(await rt.onStop({ stopHookActive: false, lastMessage: "You'll need to finish it yourself. TODO.", backgroundCount: 0, permissionMode: 'default' })).toBeNull()
  })

  test('settings survive a new Runtime (persistence) and invalid stored values are repaired', async () => {
    const f = fakeHost()
    f.kept.store['settings.v1'] = { frontier: { enabled: true, effort: 'ludicrous' }, permissions: { dangerous: 'allow' } }
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(rt.settings.frontier.enabled).toBe(true)
    expect(rt.settings.frontier.effort).toBe('max')
    expect(rt.settings.permissions.dangerous).toBe('ask')
    expect(rt.notes.join(' ')).toContain('reset to safe defaults')
  })

  test('a saved Allow for deleting files reads as Ask, is named once, and is saved tightened', async () => {
    const f = fakeHost()
    const custom = { id: 'fast', name: 'Fast', createdAt: 1, systems: { ...systemsOf(defaultSettings()), permissions: { ...defaultSettings().permissions, delete: 'allow' } } }
    f.kept.store['settings.v1'] = { ...defaultSettings(), permissions: { ...defaultSettings().permissions, delete: 'allow' }, customProfiles: [custom] }
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(rt.settings.permissions.delete).toBe('ask')
    expect(rt.settings.customProfiles[0]?.systems.permissions.delete).toBe('ask')
    expect(rt.notes.join(' ')).toContain('Deleting files no longer offers Allow')
    expect(rt.notes.join(' ')).not.toContain('reset to safe defaults')
    await f.advance(2000)
    expect((f.kept.store['settings.v1'] as Settings).permissions.delete).toBe('ask')
  })

  test('views are published for every render site', async () => {
    const { kept } = await started(() => undefined)
    for (const key of ['hud', 'pane', 'resources', 'chain', 'activity', 'permissions', 'focus', 'spinner']) {
      expect(kept.published[key], key).toBeDefined()
    }
  })
})
