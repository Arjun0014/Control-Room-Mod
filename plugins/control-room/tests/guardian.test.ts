import { describe, expect, test } from 'claude-code/testing'

import { Runtime } from '../hooks/app/runtime'
import * as Views from '../hooks/app/views'
import { defaultSettings } from '../hooks/core/settings'
import type { Settings } from '../hooks/core/settings'
import { fakeHost, flush } from './fixtures/fake-host'

const MIN = 60_000
const OPUS = 'claude-opus-5-5'
const HAIKU = 'claude-haiku-4-5-20251001'

type Fake = ReturnType<typeof fakeHost>

/** A session with Control Room started, the context at 300k tokens; `memory` is what earlier sessions learned (store `cache.v1`). */
async function started(patch: (s: Settings) => void, memory?: Record<string, unknown>) {
  const f = fakeHost()
  const s = defaultSettings()
  patch(s)
  f.kept.store['settings.v1'] = s
  if (memory !== undefined) f.kept.store['cache.v1'] = memory
  f.live.usage = { ...f.live.usage, context: { tokens: 300_000, window: 1_000_000, percent: 30 } }
  const rt = new Runtime()
  rt.bind(f.host)
  await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await f.advance(200)
  return { rt, ...f }
}

let turns = 0

/** One main turn: each request `prompt` tokens long, `read` of them from the cache, two seconds apart. */
async function turn(f: Fake, rt: Runtime, requests: readonly { prompt: number; read: number; model?: string }[]): Promise<void> {
  const turnId = `t${++turns}`
  rt.onTurnStart({ turnId, text: 'Carry on with the parser.' })
  for (const [index, r] of requests.entries()) {
    const e = { turnId, index, model: OPUS, effort: 'high' as const, messageCount: 3 + index }
    const sent = rt.stepRequest(e)
    await f.advance(2000)
    rt.stepResponse(e, sent, {
      turnId,
      index,
      answer: '',
      toolUses: [],
      stopReason: index === requests.length - 1 ? 'end_turn' : 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: r.read, cache_creation_input_tokens: Math.max(0, r.prompt - r.read - 100), model: r.model ?? sent.model ?? OPUS },
    })
  }
  await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'done' })
  await f.advance(10)
}

const ONE_HOUR = { v: 1, ttl: '1h', ttlSource: 'engine', verified: 'unknown', verifiedAt: null }
const FIVE_MINUTES = { v: 1, ttl: '5m', ttlSource: 'engine', verified: 'unknown', verifiedAt: null }

