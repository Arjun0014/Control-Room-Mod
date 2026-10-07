/**
 * Overview: how this session is doing, then a map of everything that is on.
 *
 * The top is live (context, cost, the machine). Below it, one card per
 * section in that section's accent, each system with its switch and one
 * line of state, and a quiet "Open ›" to the section itself, so the page
 * also teaches where everything lives.
 */

import type { RenderElement } from 'claude-code'

import type { PermissionCategory, StatusView, Tone } from '../../../types'
import * as fmt from '../../core/format'
import { listProfiles } from '../../core/profiles'
import { PERMISSION_CATEGORIES } from '../../core/settings'
import type { Kit } from '../kit'
import { callout, card, link, listItem, meterBar, pair, picker, row, stat, switchControl } from '../primitives'
import { ACCENT, G } from '../theme'
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

function permissionSummary(p: Record<PermissionCategory, string>): string {
  const count = (state: string) => PERMISSION_CATEGORIES.filter(c => p[c] === state).length
  const parts = [count('ask') > 0 ? `${count('ask')} ask` : '', count('deny') > 0 ? `${count('deny')} deny` : '', count('allow') > 0 ? `${count('allow')} allow` : ''].filter(Boolean)
  return parts.length === 0 ? 'Claude Code decides' : parts.join(' · ')
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
  const runCost = hud.cost.runUsd !== null && hud.cost.usd !== null && hud.cost.runUsd - hud.cost.usd > 0.005 ? `${fmt.cost(hud.cost.runUsd)}${hud.cost.isRunPartial ? '+' : ''} this run` : undefined
  const load = hud.load

  const toggle = (k: Kit, key: string, label: string, isOn: boolean, onPress: () => void, status: StatusView) =>
    row(k, { key, label, control: switchControl(k, { key, isOn, onPress }), ...(isOn ? subtitleOf(status) : {}) })

  const profiles = listProfiles(s).map(p => ({ value: p.id, label: p.name, hint: p.tagline }))
  const activeProfile = profiles.find(p => p.value === s.profile)

  return (
    <Box flexDirection="column">
      {alertCallout(kit, data)}

      <Box key="hero" flexDirection="column" marginTop={1}>
        {stat(kit, { key: 'ctx', label: 'Context', value: ctx.pct === null ? G.none : `${ctx.pct}%`, tone: ctx.tone === 'warn' || ctx.tone === 'bad' ? ctx.tone : 'normal' })}
        {meterBar(kit, { key: 'ctx-meter', fraction, marker, tone: ctx.tone === 'muted' ? 'good' : ctx.tone, width: kit.columns, alt: `Context ${ctx.pct ?? 0}% used` })}
        {pair(kit, {
          key: 'ctx-under',
          left: ctx.tokens === null ? 'Waiting for the first response' : `${fmt.tokens(ctx.tokens)}${ctx.window === null ? '' : ` of ${fmt.tokens(ctx.window)}`} tokens`,
          right: hud.autopilot.isOn && ctx.threshold !== null ? `hands off at ${fmt.tokens(ctx.threshold)}` : undefined,
        })}
        <Box key="hero-gap" height={1} />
        {stat(kit, { key: 'cost', label: 'Cost', value: fmt.cost(hud.cost.usd), tone: hud.cost.usd === null ? 'muted' : 'normal', under: hud.cost.usd === null ? 'Not reported by this host' : 'This session', underRight: runCost })}
        {load === null ? null : <Box key="hero-gap-2" height={1} />}
        {load === null
          ? null
          : stat(kit, {
              key: 'machine',
              label: 'Machine',
              value: `CPU ${load.cpu === null ? G.none : `${Math.round(load.cpu)}%`}  ·  RAM ${load.ram === null ? G.none : `${Math.round(load.ram)}%`}`,
              tone: load.cpuTone === 'bad' || load.ramTone === 'bad' ? 'bad' : load.cpuTone === 'warn' || load.ramTone === 'warn' ? 'warn' : 'normal',
            })}
      </Box>

      {card(kit, {
        key: 'profile',
        title: 'Profile',
        accent: ACCENT.overview,
        rows: k => [
          row(k, {
            key: 'profile',
            label: activeProfile?.label ?? 'Custom',
            subtitle: hud.profile.isModified ? 'Edited since applied' : activeProfile?.hint,
            control: picker(k, { key: 'profile', value: s.profile, options: profiles, onSelect: v => kit.actions.applyProfile(v) }),
          }),
        ],
      })}

      {card(kit, {
        key: 'sys-context',
        title: 'Context',
        accent: ACCENT.context,
        link: go('context'),
        rows: k => [toggle(k, 'sys-autopilot', 'Autopilot', s.autopilot.enabled, () => u(d => void (d.autopilot.enabled = !d.autopilot.enabled)), st.autopilot)],
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
          row(k, {
            key: 'sys-load',
            label: 'Machine load limit',
            control: switchControl(k, { key: 'sys-load', isOn: s.resources.level !== 'off', onPress: () => u(d => void (d.resources.level = d.resources.level === 'off' ? 'medium' : 'off')) }),
            ...(s.resources.level === 'off'
              ? {}
              : { subtitle: data.resources?.ceilings === null || data.resources === undefined ? st.load.text : `${st.load.text.split(' · ')[0]} · CPU ${data.resources.ceilings.cpu}% · RAM ${data.resources.ceilings.ram}%` }),
          }),
          ...pane.agents.running.map(a => listItem(k, { key: `agent-${a.id}`, glyph: G.dot, tone: 'info', text: `${a.type}  ${a.description}`, right: a.status })),
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
