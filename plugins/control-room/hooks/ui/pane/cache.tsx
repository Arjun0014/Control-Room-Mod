/**
 * The prompt cache, in Context: how warm it is and for how long, what it
 * holds, Keep warm and the other cache-aware settings, then its health (the
 * recent rebuilds, why each happened and what would have avoided it).
 *
 * Claude Code reports each request's tokens read from the cache and written
 * to it, never an expiry, a hit ratio or a cause: those are derived, and the
 * card says so.
 */

import type { RenderElement } from 'claude-code'

import type { CacheMissView, CacheView, Tone } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { card, listItem, meterBar, pair, row, spaced, stepper, switchControl, textRuns } from '../primitives'
import { ACCENT, G, clockGlyph } from '../theme'

/** The idle limits Keep warm offers, in minutes. */
const IDLE_STEPS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480] as const

const LIFETIME: Record<string, string> = { '5m': '5-minute', '1h': '1-hour' }

const SOURCE: Record<string, string> = { engine: 'as Claude Code reports it', observed: 'observed', probe: 'learned by Keep warm', stored: 'learned earlier' }

const KIND: Record<CacheMissView['kind'], string> = { preventable: 'preventable', lifecycle: 'expected', unavoidable: 'unexplained' }

/** The cache's state in one line, with the tone it needs. */
export function cacheState(cache: CacheView, now: number): { glyph: string; text: string; tone: Tone; fraction: number | null } {
  switch (cache.warmth) {
    case 'none':
      return { glyph: G.ring, text: 'Nothing cached yet', tone: 'muted', fraction: null }
    case 'cold':
      return { glyph: clockGlyph(0), text: 'Lapsed: the next request rebuilds it', tone: 'muted', fraction: 0 }
    case 'unknown':
      return { glyph: clockGlyph(0), text: 'May have lapsed: its lifetime is not known yet', tone: 'muted', fraction: null }
    case 'warm': {
      if (cache.expiresAt === null || cache.ttl === null) return { glyph: clockGlyph(1), text: 'Warm', tone: 'normal', fraction: 1 }
      const left = Math.max(0, cache.expiresAt - now)
      const ttl = cache.ttl === '1h' ? 3_600_000 : 300_000
      const words = left < 60_000 ? 'within a minute' : `in about ${fmt.minutes(Math.ceil(left / 60_000))}`
      return { glyph: clockGlyph(left / ttl), text: `Warm · lapses ${words}`, tone: 'normal', fraction: left / ttl }
    }
  }
}

/** What Keep warm is doing, in a line: the next refresh, or why there is none. */
export function keepWarmStatus(cache: CacheView): { text: string; tone: Tone } {
  const k = cache.keepWarm
  if (!k.isOn) return { text: 'Refreshes the cache before it lapses while you are away', tone: 'muted' }
  const verified = k.verified === 'yes' ? ' · verified here' : ''
  const count = k.refreshes > 0 ? ` · ${fmt.plural(k.refreshes, 'refresh', 'refreshes')} so far` : ''
  if (k.error !== null) return { text: `Retrying in 2 min: ${k.error}`, tone: 'warn' }
  if (k.isRefreshing) return { text: 'Refreshing now', tone: 'muted' }
  if (k.nextAt !== null) return { text: `Next refresh at ${fmt.clock(k.nextAt)}${k.isProbe ? ', to learn its lifetime' : ''}${count}${verified}`, tone: 'muted' }
  return { text: `${k.reason ?? 'Waiting'}${count}${verified}`, tone: k.verified === 'no' ? 'warn' : 'muted' }
}

function missItem(kit: Kit, m: CacheMissView, i: number): RenderElement {
  return listItem(kit, {
    key: `miss-${i}`,
    glyph: m.severity === 'warn' ? G.warn : m.kind === 'lifecycle' ? G.ring : G.dot,
    tone: m.severity === 'warn' ? 'warn' : 'muted',
    text: spaced(kit, [fmt.clock(m.at), m.detail]),
    right: `${fmt.tokens(m.recached)} · ${KIND[m.kind]}`,
    rightTone: m.severity === 'warn' ? 'warn' : 'muted',
    detail: m.advice,
    isDim: m.kind === 'lifecycle',
  })
}