describe('Cache Guardian', () => {
  test('Keep warm refreshes the one-hour cache ten minutes before it lapses, unseen, and proves itself on the next request', async () => {
    const f = await started(s => void (s.cache.keepWarm = true), ONE_HOUR)
    const { rt, kept, advance } = f
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    const t0 = rt.cache.state.lastRequestAt ?? 0
    expect(rt.cache.plan).toEqual({ at: t0 + 50 * MIN, isProbe: false })
    await advance(49 * MIN)
    expect(kept.forks).toEqual([])
    await advance(2 * MIN)
    expect(kept.forks).toEqual([t0 + 50 * MIN])
    expect(rt.cache.state.keepWarm).toMatchObject({ refreshes: 1, lastHit: true, verified: 'unknown', provingAfter: t0 + 60 * MIN })
    // Nothing reaches the transcript or the person for a refresh.
    expect(kept.appended).toEqual([])
    expect(kept.toasts).toEqual([])
    // The person is back after the old expiry: the cache is still there, which proves the method.
    await advance(20 * MIN)
    await turn(f, rt, [{ prompt: 301_000, read: 300_000 }])
    expect(rt.cache.state.keepWarm.verified).toBe('yes')
    expect(rt.cache.state.misses).toEqual([])
    expect(kept.toasts.some(t => t.startsWith('Keep warm verified'))).toBe(true)
    expect((kept.store['cache.v1'] as { verified: string }).verified).toBe('yes')
  })

  test('Keep warm stands down while a handoff is about to clear the context; a handoff that compacts keeps the cache warm', async () => {
    const f = await started(s => {
      s.cache.keepWarm = true
      s.autopilot.enabled = true
    }, ONE_HOUR)
    const { rt, kept, advance } = f
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    const t0 = rt.cache.state.lastRequestAt ?? 0
    rt.autopilot = { ...rt.autopilot, state: 'pending' }
    rt.cache.schedule()
    expect(rt.cache.plan).toEqual({ at: null, reason: 'A handoff will start a fresh context, so this cache is about to be discarded' })
    rt.update(s => void (s.autopilot.continuation = 'compact'))
    expect(rt.cache.plan).toEqual({ at: t0 + 50 * MIN, isProbe: false })
    rt.autopilot = { ...rt.autopilot, state: 'awaiting' }
    rt.cache.schedule()
    expect(rt.cache.plan.at).toBeNull()
    await advance(70 * MIN)
    expect(kept.forks).toEqual([])
  })

  test('the five-minute cache is refreshed every four minutes, for 45 idle minutes at most', async () => {
    const f = await started(s => void (s.cache.keepWarm = true), FIVE_MINUTES)
    const { rt, kept, advance } = f
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    const t0 = rt.cache.state.lastRequestAt ?? 0
    await advance(90 * MIN)
    expect(kept.forks.map(at => Math.round((at - t0) / MIN))).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44])
    expect(rt.cache.plan.at).toBeNull()
    expect(rt.cache.plan.at === null ? rt.cache.plan.reason : '').toContain('costs more than rebuilding it')
  })

  test('with the lifetime unknown, one refresh at six idle minutes learns it, and later sessions remember it', async () => {
    const f = await started(s => void (s.cache.keepWarm = true))
    const { rt, kept, advance } = f
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    const t0 = rt.cache.state.lastRequestAt ?? 0
    expect(rt.cache.plan).toEqual({ at: t0 + 6 * MIN, isProbe: true })
    await advance(7 * MIN)
    expect(kept.forks).toEqual([t0 + 6 * MIN])
    expect(rt.cache.state.ttl).toEqual({ value: '1h', source: 'probe' })
    expect(kept.store['cache.v1']).toMatchObject({ ttl: '1h', ttlSource: 'probe' })
    expect(rt.cache.plan).toEqual({ at: t0 + 56 * MIN, isProbe: false })

    const later = new Runtime()
    later.bind(f.host)
    await later.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(later.cache.state.ttl).toEqual({ value: '1h', source: 'stored' })
  })

  test('Keep warm stops itself when its refreshes do not hold the cache, and tries afresh when turned on again', async () => {
    const f = await started(s => void (s.cache.keepWarm = true), ONE_HOUR)
    const { rt, kept, live, advance } = f
    live.forkRead = 0
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    // The lifetime as Claude Code reports it in this context (a model switch's hook), not one remembered from before.
    rt.cache.noteTtl('1h')
    rt.cache.schedule()
    await advance(101 * MIN)
    expect(kept.forks.length).toBe(2)
    expect(rt.cache.state.ttl).toEqual({ value: '1h', source: 'engine' })
    expect(rt.cache.state.keepWarm.verified).toBe('no')
    expect(rt.cache.plan).toEqual({ at: null, reason: 'It did not keep the cache warm here, so it stopped' })
    expect(rt.notes.join(' ')).toContain('Keep warm did not keep the prompt cache warm')
    expect(kept.toasts.some(t => t.startsWith('Keep warm stopped'))).toBe(true)
    expect((kept.store['cache.v1'] as { verified: string }).verified).toBe('no')
    rt.update(s => void (s.cache.keepWarm = false))
    rt.update(s => void (s.cache.keepWarm = true))
    expect(rt.cache.state.keepWarm.verified).toBe('unknown')
    expect((kept.store['cache.v1'] as { verified: string }).verified).toBe('unknown')
  })

  test('a remembered hour that proves wrong is corrected: Keep warm does not blame itself, and pauses at the five-minute idle limit', async () => {
    const f = await started(s => void (s.cache.keepWarm = true), ONE_HOUR)
    const { rt, kept, live, advance } = f
    live.forkRead = 0
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    await advance(101 * MIN)
    expect(kept.forks.length).toBe(1)
    expect(rt.cache.state.ttl).toEqual({ value: '5m', source: 'observed' })
    expect(rt.cache.state.keepWarm.verified).toBe('unknown')
    expect(rt.cache.plan.at).toBeNull()
  })

  test('stable policies: while the cache is warm a settings change reaches Claude as a note, and the system prompt keeps its section', async () => {
    const f = await started(() => undefined, ONE_HOUR)
    const { rt, kept, advance } = f
    const original = rt.composeSection(null)?.text
    expect(original).toBeDefined()
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    rt.update(s => void (s.frontier.enabled = true))
    await flush()
    const note = kept.appended.at(-1) ?? ''
    expect(note).toContain('To keep the prompt cache')
    expect(note).toContain('Frontier Max is now ON')
    expect(note).toContain('frontier-level autonomous capability')
    expect(rt.composeSection(null)?.text).toBe(original)
    expect(Views.paneOf(rt).cache.policies).toEqual({ isStable: true, isHolding: true })
    // Back to what the system prompt already says: Claude is told the note no longer applies.
    rt.update(s => void (s.frontier.enabled = false))
    await flush()
    expect(kept.appended.at(-1)).toContain('apply again as written')
    // Once the cache is cold there is nothing to keep: the system prompt takes the change.
    await advance(70 * MIN)
    rt.update(s => void (s.frontier.enabled = true))
    expect(rt.composeSection(null)?.text).toContain('frontier-level autonomous capability')
  })

  test('a policy change while warm, with stable policies off, is named as the cause of the miss it brings', async () => {
    const f = await started(s => void (s.cache.stablePolicies = false), ONE_HOUR)
    const { rt } = f
    rt.composeSection(null)
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    rt.update(s => void (s.qa.enabled = true))
    expect(rt.composeSection(null)?.text).toContain('Release / QA mode')
    await turn(f, rt, [{ prompt: 301_000, read: 2_000 }])
    const miss = Views.paneOf(rt).cache.misses[0]
    expect(miss).toMatchObject({ cause: 'policy', kind: 'preventable', severity: 'warn' })
    expect(miss?.detail).toContain('Release/QA mode is now ON')
    expect(miss?.advice).toContain('Turn on Keep policies stable')
  })

  test('a model switch the person makes is confirmed first when a large warm cache would be lost', async () => {
    const { rt } = await started(() => undefined)
    const ask = { from_model: OPUS, to_model: 'claude-sonnet-5-5', source: 'command', context_tokens: 412_000, prompt_cache_warm: true, cache_ttl: '1h' as const, estimated_cache_write_usd: 2.06 }
    const reason = rt.onPreModelSwitch(ask) ?? ''
    expect(reason).toContain('412k tokens')
    expect(reason).toContain('sonnet-5-5')
    expect(reason).toContain('about $2.06')
    expect(rt.cache.state.ttl).toEqual({ value: '1h', source: 'engine' })
    expect(rt.onPreModelSwitch({ ...ask, source: 'sdk' })).toBeNull()
    expect(rt.onPreModelSwitch({ ...ask, prompt_cache_warm: false })).toBeNull()
    expect(rt.onPreModelSwitch({ ...ask, context_tokens: 40_000 })).toBeNull()
    rt.update(s => void (s.cache.guardModelSwitch = false))
    expect(rt.onPreModelSwitch(ask)).toBeNull()
  })

  test('a switch the person made, then a miss: a toast says what it cost; a compaction is expected and stays quiet', async () => {
    const f = await started(() => undefined, ONE_HOUR)
    const { rt, kept } = f
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    rt.onPostModelSwitch({ from_model: OPUS, to_model: 'claude-sonnet-5-5', cache_ttl: '1h', source: 'command' })
    await turn(f, rt, [{ prompt: 301_000, read: 0, model: 'claude-sonnet-5-5' }])
    expect(kept.toasts.at(-1)).toBe('Cache rebuilt: 300k tokens · Model changed')
    const toasts = kept.toasts.length
    rt.onCompacted('manual', { messages: [], tokensBefore: 301_000, tokensAfter: 30_000 })
    await turn(f, rt, [{ prompt: 30_000, read: 0, model: 'claude-sonnet-5-5' }])
    expect(rt.cache.state.misses[0]).toMatchObject({ cause: 'compact', kind: 'lifecycle' })
    expect(kept.toasts.length).toBe(toasts)
    expect(Views.hudOf(rt).cache?.recentMiss).toBeNull()
  })

  test('the router keeps a warm cache, and a miss its own switch causes is put down to it', async () => {
    const f = await started(s => void (s.router.strategy = 'economy'), ONE_HOUR)
    const { rt, advance } = f
    rt.router.known.set('haiku', HAIKU)
    // A context small enough for the router to consider a switch at all.
    f.live.usage = { ...f.live.usage, context: { tokens: 30_000, window: 1_000_000, percent: 3 } }
    await turn(f, rt, [{ prompt: 30_000, read: 0 }])
    rt.onPromptSubmit('Where is the config read?', { kind: 'composer' })
    expect(rt.router.turnModel).toBeNull()
    expect(rt.router.lastDecision).toContain('keeps the warm cache (30k tokens)')
    // A small warm cache is not worth keeping: the router switches, and owns the rebuild.
    const g = await started(s => void (s.router.strategy = 'economy'), ONE_HOUR)
    g.rt.router.known.set('haiku', HAIKU)
    g.live.usage = { ...g.live.usage, context: { tokens: 10_000, window: 1_000_000, percent: 1 } }
    await turn(g, g.rt, [{ prompt: 10_000, read: 0 }])
    g.rt.onPromptSubmit('Where is the config read?', { kind: 'composer' })
    expect(g.rt.router.turnModel).toBe(HAIKU)
    await turn(g, g.rt, [{ prompt: 10_200, read: 0 }])
    const miss = Views.paneOf(g.rt).cache.misses[0]
    expect(miss).toMatchObject({ cause: 'model', kind: 'preventable' })
    expect(miss?.detail).toContain('Model router: opus-5-5 → haiku-4-5')
    expect(miss?.advice).toContain('model router')
    // Once the cache has lapsed, nothing is lost by a switch.
    await advance(70 * MIN)
    rt.onPromptSubmit('Where is the config read?', { kind: 'composer' })
    expect(rt.router.turnModel).toBe(HAIKU)
  })

  test('a fresh context starts the cache over; the lifetime it learned carries', async () => {
    const f = await started(s => void (s.cache.keepWarm = true), ONE_HOUR)
    const { rt } = f
    await turn(f, rt, [{ prompt: 300_000, read: 0 }])
    expect(Views.hudOf(rt).cache).toMatchObject({ warmth: 'warm', ttl: '1h', cachedTokens: 300_000, keepWarm: true })
    await rt.onClassicSessionStart({ source: 'clear', sessionId: 'S2' })
    expect(rt.cache.state.requests).toBe(0)
    expect(rt.cache.state.ttl).toEqual({ value: '1h', source: 'stored' })
    expect(rt.cache.plan).toEqual({ at: null, reason: 'Nothing cached yet' })
    expect(Views.hudOf(rt).cache).toBeNull()
  })
})
