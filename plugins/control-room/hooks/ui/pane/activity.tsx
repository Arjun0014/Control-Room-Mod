/**
 * Activity: the run in detail, signal before noise.
 *
 * Summary (the default): the run's objective and milestones, what Claude is
 * doing now and next; what it did this turn, in a few counted lines; what
 * needs a look (Attention); how the checks went (Validation); and the files
 * it changed, real project changes first, generated and temporary files
 * folded apart. Every tool call, in order, is the secondary view.
 */

import type { RenderElement } from 'claude-code'

import type { ActivityItemView, ActivityView, AttentionView, ChangeGroupView, FileChangeView, PaneModel, Tone, ValidationView } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { buttons, card, clip, emptyState, field, listItem, note, row, segmented, switchControl, workStrip } from '../primitives'
import { ACCENT, G, toneProps } from '../theme'

const CALL_STATUS: Record<string, { glyph: string; tone: Tone }> = {
  running: { glyph: G.run, tone: 'info' },
  ok: { glyph: G.ok, tone: 'good' },
  error: { glyph: G.fail, tone: 'bad' },
  denied: { glyph: G.stop, tone: 'warn' },
  held: { glyph: G.stop, tone: 'warn' },
}

const elapsed = (kit: Kit, since: number): string => fmt.duration(Math.max(0, kit.now - since))

// ---------------------------------------------------------------------------
// Run progress

function runCard(kit: Kit, view: ActivityView): RenderElement {
  const { Box, Text } = kit.ui
  const m = view.mission
  const accent = ACCENT.activity
  const checks = view.validation
  const aside = `Session ${m.session}${m.handoffs > 0 ? ` · ${fmt.plural(m.handoffs, 'handoff')}` : ''}`
  return card(kit, {
    key: 'run',
    title: 'Run progress',
    accent,
    aside,
    rows: k => {
      const strip = Math.max(4, Math.min(12, k.columns - 10 - 16))
      const plan = m.plan
      return [
        m.objective === null
          ? null
          : (
              <Box key="run-objective" flexDirection="row">
                <Box width={10} flexShrink={0}>
                  <Text dimColor>Objective</Text>
                </Box>
                <Box flexGrow={1} flexShrink={1} {...clip(k)}>
                  <Text wrap="wrap">{m.objective}</Text>
                </Box>
              </Box>
            ),
        plan === null ? (
          note(k, 'No milestones yet. They appear here when Claude keeps a task list for the work.', 'run-no-plan')
        ) : (
          <Box key="run-plan" flexDirection="column">
            {field(k, {
              key: 'run-progress',
              label: 'Progress',
              content: workStrip(k, { key: 'run-strip', done: plan.done, total: plan.total, hasCurrent: plan.tasks.some(t => t.isCurrent), max: strip, caption: `${plan.done} of ${fmt.plural(plan.total, 'milestone')}` }),
            })}
            <Box key="run-milestones" flexDirection="column" marginLeft={10} marginTop={1}>
              {plan.earlier > 0 ? <Text key="run-earlier" dimColor>{`${plan.earlier} earlier done`}</Text> : null}
              {plan.tasks.map((t, i) =>
                listItem(k, {
                  key: `milestone-${i}`,
                  glyph: t.status === 'completed' ? G.ok : t.isCurrent || t.status === 'in_progress' ? G.arrow : G.ring,
                  tone: t.status === 'completed' ? 'good' : t.isCurrent ? 'info' : 'muted',
                  text: t.subject,
                  isDim: t.status === 'completed' || (!t.isCurrent && t.status !== 'in_progress'),
                  isBold: t.isCurrent,
                }),
              )}
              {plan.later > 0 ? <Text key="run-later" dimColor>{`${plan.later} more to come`}</Text> : null}
            </Box>
          </Box>
        ),
        <Box key="run-fields" flexDirection="column">
          {field(k, {
            key: 'run-now',
            label: 'Now',
            content:
              m.now === null ? (
                <Text dimColor>{m.isWorking ? 'Working' : 'Waiting for the next prompt'}</Text>
              ) : (
                <Text wrap="truncate-end">
                  <Text color="suggestion">{`${G.arrow} `}</Text>
                  <Text>{m.now}</Text>
                </Text>
              ),
          })}
          {m.next === null ? null : field(k, { key: 'run-next', label: 'Next', content: <Text wrap="truncate-end">{m.next}</Text> })}
          {field(k, {
            key: 'run-checks',
            label: 'Checks',
            content:
              checks.length === 0 ? (
                <Text dimColor>None run yet</Text>
              ) : (
                <Text wrap="truncate-end">
                  {checks.map((c, i) => {
                    const s = CHECK_STATUS[c.status] ?? CHECK_STATUS.passed!
                    return (
                      <Text key={`run-check-${c.kind}`}>
                        {i > 0 ? '   ' : ''}
                        <Text {...toneProps(s.tone)}>{s.glyph}</Text>
                        {` ${c.label}`}
                      </Text>
                    )
                  })}
                </Text>
              ),
          })}
        </Box>,
      ]
    },
  })
}

