/**
 * Activity: everything Focus view keeps out of the transcript. This turn's
 * tool calls, or every file Claude changed with its diff, then how the
 * transcript itself is drawn.
 */

import type { RenderElement } from 'claude-code'

import type { ActivityItemView, ActivityView, PaneModel, Tone } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { buttons, card, emptyState, listItem, row, segmented, switchControl } from '../primitives'
import { ACCENT, G } from '../theme'

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
  const accent = ACCENT.activity
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

  const transcript = card(kit, {
    key: 'transcript',
    title: 'Transcript',
    accent,
    footer: 'Focus view changes what you see, never what Claude reads. Press ▸ on a row to open it.',
    rows: k => [
      row(k, {
        key: 'act-focus',
        label: 'Focus view',
        subtitle: 'One quiet line per tool call',
        control: switchControl(k, { key: 'act-focus', isOn: focus.enabled, onPress: kit.actions.toggleFocus }),
      }),
      focus.enabled &&
        row(k, {
          key: 'act-tools',
          label: 'Tool calls',
          control: segmented(k, {
            key: 'act-tools',
            value: focus.tools,
            options: [
              { value: 'compact', label: 'One line' },
              { value: 'hidden', label: 'Hidden' },
            ],
            onSelect: v => u(d => void (d.focus.tools = v === 'hidden' ? 'hidden' : 'compact')),
          }),
        }),
      focus.enabled && row(k, { key: 'act-results', label: 'Tool results', control: switchControl(k, { key: 'act-results', isOn: focus.results, onPress: () => u(d => void (d.focus.results = !d.focus.results)) }) }),
      focus.enabled && row(k, { key: 'act-diffs', label: 'Inline file diffs', control: switchControl(k, { key: 'act-diffs', isOn: focus.diffs, onPress: () => u(d => void (d.focus.diffs = !d.focus.diffs)) }) }),
      focus.enabled &&
        row(k, {
          key: 'act-spinner',
          label: 'Activity line',
          subtitle: 'A summary in the spinner while Claude works',
          control: switchControl(k, { key: 'act-spinner', isOn: focus.spinner, onPress: () => u(d => void (d.focus.spinner = !d.focus.spinner)) }),
        }),
    ],
  })

  if (sub === 'calls') {
    return (
      <Box flexDirection="column">
        {switcher}
        {card(kit, {
          key: 'calls',
          title: 'This turn',
          accent,
          aside: view === undefined || view.turn === 0 ? undefined : view.summary.replace(/^Working · /, ''),
          rows: k =>
            view === undefined || view.items.length === 0
              ? [emptyState(k, 'No tool calls yet.', 'calls-empty')]
              : [
                  ...view.items.slice(0, 40).map(item => callItem(k, item)),
                  view.items.length > 40 ? (
                    <Text key="calls-more" dimColor>
                      {`${view.items.length - 40} more`}
                    </Text>
                  ) : null,
                ],
        })}
        {transcript}
      </Box>
    )
  }

  const selected = view?.selectedPath ?? null
  return (
    <Box flexDirection="column">
      {switcher}
      {card(kit, {
        key: 'files',
        title: 'Changed files',
        accent,
        aside: view === undefined || files === 0 ? undefined : `+${view.totals.added}  −${view.totals.removed}`,
        footer: "Diffs come from the edit tools' own results. Changes made by shell commands appear when Claude Code reports them.",
        rows: k =>
          view === undefined || view.files.length === 0
            ? [emptyState(k, 'Claude has not changed any files yet.', 'files-empty')]
            : [
                ...view.files.slice(0, 30).map(f => (
                  <Box key={`file-${f.path}`} flexDirection="row" columnGap={1}>
                    <Box flexGrow={1} flexShrink={1}>
                      <Button key={`pick-${f.path}`} label={`${f.path === selected ? G.down : G.arrow} ${f.display}`} plain dimColor={f.path !== selected} onPress={() => kit.actions.selectFile(f.path === selected ? null : f.path)} />
                    </Box>
                    <Text color="diffAdded">{`+${f.added}`}</Text>
                    <Text color="diffRemoved">{`−${f.removed}`}</Text>
                    {f.isCreated || f.isDeleted ? <Text dimColor>{f.isCreated ? 'new' : 'deleted'}</Text> : null}
                  </Box>
                )),
                selected === null ? null : (
                  <Box key="diff" flexDirection="column">
                    {view.selectedHunks === '' ? emptyState(k, 'No line-level diff recorded for this change.', 'diff-empty') : <Code source={view.selectedHunks} format="diff" path={selected} wrap="truncate-end" />}
                  </Box>
                ),
                buttons(k, [{ key: 'act-clear', label: 'Clear list', onPress: kit.actions.clearChanges }], 'files-actions'),
              ],
      })}
      {transcript}
    </Box>
  )
}
