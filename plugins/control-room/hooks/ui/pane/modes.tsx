/**
 * Modes: the behaviour systems, each as a short block — what it is doing
 * now, then its settings.
 */

import type { RenderElement } from 'claude-code'

import type { ModelAlias, PaneModel } from '../../../types'
import * as fmt from '../../core/format'
import { choice, field, hint, title, toggle } from '../components'
import type { Kit } from '../kit'

const ALIASES: { value: ModelAlias; label: string }[] = [
  { value: 'session', label: 'Session model' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'fable', label: 'Fable' },
]

const asAlias = (v: string): ModelAlias => (ALIASES.some(a => a.value === v) ? (v as ModelAlias) : 'session')

export function modesTab(kit: Kit, pane: PaneModel): RenderElement {
  const { Box } = kit.ui
  const s = pane.settings
  const u = kit.actions.update

  const effortStatus =
    !s.frontier.enabled
      ? undefined
      : pane.frontier.isEffortSupported === false
        ? 'the session model takes no effort setting (none is sent)'
        : pane.frontier.lastEffort === null
          ? 'applies from the next request'
          : `last request: effort ${pane.frontier.lastEffort}`

  const composeStatus =
    pane.frontier.isComposeReached === false ? 'policies ride the prompt (system-prompt hook bypassed by policy)' : undefined

  return (
    <Box flexDirection="column">
      {title(kit, 'Frontier Max')}
      {toggle(kit, {
        key: 'fr-on',
        label: 'Frontier Max',
        isOn: s.frontier.enabled,
        onPress: () => u(d => { d.frontier.enabled = !d.frontier.enabled; if (d.frontier.enabled) d.guard.enabled = true }),
        detail: effortStatus,
      })}
      {choice(kit, {
        key: 'fr-effort',
        label: 'Reasoning effort',
        value: s.frontier.effort,
        options: [
          { value: 'max', label: 'Max (highest supported)' },
          { value: 'xhigh', label: 'Extra high' },
          { value: 'high', label: 'High' },
          { value: 'keep', label: "Keep the session's" },
        ],
        onSelect: v => u(d => { d.frontier.effort = v === 'xhigh' ? 'xhigh' : v === 'high' ? 'high' : v === 'keep' ? 'keep' : 'max' }),
      })}
      {toggle(kit, { key: 'fr-sub', label: 'Max effort for subagents', isOn: s.frontier.subagentEffort, onPress: () => u(d => { d.frontier.subagentEffort = !d.frontier.subagentEffort }) })}
      {composeStatus === undefined ? null : hint(kit, composeStatus)}

      {title(kit, 'Release / QA')}
      {toggle(kit, { key: 'qa-on', label: 'Verification first', isOn: s.qa.enabled, onPress: () => u(d => { d.qa.enabled = !d.qa.enabled }) })}

      {title(kit, 'No-Lazy-Exit Guard')}
      {toggle(kit, {
        key: 'gu-on',
        label: 'Guard',
        isOn: s.guard.enabled,
        onPress: () => u(d => { d.guard.enabled = !d.guard.enabled }),
        detail: pane.guard.reason ?? (pane.guard.isActive ? (pane.guard.session === 0 ? 'no continuations yet' : `${fmt.plural(pane.guard.session, 'continuation')} this session`) : undefined),
      })}
      {choice(kit, {
        key: 'gu-strict',
        label: 'Strictness',
        value: s.guard.strictness,
        options: [
          { value: 'lenient', label: 'Lenient (only obvious hand-backs)' },
          { value: 'standard', label: 'Standard' },
          { value: 'strict', label: 'Strict' },
        ],
        onSelect: v => u(d => { d.guard.strictness = v === 'lenient' ? 'lenient' : v === 'strict' ? 'strict' : 'standard' }),
      })}
      {choice(kit, {
        key: 'gu-turn',
        label: 'Continuations per turn',
        value: String(s.guard.maxPerTurn),
        options: ['1', '2', '3', '4', '5'].map(v => ({ value: v, label: v })),
        onSelect: v => u(d => { d.guard.maxPerTurn = Number(v) }),
      })}
      {toggle(kit, { key: 'gu-model', label: 'Model check when unsure', isOn: s.guard.modelCheck, onPress: () => u(d => { d.guard.modelCheck = !d.guard.modelCheck }), detail: 'a small, low-cost classification' })}
      {pane.guard.last === null ? null : field(kit, 'Last decision', `${pane.guard.last.verdict} (score ${pane.guard.last.score})`, pane.guard.last.verdict === 'block' ? 'warn' : 'muted', pane.guard.last.reasons.join('; '))}

      {title(kit, 'Model Router')}
      {choice(kit, {
        key: 'ro-strategy',
        label: 'Strategy',
        value: s.router.strategy,
        options: [
          { value: 'off', label: 'Off' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'performance', label: 'Performance' },
          { value: 'economy', label: 'Economy' },
          { value: 'custom', label: 'Custom' },
        ],
        onSelect: v => u(d => { d.router.strategy = (['off', 'balanced', 'performance', 'economy', 'custom'].includes(v) ? v : 'off') as typeof d.router.strategy }),
        detail: pane.router.lastDecision ?? undefined,
      })}
      {s.router.strategy === 'off' ? null : (
        <Box flexDirection="column" key="router-more">
          {toggle(kit, { key: 'ro-main', label: 'Route main conversation', isOn: s.router.mainLoop, onPress: () => u(d => { d.router.mainLoop = !d.router.mainLoop }), detail: 'per turn, to models seen this session' })}
          {toggle(kit, { key: 'ro-sub', label: 'Route subagents', isOn: s.router.subagents, onPress: () => u(d => { d.router.subagents = !d.router.subagents }) })}
          {s.router.strategy !== 'custom'
            ? null
            : (['trivial', 'simple', 'standard', 'hard', 'explore', 'plan', 'general'] as const).map(k =>
                choice(kit, {
                  key: `ro-c-${k}`,
                  label: k === 'explore' || k === 'plan' || k === 'general' ? `Subagent: ${k}` : `${k[0]!.toUpperCase()}${k.slice(1)} tasks`,
                  value: s.router.custom[k],
                  options: ALIASES,
                  onSelect: v => u(d => { d.router.custom[k] = asAlias(v) }),
                }),
              )}
          {pane.router.resolved.length === 0 ? null : field(kit, 'Seen answering', pane.router.resolved.map(r => r.id).join(', '), 'muted')}
          {pane.router.unavailable.length === 0 ? null : field(kit, 'Unavailable', pane.router.unavailable.join(', '), 'warn')}
          {s.frontier.enabled && s.router.strategy !== 'custom' ? hint(kit, 'Frontier Max keeps the main conversation on the session model (no downgrades).') : null}
        </Box>
      )}

      {title(kit, 'Subagent Control')}
      {choice(kit, {
        key: 'sa-mode',
        label: 'Subagents',
        value: s.subagents.mode === 'limit' ? `limit-${s.subagents.limit}` : s.subagents.mode,
        options: [
          { value: 'unrestricted', label: 'Unrestricted (control off)' },
          { value: 'block', label: 'Off — block all' },
          { value: 'ask', label: 'Ask each time' },
          { value: 'limit-1', label: 'Max 1 at a time' },
          { value: 'limit-2', label: 'Max 2 at a time' },
          { value: 'limit-3', label: 'Max 3 at a time' },
          { value: 'limit-4', label: 'Max 4 at a time' },
          { value: 'limit-8', label: 'Max 8 at a time' },
        ].concat(s.subagents.mode === 'limit' && ![1, 2, 3, 4, 8].includes(s.subagents.limit) ? [{ value: `limit-${s.subagents.limit}`, label: `Max ${s.subagents.limit}` }] : []),
        onSelect: v =>
          u(d => {
            if (v.startsWith('limit-')) {
              d.subagents.mode = 'limit'
              d.subagents.limit = Number(v.slice(6))
            } else d.subagents.mode = v === 'block' ? 'block' : v === 'ask' ? 'ask' : 'unrestricted'
          }),
        detail: [pane.agents.running.length > 0 ? `${pane.agents.running.length} running` : '', pane.agents.denied > 0 ? `${pane.agents.denied} refused` : ''].filter(Boolean).join(' · ') || undefined,
      })}
      {toggle(kit, { key: 'sa-team', label: 'Count teammates', isOn: s.subagents.countTeammates, onPress: () => u(d => { d.subagents.countTeammates = !d.subagents.countTeammates }) })}
      {pane.agents.running.map(r => field(kit, r.type, r.description, 'info', r.status))}

      {title(kit, 'Focus View')}
      {toggle(kit, { key: 'fo-on', label: 'Focus View', isOn: s.focus.enabled, onPress: kit.actions.toggleFocus, detail: 'transcript presentation only — Claude still reads everything' })}
      {choice(kit, {
        key: 'fo-tools',
        label: 'Tool calls',
        value: s.focus.tools,
        options: [
          { value: 'compact', label: 'One compact line each' },
          { value: 'hidden', label: 'Hidden (see Activity)' },
        ],
        onSelect: v => u(d => { d.focus.tools = v === 'hidden' ? 'hidden' : 'compact' }),
      })}
      {toggle(kit, { key: 'fo-results', label: 'Tool results', isOn: s.focus.results, onPress: () => u(d => { d.focus.results = !d.focus.results }) })}
      {toggle(kit, { key: 'fo-diffs', label: 'Inline file diffs', isOn: s.focus.diffs, onPress: () => u(d => { d.focus.diffs = !d.focus.diffs }) })}
      {toggle(kit, { key: 'fo-spinner', label: 'Activity summary line', isOn: s.focus.spinner, onPress: () => u(d => { d.focus.spinner = !d.focus.spinner }) })}
    </Box>
  )
}