// ---------------------------------------------------------------------------
// This turn

function turnCard(kit: Kit, view: ActivityView): RenderElement {
  const { Text } = kit.ui
  const t = view.turnSummary
  const time = t.durationMs === null ? null : fmt.duration(t.durationMs)
  const aside = view.turn === 0 ? undefined : t.isRunning ? `Running${time === null ? '' : ` · ${time}`}` : `${time === null ? '' : `${time} · `}${fmt.plural(t.tools, 'tool call')}`
  return card(kit, {
    key: 'turn',
    title: 'This turn',
    accent: ACCENT.activity,
    aside,
    rows: k =>
      t.lines.length === 0
        ? [emptyState(k, view.turn === 0 ? 'Nothing yet. Claude’s work shows here as it happens.' : 'No tool calls in this turn.', 'turn-empty')]
        : t.lines.map((line, i) => (
            <Text key={`turn-line-${i}`} wrap="wrap">
              {line}
            </Text>
          )),
  })
}

// ---------------------------------------------------------------------------
// Attention

function attentionRow(kit: Kit, a: AttentionView): RenderElement {
  const tried = a.attempts > 1 ? `tried ${a.attempts}×` : null
  const detail = [a.reason, tried].filter((x): x is string => x !== null && x !== '').join(' · ')
  switch (a.kind) {
    case 'failed':
      return a.state === 'recovered'
        ? listItem(kit, { key: `att-${a.id}`, glyph: G.ok, tone: 'good', text: a.title, detail, right: 'recovered', rightTone: 'good', isDim: true })
        : listItem(kit, { key: `att-${a.id}`, glyph: G.fail, tone: 'bad', text: a.title, detail, right: 'unresolved', rightTone: 'bad' })
    case 'blocked':
      return listItem(kit, { key: `att-${a.id}`, glyph: G.stop, tone: 'warn', text: a.title, detail, right: 'blocked', rightTone: 'warn' })
    case 'held':
      return listItem(kit, { key: `att-${a.id}`, glyph: G.stop, tone: 'warn', text: a.title, detail, right: 'held back', rightTone: 'warn' })
    case 'running':
      return listItem(kit, { key: `att-${a.id}`, glyph: G.run, tone: 'info', text: a.title, right: `running ${elapsed(kit, a.since)}`, rightTone: 'info' })
    case 'slow':
      return listItem(kit, { key: `att-${a.id}`, glyph: G.warn, tone: 'warn', text: a.title, detail: 'Took longer than usual', right: a.durationMs === null ? 'slow' : fmt.duration(a.durationMs) })
  }
}

function attentionCard(kit: Kit, view: ActivityView): RenderElement | null {
  if (view.attention.length === 0) return null
  const open = view.attention.filter(a => (a.kind === 'failed' && a.state === 'unresolved') || a.kind === 'blocked' || a.kind === 'held').length
  return card(kit, {
    key: 'attention',
    title: 'Attention',
    accent: ACCENT.activity,
    aside: open > 0 ? `${open} open` : 'all clear',
    rows: k => view.attention.map(a => attentionRow(k, a)),
  })
}

// ---------------------------------------------------------------------------
// Validation

const CHECK_STATUS: Record<string, { glyph: string; tone: Tone }> = {
  passed: { glyph: G.ok, tone: 'good' },
  failed: { glyph: G.fail, tone: 'bad' },
  running: { glyph: G.run, tone: 'info' },
  blocked: { glyph: G.stop, tone: 'warn' },
  background: { glyph: G.ring, tone: 'muted' },
  stopped: { glyph: G.stop, tone: 'muted' },
}

