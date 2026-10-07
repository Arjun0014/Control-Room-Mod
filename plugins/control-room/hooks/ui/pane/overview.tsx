/**
 * Overview: the whole session at a glance (monitoring), then the handful of
 * controls people reach for most (profile, the big toggles, handoff).
 */

import type { RenderElement } from 'claude-code'

import type { Tone } from '../../../types'
import * as fmt from '../../core/format'
import { listProfiles } from '../../core/profiles'
import { actionRow, card, choice, title } from '../components'
import type { Kit } from '../kit'
import { G, toneOfLevel } from '../theme'
import type { PaneData } from './frame'

export function overviewTab(kit: Kit, data: PaneData): RenderElement {
  const { Box, Svg } = kit.ui
  const { pane, hud, resources, activity } = data
  const s = pane.settings
  const twoColumns = kit.columns >= 58
  const width = twoColumns ? Math.floor((kit.columns - 2) / 2) : kit.columns - 2

  const ctx = hud.ctx
  const cards: { key: string; title: string; value: string; tone: Tone; detail?: string }[] = [
    {
      key: 'ctx',
      title: 'Context',
      value: ctx.tokens === null ? 'waiting for the first response' : `${fmt.tokens(ctx.tokens)}${ctx.window === null ? '' : ` of ${fmt.tokens(ctx.window)}`}${ctx.pct === null ? '' : ` (${ctx.pct}%)`}`,
      tone: ctx.tone,
      detail: ctx.threshold === null ? 'autopilot off' : `handoff at ${fmt.tokens(ctx.threshold)}`,
    },
    {
      key: 'cost',
      title: 'Cost',
      value: hud.cost.usd === null ? 'not reported by this host' : `${fmt.cost(hud.cost.usd)} this session`,
      tone: hud.cost.usd === null ? 'muted' : 'normal',
      detail: hud.cost.runUsd === null ? undefined : `${fmt.cost(hud.cost.runUsd)}${hud.cost.isRunPartial ? '+' : ''} across the run`,
    },
    {
      key: 'auto',
      title: 'Context Autopilot',
      value: hud.autopilot.label,
      tone: hud.autopilot.tone,
      detail: pane.autopilot.note,
    },
    {
      key: 'frontier',
      title: 'Frontier Max',
      value: s.frontier.enabled ? `ON ${G.mid} effort ${s.frontier.effort}` : 'OFF',
      tone: s.frontier.enabled ? 'accent' : 'muted',
      detail: !s.frontier.enabled
        ? undefined
        : pane.frontier.isEffortSupported === false
          ? 'this model takes no effort setting'
          : pane.frontier.lastEffort === null
            ? 'applies from the next request'
            : `last request sent effort ${pane.frontier.lastEffort}`,
    },
    {
      key: 'guard',
      title: 'No-Lazy-Exit Guard',
      value: hud.guard.label.replace('GUARD ', ''),
      tone: hud.guard.tone,
      detail: pane.guard.reason ?? (pane.guard.session > 0 ? `${pane.guard.session} continuation${pane.guard.session === 1 ? '' : 's'} this session` : 'watching stops'),
    },
    {
      key: 'res',
      title: 'Resource Governor',
      value: hud.resources.label.replace('RES ', ''),
      tone: hud.resources.tone,
      detail:
        resources === undefined || resources.status !== 'live'
          ? (resources?.status ?? 'off')
          : `CPU ${resources.cpu === null ? '—' : Math.round(resources.cpu)}% · RAM ${resources.ram === null ? '—' : Math.round(resources.ram)}% · ${resources.level}`,
    },
    {
      key: 'agents',
      title: 'Subagents',
      value: hud.agents.label.replace('AGENTS ', ''),
      tone: hud.agents.tone,
      detail:
        [
          pane.agents.running.length > 0 ? `${pane.agents.running.length} running` : '',
          pane.agents.spawned > 0 ? `${pane.agents.spawned} started` : '',
          pane.agents.denied > 0 ? `${pane.agents.denied} refused` : '',
        ]
          .filter(Boolean)
          .join(' · ') || 'none started yet',
    },
    {
      key: 'router',
      title: 'Model Router',
      value: hud.router.label.replace('ROUTER ', ''),
      tone: hud.router.tone,
      detail: pane.router.lastDecision ?? undefined,
    },
    {
      key: 'focus',
      title: 'Focus View',
      value: s.focus.enabled ? `ON ${G.mid} tools ${s.focus.tools}` : 'OFF',
      tone: s.focus.enabled ? 'good' : 'muted',
      detail: activity === undefined ? undefined : `${fmt.plural(activity.sessionTools, 'tool call')} · ${fmt.plural(activity.totals.files, 'file')} changed`,
    },
  ]

  const rows: RenderElement[] = []
  for (let i = 0; i < cards.length; i += twoColumns ? 2 : 1) {
    const pair = cards.slice(i, i + (twoColumns ? 2 : 1))
    rows.push(
      <Box flexDirection="row" key={`cards-${i}`}>
        {pair.map(c => card(kit, { ...c, width }))}
      </Box>,
    )
  }

  const gauge =
    Svg !== undefined && ctx.tokens !== null && ctx.window !== null && ctx.window > 0
      ? contextGauge(ctx.tokens / ctx.window, ctx.threshold === null ? null : ctx.threshold / ctx.window, toneOfLevel(ctx.tone === 'bad' ? 'critical' : ctx.tone === 'warn' ? 'elevated' : 'ok'))
      : null

  const profiles = listProfiles(s).map(p => ({ value: p.id, label: p.name }))
  const a = pane.autopilot

  return (
    <Box flexDirection="column">
      {title(kit, 'Monitoring')}
      {gauge !== null && Svg !== undefined ? <Svg key="ctx-gauge" source={gauge} alt={`Context ${ctx.pct ?? 0}% used`} height={28} /> : null}
      {rows}
      {title(kit, 'Controls')}
      {choice(kit, { key: 'profile', label: 'Profile', value: s.profile, options: profiles, onSelect: v => kit.actions.applyProfile(v), detail: pane.profileLabel.endsWith('*') ? 'modified' : undefined })}
      {actionRow(kit, [
        { key: 'q-frontier', label: `Frontier Max ${s.frontier.enabled ? G.dot : G.ring}`, isPrimary: s.frontier.enabled, onPress: () => kit.actions.update(d => { d.frontier.enabled = !d.frontier.enabled; if (d.frontier.enabled) d.guard.enabled = true }) },
        { key: 'q-autopilot', label: `Autopilot ${s.autopilot.enabled ? G.dot : G.ring}`, isPrimary: s.autopilot.enabled, onPress: () => kit.actions.update(d => { d.autopilot.enabled = !d.autopilot.enabled }) },
        { key: 'q-guard', label: `Guard ${s.guard.enabled ? G.dot : G.ring}`, isPrimary: s.guard.enabled, onPress: () => kit.actions.update(d => { d.guard.enabled = !d.guard.enabled }) },
        { key: 'q-focus', label: `Focus ${s.focus.enabled ? G.dot : G.ring}`, isPrimary: s.focus.enabled, onPress: kit.actions.toggleFocus },
      ])}
      {actionRow(kit, [
        { key: 'q-handoff', label: 'Handoff now', onPress: kit.actions.handoff, isHidden: !a.canHandoff },
        { key: 'q-fresh', label: 'Start fresh context', isPrimary: true, onPress: kit.actions.fresh, isHidden: a.state !== 'awaiting' },
        { key: 'q-snooze', label: 'Snooze handoff', onPress: kit.actions.snooze, isHidden: !a.canSnooze },
      ])}
    </Box>
  )
}

/** A Desktop-only context gauge: fill, threshold marker. Raw colors (SVG cannot read theme keys). */
function contextGauge(fraction: number, threshold: number | null, tone: Tone): string {
  const w = 400
  const h = 14
  const fill = Math.round(Math.min(1, Math.max(0, fraction)) * w)
  const color = tone === 'bad' ? '#d9534f' : tone === 'warn' ? '#d9a441' : '#4f9d69'
  const marker = threshold === null ? '' : `<rect x="${Math.round(Math.min(1, threshold) * w) - 1}" y="0" width="2" height="${h}" fill="#d97757"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="3" width="${w}" height="8" rx="4" fill="#8884"/><rect x="0" y="3" width="${fill}" height="8" rx="4" fill="${color}"/>${marker}</svg>`
}
