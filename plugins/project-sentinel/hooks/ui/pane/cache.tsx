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
import { apart, card, listItem, meterBar, note, pair, row, spaced, stepper, switchControl, textRuns } from '../primitives'
import { ACCENT, G, clockGlyph } from '../theme'

/** The idle limits Keep warm offers, in minutes. */
const IDLE_STEPS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480] as const

const LIFETIME: Record<string, string> = { '5m': '5-minute', '1h': '1-hour' }

const SOURCE: Record<string, string> = { engine: 'as Claude Code reports it', observed: 'observed', probe: 'learned by Keep warm', stored: 'learned earlier', plan: 'the plan’s default' }

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
  if (k.error !== null) return { text: `Retrying in 2 min: ${k.error}`, tone: 'warn' }
  if (k.isRefreshing) return { text: 'Refreshing now', tone: 'muted' }
  if (k.nextAt !== null) return { text: `Next refresh at ${fmt.clock(k.nextAt)}${k.isProbe ? ', to learn its lifetime' : ''}`, tone: 'muted' }
  return { text: k.reason ?? 'Waiting', tone: k.verified === 'no' ? 'warn' : 'muted' }
}

/** The conversation's check of the newest refresh, as the proof line says it. */
const MAIN_WORD: Record<CacheView['keepWarm']['main'], { text: string; tone: Tone }> = {
  none: { text: 'nothing to verify yet', tone: 'muted' },
  awaiting: { text: 'AWAITING VERIFICATION · the next request tells', tone: 'muted' },
  verified: { text: 'VERIFIED · read after the old expiry', tone: 'good' },
  consistent: { text: 'READ IT · back before the old expiry, no proof yet', tone: 'normal' },
  failed: { text: 'FAILED · rebuilt before the refreshed expiry', tone: 'bad' },
  untested: { text: 'NOT TESTED · something changed first', tone: 'muted' },
}

/**
 * Keep warm's proof, under its switch once it has refreshed: how many refreshes and when the last
 * went, what that fork read (HIT or MISS), and what the conversation's next request showed.
 */
export function keepWarmProof(cache: CacheView): { refreshes: string; fork: { text: string; tone: Tone } | null; main: { text: string; tone: Tone } } | null {
  const k = cache.keepWarm
  if (k.refreshes === 0 && k.log.length === 0) return null
  const last = k.log[0] ?? null
  const refreshes = `${fmt.plural(k.refreshes, 'refresh', 'refreshes')}${last === null ? '' : ` · last ${fmt.clock(last.at)}`}`
  const fork = last === null ? null : { text: `Fork: ${last.isHit ? 'HIT' : 'MISS'} · read ${fmt.tokens(last.read)} · wrote ${fmt.tokens(last.written)}`, tone: (last.isHit ? 'normal' : 'warn') as Tone }
  const main = { ...MAIN_WORD[k.main] }
  const settled = k.log.find(r => r.status !== 'renewed')
  if (k.main === 'untested' && settled?.note) main.text = `NOT TESTED · ${settled.note.replace(/^The request changed: /, 'changed: ')}`
  return { refreshes, fork, main }
}

/** Keep warm's proof as rows: the refreshes, the last fork's reading, the conversation's verdict. */
function keepWarmRows(k: Kit, cache: CacheView): RenderElement[] {
  const proof = keepWarmProof(cache)
  if (proof === null) return []
  const out: RenderElement[] = [pair(k, { key: 'kw-count', left: proof.refreshes })]
  if (proof.fork !== null) out.push(textRuns(k, 'kw-fork', [{ text: proof.fork.text, tone: proof.fork.tone }]))
  out.push(textRuns(k, 'kw-main', [{ text: 'Main cache: ', tone: 'muted' }, { text: proof.main.text, tone: proof.main.tone, isBold: proof.main.tone === 'good' || proof.main.tone === 'bad' }]))
  if (cache.keepWarm.pausedReason !== null) out.push(note(k, `Paused: ${cache.keepWarm.pausedReason}. Turn Keep warm on again to retry.`, 'kw-paused', 'warn'))
  return out
}

