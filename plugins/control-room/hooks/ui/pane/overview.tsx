/**
 * Overview: how this session is doing, and what is on. Context and cost
 * first, then every system with its switch and one line of state, then the
 * profile. Anything that needs the person sits at the very top.
 */

import type { RenderElement } from 'claude-code'

import type { StatusView, Tone } from '../../../types'
import * as fmt from '../../core/format'
import { listProfiles } from '../../core/profiles'
import type { Kit } from '../kit'
import { callout, labelWidth, link, listItem, meterBar, pair, picker, row, section, stat, switchControl } from '../primitives'
import { G } from '../theme'
import type { PaneData } from './frame'

/** A status as a row's detail: quiet unless it needs a look. */
export const detailOf = (s: StatusView): { detail: string; detailTone: Tone } => ({
  detail: s.text,
  detailTone: s.tone === 'warn' || s.tone === 'bad' ? s.tone : 'muted',
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
      tone: 'bad',
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

export function overviewPage(kit: Kit, data: PaneData): RenderElement {
  const { Box } = kit.ui
  const { pane, hud } = data
  const s = pane.settings
  const st = pane.status
  const u = kit.actions.update
  const ctx = hud.ctx
  const lw = labelWidth(kit, 'Lazy-exit guard'.length)

  const fraction = ctx.tokens !== null && ctx.window !== null && ctx.window > 0 ? ctx.tokens / ctx.window : 0
  const marker = ctx.threshold !== null && ctx.window !== null && ctx.window > 0 ? ctx.threshold / ctx.window : null
  const runCost = hud.cost.runUsd !== null && hud.cost.usd !== null && hud.cost.runUsd - hud.cost.usd > 0.005 ? `${fmt.cost(hud.cost.runUsd)}${hud.cost.isRunPartial ? '+' : ''} this run` : undefined

  const toggleRow = (key: string, label: string, isOn: boolean, onPress: () => void, status: StatusView) =>
    row(kit, { key, label, labelWidth: lw, control: switchControl(kit, { key, isOn, onPress }), ...(isOn ? detailOf(status) : {}) })

  const profiles = listProfiles(s).map(p => ({ value: p.id, label: p.name, hint: p.tagline }))

  return (
    <Box flexDirection="column">
      {alertCallout(kit, data)}

      <Box key="ctx" flexDirection="column" marginTop={1}>
        {stat(kit, {
          key: 'ctx',
          label: 'Context',
          value: ctx.pct === null ? G.none : `${ctx.pct}%`,
          tone: ctx.tone === 'warn' || ctx.tone === 'bad' ? ctx.tone : 'normal',
        })}
        {meterBar(kit, { key: 'ctx-meter', fraction, marker, tone: ctx.tone === 'muted' ? 'good' : ctx.tone, width: kit.columns, alt: `Context ${ctx.pct ?? 0}% used` })}
        {pair(kit, {
          key: 'ctx-under',
          left: ctx.tokens === null ? 'Waiting for the first response' : `${fmt.tokens(ctx.tokens)}${ctx.window === null ? '' : ` of ${fmt.tokens(ctx.window)}`} tokens`,
          right: hud.autopilot.isOn ? (ctx.threshold === null ? hud.autopilot.text : `hands off at ${fmt.tokens(ctx.threshold)}`) : undefined,
        })}
      </Box>

      <Box key="cost" flexDirection="column" marginTop={1}>
        {stat(kit, { key: 'cost', label: 'Cost', value: fmt.cost(hud.cost.usd), tone: hud.cost.usd === null ? 'muted' : 'normal', under: hud.cost.usd === null ? 'Not reported by this host' : 'This session', underRight: runCost })}
      </Box>

      {section(kit, {
        key: 'profile',
        children: [row(kit, { key: 'profile', label: 'Profile', labelWidth: lw, control: picker(kit, { key: 'profile', value: s.profile, options: profiles, onSelect: v => kit.actions.applyProfile(v) }), detail: hud.profile.isModified ? 'edited' : undefined })],
      })}

      {section(kit, {
        key: 'systems',
        title: 'Systems',
        children: [
          toggleRow('sys-autopilot', 'Autopilot', s.autopilot.enabled, () => u(d => void (d.autopilot.enabled = !d.autopilot.enabled)), st.autopilot),
          toggleRow('sys-frontier', 'Frontier Max', s.frontier.enabled, () => u(d => {
            d.frontier.enabled = !d.frontier.enabled
            if (d.frontier.enabled) d.guard.enabled = true
          }), st.frontier),
          toggleRow('sys-guard', 'Lazy-exit guard', s.guard.enabled, () => u(d => void (d.guard.enabled = !d.guard.enabled)), st.guard),
          toggleRow('sys-qa', 'Release check', s.qa.enabled, () => u(d => void (d.qa.enabled = !d.qa.enabled)), st.qa),
          toggleRow('sys-focus', 'Focus view', s.focus.enabled, kit.actions.toggleFocus, st.focus),
          toggleRow('sys-load', 'Machine load', s.resources.level !== 'off', () => u(d => void (d.resources.level = d.resources.level === 'off' ? 'medium' : 'off')), st.load),
          row(kit, { key: 'sys-agents', label: 'Subagents', labelWidth: lw, control: link(kit, { key: 'sys-agents', label: st.subagents.text, onPress: () => kit.actions.setTab('guardrails') }) }),
          row(kit, { key: 'sys-router', label: 'Model router', labelWidth: lw, control: link(kit, { key: 'sys-router', label: st.router.text, onPress: () => kit.actions.setTab('behavior') }) }),
        ],
      })}

      {pane.agents.running.length === 0
        ? null
        : section(kit, {
            key: 'agents',
            title: 'Subagents running',
            children: pane.agents.running.map(a => listItem(kit, { key: `agent-${a.id}`, glyph: G.dot, tone: 'info', text: `${a.type}  ${a.description}`, right: a.status })),
          })}


    </Box>
  )
}