function checkRow(kit: Kit, v: ValidationView): RenderElement {
  const s = CHECK_STATUS[v.status] ?? CHECK_STATUS.passed!
  const time = v.durationMs === null ? '' : fmt.duration(v.durationMs)
  const right =
    v.status === 'passed'
      ? time
      : v.status === 'failed'
        ? `failed${time === '' ? '' : ` · ${time}`}`
        : v.status === 'running'
          ? `running${time === '' ? '' : ` · ${time}`}`
          : v.status === 'background'
            ? 'in the background'
            : v.status
  const history = v.runs > 1 ? (v.isRecovered ? `passed after ${fmt.plural(v.failures, 'failure')}` : `${v.runs} runs`) : null
  return listItem(kit, {
    key: `check-${v.kind}`,
    glyph: s.glyph,
    tone: s.tone,
    text: v.label,
    isBold: true,
    detail: [v.command, history].filter((x): x is string => x !== null).join(' · '),
    right,
    rightTone: v.status === 'failed' ? 'bad' : v.status === 'running' ? 'info' : 'muted',
  })
}

function validationCard(kit: Kit, view: ActivityView): RenderElement | null {
  if (view.validation.length === 0) return null
  const failing = view.validation.filter(v => v.status === 'failed').length
  return card(kit, {
    key: 'validation',
    title: 'Validation',
    accent: ACCENT.activity,
    aside: failing > 0 ? `${failing} failing` : view.validation.some(v => v.status === 'running') ? 'running' : 'passing',
    rows: k => view.validation.map(v => checkRow(k, v)),
  })
}

// ---------------------------------------------------------------------------
// Changes

function changeNote(f: FileChangeView): { text: string; tone: Tone }[] {
  if (f.isDeleted) return [{ text: 'deleted', tone: 'muted' }]
  if (!f.hasDiff) return [{ text: f.isCreated ? 'new · diff unavailable' : 'diff unavailable', tone: 'muted' }]
  const counts: { text: string; tone: Tone }[] = [{ text: `+${f.added}`, tone: 'good' }]
  if (f.removed > 0 || !f.isCreated) counts.push({ text: `−${f.removed}`, tone: 'bad' })
  if (f.isCreated) counts.push({ text: 'new', tone: 'muted' })
  return counts
}

