/**
 * Overview: how the run is doing, then a map of everything that is on.
 *
 * It leads with the run (its number, the session, the whole run's cost),
 * then the three lifecycles, each a card with its own graphic and one line
 * on how it starts over:
 *
 *   WORK     the objective's milestones; carries across handoffs
 *   CONTEXT  the reasoning window; starts over at each handoff
 *   CACHE    the prompt cache; starts over with each fresh context, lapses when idle
 *
 * Then what is happening now and what needs a look, the profile, and one
 * card per remaining section in that section's accent, each system with its
 * switch and one line of state, and a quiet "Open ›" to the section itself,
 * so the page also teaches where everything lives.
 */

import type { RenderElement } from 'claude-code'

import type { PermissionCategory, StatusView, Tone } from '../../../types'
import * as fmt from '../../core/format'
import { listProfiles } from '../../core/profiles'
import { PERMISSION_CATEGORIES } from '../../core/settings'
import type { Kit } from '../kit'
import { apart, cacheClock, callout, card, clip, emptyState, link, listItem, meterBar, pair, picker, row, stateLine, switchControl, textRuns, workTrack } from '../primitives'
import { ACCENT, G } from '../theme'
import { cacheState, cacheSummary, lifetimeWords } from './cache'
import type { PaneData } from './frame'

/** A status as a row's subtitle: quiet unless it needs a look. */
export const subtitleOf = (s: StatusView): { subtitle: string; subtitleTone: Tone } => ({
  subtitle: s.text,
  subtitleTone: s.tone === 'warn' || s.tone === 'bad' ? s.tone : 'muted',
})

export function alertCallout(kit: Kit, data: PaneData): RenderElement | null {
  const alert = data.hud.alert
  if (alert === null) return null
  if (alert.kind === 'pending') {
    return callout(kit, {
      key: 'alert',
      tone: 'warn',
      title: 'Handing off soon',
      text: 'Claude is finishing the current step. Then it writes handoff notes and continues in a fresh context.',
      actions: [
        { key: 'alert-handoff', label: 'Hand off now', onPress: kit.actions.handoff, isPrimary: true },
        { key: 'alert-later', label: 'Later', onPress: kit.actions.snooze },
      ],
    })
  }
  if (alert.kind === 'awaiting') {
    return callout(kit, {
      key: 'alert',
      tone: alert.tone,
      title: 'Waiting for you',
      text: alert.text,
      actions: [
        { key: 'alert-fresh', label: 'Start fresh context', onPress: kit.actions.fresh, isPrimary: true },
        { key: 'alert-later', label: 'Later', onPress: kit.actions.snooze },
      ],
    })
  }
  return callout(kit, { key: 'alert', tone: 'bad', title: 'Machine under heavy load', text: alert.text })
}

function permissionSummary(p: Record<PermissionCategory, string>): string {
  const count = (state: string) => PERMISSION_CATEGORIES.filter(c => p[c] === state).length
  const parts = [count('ask') > 0 ? `${count('ask')} ask` : '', count('deny') > 0 ? `${count('deny')} deny` : ''].filter(Boolean)
  return parts.length === 0 ? 'Claude Code decides' : parts.join(' · ')
}

/** The run at the top: which run and session, the whole run's cost, and what it is for. */
function runHeader(kit: Kit, data: PaneData): RenderElement {
  const { Box, Text } = kit.ui
  const { hud } = data
  const run = hud.cost.runUsd ?? hud.cost.usd
  const s = hud.session
  const title = s.run === null ? 'No run yet' : `Run ${s.run} · Session ${s.index}`
  const under = [s.handoffs > 0 ? fmt.plural(s.handoffs, 'handoff') : '', s.handoffs > 0 && hud.cost.usd !== null ? `${fmt.cost(hud.cost.usd)} this session` : ''].filter(Boolean).join(' · ')
  return (
    <Box key="run-head" flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Box flexShrink={1} {...clip(kit)}>
          <Text bold wrap="truncate-end">
            <Text color="claude">{`${G.brand} `}</Text>
            {title}
          </Text>
        </Box>
        <Text bold dimColor={run === null ? true : undefined}>{`${fmt.cost(run)}${run !== null && hud.cost.isRunPartial ? '+' : ''}`}</Text>
      </Box>
      {hud.objective === null && under === '' ? null : pair(kit, { key: 'run-under', left: hud.objective ?? '', right: under === '' ? undefined : under })}
      {hud.git === null || kit.surface !== 'terminal' ? null : pair(kit, { key: 'run-git', left: `Git   ${hud.git}` })}
    </Box>
  )
}

