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
    expect(odd.miss?.severity).toBe('info')
    const again = req(odd.state, T0 + 4 * MIN, 202_000, 0)
    expect(again.miss?.severity).toBe('warn')
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

  test('Keep warm proves itself: a request after the expiry it replaced still reads the cache', () => {
    let s = withTtl(req(emptyCache(), T0, 300_000, 0).state, '1h', 'engine')
    const r1 = req(s, T0 + 50 * MIN, 300_100, 299_500, { isRefresh: true })
    expect(r1.state.keepWarm.provingAfter).toBe(T0 + 60 * MIN)
    expect(r1.state.keepWarm.verified).toBe('unknown')
    expect(expiresAt(r1.state)).toBe(T0 + 110 * MIN)
    const r2 = req(r1.state, T0 + 100 * MIN, 300_100, 299_500, { isRefresh: true })
    expect(r2.verdict).toBe('yes')
    expect(r2.state.keepWarm.verified).toBe('yes')

    // Refreshes sent in time that find the cache gone, twice: it stops.
    s = withTtl(req(emptyCache(), T0, 300_000, 0).state, '1h', 'engine')
    const bad1 = req(s, T0 + 50 * MIN, 300_100, 0, { isRefresh: true })
    expect(bad1.state.keepWarm.verified).toBe('unknown')
    const bad2 = req(bad1.state, T0 + 100 * MIN, 300_100, 0, { isRefresh: true })
    expect(bad2.verdict).toBe('no')
    expect(nextRefresh(bad2.state, { ...keep, now: T0 + 101 * MIN })).toEqual({ at: null, reason: 'It did not keep the cache warm here, so it stopped' })
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
    expect(memoryOf({ ttl: '1h', ttlSource: 'engine', verified: 'yes', verifiedAt: 5, effortRebuilds: ['opus-5-5', 7] })).toEqual({ v: 1, ttl: '1h', ttlSource: 'engine', verified: 'yes', verifiedAt: 5, effortRebuilds: ['opus-5-5'] })
    expect(memoryOf('garbage')).toEqual({ v: 1, ttl: null, ttlSource: null, verified: 'unknown', verifiedAt: null, effortRebuilds: [] })
  })
})
