/**
 * Guardrails: what Claude may do, how many helpers it may run, and how hard
 * it may push the machine. Every value reads as a word ("Ask", "Deny"); its
 * options open in place with one line on what each means.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel, PermissionCategory, PermissionState, PermissionsView, ResourcesView, Tone } from '../../../types'
import * as fmt from '../../core/format'
import { DEFAULT_PERMISSIONS, PERMISSION_CATEGORIES, PERMISSION_LABEL } from '../../core/settings'
import { CATEGORY_INFO } from '../../features/permissions/categories'
import { statesFor } from '../../features/permissions/decide'
import type { Kit } from '../kit'
import { buttons, emptyState, labelWidth, listItem, meterBar, note, picker, row, section, spark, stepper, switchControl } from '../primitives'
import { G, toneOfLevel, toneProps } from '../theme'

const PERM_LABEL = PERMISSION_LABEL

const STATE: Record<PermissionState, { label: string; hint: string }> = {
  default: { label: 'Default', hint: 'Claude Code decides' },
  allow: { label: 'Allow', hint: 'answers prompts for you' },
  ask: { label: 'Ask', hint: 'always asks you first' },
  deny: { label: 'Deny', hint: 'never runs' },
}

const LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low', hint: 'CPU 50% · memory 75%' },
  { value: 'medium', label: 'Medium', hint: 'CPU 70% · memory 85%' },
  { value: 'high', label: 'High', hint: 'CPU 90% · memory 92%' },
  { value: 'custom', label: 'Custom', hint: 'your own ceilings' },
]

function loadLine(kit: Kit, input: { key: string; label: string; value: number | null; ceiling: number; series: readonly number[]; lw: number }): RenderElement {
  const { Box, Text } = kit.ui
  const value = input.value
  const tone: Tone = value === null ? 'muted' : value >= input.ceiling ? 'bad' : value >= input.ceiling - 10 ? 'warn' : 'good'
  const sparkWidth = Math.min(16, Math.max(6, Math.floor(kit.columns * 0.18)))
  const meterWidth = Math.max(8, kit.columns - input.lw - sparkWidth - 8)
  return (
    <Box key={`load-${input.key}`} flexDirection="row" alignItems="center">
      <Box width={input.lw} flexShrink={0}>
        <Text>{input.label}</Text>
      </Box>
      <Box width={meterWidth} flexShrink={1}>
        {meterBar(kit, { key: `load-${input.key}-meter`, fraction: (value ?? 0) / 100, marker: input.ceiling / 100, tone, width: meterWidth, alt: `${input.label} ${value === null ? 'unknown' : `${Math.round(value)}%`}, ceiling ${input.ceiling}%` })}
      </Box>
      <Box width={6} flexShrink={0} justifyContent="flex-end">
        <Text {...toneProps(tone === 'good' ? 'normal' : tone)}>{value === null ? G.none : `${Math.round(value)}%`}</Text>
      </Box>
      <Box marginLeft={2} flexShrink={0}>
        {spark(kit, { key: `load-${input.key}-spark`, values: input.series, tone: 'muted', width: sparkWidth, ceiling: input.ceiling, alt: `${input.label} over the last minutes` })}
      </Box>
    </Box>
  )
}

export function guardrailsPage(kit: Kit, pane: PaneModel, permissions: PermissionsView | undefined, resources: ResourcesView | undefined): RenderElement {
  const { Box } = kit.ui
  const s = pane.settings
  const u = kit.actions.update
  const p = s.permissions
  const isDefault = PERMISSION_CATEGORIES.every(c => p[c] === DEFAULT_PERMISSIONS[c])
  const lw = labelWidth(kit, Math.max(...Object.values(PERM_LABEL).map(l => l.length)))
  const r = s.resources
  const ceilings = resources?.ceilings ?? null
  const recent = permissions?.recent ?? []

  return (
    <Box flexDirection="column">
      {section(kit, {
        key: 'permissions',
        title: 'Permissions',
        aside: permissions === undefined || permissions.asked + permissions.denied + permissions.allowed === 0 ? undefined : `${permissions.asked} asked · ${permissions.denied} denied`,
        footer: 'Deny is enforced before any prompt, in every mode. Your organisation’s rules always win. Shell commands are matched by pattern, so this narrows what Claude does; it is not a sandbox.',
        children: [
          ...PERMISSION_CATEGORIES.map(c =>
            row(kit, {
              key: `perm-${c}`,
              label: PERM_LABEL[c],
              labelWidth: lw,
              control: picker(kit, {
                key: `perm-${c}`,
                value: p[c],
                options: statesFor(c).map(state => ({ value: state, label: STATE[state].label, hint: STATE[state].hint })),
                onSelect: v => u(d => void (d.permissions[c] = (statesFor(c).includes(v as PermissionState) ? v : 'ask') as PermissionState)),
              }),
              detail: kit.openPicker === `perm-${c}` ? `e.g. ${CATEGORY_INFO[c].examples}` : undefined,
            }),
          ),
          isDefault ? null : buttons(kit, [{ key: 'perm-reset', label: 'Restore safe defaults', onPress: () => u(d => void (d.permissions = { ...DEFAULT_PERMISSIONS })) }], 'perm-actions'),
        ],
      })}

      {recent.length === 0
        ? null
        : section(kit, {
            key: 'perm-recent',
            title: 'Recent decisions',
            children: recent.slice(0, 6).map((e, i) =>
              listItem(kit, {
                key: `perm-log-${i}`,
                glyph: e.outcome === 'denied' || e.outcome === 'refused-heavy' ? G.fail : e.outcome === 'asked' ? '?' : G.ok,
                tone: e.outcome === 'denied' || e.outcome === 'refused-heavy' ? 'bad' : e.outcome === 'asked' ? 'warn' : 'good',
                text: `${e.outcome === 'refused-heavy' ? 'held back' : e.outcome}  ${e.evidence}`,
                right: fmt.clock(e.at),
              }),
            ),
          })}

      {section(kit, {
        key: 'agents',
        title: 'Subagents',
        footer: s.subagents.mode === 'block' ? 'Claude does the work itself; agent types are hidden from it.' : undefined,
        children: [
          row(kit, {
            key: 'sa-mode',
            label: 'Subagents',
            labelWidth: lw,
            control: picker(kit, {
              key: 'sa-mode',
              value: s.subagents.mode,
              options: [
                { value: 'unrestricted', label: 'No limit' },
                { value: 'limit', label: 'Up to a number', hint: 'at once' },
                { value: 'ask', label: 'Ask each time' },
                { value: 'block', label: 'Off', hint: 'Claude works alone' },
              ],
              onSelect: v => u(d => void (d.subagents.mode = (['unrestricted', 'limit', 'ask', 'block'].includes(v) ? v : 'unrestricted') as typeof d.subagents.mode)),
            }),
            detail: pane.agents.running.length > 0 ? `${pane.agents.running.length} running` : undefined,
          }),
          s.subagents.mode === 'limit' &&
            row(kit, {
              key: 'sa-limit',
              label: 'At most',
              labelWidth: lw,
              control: stepper(kit, {
                key: 'sa-limit',
                display: String(s.subagents.limit),
                onDecrease: s.subagents.limit > 1 ? () => u(d => void (d.subagents.limit -= 1)) : undefined,
                onIncrease: s.subagents.limit < 16 ? () => u(d => void (d.subagents.limit += 1)) : undefined,
              }),
              detail: 'at once',
            }),
          s.subagents.mode === 'limit' &&
            row(kit, {
              key: 'sa-team',
              label: 'Count teammates',
              labelWidth: lw,
              control: switchControl(kit, { key: 'sa-team', isOn: s.subagents.countTeammates, onPress: () => u(d => void (d.subagents.countTeammates = !d.subagents.countTeammates)) }),
            }),
          ...pane.agents.running.map(a => listItem(kit, { key: `agent-${a.id}`, glyph: G.dot, tone: 'info', text: `${a.type}  ${a.description}`, right: a.status })),
        ],
      })}

      {section(kit, {
        key: 'load',
        title: 'Machine load',
        footer:
          r.level === 'off'
            ? 'Keeps your machine responsive: Claude hears when it is busy and holds back extra heavy jobs.'
            : 'Advisory and machine-wide. Claude is told about pressure and slows down; it is not an OS limit, and other programs are never touched.',
        children: [
          row(kit, {
            key: 'res-level',
            label: 'Limit',
            labelWidth: lw,
            control: picker(kit, { key: 'res-level', value: r.level, options: LEVELS, onSelect: v => u(d => void (d.resources.level = (['off', 'low', 'medium', 'high', 'custom'].includes(v) ? v : 'off') as typeof d.resources.level)) }),
            ...(r.level === 'off' || resources?.status === 'live' ? {} : { detail: pane.status.load.text.split(' · ').slice(1).join(' · ') || undefined }),
          }),
          r.level !== 'off' && resources !== undefined && resources.status === 'live' && ceilings !== null && loadLine(kit, { key: 'cpu', label: 'CPU', value: resources.cpu, ceiling: ceilings.cpu, series: resources.cpuSeries, lw }),
          r.level !== 'off' && resources !== undefined && resources.status === 'live' && ceilings !== null && loadLine(kit, { key: 'ram', label: 'Memory', value: resources.ram, ceiling: ceilings.ram, series: resources.ramSeries, lw }),
          r.level !== 'off' && resources !== undefined && resources.status !== 'live' && note(kit, resources.status === 'unavailable' ? `Readings unavailable${resources.error === null ? '' : `: ${resources.error}`}` : 'Starting the sampler…', 'res-status'),
          r.level === 'custom' &&
            row(kit, {
              key: 'res-cpu',
              label: 'CPU ceiling',
              labelWidth: lw,
              control: stepper(kit, {
                key: 'res-cpu',
                display: `${r.cpu}%`,
                onDecrease: r.cpu > 10 ? () => u(d => void (d.resources.cpu = Math.max(10, d.resources.cpu - 5))) : undefined,
                onIncrease: r.cpu < 100 ? () => u(d => void (d.resources.cpu = Math.min(100, d.resources.cpu + 5))) : undefined,
              }),
            }),
          r.level === 'custom' &&
            row(kit, {
              key: 'res-ram',
              label: 'Memory ceiling',
              labelWidth: lw,
              control: stepper(kit, {
                key: 'res-ram',
                display: `${r.ram}%`,
                onDecrease: r.ram > 10 ? () => u(d => void (d.resources.ram = Math.max(10, d.resources.ram - 5))) : undefined,
                onIncrease: r.ram < 100 ? () => u(d => void (d.resources.ram = Math.min(100, d.resources.ram + 5))) : undefined,
              }),
            }),
          r.level !== 'off' &&
            row(kit, {
              key: 'res-enf',
              label: 'When over',
              labelWidth: lw,
              control: picker(kit, {
                key: 'res-enf',
                value: r.enforcement,
                options: [
                  { value: 'inform', label: 'Just tell Claude' },
                  { value: 'limit', label: 'Hold extra heavy jobs' },
                  { value: 'strict', label: 'Hold all heavy jobs' },
                ],
                onSelect: v => u(d => void (d.resources.enforcement = (['inform', 'limit', 'strict'].includes(v) ? v : 'limit') as typeof d.resources.enforcement)),
              }),
            }),
          r.level !== 'off' && resources !== undefined && (resources.noticesSent > 0 || resources.refused > 0) && note(kit, `${fmt.plural(resources.noticesSent, 'notice')} to Claude · ${fmt.plural(resources.refused, 'heavy job')} held back`, 'res-stats'),
          ...(resources === undefined || resources.background.length === 0
            ? []
            : resources.background.map(b => (
                <Box key={`bg-${b.id}`} flexDirection="row">
                  <Box flexGrow={1} flexShrink={1}>
                    {listItem(kit, { key: `bg-item-${b.id}`, glyph: G.run, tone: toneOfLevel(resources.level), text: b.label, right: fmt.duration(kit.now - b.since) })}
                  </Box>
                  {buttons(kit, [{ key: `stop-${b.id}`, label: 'Stop', onPress: () => kit.actions.stopTask(b.id) }], `stop-wrap-${b.id}`)}
                </Box>
              ))),
        ],
      })}
    </Box>
  )
}
