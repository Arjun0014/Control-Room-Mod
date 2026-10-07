/**
 * Setup: profiles (everything at once), display, and about. The profile in
 * use carries a check; when settings drifted from it, the exact changes are
 * listed, with a way back and a way to keep them as a profile.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel } from '../../../types'
import { VERSION } from '../../constants'
import { diffSystems, listProfiles } from '../../core/profiles'
import { systemsOf } from '../../core/settings'
import type { Kit } from '../kit'
import { buttons, card, isNative, note, picker, row, switchControl } from '../primitives'
import { ACCENT, G } from '../theme'

export function setupPage(kit: Kit, pane: PaneModel): RenderElement {
  const { Box, Button, Input } = kit.ui
  const s = pane.settings
  const u = kit.actions.update
  const accent = ACCENT.setup
  const profiles = listProfiles(s)
  const active = profiles.find(p => p.id === s.profile)
  const changes = active === undefined ? [] : diffSystems(active.systems, systemsOf(s))

  return (
    <Box flexDirection="column">
      {card(kit, {
        key: 'profiles',
        title: 'Profile',
        accent,
        footer: 'A profile sets everything at once. Change anything afterwards and the profile shows as edited.',
        rows: k =>
          profiles.map(p => {
            const isActive = p.id === s.profile
            const label = isActive ? `${G.ok} In use` : 'Use'
            return row(k, {
              key: `profile-${p.id}`,
              label: p.name,
              subtitle: isActive && changes.length > 0 ? 'Edited' : p.tagline,
              isDim: !isActive,
              control: {
                element: (
                  <Box key={`profile-${p.id}-actions`} flexDirection="row" columnGap={2}>
                    {p.isBuiltin ? null : <Button key={`delete-${p.id}`} label="Delete" plain dimColor onPress={() => kit.actions.deleteProfile(p.id)} />}
                    <Button key={`apply-${p.id}`} label={label} plain={isNative(k) ? undefined : true} dimColor={!isActive} variant={isActive ? 'primary' : 'secondary'} onPress={() => kit.actions.applyProfile(p.id)} />
                  </Box>
                ),
                width: label.length + (p.isBuiltin ? 0 : 8) + (isNative(k) ? 4 : 0),
              },
            })
          }),
      })}

      {changes.length === 0 || active === undefined
        ? null
        : card(kit, {
            key: 'changes',
            title: `Changed from ${active.name}`,
            accent,
            aside: changes.length > 8 ? `${changes.length} changes` : undefined,
            rows: k => [
              ...changes.slice(0, 8).map(c => row(k, { key: `change-${c.path}`, label: c.label, value: `${c.from} ${G.chevron} ${c.to}` })),
              changes.length > 8 ? note(k, `and ${changes.length - 8} more`, 'changes-more') : null,
              Input === undefined
                ? null
                : row(k, {
                    key: 'profile-save',
                    label: 'Keep as a profile',
                    control: { element: <Input key="profile-save" value="" placeholder="Type a name" submitLabel="save" onSubmit={name => kit.actions.saveProfile(name)} />, width: 18 },
                  }),
              buttons(k, [{ key: 'profile-revert', label: `Back to ${active.name}`, onPress: () => kit.actions.applyProfile(active.id) }], 'profile-actions'),
            ],
          })}

      {card(kit, {
        key: 'display',
        title: 'Display',
        accent,
        rows: k => [
          row(k, {
            key: 'ui-hud',
            label: 'Status bar',
            subtitle: s.ui.hud === 'off' ? '/cr still opens Control Room' : 'Live readings while you work',
            control: picker(k, {
              key: 'ui-hud',
              value: s.ui.hud,
              options: [
                { value: 'band', label: 'Above prompt' },
                { value: 'status', label: 'Status line' },
                { value: 'both', label: 'Both' },
                { value: 'off', label: 'Hidden' },
              ],
              onSelect: v => u(d => void (d.ui.hud = (['band', 'status', 'both', 'off'].includes(v) ? v : 'band') as typeof d.ui.hud)),
            }),
          }),
          row(k, {
            key: 'ui-load',
            label: 'Live CPU and memory',
            subtitle: `Machine-wide totals every ${s.resources.intervalSec} s`,
            control: switchControl(k, { key: 'ui-load', isOn: s.ui.liveLoad, onPress: () => u(d => void (d.ui.liveLoad = !d.ui.liveLoad)) }),
          }),
          row(k, {
            key: 'ui-toasts',
            label: 'Notifications',
            subtitle: 'Brief notes when something changes',
            control: switchControl(k, { key: 'ui-toasts', isOn: s.ui.toasts, onPress: () => u(d => void (d.ui.toasts = !d.ui.toasts)) }),
          }),
          row(k, {
            key: 'ui-open',
            label: 'Open at start',
            subtitle: kit.surface === 'terminal' ? 'In terminals 144 columns or wider' : 'Open Control Room with each session',
            control: switchControl(k, { key: 'ui-open', isOn: s.ui.openOnStart, onPress: () => u(d => void (d.ui.openOnStart = !d.ui.openOnStart)) }),
          }),
        ],
      })}

      {card(kit, {
        key: 'about',
        title: 'About',
        accent,
        rows: k => [
          row(k, { key: 'about-version', label: 'Control Room', value: VERSION, valueTone: 'muted' }),
          row(k, { key: 'about-engine', label: 'Claude Code', value: pane.engine.version ?? 'unknown', valueTone: pane.engine.isSupported ? 'muted' : 'warn' }),
          note(k, 'Runs on your machine only. No network requests, no telemetry. It keeps its settings and run history in Claude Code’s plugin store.', 'about-privacy'),
          buttons(k, [{ key: 'reset', label: 'Reset all settings', onPress: kit.actions.resetSettings }], 'about-actions'),
        ],
      })}
    </Box>
  )
}
