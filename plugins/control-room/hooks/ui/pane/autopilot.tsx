/**
 * Context Autopilot: state first (what it is doing and why), then the
 * threshold and continuation settings, then the manual actions.
 */

import type { RenderElement } from 'claude-code'

import type { PaneModel, Tone } from '../../../types'
import * as fmt from '../../core/format'
import { actionRow, choice, field, hint, textField, title, toggle } from '../components'
import type { Kit } from '../kit'
import { meter, toneProps } from '../theme'

const STATE_TONE: Record<string, Tone> = {
  off: 'muted',
  armed: 'good',
  pending: 'warn',
  requested: 'accent',
  handoff: 'accent',
  verifying: 'accent',
  clearing: 'accent',
  compacting: 'accent',
  resuming: 'accent',
  awaiting: 'bad',
}

const PERCENTS = [50, 60, 65, 70, 75, 80, 85, 90]
const TOKENS = [150_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 850_000]

export function autopilotTab(kit: Kit, pane: PaneModel): RenderElement {
  const { Box, Text } = kit.ui
  const s = pane.settings.autopilot
  const a = pane.autopilot
  const tone = STATE_TONE[a.state] ?? 'normal'
  const labelWidth = Math.min(22, Math.max(12, Math.floor(kit.columns * 0.34)))
  const reading = ` ${fmt.tokens(a.tokens)}${a.window === null ? '' : ` / ${fmt.tokens(a.window)}`}`
  const width = Math.max(8, Math.min(40, kit.columns - labelWidth - reading.length - 1))
  const fraction = a.tokens !== null && a.window !== null && a.window > 0 ? a.tokens / a.window : 0
  const marker = a.threshold !== null && a.window !== null && a.window > 0 ? a.threshold / a.window : undefined

  const percentOptions = [...new Set([...PERCENTS, s.thresholdPercent])].sort((x, y) => x - y).map(p => ({ value: String(p), label: `${p}% of the window` }))
  const tokenOptions = [...new Set([...TOKENS, s.thresholdTokens])].sort((x, y) => x - y).map(t => ({ value: String(t), label: `${fmt.tokens(t)} tokens` }))

  return (
    <Box flexDirection="column">
      {title(kit, 'Status')}
      {field(kit, 'State', a.state.toUpperCase(), tone, a.note)}
      <Box flexDirection="row">
        <Box width={labelWidth} flexShrink={0}>
          <Text dimColor>Context</Text>
        </Box>
        <Text {...toneProps(a.threshold !== null && a.tokens !== null && a.tokens >= a.threshold ? 'bad' : 'normal')} wrap="truncate-end">
          {`${meter(fraction, width, marker)}${reading}`}
        </Text>
      </Box>
      {field(
        kit,
        'Handoff threshold',
        a.threshold === null ? (s.enabled ? 'resolves once the window is known' : 'off') : `${fmt.tokens(a.threshold)} tokens`,
        'normal',
        a.isClamped && a.autoCompactAt !== null ? `kept under Claude Code's auto-compact point (${fmt.tokens(a.autoCompactAt)})` : undefined,
      )}
      {field(kit, 'Handoff notes', a.handoffPath, 'normal')}
      {field(kit, 'Handoffs this run', String(a.completed), 'normal')}
      {a.lastError === null ? null : field(kit, 'Last problem', a.lastError, 'bad')}

      {title(kit, 'Settings')}
      {toggle(kit, { key: 'ap-enabled', label: 'Context Autopilot', isOn: s.enabled, onPress: () => kit.actions.update(d => { d.autopilot.enabled = !d.autopilot.enabled }) })}
      {choice(kit, {
        key: 'ap-mode',
        label: 'Threshold by',
        value: s.thresholdMode,
        options: [
          { value: 'percent', label: '% of context window' },
          { value: 'tokens', label: 'exact tokens' },
        ],
        onSelect: v => kit.actions.update(d => { d.autopilot.thresholdMode = v === 'tokens' ? 'tokens' : 'percent' }),
      })}
      {s.thresholdMode === 'percent'
        ? choice(kit, { key: 'ap-pct', label: 'Threshold', value: String(s.thresholdPercent), options: percentOptions, onSelect: v => kit.actions.update(d => { d.autopilot.thresholdPercent = Number(v) }) })
        : choice(kit, { key: 'ap-tokens', label: 'Threshold', value: String(s.thresholdTokens), options: tokenOptions, onSelect: v => kit.actions.update(d => { d.autopilot.thresholdTokens = Number(v) }) })}
      {textField(kit, {
        key: 'ap-custom',
        label: 'Custom threshold',
        value: '',
        placeholder: s.thresholdMode === 'percent' ? 'e.g. 72' : 'e.g. 720000 or 720k',
        submitLabel: 'set',
        onSubmit: raw => {
          const m = /^\s*(\d+(?:\.\d+)?)\s*(k|m|%)?\s*$/i.exec(raw)
          if (m === null) return
          const n = Number(m[1])
          const unit = (m[2] ?? '').toLowerCase()
          kit.actions.update(d => {
            if (unit === '%' || (d.autopilot.thresholdMode === 'percent' && unit === '')) {
              d.autopilot.thresholdMode = 'percent'
              d.autopilot.thresholdPercent = n
            } else {
              d.autopilot.thresholdMode = 'tokens'
              d.autopilot.thresholdTokens = unit === 'k' ? n * 1000 : unit === 'm' ? n * 1_000_000 : n
            }
          })
        },
      })}
      {choice(kit, {
        key: 'ap-cont',
        label: 'Continue with',
        value: s.continuation,
        options: [
          { value: 'clear', label: 'Fresh context (/clear) — preferred' },
          { value: 'compact', label: 'Compaction (/compact)' },
          { value: 'manual', label: 'Ask me (START FRESH CONTEXT)' },
        ],
        onSelect: v => kit.actions.update(d => { d.autopilot.continuation = v === 'compact' ? 'compact' : v === 'manual' ? 'manual' : 'clear' }),
      })}
      {toggle(kit, { key: 'ap-fallback', label: 'Compact if /clear fails', isOn: s.fallbackToCompact, onPress: () => kit.actions.update(d => { d.autopilot.fallbackToCompact = !d.autopilot.fallbackToCompact }) })}
      {toggle(kit, { key: 'ap-continue', label: 'Auto-continue', isOn: s.autoContinue, onPress: () => kit.actions.update(d => { d.autopilot.autoContinue = !d.autopilot.autoContinue }), detail: 'resume the work in the fresh context' })}
      {textField(kit, {
        key: 'ap-file',
        label: 'Handoff file',
        value: s.handoffFile,
        placeholder: 'NEXT_SESSION_PROMPT.md',
        onSubmit: v => kit.actions.update(d => { d.autopilot.handoffFile = v }),
      })}

      {actionRow(kit, [
        { key: 'ap-handoff', label: 'Handoff now', onPress: kit.actions.handoff, isHidden: !a.canHandoff },
        { key: 'ap-fresh', label: 'Start fresh context', isPrimary: true, onPress: kit.actions.fresh, isHidden: a.state !== 'awaiting' },
        { key: 'ap-snooze', label: 'Snooze', onPress: kit.actions.snooze, isHidden: !a.canSnooze },
      ])}

      {title(kit, 'How it works')}
      {hint(
        kit,
        'At the threshold Claude is asked to finish the current unit of work (no new large tasks). Then a handoff turn verifies the state, updates project docs and writes the handoff notes. Control Room then clears the context and continues automatically in a fresh one, with your active profile and policies. Compaction is used only if /clear is refused.',
      )}
    </Box>
  )
}
