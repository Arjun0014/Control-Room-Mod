import { describe, expect, test } from 'claude-code/testing'

import { defaultSettings } from '../hooks/core/settings'
import type { Settings } from '../hooks/core/settings'
import { SESSION, world } from './fixtures/world'

const PRESENTATION = { isFullscreen: true, columns: 120 }
const cmd = (command: string, args = '') => ({ command, args, origin: { kind: 'composer' as const }, presentation: PRESENTATION })
const spawnInput = (prompt: string) => ({
  tool_use_id: 'tu-1',
  prompt,
  description: 'scan',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal' as const], tools: [], outputStyle: null, traits: [] }

const withSettings = (patch: (s: Settings) => void): Settings => {
  const s = defaultSettings()
  patch(s)
  return s
}

describe('register', () => {
  test('the start registers /control-room and the /cr alias', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    expect(w.kept.registered).toContain('control-room')
    expect(w.kept.registered).toContain('cr')
    const { text } = await $.command.run(cmd('control-room', 'status'))
    expect(text).toContain('◆ Control Room')
    expect(text).toContain('Run 1')
  })

  test('/cr sub-commands change settings and persist them', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const r = await $.command.run(cmd('cr', 'autopilot 65%'))
    expect(r.text).toBe('Autopilot on. Hands off at 65%.')
    await w.clock.advance(2000)
    const saved = w.store['settings.v1'] as Settings
    expect(saved.autopilot.enabled).toBe(true)
    expect(saved.autopilot.thresholdPercent).toBe(65)
    await $.command.run(cmd('cr', 'profile frontier'))
    await w.clock.advance(2000)
    expect((w.store['settings.v1'] as Settings).frontier.enabled).toBe(true)
  })

  test('/cr cache tells the cache in words and sets Keep warm, its idle limit and the other cache settings', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    const status = await $.command.run(cmd('cr', 'cache'))
    expect(status.text).toContain('◆ Prompt cache')
    expect(status.text).toContain('Nothing cached yet')
    expect(status.text).toContain('derived')
    expect((await $.command.run(cmd('cr', 'cache keep on'))).text).toContain('Keep warm on.')
    expect((await $.command.run(cmd('cr', 'cache idle 45m'))).text).toBe('Keep warm stops after 45 min idle.')
    expect((await $.command.run(cmd('cr', 'cache stable off'))).text).toBe('Keep policies stable off.')
    expect((await $.command.run(cmd('cr', 'cache guard off'))).text).toBe('Ask before a model switch off.')
    expect((await $.command.run(cmd('cr', 'cache sideways'))).text).toContain('Usage: /cr cache')
    await w.clock.advance(2000)
    expect((w.store['settings.v1'] as Settings).cache).toMatchObject({ keepWarm: true, maxIdleMinutes: 45, stablePolicies: false, guardModelSwitch: false })
    expect((await $.command.run(cmd('cr', 'status'))).text).toContain('Prompt cache')
  })

  test('a model switch that would lose a large warm cache is put to the person first, with what it re-sends', async ($, on) => {
    world(on)
    on('classic.PreModelSwitch', () => ({}))
    on('classic.PostModelSwitch', () => ({}))
    await $.session.start(SESSION)
    const input = { from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'command' as const, context_tokens: 412_000, prompt_cache_warm: true, cache_ttl: '1h' as const, estimated_cache_write_usd: 2.06, pricing: 'catalog' as const }
    const asked = await $.classic.PreModelSwitch(input)
    expect(asked.permissionDecision).toBe('ask')
    expect(asked.permissionDecisionReason).toContain('412k tokens')
    expect(asked.permissionDecisionReason).toContain('about $2.06')
    const cold = await $.classic.PreModelSwitch({ ...input, prompt_cache_warm: false })
    expect(cold.permissionDecision).toBeUndefined()
    const scripted = await $.classic.PreModelSwitch({ ...input, source: 'sdk' as const })
    expect(scripted.permissionDecision).toBeUndefined()
    await $.classic.PostModelSwitch({ ...input, source: 'command' as const })
    expect((await $.command.run(cmd('cr', 'cache'))).text).toContain('1 hour (as Claude Code reports it)')
  })

  test('Deny categories are refused before anything runs', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const dangerous = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })
    expect(dangerous.deny).toContain('Permission Policy')
    const force = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
    expect(force.deny).toContain('Force push & destructive Git')
    const fine = await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(fine.deny).toBeUndefined()
  })

  test('Ask tightens an engine allow; Allow answers an engine ask but never a deny', async ($, on) => {
    world(on, { settings: withSettings(s => { s.permissions.install = 'allow' }) })
    let engine: 'allow' | 'ask' | 'deny' = 'allow'
    on('tool.check', () => ({ decision: engine, rule: 'Bash' }))
    await $.session.start(SESSION)
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push origin main' } })).decision).toBe('ask')
    engine = 'ask'
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'npm install zod' } })).decision).toBe('allow')
    engine = 'deny'
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'npm install zod' } })).decision).toBe('deny')
    engine = 'allow'
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).decision).toBe('allow')
  })

  test('Subagent Control: Off blocks and hides, Max N counts, Ask asks', async ($, on) => {
    const w = world(on, { settings: withSettings(s => { s.subagents.mode = 'block' }) })
    on('agent.spawn', ($, e) => ({ model: e.model ?? 'claude-haiku-4-5', agentId: 'a1' }))
    on('agent.offer', () => ({ isOffered: true }))
    await $.session.start(SESSION)
    const offered = await $.agent.offer({ agent: 'Explore', description: 'x', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } })
    expect(offered.isOffered).toBe(false)
    const spawned = await $.agent.spawn(spawnInput('look around'))
    expect(spawned.deny).toContain('disabled')
    await $.command.run(cmd('cr', 'agents ask'))
    w.live.askAnswer = 'Allow'
    const allowed = await $.agent.spawn(spawnInput('look around'))
    expect(allowed.deny).toBeUndefined()
    expect(w.kept.asked.length).toBe(1)
    w.live.askAnswer = 'Deny'
    const refused = await $.agent.spawn(spawnInput('again'))
    expect(refused.deny).toContain('did not approve')
  })

  test('Frontier Max: policy section and maximum effort; none invented for models without effort', async ($, on) => {
    world(on, { settings: withSettings(s => { s.frontier.enabled = true }) })
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
    const sent: unknown[] = []
    on('turn.step', async function* ($, e) {
      sent.push(e.effort)
      return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    await $.session.start(SESSION)
    const composed = await $.prompt.compose(COMPOSE)
    const policy = composed.sections.find(s => s.id === 'control-room:policies')
    expect(policy?.scope).toBe('session')
    expect(policy?.text).toContain('frontier-level autonomous capability')
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 2 })) void _
    for await (const _ of $.turn.step({ turnId: 't1', index: 1, model: 'claude-haiku-4-5', messageCount: 3 })) void _
    expect(sent).toEqual(['max', undefined])
  })

  test('No-Lazy-Exit Guard continues a lazy stop once, then respects the loop guard', async ($, on) => {
    world(on, { settings: withSettings(s => { s.guard.enabled = true; s.guard.modelCheck = false }) })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('classic.Stop', () => ({}))
    await $.session.start(SESSION)
    await $.prompt.submit({ text: 'Implement the CSV export and add tests.', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'Implement the CSV export and add tests.', turnId: 't1' })
    const lazy = "I added the button. You'll need to implement the serializer and write the tests yourself. TODO: quoting."
    const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: lazy })
    expect(first.block).toContain('No-Lazy-Exit Guard')
    const again = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: lazy })
    expect(again.block).toBeUndefined()
    const done = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Implemented and all 12 tests pass.' })
    expect(done.block).toBeUndefined()
  })

  test('Context Autopilot: threshold → pending notice → handoff → verified → /clear → fresh context → continuation', async ($, on) => {
    let fresh: { additionalContext?: string[] } | undefined
    on('command.run', { command: 'clear' }, async () => {
      w.live.sessionId = 'session-2'
      fresh = await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
      return { text: '' }
    })
    const w = world(on, {
      settings: withSettings(s => {
        s.autopilot.enabled = true
        s.autopilot.thresholdMode = 'tokens'
        s.autopilot.thresholdTokens = 100_000
      }),
      tokens: 50_000,
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('turn.step', async function* ($, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [{ name: 'Bash', input: { command: 'npm test' } }],
        stopReason: 'tool_use' as const,
        usage: { input_tokens: 10, output_tokens: 2000, cache_read_input_tokens: 110_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
      }
    })
    await $.session.start(SESSION)
    await $.turn.start({ text: 'build the feature', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 4 })) void _
    await w.clock.settle()
    const pending = await $.command.run(cmd('cr', 'status'))
    expect(pending.text).toContain('Handoff soon')

    w.live.usage = { ...w.live.usage, context: { tokens: 112_000, window: 1_000_000, percent: 11 } }
    await $.turn.complete({ answer: 'Feature done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(300)
    const handoff = w.kept.submitted.find(t => t.includes('final handoff'))
    expect(handoff).toBeDefined()
    expect(handoff).toContain('NEXT_SESSION_PROMPT.md')
    expect(handoff).not.toContain('must contain')

    await $.turn.start({ text: handoff ?? '', turnId: 't2' })
    await $.turn.complete({ answer: 'Handoff written.', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
    await w.clock.advance(2000)
    expect(fresh?.additionalContext?.join(' ')).toContain('fresh context')
    await w.clock.advance(1000)
    const continuation = w.kept.submitted.find(t => t.includes('Context Autopilot continuation'))
    expect(continuation).toBeDefined()
    expect(continuation).toContain('NEXT_SESSION_PROMPT.md')

    const status = await $.command.run(cmd('cr', 'status'))
    expect(status.text).toContain('Session 2')
  })

  test('Context Autopilot in the terminal: the reset lands after /clear returns, and the fresh session is still ours', async ($, on) => {
    let fresh: { additionalContext?: string[] } | undefined
    let finishReset: (() => Promise<void>) | null = null
    on('command.run', { command: 'clear' }, async () => {
      // The interactive terminal resets the session after the command has returned.
      finishReset = async () => {
        w.live.sessionId = 'session-2'
        fresh = await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
      }
      return { text: '' }
    })
    const w = world(on, { settings: withSettings(s => void (s.autopilot.enabled = true)) })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    await $.session.start(SESSION)
    await $.command.run(cmd('cr', 'handoff'))
    await w.clock.advance(400)
    await $.turn.start({ text: 'handoff', turnId: 'h1' })
    await $.turn.complete({ answer: 'Handoff written.', durationMs: 1, isAborted: false, turnId: 'h1', reason: 'answer' })
    await w.clock.advance(3000)
    expect(finishReset).not.toBeNull()
    // Nothing is sent into the old context while the reset is still under way.
    expect(w.kept.submitted.some(t => t.includes('Context Autopilot continuation'))).toBe(false)

    await finishReset!()
    await w.clock.advance(1000)
    expect(fresh?.additionalContext?.join(' ')).toContain('fresh context')
    const continuation = w.kept.submitted.find(t => t.includes('Context Autopilot continuation'))
    expect(continuation).toContain('(session 2)')
    const runs = Object.entries(w.store).filter(([k]) => k.startsWith('run.v1.')).map(([, v]) => v as { sessions: { end: string | null }[] })
    expect(runs.at(-1)?.sessions.map(s => s.end)).toEqual(['handoff', null])
  })

  test('the handoff never clears the context when the notes were not written', async ($, on) => {
    const w = world(on, { settings: withSettings(s => { s.autopilot.enabled = true }), isHandoffWritten: false })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    await $.session.start(SESSION)
    await $.command.run(cmd('cr', 'handoff'))
    await w.clock.advance(400)
    await $.turn.start({ text: 'handoff', turnId: 'h1' })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'h1', reason: 'answer' })
    await w.clock.advance(400)
    await $.turn.start({ text: 'retry', turnId: 'h2' })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'h2', reason: 'answer' })
    await w.clock.advance(3000)
    expect(w.kept.submitted.some(t => t.includes('could not find an updated'))).toBe(true)
    expect(w.kept.commandsRun.map(c => c.command)).not.toContain('clear')
  })

  test('a resource level change reaches the system prompt; no sampler runs on an unknown platform', async ($, on) => {
    const w = world(on)
    on('prompt.compose', () => ({ sections: [] }))
    await $.session.start(SESSION)
    await $.command.run(cmd('cr', 'resources low'))
    await w.clock.settle()
    const composed = await $.prompt.compose(COMPOSE)
    expect(composed.sections.map(x => x.text).join(' ')).toContain('Resource Governor: LOW')
    expect(w.kept.spawned.length).toBe(0)
    const status = await $.command.run(cmd('cr', 'status'))
    expect(status.text).toMatch(/Machine load\s+Low/)
  })
})