export function overviewPage(kit: Kit, data: PaneData): RenderElement {
  const { Box } = kit.ui
  const { pane, hud } = data
  const s = pane.settings
  const st = pane.status
  const u = kit.actions.update
  const ctx = hud.ctx
  const go = (tab: Parameters<Kit['actions']['setTab']>[0]) => ({ label: 'Open', onPress: () => kit.actions.setTab(tab) })

  const fraction = ctx.tokens !== null && ctx.window !== null && ctx.window > 0 ? ctx.tokens / ctx.window : 0
  const marker = ctx.threshold !== null && ctx.window !== null && ctx.window > 0 ? ctx.threshold / ctx.window : null
  const load = hud.load
  const pct = (n: number | null) => (n === null ? G.none : `${Math.round(n)}%`)
  const readingTone = (t: Tone): Tone => (t === 'warn' || t === 'bad' ? t : 'normal')

  const toggle = (k: Kit, key: string, label: string, isOn: boolean, onPress: () => void, status: StatusView) =>
    row(k, { key, label, control: switchControl(k, { key, isOn, onPress }), ...(isOn ? subtitleOf(status) : {}) })

  const profiles = listProfiles(s).map(p => ({ value: p.id, label: p.name, hint: p.tagline }))
  const activeProfile = profiles.find(p => p.value === s.profile)

  const work = hud.work
  const cache = pane.cache
  const cacheNow = cacheState(cache, kit.now)
  const lapses = cache.ttl === '5m' ? 'lapses after five idle minutes' : cache.ttl === '1h' ? 'lapses after an idle hour' : 'lapses when left idle'
  const line = hud.headline
  const isLoadHigh = load !== null && (readingTone(load.cpuTone) !== 'normal' || readingTone(load.ramTone) !== 'normal')
  const needsLook = hud.attention + hud.failing.length

  return (
    <Box flexDirection="column">
      {alertCallout(kit, data)}

      {runHeader(kit, data)}

      {card(kit, {
        key: 'life-work',
        title: 'Work',
        accent: ACCENT.activity,
        aside: work === null ? undefined : `${work.done} of ${work.total}`,
        link: go('activity'),
        footer: 'Carries across handoffs, counted from Claude’s own milestones.',
        rows: k =>
          work === null
            ? [emptyState(k, 'Claude lists milestones when the work has several steps.', 'work-empty')]
            : [
                workTrack(k, {
                  key: 'work-track',
                  done: work.done,
                  total: work.total,
                  hasCurrent: work.current !== null,
                  max: Math.max(4, Math.min(12, Math.floor((k.columns - 24) / 2))),
                  caption: work.done === work.total ? 'All milestones done' : `${work.done} of ${fmt.plural(work.total, 'milestone')}`,
                  isAnimated: hud.isAnimated,
                }),
                work.current === null ? null : listItem(k, { key: 'work-now', glyph: G.run, tone: 'info', text: work.current }),
              ],
      })}

      {card(kit, {
        key: 'life-context',
        title: 'Context',
        accent: ACCENT.context,
        aside: ctx.pct === null ? undefined : `${ctx.pct}%`,
        link: go('context'),
        footer: s.autopilot.enabled ? 'Starts over at each handoff.' : 'Starts over when you clear it; Autopilot hands off before it fills.',
        rows: k => [
          meterBar(k, { key: 'ctx-meter', fraction, marker, tone: ctx.tone === 'muted' ? 'good' : ctx.tone, width: k.columns, alt: `Context ${ctx.pct ?? 0}% used` }),
          pair(k, {
            key: 'ctx-under',
            left: ctx.tokens === null ? 'Waiting for the first response' : `${fmt.tokens(ctx.tokens)}${ctx.window === null ? '' : ` of ${fmt.tokens(ctx.window)}`} tokens`,
            right: hud.autopilot.isOn && ctx.threshold !== null ? `hands off at ${fmt.tokens(ctx.threshold)}` : undefined,
          }),
          apart(k, 'sys-autopilot', toggle(k, 'sys-autopilot', 'Autopilot', s.autopilot.enabled, () => u(d => void (d.autopilot.enabled = !d.autopilot.enabled)), st.autopilot)),
        ],
      })}

      {card(kit, {
        key: 'life-cache',
        title: 'Cache',
        accent: ACCENT.context,
        // The state is the card's first line; the aside says how long the cache lasts.
        aside: lifetimeWords(cache) ?? undefined,
        link: go('context'),
        footer: cache.warmth === 'none' ? undefined : `Starts over with each fresh context, and ${lapses}.${s.cache.keepWarm ? ' Keep warm holds it while you are away.' : ''}`,
        rows: k =>
          cache.warmth === 'none'
            ? [
                // Nothing cached yet: one row, the switch beside what the cache will be.
                row(k, {
                  key: 'sys-keepwarm',
                  label: 'Keep warm',
                  subtitle: 'Nothing cached yet',
                  control: switchControl(k, { key: 'sys-keepwarm', isOn: s.cache.keepWarm, onPress: () => u(d => void (d.cache.keepWarm = !d.cache.keepWarm)) }),
                }),
              ]
            : [
                cacheClock(k, { key: 'cache-clock', fraction: cacheNow.fraction, tone: cacheNow.tone, text: cacheNow.text, isBold: cache.warmth === 'warm' }),
                pair(k, { key: 'cache-under', left: cacheSummary(cache) }),
                apart(
                  k,
                  'sys-keepwarm',
                  row(k, {
                    key: 'sys-keepwarm',
                    label: 'Keep warm',
                    control: switchControl(k, { key: 'sys-keepwarm', isOn: s.cache.keepWarm, onPress: () => u(d => void (d.cache.keepWarm = !d.cache.keepWarm)) }),
                  }),
                ),
              ],
      })}

      {card(kit, {
        key: 'now',
        title: 'Now',
        accent: ACCENT.overview,
        rows: k => [
          // What Claude is doing, or what the run waits for: the status bar's headline, in full, with its mark.
          stateLine(k, {
            key: 'now-line',
            state: line.state,
            text: line.text,
            detail: line.detail,
            isBold: line.state === 'working' || line.state === 'validating' || line.state === 'handoff' || line.state === 'blocked' || line.state === 'waitingUser' || line.state === 'waitingExternal',
            isDim: line.state === 'ready' || line.state === 'thinking',
          }),
          needsLook === 0
            ? null
            : row(k, {
                key: 'now-attention',
                label: hud.failing.length > 0 ? `${hud.failing.join(', ')} failing` : `${fmt.plural(hud.attention, 'call')} need${hud.attention === 1 ? 's' : ''} a look`,
                control: link(k, { key: 'now-attention', label: 'Activity', onPress: () => kit.actions.setTab('activity') }),
              }),
        ],
      })}

      {card(kit, {
        key: 'profile',
        rows: k => [
          row(k, {
            key: 'profile',
            label: 'Profile',
            subtitle: hud.profile.isModified ? 'Edited since you applied it' : activeProfile?.hint,
            control: picker(k, { key: 'profile', value: s.profile, options: profiles, onSelect: v => kit.actions.applyProfile(v) }),
          }),
        ],
      })}

      {card(kit, {
        key: 'sys-behavior',
        title: 'Behavior',
        accent: ACCENT.behavior,
        link: go('behavior'),
        rows: k => [
          toggle(k, 'sys-frontier', 'Frontier Max', s.frontier.enabled, () => u(d => {
            d.frontier.enabled = !d.frontier.enabled
            if (d.frontier.enabled) d.guard.enabled = true
          }), st.frontier),
          toggle(k, 'sys-guard', 'Lazy-exit guard', s.guard.enabled, () => u(d => void (d.guard.enabled = !d.guard.enabled)), st.guard),
          toggle(k, 'sys-qa', 'Release check', s.qa.enabled, () => u(d => void (d.qa.enabled = !d.qa.enabled)), st.qa),
          row(k, { key: 'sys-router', label: 'Model router', control: link(k, { key: 'sys-router', label: st.router.text, onPress: () => kit.actions.setTab('behavior') }) }),
          row(k, { key: 'sys-answers', label: 'Answer style', control: link(k, { key: 'sys-answers', label: st.answers.text, onPress: () => kit.actions.setTab('behavior') }) }),
        ],
      })}

      {card(kit, {
        key: 'sys-guardrails',
        title: 'Guardrails',
        accent: ACCENT.guardrails,
        link: go('guardrails'),
        rows: k => [
          row(k, { key: 'sys-perms', label: 'Permissions', control: link(k, { key: 'sys-perms', label: permissionSummary(s.permissions), onPress: () => kit.actions.setTab('guardrails') }) }),
          row(k, { key: 'sys-agents', label: 'Subagents', control: link(k, { key: 'sys-agents', label: st.subagents.text, onPress: () => kit.actions.setTab('guardrails') }) }),
          load === null
            ? null
            : textRuns(k, 'machine-value', [
                { text: k.surface === 'terminal' ? 'Machine   CPU ' : 'Machine · CPU ', tone: 'muted' },
                { text: pct(load.cpu), tone: readingTone(load.cpuTone), isBold: load.cpuTone === 'bad' },
                { text: k.surface === 'terminal' ? '   Memory ' : ' · Memory ', tone: 'muted' },
                { text: pct(load.ram), tone: readingTone(load.ramTone), isBold: load.ramTone === 'bad' },
                ...(isLoadHigh ? [{ text: kit.surface === 'terminal' ? '   busy' : ' · busy', tone: 'warn' as const }] : []),
              ]),
          row(k, {
            key: 'sys-load',
            label: 'Machine load limit',
            control: switchControl(k, { key: 'sys-load', isOn: s.resources.level !== 'off', onPress: () => u(d => void (d.resources.level = d.resources.level === 'off' ? 'medium' : 'off')) }),
            ...(s.resources.level === 'off'
              ? {}
              : { subtitle: data.resources?.ceilings === null || data.resources === undefined ? st.load.text : `${st.load.text.split(' · ')[0]} · CPU ${data.resources.ceilings.cpu}% · RAM ${data.resources.ceilings.ram}%` }),
          }),
          ...pane.agents.running.map(ag => listItem(k, { key: `agent-${ag.id}`, glyph: G.dot, tone: 'info', text: `${ag.type}  ${ag.description}`, right: ag.status })),
        ],
      })}

      {card(kit, {
        key: 'sys-activity',
        title: 'Activity',
        accent: ACCENT.activity,
        link: go('activity'),
        rows: k => [toggle(k, 'sys-focus', 'Focus view', s.focus.enabled, kit.actions.toggleFocus, st.focus)],
      })}
    </Box>
  )
}
