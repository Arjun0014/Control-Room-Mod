/**
 * The prompt cache, as Control Room can know it: from what the engine
 * reports about each main-thread request (tokens read from the cache,
 * written to it, sent uncached) and the events around it.
 *
 * Claude Code reports no expiry, hit ratio or miss cause. Each is derived
 * here from reported figures, and named as derived where it is shown: the
 * expiry is the last request's time plus the TTL; the TTL is the engine's
 * own (a model switch reports it), or observed (a request after more than
 * five idle minutes that still read the cache proves the one-hour TTL); a
 * miss is a request that read much less than the one before it sent, and
 * its cause the change Control Room saw before it, if any.
 *
 * Keep warm refreshes the cache before it lapses by re-sending the last
 * request (a fork, which the transcript never sees). It checks itself: a
 * refresh must read the cache, and the first request after the expiry it
 * replaced must still find it. If not, it stops.
 *
 * Pure: the Runtime supplies times and figures and performs the fork.
 */

export type TtlValue = '5m' | '1h'
export type TtlSource = 'engine' | 'observed' | 'probe' | 'stored'

export const TTL_MS: Record<TtlValue, number> = { '5m': 300_000, '1h': 3_600_000 }

/** Below this, a request's prompt is not worth calling a miss over (and may sit under the model's cache minimum). */
export const MIN_PREFIX = 4096

/** A request that reads less than this share of the prompt the last one sent missed the cache. */
const HIT_SHARE = 0.5

/** Changes Control Room can see that rebuild the cache on the next request. */
export type CacheChange = 'compact' | 'model' | 'policy' | 'style' | 'tools' | 'effort'

export type MissCause = CacheChange | 'expired' | 'unexplained'

/** Preventable: a change someone made, or idling past the TTL. Lifecycle: expected. Unavoidable: nothing seen changed. */
export type MissKind = 'preventable' | 'lifecycle' | 'unavoidable'

export type CacheMiss = {
  at: number
  cause: MissCause
  kind: MissKind
  severity: 'info' | 'warn'
  /** Tokens the request had to write afresh that the one before it had cached. */
  recached: number
  /** The prompt the request before sent (what should have been found). */
  prefix: number
  read: number
  /** Time since the request before. */
  gapMs: number
  /** What happened, in a few words ("Model changed: opus → sonnet"). */
  detail: string
  /** True when it was a Keep warm refresh that missed. */
  isRefresh: boolean
}

export type CacheEvent = { cause: CacheChange; at: number; detail: string }

export type KeepWarmState = {
  refreshes: number
  lastAt: number | null
  lastRead: number | null
  lastHit: boolean | null
  /** Whether a refresh has been seen to carry the cache past its old expiry. */
  verified: 'unknown' | 'yes' | 'no'
  /** The expiry a refresh replaced: the first request after it proves (or disproves) the refresh. */
  provingAfter: number | null
  /** Refreshes sent before the expiry that still found the cache gone: two and Keep warm stops. */
  failures: number
}

export type CacheState = {
  requests: number
  read: number
  written: number
  uncached: number
  /** When the last main-thread request (or refresh) went out. */
  lastRequestAt: number | null
  /** The prompt the last real request sent: what the next request should find cached. */
  lastPrefix: number
  model: string | null
  effort: string | null
  ttl: { value: TtlValue; source: TtlSource } | null
  /** Newest first, at most MISSES_KEPT. */
  misses: CacheMiss[]
  /** Changes seen since the last request, which may rebuild the cache on the next one. */
  pending: CacheEvent[]
  keepWarm: KeepWarmState
}

const MISSES_KEPT = 20

export const emptyKeepWarm = (verified: KeepWarmState['verified'] = 'unknown'): KeepWarmState => ({
  refreshes: 0,
  lastAt: null,
  lastRead: null,
  lastHit: null,
  verified,
  provingAfter: null,
  failures: 0,
})

/** A fresh context's cache: nothing sent yet. What is known across contexts (the TTL, Keep warm's verdict) carries in. */
export function emptyCache(carry?: { ttl?: CacheState['ttl']; verified?: KeepWarmState['verified'] }): CacheState {
  return {
    requests: 0,
    read: 0,
    written: 0,
    uncached: 0,
    lastRequestAt: null,
    lastPrefix: 0,
    model: null,
    effort: null,
    ttl: carry?.ttl ?? null,
    misses: [],
    pending: [],
    keepWarm: emptyKeepWarm(carry?.verified ?? 'unknown'),
  }
}

