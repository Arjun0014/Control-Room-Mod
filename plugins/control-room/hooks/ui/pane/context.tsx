/**
 * Context: when Claude hands off to a fresh context, and what happened
 * across the run. The live state and meter first, the Autopilot's few
 * settings (details appear only when it is on), then the run's sessions.
 */

import type { RenderElement } from 'claude-code'

import type { ChainRunView, ChainSessionView, ChainView, HudModel, PaneModel } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { buttons, emptyState, labelWidth, listItem, meterBar, pair, row, section, segmented, stepper, switchControl } from '../primitives'
import { G, toneProps } from '../theme'

const END: Record<string, string> = {
  handoff: 'handed off',
  clear: 'cleared',
  exit: 'ended',
  resume: 'resumed elsewhere',
  logout: 'signed out',
  other: 'ended',
}

const stepFor = (tokens: number): number => (tokens >= 1_000_000 ? 100_000 : tokens >= 200_000 ? 50_000 : 10_000)

function sessionItem(kit: Kit, s: ChainSessionView, isActive: boolean): RenderElement {
  const time = `${fmt.clock(s.startedAt)}–${s.endedAt === null ? 'now' : fmt.clock(s.endedAt)}`
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
    text: `Run ${r.number}   ${fmt.when(r.startedAt, now)}   ${fmt.plural(r.sessions.length, 'session')}   ${r.root}`,
    right: `${fmt.cost(r.costUsd)}${r.isCostPartial ? '+' : ''}`,
    isDim: true,
  })
}

export function contextPage(kit: Kit, pane: PaneModel, hud: HudModel, chain: ChainView | undefined): RenderElement {
  const { Box, Text } = kit.ui
  const a = pane.autopilot
  const s = pane.settings.autopilot
  const u = kit.actions.update
  const lw = labelWidth(kit, 'Continue on its own'.length)
  const fraction = a.tokens !== null && a.window !== null && a.window > 0 ? a.tokens / a.window : 0
  const marker = a.threshold !== null && a.window !== null && a.window > 0 ? a.threshold / a.window : null
  const tone = hud.ctx.tone === 'muted' ? 'good' : hud.ctx.tone

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

  const current = chain?.current ?? null
  const now = kit.now

  return (
    <Box flexDirection="column">
      <Box key="state" flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text {...toneProps(s.enabled ? (hud.autopilot.tone === 'normal' ? 'good' : hud.autopilot.tone) : 'muted')}>{`${s.enabled ? G.dot : G.ring} `}</Text>
            <Text bold>{s.enabled ? a.note : 'Autopilot is off'}</Text>
          </Text>
          <Text bold {...toneProps(hud.ctx.tone === 'warn' || hud.ctx.tone === 'bad' ? hud.ctx.tone : 'normal')}>
            {hud.ctx.pct === null ? G.none : `${hud.ctx.pct}%`}
          </Text>
        </Box>
        {meterBar(kit, { key: 'ap-meter', fraction, marker: s.enabled ? marker : null, tone, width: kit.columns, alt: `Context ${hud.ctx.pct ?? 0}% used` })}
        {pair(kit, {
          key: 'ap-under',
          left: a.tokens === null ? 'Waiting for the first response' : `${fmt.tokens(a.tokens)}${a.window === null ? '' : ` of ${fmt.tokens(a.window)}`} tokens`,
          right: s.enabled && a.threshold !== null ? `hands off at ${fmt.tokens(a.threshold)}` : undefined,
        })}
        {a.isClamped && a.autoCompactAt !== null ? (
          <Text dimColor wrap="wrap">{`Kept below Claude Code's own compaction point (${fmt.tokens(a.autoCompactAt)}).`}</Text>
        ) : null}
        {a.lastError === null ? null : <Text color="warning" wrap="wrap">{a.lastError}</Text>}
      </Box>

      {section(kit, {
        key: 'autopilot',
        title: 'Autopilot',
        footer: s.enabled
          ? 'At the threshold Claude finishes the step it is on, writes handoff notes, then continues in a fresh context with your settings.'
          : 'Hands long work to a fresh context before this one fills up, so nothing is lost and nothing is compacted.',
        children: [
          row(kit, { key: 'ap-enabled', label: 'Autopilot', labelWidth: lw, control: switchControl(kit, { key: 'ap-enabled', isOn: s.enabled, onPress: () => u(d => void (d.autopilot.enabled = !d.autopilot.enabled)) }) }),
          s.enabled && row(kit, { key: 'ap-threshold', label: 'Hand off at', labelWidth: lw, control: threshold }),
          s.enabled &&
            row(kit, {
              key: 'ap-mode',
              label: 'Measure by',
              labelWidth: lw,
              control: segmented(kit, {
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
            row(kit, {
              key: 'ap-cont',
              label: 'Then',
              labelWidth: lw,
              control: segmented(kit, {
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
          s.enabled && row(kit, { key: 'ap-auto', label: 'Continue on its own', labelWidth: lw, control: switchControl(kit, { key: 'ap-auto', isOn: s.autoContinue, onPress: () => u(d => void (d.autopilot.autoContinue = !d.autopilot.autoContinue)) }) }),
          s.enabled &&
            s.continuation === 'clear' &&
            row(kit, {
              key: 'ap-fallback',
              label: 'If clearing fails',
              labelWidth: lw,
              control: switchControl(kit, { key: 'ap-fallback', isOn: s.fallbackToCompact, onPress: () => u(d => void (d.autopilot.fallbackToCompact = !d.autopilot.fallbackToCompact)) }),
              detail: s.fallbackToCompact ? 'compact instead' : 'wait for me',
            }),
          s.enabled && row(kit, { key: 'ap-file', label: 'Notes file', labelWidth: lw, value: s.handoffFile, valueTone: 'muted' }),
          buttons(
            kit,
            [
              { key: 'ap-handoff', label: 'Hand off now', onPress: kit.actions.handoff, isHidden: !a.canHandoff && s.enabled, isPrimary: a.state === 'pending' },
              { key: 'ap-fresh', label: 'Start fresh context', onPress: kit.actions.fresh, isPrimary: true, isHidden: a.state !== 'awaiting' },
              { key: 'ap-snooze', label: 'Later', onPress: kit.actions.snooze, isHidden: !a.canSnooze },
            ],
            'ap-actions',
          ),
        ],
      })}

      {section(kit, {
        key: 'run',
        title: current === null ? 'This run' : `Run ${current.number}`,
        aside: current === null ? undefined : `${current.handoffs > 0 ? `${fmt.plural(current.handoffs, 'handoff')} · ` : ''}${fmt.cost(current.costUsd)}${current.isCostPartial ? '+' : ''}`,
        footer: 'Costs are as Claude Code reports them. Nothing is estimated.',
        children:
          current === null
            ? [emptyState(kit, 'The run starts with the first response.', 'run-empty')]
            : current.sessions.map((x, i) => sessionItem(kit, x, i === current.sessions.length - 1 && current.status === 'active' && x.endedAt === null)),
      })}

      {chain === undefined || chain.history.length === 0
        ? null
        : section(kit, {
            key: 'history',
            title: 'Earlier runs',
            children: chain.history.slice(0, 5).map(r => runItem(kit, r, now)),
          })}
    </Box>
  )
}