function fileRow(kit: Kit, f: FileChangeView, view: ActivityView, isDim: boolean): RenderElement {
  const { Box, Button, Code, Text } = kit.ui
  const isSelected = view.selectedPath === f.path
  const parts = changeNote(f)
  return (
    <Box key={`file-${f.path}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} {...clip(kit)}>
          <Button
            key={`pick-${f.path}`}
            label={`${isSelected ? G.down : G.arrow} ${f.display}`}
            plain
            dimColor={!isSelected}
            onPress={() => kit.actions.selectFile(isSelected ? null : f.path)}
          />
        </Box>
        <Box flexShrink={0}>
          <Text>
            {parts.map((p, i) => (
              <Text key={`file-${f.path}-${i}`} color={p.tone === 'good' ? 'diffAdded' : p.tone === 'bad' ? 'diffRemoved' : undefined} dimColor={p.tone === 'muted' || isDim ? true : undefined}>
                {`${i > 0 ? ' ' : ''}${p.text}`}
              </Text>
            ))}
          </Text>
        </Box>
      </Box>
      {isSelected ? (
        <Box key={`diff-${f.path}`} flexDirection="column" marginLeft={2}>
          {view.selectedHunks === '' ? (
            emptyState(kit, f.hasDiff ? 'No line-level diff recorded for this change.' : 'No tool reported the lines of this change.', 'diff-empty')
          ) : (
            <Code source={view.selectedHunks} format="diff" path={f.path} wrap="truncate-end" />
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function groupBlock(kit: Kit, g: ChangeGroupView, view: ActivityView): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box key={`group-${g.id}`} flexDirection="column">
      <Text dimColor bold>{`${g.label.toUpperCase()}  ${g.files.length}`}</Text>
      {g.files.map(f => fileRow(kit, f, view, false))}
    </Box>
  )
}

function changesCard(kit: Kit, view: ActivityView): RenderElement {
  const { Box, Button } = kit.ui
  const real = view.groups.filter(g => g.id !== 'generated')
  const generated = view.groups.find(g => g.id === 'generated')
  let added = 0
  let removed = 0
  for (const g of real) for (const f of g.files) if (f.hasDiff) (added += f.added), (removed += f.removed)
  const count = real.reduce((n, g) => n + g.files.length, 0)
  return card(kit, {
    key: 'files',
    title: 'Changes',
    accent: ACCENT.activity,
    aside: count === 0 ? undefined : `${fmt.plural(count, 'file')}  +${added} −${removed}`,
    footer: 'From the edit tools’ own results. A file a command created shows without a diff when Claude Code reports none.',
    rows: k => [
      count === 0 && generated === undefined ? emptyState(k, 'Claude has not changed any files yet.', 'files-empty') : null,
      count === 0 && generated !== undefined ? emptyState(k, 'No project files changed yet.', 'files-none-real') : null,
      ...real.map(g => groupBlock(k, g, view)),
      generated === undefined ? null : (
        <Box key="group-generated" flexDirection="column">
          <Button
            key="toggle-generated"
            label={`${view.showGenerated ? G.down : G.arrow} ${generated.label} · ${generated.files.length}`}
            plain
            dimColor
            onPress={kit.actions.toggleGenerated}
          />
          {view.showGenerated ? generated.files.map(f => fileRow(k, f, view, true)) : null}
        </Box>
      ),
      count === 0 && generated === undefined ? null : buttons(k, [{ key: 'act-clear', label: 'Clear list', onPress: kit.actions.clearChanges }], 'files-actions'),
    ],
  })
}

// ---------------------------------------------------------------------------
// Every tool call (the secondary view)

function callItem(kit: Kit, item: ActivityItemView): RenderElement {
  const s = CALL_STATUS[item.status] ?? CALL_STATUS.ok!
  return listItem(kit, {
    key: `call-${item.id}`,
    glyph: s.glyph,
    tone: s.tone,
    text: `${item.isSubagent ? '↳ ' : ''}${item.tool}  ${item.label}`,
    detail: item.status === 'ok' || item.status === 'running' ? null : item.reason,
    right: item.endedAt === null ? 'running' : fmt.duration(item.endedAt - item.startedAt),
    isDim: item.status === 'ok' && item.heavy.length === 0,
  })
}

function rawCard(kit: Kit, view: ActivityView): RenderElement {
  const { Text } = kit.ui
  return card(kit, {
    key: 'calls',
    title: 'All tool calls',
    accent: ACCENT.activity,
    aside: view.sessionTools === 0 ? undefined : `${view.sessionTools} in this context`,
    footer: 'Newest first. Subagents’ calls are marked ↳.',
    rows: k =>
      view.items.length === 0
        ? [emptyState(k, 'No tool calls yet.', 'calls-empty')]
        : [
            ...view.items.slice(0, 60).map(item => callItem(k, item)),
            view.items.length > 60 ? (
              <Text key="calls-more" dimColor>
                {`${view.items.length - 60} more`}
              </Text>
            ) : null,
          ],
  })
}

// ---------------------------------------------------------------------------
// The page

export function activityPage(kit: Kit, pane: PaneModel, view: ActivityView | undefined): RenderElement {
  const { Box } = kit.ui
  const sub = pane.activitySub
  const focus = pane.settings.focus
  const u = kit.actions.update
  const accent = ACCENT.activity

  const switcher = (
    <Box key="activity-switch" marginTop={1}>
      {
        segmented(kit, {
          key: 'sub',
          value: sub,
          options: [
            { value: 'summary', label: 'Summary' },
            { value: 'raw', label: view === undefined || view.sessionTools === 0 ? 'All tool calls' : `All tool calls (${view.sessionTools})` },
          ],
          onSelect: v => kit.actions.setActivitySub(v === 'raw' ? 'raw' : 'summary'),
        }).element
      }
    </Box>
  )

  if (view === undefined) {
    return (
      <Box flexDirection="column">
        {switcher}
        {note(kit, 'Loading…', 'activity-loading')}
      </Box>
    )
  }

  if (sub === 'raw') {
    return (
      <Box flexDirection="column">
        {switcher}
        {rawCard(kit, view)}
      </Box>
    )
  }

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

  return (
    <Box flexDirection="column">
      {switcher}
      {runCard(kit, view)}
      {turnCard(kit, view)}
      {attentionCard(kit, view)}
      {validationCard(kit, view)}
      {changesCard(kit, view)}
      {transcript}
    </Box>
  )
}
