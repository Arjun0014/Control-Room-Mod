/**
 * Cache Guardian: watches the main conversation's prompt cache and, when
 * asked to, keeps it warm while the person is away.
 *
 * It reads every main-thread request's usage (features/cache.ts decides what
 * it means), learns the cache's lifetime, explains misses, and schedules a
 * refresh before the cache lapses: one fork of the last request, which the
 * API serves from the cache and the transcript never sees. Each refresh is
 * checked, and the first request after the expiry it replaced must still
 * read the cache; if refreshes do not hold it, Keep warm turns itself off.
 *
 * It also keeps Control Room's own system-prompt section stable while the
 * cache is warm, so a setting changed mid-context reaches Claude as a note
 * instead of rebuilding the whole cache.
 */

import type { ModelForkResult, Timer } from 'claude-code'

import type { CacheMissView, CacheView, HudModel } from '../../types'
import { STORE_KEYS } from '../constants'
import type { Settings } from '../core/settings'
import * as Cache from '../features/cache'
import { KEEP_WARM_PROMPT } from '../features/prompts'
import type { Host } from '../host'

type Ctx = {
  host: () => Host | null
  /** Milliseconds since the epoch: the Runtime's clock (a test's manual one). */
  now: () => number
  settings: () => Settings
  isTurnRunning: () => boolean
  contextTokens: () => number
  /** Why a refresh is pointless now (a handoff about to clear the context), else null. */
  standDown: () => string | null
  changed: () => void
  /** A miss the person should hear about now. */
  missed: (miss: Cache.CacheMiss) => void
  /** Keep warm's verdict on itself. */
  verdict: (verdict: 'yes' | 'no') => void
}

const RECENT_MISS_MS = 5 * 60_000

export class CacheGuardian {
  state: Cache.CacheState = Cache.emptyCache()
  memory: Cache.CacheMemory = Cache.memoryOf(undefined)
  plan: Cache.RefreshPlan = { at: null, reason: 'Off' }
  /** When the last main turn ended: the person's idle time starts there. */
  idleSince: number | null = null
  isRefreshing = false
  lastError: string | null = null

  private timer: Timer | null = null
  private steps = new Map<string, { at: number; effort: string | null }>()
  /** The policy text the system prompt last carried, while it is held stable. */
  private delivered: string | null = null
  private style: string | null | undefined = undefined
  private tools: string | null = null

  constructor(private readonly ctx: Ctx) {}

  /** What earlier sessions learned (the TTL, Keep warm's verdict). */
  async load(): Promise<void> {
    const host = this.ctx.host()
    if (host === null) return
    this.memory = Cache.memoryOf(await host.storeGet(STORE_KEYS.cache).catch(() => undefined))
    this.state = this.fresh()
    this.ctx.changed()
  }

  private fresh(): Cache.CacheState {
    const m = this.memory
    return Cache.emptyCache({ ttl: m.ttl === null ? null : { value: m.ttl, source: 'stored' }, verified: m.verified })
  }

  private remember(patch: Partial<Cache.CacheMemory> = {}): void {
    const s = this.state
    const next: Cache.CacheMemory = {
      v: 1,
      ttl: s.ttl?.value ?? this.memory.ttl,
      ttlSource: s.ttl !== null && s.ttl.source !== 'stored' ? s.ttl.source : this.memory.ttlSource,
      verified: s.keepWarm.verified === 'unknown' ? this.memory.verified : s.keepWarm.verified,
      verifiedAt: s.keepWarm.verified !== this.memory.verified && s.keepWarm.verified !== 'unknown' ? this.ctx.now() : this.memory.verifiedAt,
      effortRebuilds: this.memory.effortRebuilds,
      ...patch,
    }
    if (JSON.stringify(next) === JSON.stringify(this.memory)) return
    this.memory = next
    void this.ctx.host()?.storeSet(STORE_KEYS.cache, next).catch(() => undefined)
  }

  /** A fresh context (/clear): its cache starts empty; the system prompt may change freely. */
  resetForContext(): void {
    this.cancel()
    this.state = this.fresh()
    this.steps.clear()
    this.delivered = null
    this.isHeldNoteSent = false
    this.idleSince = null
    this.plan = { at: null, reason: 'Nothing cached yet' }
    this.ctx.changed()
  }

  /** Keep warm turned on again: whatever it concluded about itself before is forgotten, so it tries afresh. */
  resetVerdict(): void {
    this.state = Cache.withVerdictReset(this.state)
    this.remember({ verified: 'unknown', verifiedAt: null })
    this.lastError = null
    this.ctx.changed()
  }