/**
 * One rebuild: what happened and when, what it cost (partial or full, and what it still read), then
 * (wrapping, under it) how sure the cause is and what would avoid it. A cause is stated only as far
 * as the evidence goes: proven, likely, or unknown; nothing is put on the server without evidence.
 */
function missItem(kit: Kit, m: CacheMissView, i: number): RenderElement {
  const { Box } = kit.ui
  const size = m.isPartial ? `partial · re-sent ${fmt.tokens(m.recached)}, read ${fmt.tokens(m.read)}` : `full · re-sent ${fmt.tokens(m.recached)}`
  return (
    <Box key={`miss-${i}`} flexDirection="column">
      {listItem(kit, {
        key: `miss-${i}-line`,
        glyph: m.severity === 'warn' ? G.warn : m.kind === 'lifecycle' ? G.ring : G.dot,
        tone: m.severity === 'warn' ? 'warn' : 'muted',
        text: `${m.label}: ${m.detail}`,
        right: spaced(kit, [size, fmt.clock(m.at)]),
        rightTone: m.severity === 'warn' ? 'warn' : 'muted',
        isDim: m.kind === 'lifecycle',
      })}
      <Box key={`miss-${i}-advice`} marginLeft={3}>
        {note(kit, `${CERTAINTY_WORD[m.certainty]}. ${m.advice}`, `miss-${i}-note`)}
      </Box>
    </Box>
  )
}

const CERTAINTY_WORD: Record<CacheMissView['certainty'], string> = { proven: 'Proven cause', likely: 'Likely cause', unknown: 'Cause unknown' }

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
      aside: cache.warmth === 'none' ? 'Nothing cached yet' : lifetime,
      footer: cache.warmth === 'none' ? undefined : 'The expiry, the hit ratio and the causes are derived from the tokens Claude Code reports.',
      rows: k => [
        cache.warmth === 'none'
          ? null
          : textRuns(k, 'cache-state', [
              { text: `${state.glyph} `, tone: state.tone === 'normal' ? 'info' : state.tone },
              { text: state.text, isBold: cache.warmth === 'warm', tone: cache.warmth === 'warm' ? 'normal' : 'muted' },
            ]),
        cache.warmth === 'none'
          ? null
          : meterBar(k, { key: 'cache-left', fraction: state.fraction ?? 0, tone: cache.warmth === 'warm' ? 'info' : 'muted', width: k.columns, alt: state.text }),
        cache.warmth === 'none' ? null : pair(k, { key: 'cache-under', left: `${fmt.tokens(cache.cachedTokens)} tokens cached · ${fmt.plural(cache.requests, 'request')}`, right: hit ?? undefined }),
        (cache.warmth === 'none' ? (_k: Kit, _key: string, el: RenderElement) => el : apart)(
          k,
          'cache-keep',
          row(k, {
            key: 'cache-keep',
            label: 'Keep warm while you are away',
            subtitle: kw.text,
            subtitleTone: kw.tone,
            control: switchControl(k, { key: 'cache-keep', isOn: settings.keepWarm, onPress: () => u(d => void (d.cache.keepWarm = !d.cache.keepWarm)) }),
          }),
        ),
        ...(settings.keepWarm ? keepWarmRows(k, cache) : []),
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
          subtitle: 'When it would re-send 100k+ cached tokens',
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
        rows: k => cache.misses.slice(0, 4).map((m, i) => missItem(k, m, i)),
      }),
    )
  }
  return out
}

/** What the cache holds, in a line, for Overview's lifecycle card: its state is the line above it, said once. */
export function cacheSummary(cache: CacheView): string {
  if (cache.warmth === 'none') return 'Nothing cached yet'
  const parts = [`${fmt.tokens(cache.cachedTokens)} cached`]
  if (cache.hitRatio !== null) parts.push(`${Math.round(cache.hitRatio * 100)}% read from cache`)
  return parts.join(' · ')
}

/** The cache's lifetime in a few words, for a card's aside; null while it is not known. */
export function lifetimeWords(cache: CacheView): string | null {
  return cache.ttl === null ? null : `${LIFETIME[cache.ttl]} cache`
}
