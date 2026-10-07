/**
 * Permissions: one row per category with its state, the recent decisions
 * the policy made, and what it can and cannot override.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel, PermissionCategory, PermissionState, PermissionsView } from '../../../types'
import * as fmt from '../../core/format'
import { DEFAULT_PERMISSIONS, PERMISSION_CATEGORIES } from '../../core/settings'
import { CATEGORY_INFO } from '../../features/permissions/categories'
import { statesFor } from '../../features/permissions/decide'
import { actionRow, choice, empty, hint, labelWidthOf, listLine, title } from '../components'
import type { Kit } from '../kit'

const STATE_LABEL: Record<PermissionState, string> = {
  default: 'Claude Code decides',
  allow: 'Allow',
  ask: 'Ask',
  deny: 'Deny',
}

export function permissionsTab(kit: Kit, pane: PaneModel, view: PermissionsView | undefined): RenderElement {
  const { Box } = kit.ui
  const p = pane.settings.permissions
  const isDefault = PERMISSION_CATEGORIES.every(c => p[c] === DEFAULT_PERMISSIONS[c])
  const labelWidth = labelWidthOf(kit, Math.max(...PERMISSION_CATEGORIES.map(c => CATEGORY_INFO[c].label.length)))
  return (
    <Box flexDirection="column">
      {title(kit, 'Policy', view === undefined ? undefined : `${view.asked} asked · ${view.denied} denied · ${view.allowed} allowed`)}
      {PERMISSION_CATEGORIES.map((c: PermissionCategory) =>
        choice(kit, {
          key: `perm-${c}`,
          label: CATEGORY_INFO[c].label,
          value: p[c],
          options: statesFor(c).map(s => ({ value: s, label: STATE_LABEL[s] })),
          onSelect: v => kit.actions.update(d => { d.permissions[c] = (statesFor(c).includes(v as PermissionState) ? v : 'ask') as PermissionState }),
          detail: kit.columns >= 90 ? CATEGORY_INFO[c].examples : undefined,
          labelWidth,
        }),
      )}
      {actionRow(kit, [{ key: 'perm-reset', label: 'Restore safe defaults', isHidden: isDefault, onPress: () => kit.actions.update(d => { d.permissions = { ...DEFAULT_PERMISSIONS } }) }])}

      {title(kit, 'Recent decisions')}
      {view === undefined || view.recent.length === 0
        ? empty(kit, 'Nothing intercepted yet.')
        : view.recent.slice(0, 12).map((r, i) =>
            listLine(kit, {
              key: `perm-log-${i}`,
              glyph: r.outcome === 'denied' || r.outcome === 'refused-heavy' ? '✗' : r.outcome === 'asked' ? '?' : '✓',
              glyphTone: r.outcome === 'denied' || r.outcome === 'refused-heavy' ? 'bad' : r.outcome === 'asked' ? 'warn' : 'good',
              text: `${r.outcome === 'refused-heavy' ? 'held back (resources)' : r.outcome} · ${r.evidence}`,
              right: fmt.clock(r.at),
            }),
          )}

      {title(kit, 'Precedence')}
      {hint(
        kit,
        'Deny is enforced before any dialog, in every permission mode, for Claude and its subagents. Ask forces an approval even where a rule or the mode would allow. Allow only answers prompts Claude Code would otherwise show — it never lifts a deny rule, never acts in plan mode, and is not offered for push, destructive Git, deploys or dangerous commands. Your organisation\'s managed settings always win. Shell commands are classified by pattern; this narrows what Claude may do but is not a sandbox.',
      )}
    </Box>
  )
}