/** A change Control Room saw that may rebuild the cache on the next request. */
export function noteChange(state: CacheState, event: CacheEvent): CacheState {
  if (state.requests === 0) return state
  return { ...state, pending: [...state.pending.filter(p => p.cause !== event.cause), event].slice(-8) }
}

/** The TTL as the engine reported it (a model switch), which outranks anything observed. */
export function withTtl(state: CacheState, value: TtlValue, source: TtlSource): CacheState {
  const rank: Record<TtlSource, number> = { engine: 3, probe: 2, observed: 1, stored: 0 }
  if (state.ttl !== null && state.ttl.value === value && rank[state.ttl.source] >= rank[source]) return state
  if (state.ttl !== null && rank[state.ttl.source] > rank[source]) return state
  return { ...state, ttl: { value, source } }
}

export const ttlMs = (state: CacheState): number | null => (state.ttl === null ? null : TTL_MS[state.ttl.value])

/** When the cache lapses: the last request plus the TTL; null while either is unknown. */
export function expiresAt(state: CacheState): number | null {
  const ms = ttlMs(state)
  return ms === null || state.lastRequestAt === null ? null : state.lastRequestAt + ms
}

export type Warmth = 'none' | 'warm' | 'cold' | 'unknown'

/** Warm until the expiry; with the TTL unknown, warm for five minutes (every TTL lasts that long), unknown after. */
export function warmthOf(state: CacheState, now: number): Warmth {
  if (state.lastRequestAt === null || state.lastPrefix < MIN_PREFIX) return 'none'
  const at = expiresAt(state)
  if (at !== null) return now < at ? 'warm' : 'cold'
  return now - state.lastRequestAt < TTL_MS['5m'] ? 'warm' : 'unknown'
}

/** Share of the prompt tokens served from the cache, over every request of this context. */
export function hitRatio(state: CacheState): number | null {
  const total = state.read + state.written + state.uncached
  return total === 0 ? null : state.read / total
}

/** How long before the expiry a refresh goes: a sixth of the TTL, between one and ten minutes. */
export const leadMs = (ttl: number): number => Math.min(600_000, Math.max(60_000, Math.round(ttl / 6)))

const ORDER: readonly CacheChange[] = ['compact', 'model', 'policy', 'style', 'tools', 'effort']

