import { describe, expect, test } from 'claude-code/testing'

import {
  type CacheState,
  adviceFor,
  emptyCache,
  expiresAt,
  hitRatio,
  leadMs,
  memoryOf,
  nextRefresh,
  noteChange,
  observeRequest,
  warmthOf,
  withTtl,
  withVerdictReset,
} from '../hooks/features/cache'

const MIN = 60_000
const T0 = 1_000_000_000

/** One main-thread request: `prompt` tokens, `cached` of them read from the cache. */
function req(state: CacheState, at: number, prompt: number, cached: number, extra: { model?: string; effort?: string; isRefresh?: boolean; isProbe?: boolean } = {}) {
  return observeRequest(state, {
    at,
    input: 200,
    read: cached,
    written: Math.max(0, prompt - cached - 200),
    model: extra.model ?? 'claude-opus-5-5',
    effort: extra.effort ?? 'high',
    isRefresh: extra.isRefresh,
    isProbe: extra.isProbe,
  })
}

const keep = { isOn: true, isTurnRunning: false, contextTokens: 300_000, minTokens: 20_000, idleSince: T0, maxIdleMs: 120 * MIN, standDown: null }

describe('prompt cache', () => {
  test('requests that read what the one before sent are hits; the ratio counts tokens', () => {
    let s = emptyCache()
    s = req(s, T0, 100_000, 0).state
    const second = req(s, T0 + MIN, 104_000, 99_000)
    expect(second.miss).toBeNull()
    s = second.state
    expect(s.requests).toBe(2)
    expect(Math.round((hitRatio(s) ?? 0) * 1000)).toBe(Math.round((99_000 / 204_000) * 1000))
    // With the lifetime unknown it is surely warm for five minutes, and unknown after.
    expect(warmthOf(s, T0 + 3 * MIN)).toBe('warm')
    expect(warmthOf(s, T0 + 9 * MIN)).toBe('unknown')
    expect(expiresAt(s)).toBeNull()
  })

  test("Keep warm's refreshes move the expiry but are no requests of the conversation, as Claude Code counts them", () => {
    // The live 1-hour test: two requests (31,367 then 60,669 read), Claude Code's hit ratio 0.6219.
    let s = observeRequest(emptyCache(), { at: T0, input: 2, read: 31_367, written: 29_302, model: 'claude-sonnet-5-5', effort: null }).state
    s = observeRequest(s, { at: T0 + 3_000, input: 2, read: 60_669, written: 26_661, model: 'claude-sonnet-5-5', effort: null }).state
    s = withTtl(s, '1h', 'probe')
    const ratio = hitRatio(s)
    s = req(s, T0 + 6 * MIN, 87_332, 87_330, { isRefresh: true }).state
    s = req(s, T0 + 56 * MIN, 87_332, 87_330, { isRefresh: true }).state
    expect(s.requests).toBe(2)
    expect(hitRatio(s)).toBe(ratio)
    expect(Math.round((ratio ?? 0) * 10_000)).toBe(6219)
    expect(s.keepWarm.refreshes).toBe(2)
    expect(expiresAt(s)).toBe(T0 + 56 * MIN + 60 * MIN)
  })

  test('a model change before a request that misses is named, preventable, with the tokens re-cached', () => {
    let s = req(emptyCache(), T0, 400_000, 0).state
    const r = req(s, T0 + MIN, 401_000, 0, { model: 'claude-sonnet-5-5' })
    expect(r.miss?.cause).toBe('model')
    expect(r.miss?.kind).toBe('preventable')
    expect(r.miss?.severity).toBe('warn')
    expect(r.miss?.recached).toBe(400_000)
    expect(r.miss?.detail).toContain('opus-5-5 → sonnet-5-5')
    s = r.state
    expect(s.pending).toEqual([])
    // Live: a switch that also changed the effort; Claude Code named both causes (model_changed, effort_changed).
    const both = req(req(emptyCache(), T0, 143_000, 0, { model: 'claude-sonnet-5-5', effort: 'medium' }).state, T0 + MIN, 143_500, 0, { model: 'claude-opus-5-5', effort: 'high' })
    expect(both.miss?.detail).toBe('Model changed: sonnet-5-5 → opus-5-5, effort too')
  })

  test('a change Control Room saw outranks the gap: its own policy section, then idling, then nothing seen', () => {
    let s = req(emptyCache(), T0, 200_000, 0).state
    s = noteChange(s, { cause: 'policy', at: T0 + 10_000, detail: 'Frontier Max turned on' })
    expect(req(s, T0 + MIN, 201_000, 1_000).miss?.cause).toBe('policy')

    s = withTtl(req(emptyCache(), T0, 200_000, 0).state, '1h', 'engine')
    const late = req(s, T0 + 75 * MIN, 201_000, 0)
    expect(late.miss?.cause).toBe('expired')
    expect(late.miss?.detail).toContain('1 h 15 min')
    expect(late.miss?.detail).toContain('1-hour')

    s = withTtl(req(emptyCache(), T0, 200_000, 0).state, '1h', 'engine')
    const odd = req(s, T0 + 2 * MIN, 201_000, 0)
    expect(odd.miss?.cause).toBe('unexplained')
    expect(odd.miss?.certainty).toBe('unknown')
    // 200k re-sent with no cause seen is worth a look the first time; a small one only once it repeats.
    expect(odd.miss?.severity).toBe('warn')
    const small = withTtl(req(emptyCache(), T0, 30_000, 0).state, '1h', 'engine')
    const once = req(small, T0 + 2 * MIN, 30_500, 0)
    expect(once.miss).toMatchObject({ cause: 'unexplained', severity: 'info' })
    expect(req(once.state, T0 + 4 * MIN, 31_000, 0).miss?.severity).toBe('warn')
    // Unknown is said as unknown: nothing in the words puts it on the server.
    expect(`${odd.miss?.detail} ${adviceFor(odd.miss!, { keepWarm: false, stablePolicies: true })}`.toLowerCase()).not.toMatch(/server|evict/)
  })

  test('compaction is an expected rebuild; a tiny prompt is never called a miss', () => {
    let s = req(emptyCache(), T0, 300_000, 0).state
    s = noteChange(s, { cause: 'compact', at: T0 + MIN, detail: 'Compacted' })
    const r = req(s, T0 + 2 * MIN, 30_000, 0)
    expect(r.miss?.kind).toBe('lifecycle')
    expect(r.miss?.severity).toBe('info')
    const tiny = req(req(emptyCache(), T0, 2_000, 0).state, T0 + MIN, 2_100, 0)
    expect(tiny.miss).toBeNull()
  })

  test('the TTL is learned: a hit after more than five idle minutes proves the hour', () => {
    let s = req(emptyCache(), T0, 200_000, 0).state
    s = req(s, T0 + 12 * MIN, 201_000, 199_000).state
    expect(s.ttl).toEqual({ value: '1h', source: 'observed' })
    expect(expiresAt(s)).toBe(T0 + 12 * MIN + 60 * MIN)
    // The engine's own word outranks it.
    expect(withTtl(s, '5m', 'engine').ttl).toEqual({ value: '5m', source: 'engine' })
    expect(withTtl(withTtl(s, '5m', 'engine'), '1h', 'observed').ttl?.source).toBe('engine')
  })

  test('a lifetime remembered from an earlier session is a hint the context can correct', () => {
    // An hour remembered, but this context has the five-minute cache (an API key, usage over the plan).
    const stored = emptyCache({ ttl: { value: '1h', source: 'stored' } })
    const s = req(stored, T0, 200_000, 0).state
    const lapse = req(s, T0 + 20 * MIN, 201_000, 0)
    expect(lapse.miss?.cause).toBe('expired')
    expect(lapse.miss?.detail).toBe('Idle 20 min')
    expect(lapse.state.ttl).toEqual({ value: '5m', source: 'observed' })
    // A refresh timed by the wrong hour finds the cache gone: the lifetime is corrected, Keep warm is not blamed.
    const refresh = req(s, T0 + 50 * MIN, 200_000, 0, { isRefresh: true })
    expect(refresh.state.ttl?.value).toBe('5m')
    expect(refresh.verdict).toBeNull()
    // The refresh rebuilt the cache: if the next one, in time on the corrected lifetime, misses too, Keep warm does not work here.
    const next = req(refresh.state, T0 + 54 * MIN, 200_000, 0, { isRefresh: true })
    expect(next.verdict).toBe('no')
    expect(req(refresh.state, T0 + 54 * MIN, 200_200, 199_000, { isRefresh: true }).verdict).toBeNull()
    // An hour the context proves (a hit after more than five idle minutes) replaces the hint too.
    expect(req(s, T0 + 9 * MIN, 201_000, 199_000).state.ttl).toEqual({ value: '1h', source: 'observed' })
  })

  test('the refresh lead is a sixth of the TTL, between one and ten minutes', () => {
    expect(leadMs(60 * MIN)).toBe(10 * MIN)
    expect(leadMs(5 * MIN)).toBe(MIN)
  })

  test('Keep warm refreshes ahead of the expiry, and only while it can matter', () => {
    let s = withTtl(req(emptyCache(), T0, 300_000, 0).state, '1h', 'engine')
    expect(nextRefresh(s, { ...keep, now: T0 + MIN })).toEqual({ at: T0 + 50 * MIN, isProbe: false })
    s = withTtl(s, '5m', 'engine')
    expect(nextRefresh(s, { ...keep, now: T0 + MIN })).toEqual({ at: T0 + 4 * MIN, isProbe: false })
    const one = withTtl(s, '1h', 'engine')
    const reasonOf = (plan: ReturnType<typeof nextRefresh>) => (plan.at === null ? plan.reason : 'scheduled')
    expect(reasonOf(nextRefresh(one, { ...keep, now: T0 + MIN, isOn: false }))).toBe('Off')
    expect(reasonOf(nextRefresh(one, { ...keep, now: T0 + MIN, isTurnRunning: true }))).toContain('working')
    expect(reasonOf(nextRefresh(one, { ...keep, now: T0 + MIN, standDown: 'A handoff will clear this context' }))).toBe('A handoff will clear this context')
    expect(reasonOf(nextRefresh(one, { ...keep, now: T0 + MIN, contextTokens: 8_000 }))).toContain('small')
    expect(reasonOf(nextRefresh(one, { ...keep, now: T0 + 130 * MIN }))).toContain('idle')
    // The idle limit falls before the refresh would: none is scheduled.
    expect(reasonOf(nextRefresh(one, { ...keep, now: T0 + MIN, maxIdleMs: 30 * MIN }))).toBe('Paused at the 30 min idle limit')
    // The TTL unknown: one probe at six idle minutes.
    const unknown = req(emptyCache(), T0, 300_000, 0).state
    expect(nextRefresh(unknown, { ...keep, now: T0 + MIN })).toEqual({ at: T0 + 6 * MIN, isProbe: true })
  })

  test('a probe that still reads the cache at six minutes teaches the hour', () => {
    const s = req(emptyCache(), T0, 300_000, 0).state
    const probe = req(s, T0 + 6 * MIN, 300_200, 299_000, { isProbe: true })
    expect(probe.miss).toBeNull()
    expect(probe.state.ttl).toEqual({ value: '1h', source: 'probe' })
    // The fork's own tail is not cached: the prompt to find stays the last real request's.
    expect(probe.state.lastPrefix).toBe(300_000)
    expect(probe.state.keepWarm.refreshes).toBe(1)
  })

  test("a probe that finds the cache gone teaches five minutes, and its rebuild is the expected price of learning", () => {
    // Live (5-minute cache, 141k): the probe at six idle minutes read 0 and wrote 141k.
    const s = req(emptyCache(), T0, 141_000, 0).state
    const probe = req(s, T0 + 6 * MIN, 141_100, 0, { isProbe: true })
    expect(probe.state.ttl).toEqual({ value: '5m', source: 'probe' })
    expect(probe.miss).toMatchObject({ cause: 'expired', kind: 'lifecycle', severity: 'info', isProbe: true })
    expect(probe.miss?.detail).toContain('the cache lasts 5 minutes here')
    expect(adviceFor(probe.miss!, { keepWarm: true, stablePolicies: true })).toContain('Expected once')
    // The rebuilt cache is warm again for five minutes from the probe, and the next refresh is a minute before that.
    expect(expiresAt(probe.state)).toBe(T0 + 11 * MIN)
    expect(nextRefresh(probe.state, { ...keep, now: T0 + 6 * MIN, idleSince: T0 })).toEqual({ at: T0 + 10 * MIN, isProbe: false })
  })

  test('Keep warm proves itself only by the conversation: its next request after the expiry a refresh replaced still reads the cache', () => {
    let s = withTtl(req(emptyCache(), T0, 300_000, 0).state, '1h', 'engine')
    const r1 = req(s, T0 + 50 * MIN, 300_100, 299_500, { isRefresh: true })
    expect(r1.state.keepWarm.provingAfter).toBe(T0 + 60 * MIN)
    expect(r1.state.keepWarm.verified).toBe('unknown')
    expect(expiresAt(r1.state)).toBe(T0 + 110 * MIN)
    expect(r1.state.keepWarm.log[0]).toMatchObject({ status: 'awaiting', isHit: true, oldExpiry: T0 + 60 * MIN, newExpiry: T0 + 110 * MIN })
    // Another fork that reads it after the old expiry proves only that forks find it: not the conversation.
    const r2 = req(r1.state, T0 + 100 * MIN, 300_100, 299_500, { isRefresh: true })
    expect(r2.verdict).toBeNull()
    expect(r2.state.keepWarm.log.map(r => r.status)).toEqual(['awaiting', 'renewed'])
    // The conversation's own request after the expiry the refresh replaced reads it: verified.
    const back = req(r2.state, T0 + 150 * MIN, 301_000, 300_000)
    expect(back.verdict).toBe('yes')
    expect(back.state.keepWarm.verified).toBe('yes')
    expect(back.state.keepWarm.log[0]).toMatchObject({ status: 'verified', main: { phase: 'after-old-expiry', read: 300_000 } })

    // Refreshes sent in time that find the cache gone, twice: it pauses.
    s = withTtl(req(emptyCache(), T0, 300_000, 0).state, '1h', 'engine')
    const bad1 = req(s, T0 + 50 * MIN, 300_100, 0, { isRefresh: true })
    expect(bad1.state.keepWarm.verified).toBe('unknown')
    const bad2 = req(bad1.state, T0 + 100 * MIN, 300_100, 0, { isRefresh: true })
    expect(bad2.verdict).toBe('no')
    expect(nextRefresh(bad2.state, { ...keep, now: T0 + 101 * MIN })).toEqual({ at: null, reason: 'Paused: its last check failed' })
  })

  test('the five-minute cache is kept warm for 45 idle minutes at most: past that a refresh costs more than a rebuild', () => {
    const five = withTtl(req(emptyCache(), T0, 300_000, 0).state, '5m', 'engine')
    const reasonOf = (plan: ReturnType<typeof nextRefresh>) => (plan.at === null ? plan.reason : 'scheduled')
    expect(reasonOf(nextRefresh(five, { ...keep, now: T0 + MIN }))).toBe('scheduled')
    const late = withTtl(req(emptyCache(), T0 + 44 * MIN, 300_000, 0).state, '5m', 'engine')
    expect(reasonOf(nextRefresh(late, { ...keep, now: T0 + 44 * MIN + 1000 }))).toContain('costs more than rebuilding it')
    expect(reasonOf(nextRefresh(late, { ...keep, now: T0 + 46 * MIN }))).toContain('Paused after 45 min idle')
    // A shorter limit of the person's own holds as it is, with no word on cost.
    expect(reasonOf(nextRefresh(late, { ...keep, now: T0 + 46 * MIN, maxIdleMs: 30 * MIN }))).toBe('Paused after 30 min idle')
  })

  test('a change seen after the cache had surely lapsed is not blamed for the miss; the router owns its own switches', () => {
    let s = withTtl(req(emptyCache(), T0, 200_000, 0).state, '1h', 'engine')
    s = noteChange(s, { cause: 'model', at: T0 + 70 * MIN, detail: 'Model changed: opus-5-5 → sonnet-5-5', by: 'person' })
    expect(req(s, T0 + 71 * MIN, 201_000, 0, { model: 'claude-sonnet-5-5' }).miss?.cause).toBe('expired')
    s = withTtl(req(emptyCache(), T0, 200_000, 0).state, '1h', 'engine')
    s = noteChange(s, { cause: 'model', at: T0 + MIN, detail: 'Model router: opus-5-5 → haiku-4-5 (simple task → haiku)', by: 'router' })
    const routed = req(s, T0 + 2 * MIN, 201_000, 0, { model: 'claude-haiku-4-5' })
    expect(routed.miss?.cause).toBe('model')
    expect(routed.miss?.by).toBe('router')
    // The router's own words are kept, not replaced by the plain model change it caused.
    expect(routed.miss?.detail).toContain('Model router')
    expect(adviceFor(routed.miss!, { keepWarm: false, stablePolicies: true })).toContain('model router')
  })

  test('turning Keep warm on again forgets a verdict against it', () => {
    let s = withTtl(req(emptyCache(), T0, 300_000, 0).state, '1h', 'engine')
    s = req(s, T0 + 50 * MIN, 300_100, 0, { isRefresh: true }).state
    s = req(s, T0 + 100 * MIN, 300_100, 0, { isRefresh: true }).state
    expect(s.keepWarm.verified).toBe('no')
    const again = withVerdictReset(s)
    expect(again.keepWarm).toMatchObject({ verified: 'unknown', failures: 0, provingAfter: null })
  })

  test('what is remembered across sessions is validated', () => {
    expect(memoryOf({ ttl: '1h', ttlSource: 'engine', verified: 'yes', verifiedAt: 5, effortRebuilds: ['opus-5-5', 7] })).toEqual({ v: 1, ttl: '1h', ttlSource: 'engine', verified: 'yes', verifiedAt: 5, effortRebuilds: ['opus-5-5'], writeRates: [] })
    expect(memoryOf('garbage')).toEqual({ v: 1, ttl: null, ttlSource: null, verified: 'unknown', verifiedAt: null, effortRebuilds: [], writeRates: [] })
  })

  test('while a turn runs, the cache is never called lapsed on time alone, unless a five-minute lifetime is known', () => {
    const one = req(emptyCache(), T0, 345_000, 0).state
    // A shell command runs for nine minutes inside the turn: no requests, no reason to think the cache is gone.
    expect(warmthOf(one, T0 + 9 * MIN, true)).toBe('warm')
    expect(warmthOf(one, T0 + 9 * MIN, false)).toBe('unknown')
    // A known five-minute lifetime does lapse during a long call.
    const fiveMinutes = withTtl(one, '5m', 'observed')
    expect(warmthOf(fiveMinutes, T0 + 9 * MIN, true)).toBe('cold')
  })

  test("the plan's default lifetime is a hint: below anything learned, corrected to five minutes by a miss after a long gap", () => {
    const planned = withTtl(req(emptyCache(), T0, 300_000, 0).state, '1h', 'plan')
    expect(planned.ttl).toEqual({ value: '1h', source: 'plan' })
    expect(warmthOf(planned, T0 + 30 * MIN)).toBe('warm')
    // Anything learned or remembered outranks the plan's default.
    expect(withTtl(emptyCache({ ttl: { value: '5m', source: 'stored' } }), '1h', 'plan').ttl).toEqual({ value: '5m', source: 'stored' })
    expect(withTtl(planned, '5m', 'observed').ttl).toEqual({ value: '5m', source: 'observed' })
    // Six idle minutes later the cache is gone: on a hint the miss is not "surely expired" blame, and it teaches five minutes.
    const missed = req(planned, T0 + 6 * MIN, 300_000, 0)
    expect(missed.miss?.cause).toBe('expired')
    expect(missed.state.ttl).toEqual({ value: '5m', source: 'observed' })
    // A hit after a long gap proves the hour, replacing the hint.
    const hit = req(planned, T0 + 20 * MIN, 300_000, 299_000)
    expect(hit.miss).toBeNull()
    expect(hit.state.ttl).toEqual({ value: '1h', source: 'observed' })
  })
})