export function cacheCards(kit: Kit, cache: CacheView, settings: { keepWarm: boolean; maxIdleMinutes: number; guardModelSwitch: boolean; stablePolicies: boolean }): RenderElement[] {
  const u = kit.actions.update
  const accent = ACCENT.context
  const state = cacheState(cache, kit.now)
  const kw = keepWarmStatus(cache)
  const idle = settings.maxIdleMinutes
  const lower = [...IDLE_STEPS].reverse().find(m => m < idle)
  const higher = IDLE_STEPS.find(m => m > idle)
  const lifetime = cache.ttl === null ? 'Lifetime not known yet' : `${LIFETIME[cache.ttl]} cache · ${SOURCE[cache.ttlSource ?? 'observed'] ?? 'observed'}`
  const hit = cache.hitRatio === null ? null : `${Math.round(cache.hitRatio * 100)}% read from cache`
  const preventable = cache.misses.filter(m => m.kind === 'preventable').length

  const out: RenderElement[] = [
    card(kit, {
      key: 'cache',
      title: 'Cache',
      accent,
      aside: cache.warmth === 'none' ? undefined : lifetime,
      footer: 'Claude Code reports the tokens each request read from the cache and wrote to it. The expiry, the hit ratio and the causes are derived from those.',
      rows: k => [
        textRuns(k, 'cache-state', [
          { text: `${state.glyph} `, tone: state.tone === 'normal' ? 'info' : state.tone },
          { text: state.text, isBold: cache.warmth === 'warm', tone: cache.warmth === 'warm' ? 'normal' : 'muted' },
        ]),
        cache.warmth === 'none'
          ? null
          : meterBar(k, { key: 'cache-left', fraction: state.fraction ?? 0, tone: cache.warmth === 'warm' ? 'info' : 'muted', width: k.columns, alt: state.text }),
        cache.warmth === 'none'
          ? pair(k, { key: 'cache-under', left: 'The cache starts with Claude’s first response in this context.' })
          : pair(k, { key: 'cache-under', left: `${fmt.tokens(cache.cachedTokens)} tokens cached · ${fmt.plural(cache.requests, 'request')}`, right: hit ?? undefined }),
        row(k, {
          key: 'cache-keep',
          label: 'Keep warm while you are away',
          subtitle: kw.text,
          subtitleTone: kw.tone,
          control: switchControl(k, { key: 'cache-keep', isOn: settings.keepWarm, onPress: () => u(d => void (d.cache.keepWarm = !d.cache.keepWarm)) }),
        }),
        settings.keepWarm &&
          row(k, {
            key: 'cache-idle',
            label: 'Stop after',
            subtitle: cache.ttl === '5m' && idle > 45 ? 'The 5-minute cache stops at 45 min: refreshing longer costs more' : 'Of idle time, if you have not come back',
            control: stepper(k, {
              key: 'cache-idle',
              display: fmt.minutes(idle),
              onDecrease: lower === undefined ? undefined : () => u(d => void (d.cache.maxIdleMinutes = lower)),
              onIncrease: higher === undefined ? undefined : () => u(d => void (d.cache.maxIdleMinutes = higher)),
            }),
          }),
        row(k, {
          key: 'cache-guard',
          label: 'Ask before a model switch',
          subtitle: 'When the switch would re-send 100k or more cached tokens',
          control: switchControl(k, { key: 'cache-guard', isOn: settings.guardModelSwitch, onPress: () => u(d => void (d.cache.guardModelSwitch = !d.cache.guardModelSwitch)) }),
        }),
        row(k, {
          key: 'cache-stable',
          label: 'Keep policies stable',
          subtitle: cache.policies.isHolding && settings.stablePolicies ? 'Holding: setting changes reach Claude as notes' : 'While the cache is warm, setting changes reach Claude as notes',
          control: switchControl(k, { key: 'cache-stable', isOn: settings.stablePolicies, onPress: () => u(d => void (d.cache.stablePolicies = !d.cache.stablePolicies)) }),
        }),
      ],
    }),
  ]
  if (cache.misses.length > 0) {
    out.push(
      card(kit, {
        key: 'cache-health',
        title: 'Cache health',
        accent,
        aside: preventable > 0 ? `${fmt.plural(cache.misses.length, 'rebuild')} · ${preventable} preventable` : fmt.plural(cache.misses.length, 'rebuild'),
        rows: k => cache.misses.slice(0, 6).map((m, i) => missItem(k, m, i)),
      }),
    )
  }
  return out
}

/** The cache in a line, for Overview's lifecycle card. */
export function cacheSummary(cache: CacheView, now: number): string {
  if (cache.warmth === 'none') return 'Nothing cached yet'
  const state = cacheState(cache, now)
  const parts = [`${fmt.tokens(cache.cachedTokens)} cached`]
  if (cache.hitRatio !== null) parts.push(`${Math.round(cache.hitRatio * 100)}% read from cache`)
  parts.push(cache.keepWarm.isOn ? (cache.keepWarm.verified === 'no' ? 'Keep warm stopped' : 'Keep warm on') : 'Keep warm off')
  return cache.warmth === 'warm' ? parts.join(' · ') : `${state.text.split(':')[0]} · ${parts.join(' · ')}`
}