  /** True when a change of effort was seen to rebuild the cache on this model (learned from earlier misses). */
  isEffortRebuilding(model: string | null): boolean {
    const m = model ?? this.state.model
    return m !== null && this.memory.effortRebuilds.includes(Cache.shortModel(m))
  }

  // ---------------------------------------------------------------------------
  // Requests

  stepStarted(key: string, effort: string | null): void {
    this.steps.set(key, { at: this.ctx.now(), effort })
    if (this.steps.size > 50) this.steps.delete(this.steps.keys().next().value as string)
  }

  stepAnswered(key: string, usage: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string }): void {
    const start = this.steps.get(key)
    this.steps.delete(key)
    this.observe({
      at: start?.at ?? this.ctx.now(),
      input: usage.input_tokens,
      read: usage.cache_read_input_tokens,
      written: usage.cache_creation_input_tokens,
      model: usage.model,
      effort: start?.effort ?? null,
    })
  }

  private observe(req: Parameters<typeof Cache.observeRequest>[1]): void {
    const model = this.state.model
    const result = Cache.observeRequest(this.state, req)
    this.state = result.state
    if (result.miss !== null) this.ctx.missed(result.miss)
    if (result.verdict !== null) this.ctx.verdict(result.verdict)
    // An effort change followed by a miss: on this model effort is part of what the cache keys on.
    const short = model === null ? null : Cache.shortModel(model)
    const isEffortMiss = result.miss !== null && result.miss.cause === 'effort' && short !== null && !this.memory.effortRebuilds.includes(short)
    this.remember(isEffortMiss && short !== null ? { effortRebuilds: [...this.memory.effortRebuilds, short].slice(-12) } : {})
    this.keepTicking()
    this.ctx.changed()
  }

  turnStarted(): void {
    this.idleSince = null
    this.cancel()
    this.plan = { at: null, reason: 'Claude is working: its requests keep the cache warm' }
    this.ctx.changed()
  }

  turnEnded(now: number): void {
    this.idleSince = now
    this.schedule()
  }

  // ---------------------------------------------------------------------------
  // Changes that rebuild the cache

  noteCompact(now: number): void {
    this.state = Cache.noteChange(this.state, { cause: 'compact', at: now, detail: 'The conversation was compacted' })
    this.delivered = null
    this.ctx.changed()
  }

  /** The model router sends this turn to another model: a miss after it is the router's doing, not the person's. */
  noteRouted(from: string, to: string, why: string): void {
    if (from === to) return
    this.state = Cache.noteChange(this.state, { cause: 'model', at: this.ctx.now(), detail: `Model router: ${Cache.shortModel(from)} → ${Cache.shortModel(to)} (${why})`, by: 'router' })
    this.ctx.changed()
  }

  /** The cache lifetime as the engine reported it before a model switch. */
  noteTtl(ttl: '5m' | '1h'): void {
    this.state = Cache.withTtl(this.state, ttl, 'engine')
    this.remember()
    this.ctx.changed()
  }

  /** A model switch the engine reported: its TTL, and the rebuild it means. */
  noteModelSwitch(input: { from: string; to: string; ttl: '5m' | '1h'; now: number; by: Cache.ChangeBy }): void {
    this.state = Cache.withTtl(this.state, input.ttl, 'engine')
    if (input.from !== input.to) {
      const how = input.by === 'engine' ? 'Claude Code switched models' : 'Model changed'
      this.state = Cache.noteChange(this.state, { cause: 'model', at: input.now, detail: `${how}: ${Cache.shortModel(input.from)} → ${Cache.shortModel(input.to)}`, by: input.by })
    }
    this.remember()
    this.ctx.changed()
  }

  /** The tools offered (by name): a new or removed tool rewrites the start of every request. */
  noteTools(names: readonly string[]): void {
    const key = [...names].sort().join('\n')
    if (this.tools !== null && this.tools !== key) {
      const before = new Set(this.tools.split('\n'))
      const after = new Set(names)
      const added = names.filter(n => !before.has(n))
      const removed = [...before].filter(n => !after.has(n))
      const what = [added.length > 0 ? `${added.length} added` : '', removed.length > 0 ? `${removed.length} removed` : ''].filter(Boolean).join(', ')
      this.state = Cache.noteChange(this.state, { cause: 'tools', at: this.ctx.now(), detail: `Tools changed (${what || 'reordered'})` })
      this.ctx.changed()
    }
    this.tools = key
  }

  /**
   * The policy section for this request. While the cache is warm and worth
   * keeping, and the person asked for stable policies, the text the system
   * prompt already carries is sent again; the change went to Claude as a note.
   */
  policyText(text: string | null, outputStyle: string | null, reason: string | null): string | null {
    if (this.style !== undefined && this.style !== outputStyle) {
      this.state = Cache.noteChange(this.state, { cause: 'style', at: this.ctx.now(), detail: `Output style changed to ${outputStyle ?? 'default'}` })
    }
    this.style = outputStyle
    const current = text ?? ''
    if (this.delivered === null) {
      this.delivered = current
      return text
    }
    if (current === this.delivered) {
      this.isHeldNoteSent = false
      return text
    }
    if (this.isHoldingPolicies()) return this.delivered === '' ? null : this.delivered
    // A cold cache is rebuilt anyway: only a warm one is lost to the change.
    if (Cache.warmthOf(this.state, this.ctx.now()) === 'warm') {
      this.state = Cache.noteChange(this.state, { cause: 'policy', at: this.ctx.now(), detail: reason === null ? 'Control Room policies changed' : `Control Room policies changed: ${reason}`, by: 'person' })
    }
    this.delivered = current
    this.isHeldNoteSent = false
    this.ctx.changed()
    return text
  }

  /** True once Claude was told, by a note, that policies other than its system prompt's apply. */
  isHeldNoteSent = false

  /** True while setting changes are told to Claude as notes, so the cached system prompt stays as it is. */
  isHoldingPolicies(): boolean {
    const s = this.ctx.settings().cache
    return s.stablePolicies && this.delivered !== null && Cache.warmthOf(this.state, this.ctx.now()) === 'warm' && this.state.lastPrefix >= s.minTokens
  }

  /** True when the system prompt carries other policies than the settings now say (held stable). */
  isPolicyHeld(current: string | null): boolean {
    return this.delivered !== null && this.delivered !== (current ?? '')
  }

  // ---------------------------------------------------------------------------
  // Keep warm

  cancel(): void {
    this.timer?.cancel()
    this.timer = null
  }

  /** The session ends: no refresh, no countdown. */
  stop(): void {
    this.cancel()
    this.ticker?.cancel()
    this.ticker = null
  }

  refreshPlan(now: number): Cache.RefreshPlan {
    const s = this.ctx.settings().cache
    return Cache.nextRefresh(this.state, {
      now,
      isOn: s.keepWarm,
      isTurnRunning: this.ctx.isTurnRunning(),
      contextTokens: Math.max(this.ctx.contextTokens(), this.state.lastPrefix),
      minTokens: s.minTokens,
      idleSince: this.idleSince,
      maxIdleMs: s.maxIdleMinutes * 60_000,
      standDown: this.ctx.standDown(),
    })
  }

  /** Plans the next refresh (or says why there is none) and sets its timer. */
  schedule(): void {
    this.cancel()
    const host = this.ctx.host()
    if (host === null) return
    this.plan = this.refreshPlan(this.ctx.now())
    this.ctx.changed()
    const plan = this.plan
    if (plan.at === null) return
    this.timer = host.after(Math.max(1000, plan.at - this.ctx.now()), () => {
      this.timer = null
      void this.refresh(plan.isProbe)
    })
  }

  private async refresh(isProbe: boolean): Promise<void> {
    const host = this.ctx.host()
    if (host === null || this.isRefreshing) return
    // The world may have moved since the timer was set.
    const plan = this.refreshPlan(this.ctx.now())
    if (plan.at === null || plan.at > this.ctx.now() + 5000) {
      this.schedule()
      return
    }
    this.isRefreshing = true
    const at = this.ctx.now()
    let result: ModelForkResult | null = null
    try {
      result = await host.fork(KEEP_WARM_PROMPT)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)
    } finally {
      this.isRefreshing = false
    }
    if (result !== null && (result.isAnswered || result.reason !== 'nothing-to-fork')) {
      const u = result.usage
      const answered = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens > 0
      if (answered) {
        this.lastError = null
        this.observe({ at, input: u.input_tokens, read: u.cache_read_input_tokens, written: u.cache_creation_input_tokens, model: null, effort: null, isRefresh: true, isProbe: plan.isProbe || isProbe })
      } else if (!result.isAnswered) {
        this.lastError = result.reason === 'api-error' ? `The API refused the refresh (${result.error})` : `No reply (${result.reason})`
      }
    }
    // A failed attempt tries again in two minutes while the cache can still be saved.
    if (this.lastError !== null && host !== null) {
      this.cancel()
      this.timer = host.after(120_000, () => {
        this.timer = null
        this.schedule()
      })
      this.ctx.changed()
      return
    }
    this.schedule()
  }

  // ---------------------------------------------------------------------------
  // Views

  view(now: number): CacheView {
    const s = this.state
    const settings = this.ctx.settings().cache
    const plan = this.plan
    return {
      warmth: Cache.warmthOf(s, now),
      ttl: s.ttl?.value ?? null,
      ttlSource: s.ttl?.source ?? null,
      expiresAt: Cache.expiresAt(s),
      lastRequestAt: s.lastRequestAt,
      cachedTokens: s.lastPrefix,
      requests: s.requests,
      hitRatio: Cache.hitRatio(s),
      read: s.read,
      written: s.written,
      model: s.model,
      keepWarm: {
        isOn: settings.keepWarm,
        nextAt: plan.at,
        isProbe: plan.at !== null && plan.isProbe,
        reason: plan.at === null ? plan.reason : null,
        refreshes: s.keepWarm.refreshes,
        lastAt: s.keepWarm.lastAt,
        lastRead: s.keepWarm.lastRead,
        lastHit: s.keepWarm.lastHit,
        verified: s.keepWarm.verified,
        maxIdleMinutes: settings.maxIdleMinutes,
        isRefreshing: this.isRefreshing,
        error: this.lastError,
      },
      misses: s.misses.slice(0, 8).map(m => missView(m, settings)),
      policies: { isStable: settings.stablePolicies, isHolding: this.isHoldingPolicies() },
      guardModelSwitch: settings.guardModelSwitch,
    }
  }

  hud(now: number): HudModel['cache'] {
    const s = this.state
    const warmth = Cache.warmthOf(s, now)
    if (warmth === 'none') return null
    const latest = s.misses[0]
    // Only a costly rebuild is worth the status bar's attention, and only for a few minutes.
    const recent = latest !== undefined && now - latest.at < RECENT_MISS_MS && latest.kind !== 'lifecycle' && latest.severity === 'warn' ? latest : null
    const expiresAt = Cache.expiresAt(s)
    const ttl = Cache.ttlMs(s)
    const leftMs = warmth === 'warm' && expiresAt !== null ? Math.max(0, expiresAt - now) : null
    const fraction = leftMs !== null && ttl !== null ? leftMs / ttl : warmth === 'warm' ? 1 : 0
    // Near the expiry with no refresh coming before it: amber, worth a look.
    const isRefreshing = this.plan.at !== null && expiresAt !== null && this.plan.at < expiresAt
    const isNear = leftMs !== null && ttl !== null && leftMs <= Cache.leadMs(ttl) && !isRefreshing
    const text = recent !== null ? `rebuilt ${tokensWord(recent.recached)}` : warmth === 'warm' ? (leftMs === null ? 'warm' : leftWords(leftMs)) : warmth === 'cold' ? 'cold' : 'lapsed?'
    return {
      warmth,
      ttl: s.ttl?.value ?? null,
      expiresAt,
      leftMs,
      fraction,
      text,
      tone: recent !== null || isNear ? 'warn' : warmth === 'warm' ? 'normal' : 'muted',
      cachedTokens: s.lastPrefix,
      keepWarm: this.ctx.settings().cache.keepWarm && s.keepWarm.verified !== 'no',
      nextRefreshAt: this.plan.at,
      recentMiss: recent === null ? null : { label: Cache.CAUSE_LABEL[recent.cause], recached: recent.recached, severity: recent.severity, at: recent.at },
    }
  }

  // ---------------------------------------------------------------------------
  // The countdown

  private ticker: Timer | null = null

  /**
   * While the cache is warm, the status bar's countdown and the panel's
   * expiry move on once a minute (one republish; nothing is sent anywhere).
   * The tick stops once the cache is cold.
   */
  private keepTicking(): void {
    const host = this.ctx.host()
    if (host === null || this.ticker !== null) return
    this.ticker = host.every(60_000, () => {
      const warmth = Cache.warmthOf(this.state, this.ctx.now())
      this.ctx.changed()
      if (warmth !== 'warm') {
        this.ticker?.cancel()
        this.ticker = null
      }
    })
  }
}

const tokensWord = (n: number): string => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** "52m", "1h", "<1m": the time a warm cache has left, as the status bar says it. */
export function leftWords(ms: number): string {
  if (ms < 60_000) return '<1m'
  const m = Math.ceil(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 === 0 ? '' : ` ${m % 60}m`}` : `${m}m`
}

export function missView(m: Cache.CacheMiss, settings: Settings['cache']): CacheMissView {
  return {
    at: m.at,
    cause: m.cause,
    label: Cache.CAUSE_LABEL[m.cause],
    kind: m.kind,
    severity: m.severity,
    recached: m.recached,
    detail: m.detail,
    advice: Cache.adviceFor(m, { keepWarm: settings.keepWarm, stablePolicies: settings.stablePolicies }),
    isRefresh: m.isRefresh,
  }
}
