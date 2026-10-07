/**
 * Settings: how Control Room presents itself, what it can see and do, and
 * the reset.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel } from '../../../types'
import * as fmt from '../../core/format'
import { actionRow, choice, field, hint, title, toggle } from '../components'
import type { Kit } from '../kit'

export function settingsTab(kit: Kit, pane: PaneModel): RenderElement {
  const { Box } = kit.ui
  const ui = pane.settings.ui
  const u = kit.actions.update
  return (
    <Box flexDirection="column">
      {title(kit, 'Display')}
      {choice(kit, {
        key: 'set-hud',
        label: 'HUD',
        value: ui.hud,
        options: [
          { value: 'band', label: 'Band above the prompt' },
          { value: 'status', label: 'Status line under the prompt' },
          { value: 'both', label: 'Both' },
          { value: 'off', label: 'Off' },
        ],
        onSelect: v => u(d => { d.ui.hud = v === 'status' ? 'status' : v === 'both' ? 'both' : v === 'off' ? 'off' : 'band' }),
      })}
      {toggle(kit, { key: 'set-toasts', label: 'Toasts for state changes', isOn: ui.toasts, onPress: () => u(d => { d.ui.toasts = !d.ui.toasts }) })}
      {toggle(kit, { key: 'set-open', label: 'Open at session start', isOn: ui.openOnStart, onPress: () => u(d => { d.ui.openOnStart = !d.ui.openOnStart }), detail: 'where the terminal is wide enough' })}

      {title(kit, 'About')}
      {field(kit, 'Claude Code', pane.engine.version ?? 'unknown', pane.engine.isSupported ? 'normal' : 'warn', pane.engine.isSupported ? undefined : 'older than the verified 2.1.289')}
      {field(kit, 'Drawing on', pane.surfaces.length === 0 ? 'terminal' : pane.surfaces.join(', '), 'normal')}
      {field(kit, 'Settings saved', pane.savedAt === null ? 'not changed this session' : fmt.clock(pane.savedAt), 'muted', 'kept in Control Room\'s own store; applies to new sessions too')}

      {title(kit, 'Privacy & control')}
      {hint(
        kit,
        'Control Room runs entirely inside Claude Code: no network requests, no telemetry, no data leaves your machine through it. It reads session figures (context, cost), tool calls as they happen, and — only with the Resource Governor on — machine-wide CPU/RAM totals. It writes only its own store, and asks Claude (never itself) to write the handoff file. The guard\'s optional model check sends the last request and answer to your configured model, as Claude Code does for every turn.',
      )}

      {title(kit, 'Reset')}
      {actionRow(kit, [{ key: 'set-reset', label: 'Reset all settings to Normal', onPress: kit.actions.resetSettings }])}
    </Box>
  )
}
