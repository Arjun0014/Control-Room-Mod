/**
 * The Control Centre's frame: identity and live strip on top, the tab bar
 * (1–9 while the pane has the keyboard), the selected tab, and a quiet
 * footer. Monitoring sits above controls on every tab.
 */

import type { RenderElement } from 'claude-code'

import type { ActivityView, ChainView, HudModel, PaneModel, PermissionsView, ResourcesView, TabId } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { G, meter, toneProps } from '../theme'
import { activityTab } from './activity'
import { autopilotTab } from './autopilot'
import { chainTab } from './chain'
import { modesTab } from './modes'
import { overviewTab } from './overview'
import { permissionsTab } from './permissions'
import { profilesTab } from './profiles'
import { resourcesTab } from './resources'
import { settingsTab } from './settings'

export const TABS: readonly { id: TabId; label: string; short: string; hotkey: string }[] = [
  { id: 'overview', label: 'Overview', short: 'Home', hotkey: '1' },
  { id: 'autopilot', label: 'Autopilot', short: 'Auto', hotkey: '2' },
  { id: 'modes', label: 'Modes', short: 'Modes', hotkey: '3' },
  { id: 'resources', label: 'Resources', short: 'Res', hotkey: '4' },
  { id: 'permissions', label: 'Permissions', short: 'Perm', hotkey: '5' },
  { id: 'chain', label: 'Chain', short: 'Chain', hotkey: '6' },
  { id: 'activity', label: 'Activity', short: 'Act', hotkey: '7' },
  { id: 'profiles', label: 'Profiles', short: 'Prof', hotkey: '8' },
  { id: 'settings', label: 'Settings', short: 'Set', hotkey: '9' },
]

/** Which extra atoms a tab draws from (the render hook reads only these). */
export const TAB_NEEDS: Record<TabId, readonly ('resources' | 'chain' | 'activity' | 'permissions')[]> = {
  overview: ['resources', 'activity'],
  autopilot: [],
  modes: [],
  resources: ['resources'],
  permissions: ['permissions'],
  chain: ['chain'],
  activity: ['activity'],
  profiles: [],
  settings: [],
}

export type PaneData = {
  pane: PaneModel
  hud: HudModel
  resources?: ResourcesView
  chain?: ChainView
  activity?: ActivityView
  permissions?: PermissionsView
}

function header(kit: Kit, data: PaneData): RenderElement {
  const { Box, Text } = kit.ui
  const { hud, pane } = data
  const ctx = hud.ctx
  const ctxLine =
    ctx.tokens === null
      ? G.none
      : `${fmt.tokens(ctx.tokens)}${ctx.window === null ? '' : ` / ${fmt.tokens(ctx.window)}`}${ctx.pct === null ? '' : `  ${ctx.pct}%`}`
  const barWidth = Math.max(8, Math.min(24, kit.columns - 46))
  return (
    <Box flexDirection="column" key="header">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="claude">{`${G.brand} CONTROL ROOM`}</Text>
        <Text dimColor wrap="truncate-start">{`${pane.profileLabel} ${G.mid} ${pane.runLabel}`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Text {...toneProps(ctx.tone)}>{`CTX ${ctxLine}`}</Text>
        {ctx.tokens !== null && ctx.window !== null ? (
          <Text {...toneProps(ctx.tone)}>{meter(ctx.tokens / ctx.window, barWidth, ctx.threshold === null ? undefined : ctx.threshold / ctx.window)}</Text>
        ) : null}
        <Text>{`${fmt.cost(hud.cost.usd)}${hud.cost.runUsd !== null && hud.cost.usd !== null && hud.cost.runUsd > hud.cost.usd + 0.005 ? ` ${G.mid} run ${fmt.cost(hud.cost.runUsd)}` : ''}`}</Text>
        <Text {...toneProps(hud.autopilot.tone)}>{hud.autopilot.label}</Text>
      </Box>
    </Box>
  )
}

/** Cells a tab button takes: its hotkey, `: `, its label. */
const tabCells = (labels: readonly string[]): number => labels.reduce((n, l) => n + l.length + 3, 0) + labels.length - 1

/**
 * One row where it fits, else two deliberate rows (1–5, 6–9) rather than a
 * stray last tab; short labels only where even those would not fit.
 */
function tabBar(kit: Kit, current: TabId): RenderElement {
  const { Box, Button } = kit.ui
  const full = TABS.map(t => t.label)
  const isOneRow = tabCells(full) <= kit.columns
  const isFullLabels = isOneRow || tabCells(full.slice(0, 5)) <= kit.columns
  const button = (t: (typeof TABS)[number]) => (
    <Button
      key={`tab-${t.id}`}
      label={isFullLabels ? t.label : t.short}
      hotkey={t.hotkey}
      plain
      dimColor={t.id !== current}
      variant={t.id === current ? 'primary' : 'secondary'}
      onPress={() => kit.actions.setTab(t.id)}
    />
  )
  const rows = isOneRow ? [TABS] : [TABS.slice(0, 5), TABS.slice(5)]
  return (
    <Box flexDirection="column" marginTop={1} key="tabs">
      {rows.map((row, i) => (
        <Box key={`tabs-${i}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
          {row.map(button)}
        </Box>
      ))}
    </Box>
  )
}

function body(kit: Kit, data: PaneData): RenderElement {
  switch (data.pane.tab) {
    case 'overview':
      return overviewTab(kit, data)
    case 'autopilot':
      return autopilotTab(kit, data.pane)
    case 'modes':
      return modesTab(kit, data.pane)
    case 'resources':
      return resourcesTab(kit, data.pane, data.resources)
    case 'permissions':
      return permissionsTab(kit, data.pane, data.permissions)
    case 'chain':
      return chainTab(kit, data.chain)
    case 'activity':
      return activityTab(kit, data.pane, data.activity)
    case 'profiles':
      return profilesTab(kit, data.pane)
    case 'settings':
      return settingsTab(kit, data.pane)
  }
}

export function paneView(kit: Kit, data: PaneData): RenderElement {
  const { Box, Text } = kit.ui
  const notes = data.pane.notes
  return (
    <Box flexDirection="column" paddingRight={1}>
      {header(kit, data)}
      {tabBar(kit, data.pane.tab)}
      <Text dimColor>{G.rule.repeat(Math.max(4, Math.min(kit.columns - 1, 160)))}</Text>
      {notes.length === 0 ? null : (
        <Box flexDirection="column" marginBottom={1} key="notes">
          {notes.map((n, i) => (
            <Text key={`note-${i}`} color="warning" wrap="wrap">{`${G.warn} ${n}`}</Text>
          ))}
        </Box>
      )}
      {body(kit, data)}
      <Box marginTop={1} key="footer">
        <Text dimColor wrap="truncate-end">
          {kit.surface !== 'terminal'
            ? '/cr help lists every command'
            : kit.columns >= 84
              ? '1–9 tabs · Tab/arrows move · Enter selects · Esc back to the prompt · /cr help'
              : '1–9 tabs · Tab/arrows move · Enter selects · Esc back'}
        </Text>
      </Box>
    </Box>
  )
}