export function durationWords(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))} s`
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

/** Why a miss happened, in kind and severity, from the change seen before it or the gap. */
function classify(state: CacheState, gapMs: number, recached: number, isRefresh: boolean, at: number): Omit<CacheMiss, 'at' | 'recached' | 'prefix' | 'read' | 'gapMs' | 'isRefresh'> {
  const change = ORDER.map(c => state.pending.find(p => p.cause === c)).find(p => p !== undefined)
  if (change !== undefined) {
    if (change.cause === 'compact') return { cause: 'compact', kind: 'lifecycle', severity: 'info', detail: change.detail }
    return { cause: change.cause, kind: 'preventable', severity: recached >= 20_000 ? 'warn' : 'info', detail: change.detail }
  }
  const ttl = ttlMs(state)
  const isExpired = ttl === null ? gapMs > TTL_MS['5m'] : gapMs > ttl
  if (isExpired) {
    return {
      cause: 'expired',
      kind: 'preventable',
      severity: recached >= 50_000 && !isRefresh ? 'warn' : 'info',
      detail: `Idle ${durationWords(gapMs)}${ttl === null ? '' : `, past the ${state.ttl?.value === '1h' ? '1-hour' : '5-minute'} cache`}`,
    }
  }
  const recent = state.misses.filter(m => m.cause === 'unexplained' && at - m.at < 30 * 60_000).length
  return {
    cause: 'unexplained',
    kind: 'unavoidable',
    severity: recent >= 1 ? 'warn' : 'info',
    detail: recent >= 1 ? `Again, with nothing changed (${recent + 1} in 30 min)` : 'Nothing Control Room saw changed',
  }
}

export type Observed = {
  state: CacheState
  miss: CacheMiss | null
  /** Keep warm's verdict, when this request settled it. */
  verdict: 'yes' | 'no' | null
}

/**
 * One main-thread request's usage. `isRefresh` marks a Keep warm fork: it
 * re-sends the last request, so it keeps that request's prompt as the one
 * to find, and its own tail is never cached.
 */
export function observeRequest(
  state: CacheState,
  req: { at: number; input: number; read: number; written: number; model: string | null; effort: string | null; isRefresh?: boolean; isProbe?: boolean },
): Observed {
  const isProbe = req.isProbe === true
  const isRefresh = req.isRefresh === true || isProbe
  const prompt = req.input + req.read + req.written
  const gapMs = state.lastRequestAt === null ? 0 : Math.max(0, req.at - state.lastRequestAt)
  let next: CacheState = { ...state }
  // A change of model or effort is itself a change the cache may not survive.
  if (!isRefresh && state.requests > 0 && req.model !== null && state.model !== null && req.model !== state.model) {
    next = noteChange(next, { cause: 'model', at: req.at, detail: `Model changed: ${shortModel(state.model)} → ${shortModel(req.model)}` })
  }
  if (!isRefresh && state.requests > 0 && req.effort !== null && state.effort !== null && req.effort !== state.effort) {
    next = noteChange(next, { cause: 'effort', at: req.at, detail: `Effort changed: ${state.effort} → ${req.effort}` })
  }
  const expected = state.lastPrefix
  const isComparable = state.requests > 0 && expected >= MIN_PREFIX
  const isMiss = isComparable && req.read < expected * HIT_SHARE
  let miss: CacheMiss | null = null
  if (isMiss) {
    const recached = Math.max(0, expected - req.read)
    miss = { at: req.at, recached, prefix: expected, read: req.read, gapMs, isRefresh, ...classify(next, gapMs, recached, isRefresh, req.at) }
  }
  // What the TTL must be: a hit after more than five idle minutes proves the hour;
  // a lapse between five minutes and the hour, with nothing else to blame, points to five.
  if (isComparable && !isMiss && gapMs > TTL_MS['5m'] + 15_000) next = withTtl(next, '1h', isProbe ? 'probe' : 'observed')
  if (miss !== null && miss.cause === 'expired' && next.ttl === null && gapMs < TTL_MS['1h']) next = withTtl(next, '5m', isProbe ? 'probe' : 'observed')

  // Keep warm proves itself on the first request after the expiry a refresh replaced.
  let verdict: Observed['verdict'] = null
  const kw = { ...next.keepWarm }
  if (kw.provingAfter !== null && req.at > kw.provingAfter && isComparable) {
    if (!isMiss) verdict = 'yes'
    else if (miss !== null && (miss.cause === 'expired' || miss.cause === 'unexplained')) verdict = 'no'
    if (verdict !== null || isMiss) kw.provingAfter = null
    if (verdict !== null) kw.verified = verdict
  }
  if (isRefresh) {
    const oldExpiry = expiresAt(state)
    const isInTime = oldExpiry !== null && req.at < oldExpiry
    kw.refreshes += 1
    kw.lastAt = req.at
    kw.lastRead = req.read
    kw.lastHit = !isMiss
    // A refresh that read the cache before it lapsed is what the next request will test.
    if (!isMiss && isInTime && kw.verified !== 'yes') kw.provingAfter = oldExpiry
    // One sent in time that found the cache gone: once may be the server, twice is the method.
    if (isMiss && isInTime && !isProbe) {
      kw.failures += 1
      if (kw.failures >= 2 && kw.verified !== 'yes') {
        kw.verified = 'no'
        verdict = 'no'
      }
    }
  }
  next = {
    ...next,
    requests: next.requests + 1,
    read: next.read + req.read,
    written: next.written + req.written,
    uncached: next.uncached + req.input,
    lastRequestAt: req.at,
    lastPrefix: isRefresh ? state.lastPrefix || prompt : prompt,
    model: isRefresh ? state.model : (req.model ?? state.model),
    effort: isRefresh ? state.effort : (req.effort ?? state.effort),
    pending: isRefresh ? next.pending : [],
    misses: miss === null ? next.misses : [miss, ...next.misses].slice(0, MISSES_KEPT),
    keepWarm: kw,
  }
  return { state: next, miss, verdict }
}

export const shortModel = (id: string): string => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')

export type RefreshPlan = { at: number; isProbe: boolean } | { at: null; reason: string }

/**
 * When Keep warm refreshes next, or why it does not: only while it has a
 * chance to matter (the person away, the context worth keeping) and never
 * while the cache is about to be thrown away.
 */
export function nextRefresh(
  state: CacheState,
  input: {
    now: number
    isOn: boolean
    isTurnRunning: boolean
    contextTokens: number
    minTokens: number
    /** When the last turn ended (the person's idle time starts there). */
    idleSince: number | null
    maxIdleMs: number
    /** Why Autopilot makes a refresh pointless now (a handoff about to clear), else null. */
    standDown: string | null
  },
): RefreshPlan {
  if (!input.isOn) return { at: null, reason: 'Off' }
  if (state.keepWarm.verified === 'no') return { at: null, reason: 'It did not keep the cache warm here, so it stopped' }
  if (state.lastRequestAt === null || state.lastPrefix < MIN_PREFIX) return { at: null, reason: 'Nothing cached yet' }
  if (input.isTurnRunning) return { at: null, reason: 'Claude is working: its requests keep the cache warm' }
  if (input.standDown !== null) return { at: null, reason: input.standDown }
  if (input.contextTokens < input.minTokens) return { at: null, reason: 'The context is small: starting cold costs little' }
  const idleEnd = input.idleSince === null ? null : input.idleSince + input.maxIdleMs
  if (idleEnd !== null && input.now >= idleEnd) return { at: null, reason: `Paused after ${durationWords(input.maxIdleMs)} idle` }
  const ttl = ttlMs(state)
  if (ttl === null) {
    // The TTL is unknown: one refresh at six idle minutes tells. A hit means the hour.
    const at = state.lastRequestAt + TTL_MS['5m'] + 60_000
    return input.now > at + 120_000 ? { at: null, reason: 'Waiting to learn the cache lifetime' } : { at: Math.max(input.now, at), isProbe: true }
  }
  const expiry = state.lastRequestAt + ttl
  if (input.now >= expiry) return { at: null, reason: 'The cache lapsed before a refresh' }
  const at = Math.max(input.now, expiry - leadMs(ttl))
  if (idleEnd !== null && at > idleEnd) return { at: null, reason: `Pauses at the ${durationWords(input.maxIdleMs)} idle limit` }
  return { at, isProbe: false }
}

/** What to do about a miss, in one sentence. */
export function adviceFor(miss: CacheMiss, input: { keepWarm: boolean; stablePolicies: boolean }): string {
  switch (miss.cause) {
    case 'expired':
      return input.keepWarm
        ? 'Keep warm was paused or idle past its limit; raise the limit if you return later than that.'
        : 'Turn on Keep warm to hold the cache while you are away.'
    case 'model':
      return 'Switch models at the start of a fresh context; Control Room asks first when the cache is large.'
    case 'effort':
      return 'Change effort at the start of a fresh context: on this model the change rebuilds the cache.'
    case 'policy':
      return input.stablePolicies
        ? 'A Control Room policy changed the system prompt; it is kept stable while the cache is warm.'
        : 'Turn on Keep policies stable: setting changes then reach Claude as notes, not a new system prompt.'
    case 'style':
      return 'Change the output style at the start of a fresh context.'
    case 'tools':
      return 'Connect MCP servers and plugins before the work starts; a new tool rebuilds the whole cache.'
    case 'compact':
      return 'Expected: compaction always rebuilds the cache.'
    case 'unexplained':
      return miss.severity === 'warn'
        ? 'Repeated misses with nothing changed: check for a proxy or a gateway that does not keep the cache.'
        : 'Probably evicted by the server. Nothing to do unless it repeats.'
  }
}

export const CAUSE_LABEL: Record<MissCause, string> = {
  expired: 'Lapsed while idle',
  model: 'Model changed',
  effort: 'Effort changed',
  policy: 'Policies changed',
  style: 'Output style changed',
  tools: 'Tools changed',
  compact: 'Compacted',
  unexplained: 'Unexplained',
}

/** What is remembered across sessions (store `cache.v1`): the TTL learned, and Keep warm's verdict. */
export type CacheMemory = { v: 1; ttl: TtlValue | null; ttlSource: TtlSource | null; verified: KeepWarmState['verified']; verifiedAt: number | null }

export function memoryOf(raw: unknown): CacheMemory {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const ttl = r.ttl === '5m' || r.ttl === '1h' ? r.ttl : null
  const src = r.ttlSource === 'engine' || r.ttlSource === 'observed' || r.ttlSource === 'probe' ? r.ttlSource : null
  const verified = r.verified === 'yes' || r.verified === 'no' ? r.verified : 'unknown'
  return { v: 1, ttl, ttlSource: ttl === null ? null : src, verified, verifiedAt: typeof r.verifiedAt === 'number' ? r.verifiedAt : null }
}

