/**
 * Setup: profiles (everything at once), display, and about. A profile is
 * picked like a radio button; when the settings drifted from it, the exact
 * changes are listed and can be saved as a profile of their own.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel } from '../../../types'
import { VERSION } from '../../constants'
import { diffSystems, listProfiles } from '../../core/profiles'
import { systemsOf } from '../../core/settings'
import type { Kit } from '../kit'
import { buttons, labelWidth, note, picker, row, section, switchControl } from '../primitives'
import { G } from '../theme'

const pretty = (v: string): string => (v === 'on' ? 'On' : v === 'off' ? 'Off' : v.charAt(0).toUpperCase() + v.slice(1))

export function setupPage(kit: Kit, pane: PaneModel): RenderElement {
  const { Box, Text, Button, Input } = kit.ui
  const s = pane.settings
  const u = kit.actions.update
  const lw = labelWidth(kit, 'Open at session start'.length)
  const profiles = listProfiles(s)
  const active = profiles.find(p => p.id === s.profile)
  const changes = active === undefined ? [] : diffSystems(active.systems, systemsOf(s))
  const nameWidth = Math.max(...profiles.map(p => p.name.length)) + 2
  const changeWidth = Math.min(28, Math.max(12, ...changes.slice(0, 6).map(c => c.label.length + 4)))

  return (
    <Box flexDirection="column">
      {section(kit, {
        key: 'profiles',
        title: 'Profile',
        footer: 'A profile sets everything at once. Changing a setting afterwards keeps the profile, marked as edited.',
        children: [
          ...profiles.map(p => {
            const isActive = p.id === s.profile
            return (
              <Box key={`profile-${p.id}`} flexDirection="row">
                <Box width={nameWidth + 2} flexShrink={0}>
                  <Button key={`apply-${p.id}`} label={`${isActive ? G.dot : G.ring} ${p.name}`} plain dimColor={!isActive} onPress={() => kit.actions.applyProfile(p.id)} />
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Text dimColor wrap="truncate-end">
                    {isActive && changes.length > 0 ? 'edited' : p.tagline}
                  </Text>
                </Box>
                {p.isBuiltin ? null : <Button key={`delete-${p.id}`} label="Delete" plain dimColor onPress={() => kit.actions.deleteProfile(p.id)} />}
              </Box>
            )
          }),
          changes.length === 0 ? null : (
            <Box key="profile-changes" flexDirection="column" marginTop={1}>
              <Text dimColor>{`Changed from ${active?.name ?? 'the profile'}:`}</Text>
              {changes.slice(0, 6).map(c => (
                <Box key={`change-${c.path}`} flexDirection="row">
                  <Box width={changeWidth} flexShrink={0}>
                    <Text dimColor wrap="truncate-end">{`  ${c.label}`}</Text>
                  </Box>
                  <Text dimColor>{pretty(c.from)}</Text>
                  <Text dimColor>{` ${G.chevron} `}</Text>
                  <Text>{pretty(c.to)}</Text>
                </Box>
              ))}
              {changes.length > 6 ? <Text dimColor>{`  and ${changes.length - 6} more`}</Text> : null}
            </Box>
          ),
          changes.length === 0 || Input === undefined ? null : (
            <Box key="profile-save" flexDirection="row" marginTop={1}>
              <Box width={lw} flexShrink={0}>
                <Text>Save as</Text>
              </Box>
              <Input key="profile-save" value="" placeholder="a name, e.g. Night shift" submitLabel="save" onSubmit={name => kit.actions.saveProfile(name)} />
            </Box>
          ),
          changes.length === 0 || active === undefined ? null : buttons(kit, [{ key: 'profile-revert', label: `Back to ${active.name}`, onPress: () => kit.actions.applyProfile(active.id) }], 'profile-actions'),
        ],
      })}

      {section(kit, {
        key: 'display',
        title: 'Display',
        children: [
          row(kit, {
            key: 'ui-hud',
            label: 'Status bar',
            labelWidth: lw,
            control: picker(kit, {
              key: 'ui-hud',
              value: s.ui.hud,
              options: [
                { value: 'band', label: 'Above the prompt' },
                { value: 'status', label: 'In the status line' },
                { value: 'both', label: 'Both' },
                { value: 'off', label: 'Hidden', hint: '/cr still opens Control Room' },
              ],
              onSelect: v => u(d => void (d.ui.hud = (['band', 'status', 'both', 'off'].includes(v) ? v : 'band') as typeof d.ui.hud)),
            }),
          }),
          row(kit, { key: 'ui-toasts', label: 'Notifications', labelWidth: lw, control: switchControl(kit, { key: 'ui-toasts', isOn: s.ui.toasts, onPress: () => u(d => void (d.ui.toasts = !d.ui.toasts)) }), detail: 'brief notes when something changes' }),
          row(kit, {
            key: 'ui-open',
            label: 'Open at session start',
            labelWidth: lw,
            control: switchControl(kit, { key: 'ui-open', isOn: s.ui.openOnStart, onPress: () => u(d => void (d.ui.openOnStart = !d.ui.openOnStart)) }),
            detail: s.ui.openOnStart && kit.surface === 'terminal' ? 'in terminals 144 columns or wider' : undefined,
          }),
        ],
      })}

      {section(kit, {
        key: 'about',
        title: 'About',
        children: [
          row(kit, { key: 'about-version', label: 'Control Room', labelWidth: lw, value: VERSION, valueTone: 'muted' }),
          row(kit, { key: 'about-engine', label: 'Claude Code', labelWidth: lw, value: pane.engine.version ?? 'unknown', valueTone: pane.engine.isSupported ? 'muted' : 'warn' }),
          note(kit, 'Runs entirely on your machine. No network requests, no telemetry. It keeps only its settings and run history, in Claude Code’s plugin store.', 'about-privacy'),
          buttons(kit, [{ key: 'reset', label: 'Reset all settings', onPress: kit.actions.resetSettings }], 'about-actions'),
        ],
      })}
    </Box>
  )
}
