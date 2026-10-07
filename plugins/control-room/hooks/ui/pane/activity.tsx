/**
 * Activity: everything Focus View keeps out of the transcript — every tool
 * call, and every file Claude changed with its diff.
 */

import type { RenderElement } from 'claude-code'

import type { ActivityItemView, ActivityView, PaneModel, Tone } from '../../../types'
import * as fmt from '../../core/format'
import { actionRow, empty, hint, listLine, title, toggle } from '../components'
import type { Kit } from '../kit'
import { G } from '../theme'

const STATUS: Record<string, { glyph: string; tone: Tone }> = {
  running: { glyph: G.run, tone: 'info' },
  ok: { glyph: G.ok, tone: 'good' },
  error: { glyph: G.fail, tone: 'bad' },
  denied: { glyph: G.stop, tone: 'warn' },
}

function callLine(kit: Kit, item: ActivityItemView): RenderElement {
  const s = STATUS[item.status] ?? STATUS.ok!
  const took = item.endedAt === null ? 'running' : fmt.duration(item.endedAt - item.startedAt)
  return listLine(kit, {
    key: `call-${item.id}`,
    glyph: s.glyph,
    glyphTone: s.tone,
    text: `${item.isSubagent ? '↳ ' : ''}${item.tool}  ${item.label}`,
    right: took,
    isDim: item.status === 'ok' && item.heavy.length === 0,
  })
}

export function activityTab(kit: Kit, pane: PaneModel, view: ActivityView | undefined): RenderElement {
  const { Box, Text, Button, Code } = kit.ui
  const sub = pane.activitySub
  const focus = pane.settings.focus
  const switcher = (
    <Box flexDirection="row" columnGap={1} key="activity-switch">
      <Button key="sub-calls" label="Tool calls" variant={sub === 'calls' ? 'primary' : 'secondary'} dimColor={sub !== 'calls'} onPress={() => kit.actions.setActivitySub('calls')} />
      <Button
        key="sub-changes"
        label={`Changes${view === undefined || view.totals.files === 0 ? '' : ` (${view.totals.files})`}`}
        variant={sub === 'changes' ? 'primary' : 'secondary'}
        dimColor={sub !== 'changes'}
        onPress={() => kit.actions.setActivitySub('changes')}
      />
    </Box>
  )

  if (view === undefined) return <Box flexDirection="column">{switcher}{empty(kit, 'No activity yet.')}</Box>

  if (sub === 'calls') {
    return (
      <Box flexDirection="column">
        {switcher}
        {title(kit, 'This turn', view.summary)}
        {view.items.length === 0 ? empty(kit, 'No tool calls yet.') : view.items.slice(0, 40).map(item => callLine(kit, item))}
        {view.items.length > 40 ? <Text dimColor>{`(${view.items.length - 40} more)`}</Text> : null}
        {title(kit, 'Transcript')}
        {toggle(kit, { key: 'act-focus', label: 'Focus View', isOn: focus.enabled, onPress: kit.actions.toggleFocus, detail: focus.enabled ? 'tool rows minimized in the transcript' : 'tool rows shown in full' })}
      </Box>
    )
  }

  const selected = view.selectedPath
  return (
    <Box flexDirection="column">
      {switcher}
      {title(kit, 'Changed files', `${fmt.plural(view.totals.files, 'file')} · +${view.totals.added} −${view.totals.removed}`)}
      {view.files.length === 0
        ? empty(kit, 'Claude has not changed any files yet.')
        : view.files.slice(0, 30).map(f => (
            <Box flexDirection="row" key={`file-${f.path}`}>
              <Button
                key={`pick-${f.path}`}
                label={`${f.path === selected ? G.arrow : ' '} ${f.display}`}
                plain
                dimColor={f.path !== selected}
                onPress={() => kit.actions.selectFile(f.path === selected ? null : f.path)}
              />
              <Text color="diffAdded">{` +${f.added}`}</Text>
              <Text color="diffRemoved">{` −${f.removed}`}</Text>
              <Text dimColor>{f.isCreated ? ' new' : f.isDeleted ? ' deleted' : ''}</Text>
            </Box>
          ))}
      {selected === null ? null : (
        <Box flexDirection="column" marginTop={1} key="diff">
          <Text bold>{view.files.find(f => f.path === selected)?.display ?? selected}</Text>
          {view.selectedHunks === '' ? empty(kit, 'No line-level diff recorded for this change.') : <Code source={view.selectedHunks} format="diff" path={selected} wrap="truncate-end" />}
        </Box>
      )}
      {actionRow(kit, [
        { key: 'act-inline', label: focus.diffs ? 'Hide inline diffs' : 'Show inline diffs', onPress: () => kit.actions.update(d => { d.focus.diffs = !d.focus.diffs }) },
        { key: 'act-clear', label: 'Clear list', onPress: kit.actions.clearChanges, isHidden: view.files.length === 0 },
      ])}
      {hint(kit, 'Diffs come from the edit tools\' own results; changes made by shell commands appear when Claude Code reports them. Nothing is hidden from Claude — only from the transcript.')}
    </Box>
  )
}
