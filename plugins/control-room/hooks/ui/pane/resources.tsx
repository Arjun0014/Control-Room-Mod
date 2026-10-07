/**
 * Resources: live machine load against the session's ceilings, the level
 * and enforcement settings, and the background work Claude started.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel, ResourcesView } from '../../../types'
import * as fmt from '../../core/format'
import { presetOf } from '../../features/resources/pressure'
import { choice, empty, field, hint, title } from '../components'
import type { Kit } from '../kit'
import { G, meter, sparkline, toneOfLevel, toneProps } from '../theme'

const PCTS = [40, 50, 60, 70, 75, 80, 85, 90, 95].map(n => ({ value: String(n), label: `${n}%` }))

function gauge(kit: Kit, label: string, value: number | null, ceiling: number | null, series: readonly number[]): RenderElement {
  const { Box, Text } = kit.ui
  const width = Math.max(8, Math.min(30, kit.columns - 34))
  const tone = value === null || ceiling === null ? 'muted' : value >= ceiling + 10 ? 'bad' : value >= ceiling ? 'bad' : value >= ceiling - 10 ? 'warn' : 'good'
  return (
    <Box flexDirection="row" key={`gauge-${label}`}>
      <Box width={6} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text {...toneProps(tone)}>{meter((value ?? 0) / 100, width, ceiling === null ? undefined : ceiling / 100)}</Text>
      <Box width={7} flexShrink={0} marginLeft={1}>
        <Text {...toneProps(tone)}>{value === null ? '—' : `${Math.round(value)}%`}</Text>
      </Box>
      {series.length > 1 && kit.columns >= 60 ? <Text dimColor>{sparkline(series, Math.min(20, kit.columns - width - 26))}</Text> : null}
    </Box>
  )
}

export function resourcesTab(kit: Kit, pane: PaneModel, view: ResourcesView | undefined): RenderElement {
  const { Box, Text, Button } = kit.ui
  const r = pane.settings.resources
  const u = kit.actions.update
  const v = view

  const status =
    r.level === 'off'
      ? 'Off — no monitoring, no limits'
      : v === undefined
        ? 'starting'
        : v.status === 'live'
          ? `${v.level.toUpperCase()} ${G.mid} sampling every ${r.intervalSec}s on ${v.platform}`
          : v.status === 'unavailable'
            ? `Unavailable: ${v.error ?? 'the sampler could not start'} (the policy still applies)`
            : 'Starting the sampler…'

  return (
    <Box flexDirection="column">
      {title(kit, 'Machine load')}
      {field(kit, 'Status', status, r.level === 'off' ? 'muted' : toneOfLevel(v?.level ?? 'unknown'))}
      {r.level === 'off' || v === undefined ? null : (
        <Box flexDirection="column" key="gauges">
          {gauge(kit, 'CPU', v.cpu, v.ceilings?.cpu ?? null, v.cpuSeries)}
          {gauge(kit, 'RAM', v.ram, v.ceilings?.ram ?? null, v.ramSeries)}
          {field(kit, 'Ceilings', v.ceilings === null ? '—' : `CPU ${v.ceilings.cpu}% · RAM ${v.ceilings.ram}% · ${fmt.plural(v.ceilings.maxHeavy, 'heavy job')} at a time`, 'normal')}
          {field(kit, 'Heavy work now', v.heavyRunning.length === 0 ? 'none' : v.heavyRunning.join('; '), v.heavyRunning.length === 0 ? 'muted' : 'info')}
          {field(kit, 'Interventions', `${v.noticesSent} notice(s) to Claude · ${v.refused} heavy command(s) held back`, 'muted')}
        </Box>
      )}

      {title(kit, 'Policy')}
      {choice(kit, {
        key: 'rs-level',
        label: 'Resource Governor',
        value: r.level,
        options: [
          { value: 'off', label: 'Off' },
          { value: 'low', label: 'Low — CPU 50% · RAM 75%' },
          { value: 'medium', label: 'Medium — CPU 70% · RAM 85%' },
          { value: 'high', label: 'High — CPU 90% · RAM 92%' },
          { value: 'custom', label: 'Custom' },
        ],
        onSelect: next =>
          u(d => {
            const level = (['off', 'low', 'medium', 'high', 'custom'].includes(next) ? next : 'off') as typeof d.resources.level
            d.resources.level = level
            if (level === 'low' || level === 'medium' || level === 'high') {
              const p = presetOf(level)
              d.resources.cpu = p.cpu
              d.resources.ram = p.ram
            }
          }),
      })}
      {r.level !== 'custom'
        ? null
        : [
            choice(kit, { key: 'rs-cpu', label: 'CPU ceiling', value: String(r.cpu), options: PCTS.some(p => p.value === String(r.cpu)) ? PCTS : [...PCTS, { value: String(r.cpu), label: `${r.cpu}%` }], onSelect: x => u(d => { d.resources.cpu = Number(x) }) }),
            choice(kit, { key: 'rs-ram', label: 'RAM ceiling', value: String(r.ram), options: PCTS.some(p => p.value === String(r.ram)) ? PCTS : [...PCTS, { value: String(r.ram), label: `${r.ram}%` }], onSelect: x => u(d => { d.resources.ram = Number(x) }) }),
          ]}
      {r.level === 'off'
        ? null
        : [
            choice(kit, {
              key: 'rs-enforce',
              label: 'When over a ceiling',
              value: r.enforcement,
              options: [
                { value: 'inform', label: 'Tell Claude only' },
                { value: 'limit', label: 'Also hold back extra heavy jobs' },
                { value: 'strict', label: 'Also hold back any new heavy job' },
              ],
              onSelect: x => u(d => { d.resources.enforcement = x === 'inform' ? 'inform' : x === 'strict' ? 'strict' : 'limit' }),
            }),
            choice(kit, {
              key: 'rs-interval',
              label: 'Sample every',
              value: String(r.intervalSec),
              options: ['2', '3', '5', '10', '15', '30'].map(s => ({ value: s, label: `${s} s` })),
              onSelect: x => u(d => { d.resources.intervalSec = Number(x) }),
            }),
          ]}

      {title(kit, "Claude's background work")}
      {v === undefined || v.background.length === 0
        ? empty(kit, 'No background commands from Claude are running.')
        : v.background.map(b => (
            <Box flexDirection="row" key={`bg-${b.id}`}>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end">{`${b.label}  `}</Text>
              </Box>
              <Text dimColor>{`${fmt.duration(kit.now - b.since)} `}</Text>
              <Button key={`stop-${b.id}`} label="Stop" onPress={() => kit.actions.stopTask(b.id)} />
            </Box>
          ))}
      {hint(
        kit,
        'Ceilings are machine-wide and advisory: Control Room tells Claude about pressure mid-task and holds back additional heavy commands, but it is not an operating-system quota and never stops or changes other programs. Only Claude-started background tasks can be stopped here.',
      )}
    </Box>
  )
}
