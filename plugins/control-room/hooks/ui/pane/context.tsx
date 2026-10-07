/**
 * Context: when Claude hands off to a fresh context, and what happened
 * across the run.
 *
 * 1. Where things stand: the state in words, the meter with its threshold,
 *    the numbers under it.
 * 2. What happens at the threshold, in three numbered steps, with the
 *    actions (hand off now, start fresh, later) right there.
 * 3. The Autopilot's settings, each row explaining itself.
 * 4. The run: this run's sessions, then earlier runs by project.
 */

import type { RenderElement } from 'claude-code'

import type { ChainRunView, ChainSessionView, ChainView, HudModel, PaneModel } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { buttons, card, emptyState, listItem, meterBar, pair, row, segmented, steps, stepper, switchControl } from '../primitives'
import { ACCENT, G, toneProps } from '../theme'

const END: Record<string, string> = {
  handoff: 'handed off',
  clear: 'cleared',
  exit: 'ended',
  resume: 'resumed elsewhere',
  logout: 'signed out',
  other: 'ended',
}

const THEN_HINT: Record<string, string> = {
  clear: 'Clears the context and carries on with the notes. Nothing is compacted.',
  compact: 'Compacts the context instead of clearing it.',
  manual: 'Writes the notes, then waits for you to start the fresh context.',
}

const stepFor = (tokens: number): number => (tokens >= 1_000_000 ? 100_000 : tokens >= 200_000 ? 50_000 : 10_000)

const projectOf = (root: string): string => root.split(/[\\/]/).filter(Boolean).pop() ?? root

function sessionItem(kit: Kit, s: ChainSessionView, isActive: boolean): RenderElement {
  const time = `${fmt.clock(s.startedAt)} → ${s.endedAt === null ? 'now' : fmt.clock(s.endedAt)}`
  const peak = s.peakTokens > 0 ? `   ${fmt.tokens(s.peakTokens)} peak` : ''
  return listItem(kit, {
    key: `session-${s.id}`,
    glyph: isActive ? G.dot : s.end === 'handoff' ? G.chevron : G.ok,
    tone: isActive ? 'accent' : 'muted',
    text: `Session ${s.index}   ${time}${peak}${isActive ? '' : `   ${END[s.end ?? 'other'] ?? 'ended'}`}`,
    right: fmt.cost(s.costUsd),
    isDim: !isActive,
  })
}

function runItem(kit: Kit, r: ChainRunView, now: number): RenderElement {
  return listItem(kit, {
    key: `run-${r.id}`,
    glyph: G.ring,
    tone: 'muted',
    text: `${projectOf(r.root)}   ${fmt.when(r.startedAt, now)}${r.sessions.length > 1 ? `   ${r.sessions.length} sessions` : ''}`,
    right: `${fmt.cost(r.costUsd)}${r.isCostPartial ? '+' : ''}`,
    isDim: true,
  })
}

