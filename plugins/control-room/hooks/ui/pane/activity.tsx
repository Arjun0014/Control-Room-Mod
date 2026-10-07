/**
 * Activity: everything Focus View keeps out of the transcript. Every tool
 * call of the turn, and every file Claude changed with its diff.
 */

import type { RenderElement } from 'claude-code'

import type { ActivityItemView, ActivityView, PaneModel, Tone } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { buttons, emptyState, labelWidth, listItem, row, section, segmented, switchControl } from '../primitives'
import { G } from '../theme'

const STATUS: Record<string, { glyph: string; tone: Tone }> = {
  running: { glyph: G.run, tone: 'info' },
  ok: { glyph: G.ok, tone: 'good' },
  error: { glyph: G.fail, tone: 'bad' },
  denied: { glyph: G.stop, tone: 'warn' },
}

function callItem(kit: Kit, item: ActivityItemView): RenderElement {
  const s = STATUS[item.status] ?? STATUS.ok!
  return listItem(kit, {
    key: `call-${item.id}`,
    glyph: s.glyph,
    tone: s.tone,
    text: `${item.isSubagent ? '↳ ' : ''}${item.tool}  ${item.label}`,
    right: item.endedAt === null ? 'running' : fmt.duration(item.endedAt - item.startedAt),
    isDim: item.status === 'ok' && item.heavy.length === 0,
  })
}

export function activityPage(kit: Kit, pane: PaneModel, view: ActivityView | undefined): RenderElement {
  const { Box, Text, Button, Code } = kit.ui
  const sub = pane.activitySub
  const focus = pane.settings.focus
  const u = kit.actions.update
  const lw = labelWidth(kit, 'Inline file diffs'.length)
  const files = view?.totals.files ?? 0

  const switcher = (
    <Box key="activity-switch" marginTop={1}>
      {
        segmented(kit, {
          key: 'sub',
          value: sub,
          options: [
            { value: 'calls', label: 'Tool calls' },
            { value: 'changes', label: files === 0 ? 'Changes' : `Changes (${files})` },
          ],
          onSelect: v => kit.actions.setActivitySub(v === 'changes' ? 'changes' : 'calls'),
        }).element
      }
    </Box>
  )

  const transcript = section(kit, {
    key: 'transcript',
    title: 'Transcript',
    footer: 'Focus View changes what you see, never what Claude reads. Press ▸ on a row to open it.',
    children: [
      row(kit, { key: 'act-focus', label: 'Focus view', labelWidth: lw, control: switchControl(kit, { key: 'act-focus', isOn: focus.enabled, onPress: kit.actions.toggleFocus }) }),
      focus.enabled &&
        row(kit, {
          key: 'act-tools',
          label: 'Tool calls',
          labelWidth: lw,
          control: segmented(kit, {
            key: 'act-tools',
            value: focus.tools,
            options: [
              { value: 'compact', label: 'One line' },
              { value: 'hidden', label: 'Hidden' },
            ],
            onSelect: v => u(d => void (d.focus.tools = v === 'hidden' ? 'hidden' : 'compact')),
          }),
        }),
      focus.enabled && row(kit, { key: 'act-results', label: 'Tool results', labelWidth: lw, control: switchControl(kit, { key: 'act-results', isOn: focus.results, onPress: () => u(d => void (d.focus.results = !d.focus.results)) }) }),
      focus.enabled && row(kit, { key: 'act-diffs', label: 'Inline file diffs', labelWidth: lw, control: switchControl(kit, { key: 'act-diffs', isOn: focus.diffs, onPress: () => u(d => void (d.focus.diffs = !d.focus.diffs)) }) }),
      focus.enabled && row(kit, { key: 'act-spinner', label: 'Activity line', labelWidth: lw, control: switchControl(kit, { key: 'act-spinner', isOn: focus.spinner, onPress: () => u(d => void (d.focus.spinner = !d.focus.spinner)) }), detail: focus.spinner ? 'in the spinner while Claude works' : undefined }),
    ],
  })

  if (sub === 'calls') {
    return (
      <Box flexDirection="column">
        {switcher}
        {section(kit, {
          key: 'calls',
          title: 'This turn',
          aside: view === undefined || view.turn === 0 ? undefined : view.summary.replace(/^Working · /, ''),
          children:
            view === undefined || view.items.length === 0
              ? [emptyState(kit, 'No tool calls yet.', 'calls-empty')]
              : [...view.items.slice(0, 40).map(item => callItem(kit, item)), view.items.length > 40 ? <Text key="calls-more" dimColor>{`${view.items.length - 40} more`}</Text> : null],
        })}
        {transcript}
      </Box>
    )
  }

  const selected = view?.selectedPath ?? null
  return (
    <Box flexDirection="column">
      {switcher}
      {section(kit, {
        key: 'files',
        title: 'Changed files',
        aside: view === undefined || files === 0 ? undefined : `+${view.totals.added}  −${view.totals.removed}`,
        footer: "Diffs come from the edit tools' own results. Changes made by shell commands appear when Claude Code reports them.",
        children:
          view === undefined || view.files.length === 0
            ? [emptyState(kit, 'Claude has not changed any files yet.', 'files-empty')]
            : [
                ...view.files.slice(0, 30).map(f => (
                  <Box key={`file-${f.path}`} flexDirection="row">
                    <Box flexGrow={1} flexShrink={1}>
                      <Button key={`pick-${f.path}`} label={`${f.path === selected ? G.down : G.arrow} ${f.display}`} plain dimColor={f.path !== selected} onPress={() => kit.actions.selectFile(f.path === selected ? null : f.path)} />
                    </Box>
                    <Text color="diffAdded">{` +${f.added}`}</Text>
                    <Text color="diffRemoved">{` −${f.removed}`}</Text>
                    {f.isCreated || f.isDeleted ? <Text dimColor>{f.isCreated ? '  new' : '  deleted'}</Text> : null}
                  </Box>
                )),
                selected === null ? null : (
                  <Box key="diff" flexDirection="column" marginTop={1}>
                    {view.selectedHunks === '' ? emptyState(kit, 'No line-level diff recorded for this change.', 'diff-empty') : <Code source={view.selectedHunks} format="diff" path={selected} wrap="truncate-end" />}
                  </Box>
                ),
                buttons(kit, [{ key: 'act-clear', label: 'Clear list', onPress: kit.actions.clearChanges }], 'files-actions'),
              ],
      })}
      {transcript}
    </Box>
  )
}
