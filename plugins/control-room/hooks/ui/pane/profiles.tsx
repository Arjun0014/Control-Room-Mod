/**
 * Profiles: each profile with exactly what applying it would change, the
 * active one marked; save the current setup as a profile of your own.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel } from '../../../types'
import { diffSystems, listProfiles } from '../../core/profiles'
import { systemsOf } from '../../core/settings'
import { hint, textField, title } from '../components'
import type { Kit } from '../kit'
import { G } from '../theme'

export function profilesTab(kit: Kit, pane: PaneModel): RenderElement {
  const { Box, Text, Button } = kit.ui
  const s = pane.settings
  const current = systemsOf(s)
  const profiles = listProfiles(s)
  return (
    <Box flexDirection="column">
      {title(kit, 'Profiles', `active: ${pane.profileLabel}`)}
      {profiles.map(p => {
        const changes = diffSystems(current, p.systems)
        const isActive = s.profile === p.id
        const isExact = changes.length === 0
        return (
          <Box flexDirection="column" key={`profile-${p.id}`} marginBottom={1}>
            <Box flexDirection="row">
              <Box flexGrow={1} flexShrink={1}>
                <Text bold={isActive} color={isActive ? 'claude' : undefined} wrap="truncate-end">
                  {`${isActive ? G.dot : G.ring} ${p.name}${isActive && !isExact ? ' (modified)' : ''}`}
                </Text>
              </Box>
              {isExact ? <Text dimColor>in effect</Text> : <Button key={`apply-${p.id}`} label="Apply" variant={isActive ? 'primary' : 'secondary'} onPress={() => kit.actions.applyProfile(p.id)} />}
              {p.isBuiltin ? null : <Button key={`delete-${p.id}`} label="Delete" dimColor onPress={() => kit.actions.deleteProfile(p.id)} />}
            </Box>
            <Box marginLeft={2}>
              <Text dimColor wrap="wrap">
                {p.tagline}
              </Text>
            </Box>
            {isExact ? null : (
              <Box flexDirection="column" marginLeft={2}>
                {changes.slice(0, 8).map(c => (
                  <Text key={`chg-${p.id}-${c.path}`} wrap="truncate-end">
                    <Text dimColor>{`${c.label}: `}</Text>
                    <Text dimColor strikethrough>{c.from}</Text>
                    <Text>{` → ${c.to}`}</Text>
                  </Text>
                ))}
                {changes.length > 8 ? <Text dimColor>{`… ${changes.length - 8} more`}</Text> : null}
              </Box>
            )}
          </Box>
        )
      })}
      {title(kit, 'Save current setup')}
      {textField(kit, { key: 'profile-save', label: 'Profile name', value: '', placeholder: 'e.g. Night shift', submitLabel: 'save', onSubmit: name => kit.actions.saveProfile(name) })}
      {hint(kit, 'A profile sets every system at once. Changing any setting afterwards keeps the profile name with a * so you can see it was customised. Profiles never change permissions your organisation manages.')}
    </Box>
  )
}