export function contextPage(kit: Kit, pane: PaneModel, hud: HudModel, chain: ChainView | undefined): RenderElement {
  const { Box, Text } = kit.ui
  const a = pane.autopilot
  const s = pane.settings.autopilot
  const u = kit.actions.update
  const accent = ACCENT.context
  const fraction = a.tokens !== null && a.window !== null && a.window > 0 ? a.tokens / a.window : 0
  const marker = a.threshold !== null && a.window !== null && a.window > 0 ? a.threshold / a.window : null
  const meterTone = hud.ctx.tone === 'muted' ? 'good' : hud.ctx.tone
  const at = s.thresholdMode === 'percent' ? `${s.thresholdPercent}%` : fmt.tokens(s.thresholdTokens)
  const stateTone = s.enabled ? (hud.autopilot.tone === 'normal' ? 'good' : hud.autopilot.tone) : 'muted'

  const threshold =
    s.thresholdMode === 'percent'
      ? stepper(kit, {
          key: 'ap-threshold',
          display: `${s.thresholdPercent}%`,
          onDecrease: s.thresholdPercent - 5 >= 10 ? () => u(d => void (d.autopilot.thresholdPercent = Math.max(10, d.autopilot.thresholdPercent - 5))) : undefined,
          onIncrease: s.thresholdPercent + 5 <= 95 ? () => u(d => void (d.autopilot.thresholdPercent = Math.min(95, d.autopilot.thresholdPercent + 5))) : undefined,
        })
      : stepper(kit, {
          key: 'ap-threshold',
          display: fmt.tokens(s.thresholdTokens),
          onDecrease: s.thresholdTokens > 10_000 ? () => u(d => void (d.autopilot.thresholdTokens = Math.max(10_000, d.autopilot.thresholdTokens - stepFor(d.autopilot.thresholdTokens - 1)))) : undefined,
          onIncrease: s.thresholdTokens < 10_000_000 ? () => u(d => void (d.autopilot.thresholdTokens = Math.min(10_000_000, d.autopilot.thresholdTokens + stepFor(d.autopilot.thresholdTokens)))) : undefined,
        })

  const thirdStep =
    s.continuation === 'compact'
      ? 'The context is compacted, and Claude carries on with your settings.'
      : s.continuation === 'manual'
        ? 'You start the fresh context when you are ready. Claude carries on from the notes.'
        : `The context is cleared${s.autoContinue ? ', and Claude carries on by itself' : ''}, with your settings.`

  const current = chain?.current ?? null

  return (
    <Box flexDirection="column">
      <Box key="state" flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text {...toneProps(stateTone)}>{`${s.enabled ? G.dot : G.ring} `}</Text>
              <Text bold>{s.enabled ? a.note : 'Autopilot is off'}</Text>
            </Text>
          </Box>
          <Text bold {...toneProps(hud.ctx.tone === 'warn' || hud.ctx.tone === 'bad' ? hud.ctx.tone : 'normal')}>
            {hud.ctx.pct === null ? G.none : `${hud.ctx.pct}%`}
          </Text>
        </Box>
        {meterBar(kit, { key: 'ap-meter', fraction, marker: s.enabled ? marker : null, tone: meterTone, width: kit.columns, alt: `Context ${hud.ctx.pct ?? 0}% used` })}
        {pair(kit, {
          key: 'ap-under',
          left: a.tokens === null ? 'Waiting for the first response' : `${fmt.tokens(a.tokens)}${a.window === null ? '' : ` of ${fmt.tokens(a.window)}`} tokens used`,
          right: s.enabled && a.threshold !== null ? `hands off at ${fmt.tokens(a.threshold)}` : undefined,
        })}
        {a.isClamped && a.autoCompactAt !== null ? <Text dimColor wrap="wrap">{`Kept below Claude Code's own compaction point (${fmt.tokens(a.autoCompactAt)}).`}</Text> : null}
        {a.lastError === null ? null : (
          <Text color="warning" wrap="wrap">
            {a.lastError}
          </Text>
        )}
      </Box>

      {card(kit, {
        key: 'ap-how',
        title: s.enabled ? `When context reaches ${at}` : 'How it works',
        accent,
        rows: k => [
          steps(k, 'ap-steps', ['Claude finishes the step it is on. No new large tasks.', `It writes handoff notes to ${s.handoffFile}.`, thirdStep], accent),
          buttons(
            k,
            [
              { key: 'ap-handoff', label: 'Hand off now', onPress: kit.actions.handoff, isHidden: s.enabled && !a.canHandoff, isPrimary: a.state === 'pending' },
              { key: 'ap-fresh', label: 'Start fresh context', onPress: kit.actions.fresh, isPrimary: true, isHidden: a.state !== 'awaiting' },
              { key: 'ap-snooze', label: 'Later', onPress: kit.actions.snooze, isHidden: !a.canSnooze },
            ],
            'ap-actions',
          ),
        ],
      })}

      {card(kit, {
        key: 'ap-settings',
        title: 'Autopilot',
        accent,
        rows: k => [
          row(k, {
            key: 'ap-enabled',
            label: 'Autopilot',
            subtitle: 'Hand off before the context fills up',
            control: switchControl(k, { key: 'ap-enabled', isOn: s.enabled, onPress: () => u(d => void (d.autopilot.enabled = !d.autopilot.enabled)) }),
          }),
          s.enabled && row(k, { key: 'ap-threshold', label: 'Hand off at', subtitle: s.thresholdMode === 'percent' ? 'Of the context window' : 'Tokens in the context', control: threshold }),
          s.enabled &&
            row(k, {
              key: 'ap-mode',
              label: 'Measure in',
              control: segmented(k, {
                key: 'ap-mode',
                value: s.thresholdMode,
                options: [
                  { value: 'percent', label: 'Percent' },
                  { value: 'tokens', label: 'Tokens' },
                ],
                onSelect: v => u(d => void (d.autopilot.thresholdMode = v === 'tokens' ? 'tokens' : 'percent')),
              }),
            }),
          s.enabled &&
            row(k, {
              key: 'ap-cont',
              label: 'After the notes',
              subtitle: THEN_HINT[s.continuation],
              control: segmented(k, {
                key: 'ap-cont',
                value: s.continuation,
                options: [
                  { value: 'clear', label: 'Start fresh' },
                  { value: 'compact', label: 'Compact' },
                  { value: 'manual', label: 'Wait for me' },
                ],
                onSelect: v => u(d => void (d.autopilot.continuation = v === 'compact' ? 'compact' : v === 'manual' ? 'manual' : 'clear')),
              }),
            }),
          s.enabled &&
            s.continuation === 'clear' &&
            row(k, {
              key: 'ap-auto',
              label: 'Carry on by itself',
              subtitle: 'Claude resumes the work in the fresh context',
              control: switchControl(k, { key: 'ap-auto', isOn: s.autoContinue, onPress: () => u(d => void (d.autopilot.autoContinue = !d.autopilot.autoContinue)) }),
            }),
          s.enabled &&
            s.continuation === 'clear' &&
            row(k, {
              key: 'ap-fallback',
              label: 'If clearing fails',
              subtitle: s.fallbackToCompact ? 'Compact instead' : 'Wait for you',
              control: switchControl(k, { key: 'ap-fallback', isOn: s.fallbackToCompact, onPress: () => u(d => void (d.autopilot.fallbackToCompact = !d.autopilot.fallbackToCompact)) }),
            }),
          s.enabled && row(k, { key: 'ap-file', label: 'Notes file', value: s.handoffFile, valueTone: 'muted' }),
        ],
      })}

      {card(kit, {
        key: 'run',
        title: current === null ? 'This run' : `Run ${current.number}`,
        accent,
        aside: current === null ? undefined : `${current.handoffs > 0 ? `${fmt.plural(current.handoffs, 'handoff')} · ` : ''}${fmt.cost(current.costUsd)}${current.isCostPartial ? '+' : ''}`,
        footer: 'Costs are as Claude Code reports them. Nothing is estimated.',
        rows: k =>
          current === null
            ? [emptyState(k, 'The run starts with the first response.', 'run-empty')]
            : current.sessions.map((x, i) => sessionItem(k, x, i === current.sessions.length - 1 && current.status === 'active' && x.endedAt === null)),
      })}

      {chain === undefined || chain.history.length === 0
        ? null
        : card(kit, {
            key: 'history',
            title: 'Earlier runs',
            accent,
            rows: k => chain.history.slice(0, 5).map(r => runItem(k, r, kit.now)),
          })}
    </Box>
  )
}
