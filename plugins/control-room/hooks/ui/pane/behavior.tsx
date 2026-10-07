/**
 * Behavior: how Claude works, and how it writes to you. One card per system,
 * so each reads on its own: the card title names the system and carries its
 * live state, the first row says what it does and holds its switch, and its
 * finer settings follow only while it is on. A row never repeats its card's
 * title.
 */

import type { RenderElement } from 'claude-code'

import type { ModelAlias, PaneModel } from '../../../types'
import { ANSWER_STYLE_INFO } from '../../core/answers'
import { ANSWER_STYLES } from '../../core/settings'
import type { Kit } from '../kit'
import { card, link, picker, row, segmented, stepper, switchControl } from '../primitives'
import { ACCENT } from '../theme'

const MODELS: readonly { value: ModelAlias; label: string; hint: string }[] = [
  { value: 'session', label: 'Session model', hint: "this session's model" },
  { value: 'haiku', label: 'Haiku', hint: 'fastest, lowest cost' },
  { value: 'sonnet', label: 'Sonnet', hint: 'balanced' },
  { value: 'opus', label: 'Opus', hint: 'deep work' },
  { value: 'fable', label: 'Fable', hint: 'the most capable' },
]

const asAlias = (v: string): ModelAlias => MODELS.find(m => m.value === v)?.value ?? 'session'

const CLASS_LABEL: Record<string, string> = {
  trivial: 'Quick replies',
  simple: 'Questions',
  standard: 'Building',
  hard: 'Hard problems',
  explore: 'Explore agents',
  plan: 'Plan agents',
  general: 'Other agents',
}

const STRATEGY_HINT: Record<string, string> = {
  off: 'every task uses the session model',
  balanced: 'lighter for quick work',
  performance: 'stronger for hard work',
  economy: 'lightest that fits',
  custom: 'you choose per task',
}

/** A picker hint ("lighter for quick work") as a row's subtitle ("Lighter for quick work"). */
const sentence = (hint: string): string => hint.charAt(0).toUpperCase() + hint.slice(1)

const STRICTNESS_HINT: Record<string, string> = {
  lenient: 'Only obvious hand-backs',
  standard: 'Clear signs the job is unfinished',
  strict: 'Any unverified or unfinished work',
}

export function behaviorPage(kit: Kit, pane: PaneModel): RenderElement {
  const { Box } = kit.ui
  const s = pane.settings
  const st = pane.status
  const u = kit.actions.update
  const accent = ACCENT.behavior

  const style = s.answers.style
  const info = ANSWER_STYLE_INFO[style]
  const native = pane.nativeOutputStyle

  return (
    <Box flexDirection="column">
      {card(kit, {
        key: 'answers',
        title: 'Answer style',
        accent,
        aside: native === null && style !== 'standard' ? info.label : undefined,
        footer:
          native !== null
            ? `Claude Code’s own output style, ${native}, is in use and takes precedence. Set it back to Default in Claude Code (/config) to use these.`
            : (info.note ?? undefined),
        rows: k => [
          row(k, {
            key: 'an-style',
            label: 'How Claude writes to you',
            subtitle: info.hint,
            control: picker(k, {
              key: 'an-style',
              value: style,
              options: ANSWER_STYLES.map(v => ({ value: v, label: ANSWER_STYLE_INFO[v].label, hint: ANSWER_STYLE_INFO[v].hint })),
              onSelect: v => u(d => void (d.answers.style = ANSWER_STYLES.find(x => x === v) ?? 'standard')),
            }),
          }),
          native === null && info.sample !== null && row(k, { key: 'an-sample', label: 'For example', subtitle: `“${info.sample}”` }),
          native === null &&
            style === 'quest' &&
            row(k, { key: 'an-quest', label: 'Your progress', control: link(k, { key: 'an-quest', label: 'Activity', onPress: () => kit.actions.setTab('activity') }) }),
        ],
      })}

      {card(kit, {
        key: 'frontier',
        title: 'Frontier Max',
        accent,
        aside: s.frontier.enabled ? st.frontier.text : undefined,
        rows: k => [
          row(k, {
            key: 'fr-on',
            label: 'Hold Claude to senior-engineer standards',
            control: switchControl(k, {
              key: 'fr-on',
              isOn: s.frontier.enabled,
              onPress: () =>
                u(d => {
                  d.frontier.enabled = !d.frontier.enabled
                  if (d.frontier.enabled) d.guard.enabled = true
                }),
            }),
          }),
          s.frontier.enabled &&
            row(k, {
              key: 'fr-effort',
              label: 'Effort',
              control: picker(k, {
                key: 'fr-effort',
                value: s.frontier.effort,
                options: [
                  { value: 'max', label: 'Maximum', hint: "the model's highest" },
                  { value: 'xhigh', label: 'Extra high', hint: 'one step below' },
                  { value: 'high', label: 'High', hint: 'quicker, still careful' },
                  { value: 'keep', label: 'Leave as is', hint: 'policy only' },
                ],
                onSelect: v => u(d => void (d.frontier.effort = (['max', 'xhigh', 'high', 'keep'].includes(v) ? v : 'max') as typeof d.frontier.effort)),
              }),
            }),
          s.frontier.enabled &&
            row(k, {
              key: 'fr-sub',
              label: 'Subagents too',
              subtitle: 'Raises their effort as well; costs more',
              control: switchControl(k, { key: 'fr-sub', isOn: s.frontier.subagentEffort, onPress: () => u(d => void (d.frontier.subagentEffort = !d.frontier.subagentEffort)) }),
            }),
        ],
      })}

      {card(kit, {
        key: 'guard',
        title: 'Lazy-exit guard',
        accent,
        aside: s.guard.enabled ? st.guard.text : undefined,
        rows: k => [
          row(k, {
            key: 'gu-on',
            label: 'Keep Claude going when it stops early',
            control: switchControl(k, { key: 'gu-on', isOn: s.guard.enabled, onPress: () => u(d => void (d.guard.enabled = !d.guard.enabled)) }),
          }),
          s.guard.enabled &&
            row(k, {
              key: 'gu-strict',
              label: 'Strictness',
              subtitle: STRICTNESS_HINT[s.guard.strictness],
              control: segmented(k, {
                key: 'gu-strict',
                value: s.guard.strictness,
                options: [
                  { value: 'lenient', label: 'Lenient' },
                  { value: 'standard', label: 'Standard' },
                  { value: 'strict', label: 'Strict' },
                ],
                onSelect: v => u(d => void (d.guard.strictness = (['lenient', 'standard', 'strict'].includes(v) ? v : 'standard') as typeof d.guard.strictness)),
              }),
            }),
          s.guard.enabled &&
            row(k, {
              key: 'gu-turn',
              label: 'Times per turn',
              subtitle: 'At most this many nudges in one turn',
              control: stepper(k, {
                key: 'gu-turn',
                display: String(s.guard.maxPerTurn),
                onDecrease: s.guard.maxPerTurn > 1 ? () => u(d => void (d.guard.maxPerTurn -= 1)) : undefined,
                onIncrease: s.guard.maxPerTurn < 5 ? () => u(d => void (d.guard.maxPerTurn += 1)) : undefined,
              }),
            }),
          s.guard.enabled &&
            row(k, {
              key: 'gu-model',
              label: 'Smart check',
              subtitle: 'A small model call when the signs are unclear',
              control: switchControl(k, { key: 'gu-model', isOn: s.guard.modelCheck, onPress: () => u(d => void (d.guard.modelCheck = !d.guard.modelCheck)) }),
            }),
        ],
      })}

      {card(kit, {
        key: 'qa',
        title: 'Release check',
        accent,
        rows: k => [
          row(k, {
            key: 'qa-on',
            label: 'Test before calling work done',
            subtitle: 'And say plainly what could not be checked',
            control: switchControl(k, { key: 'qa-on', isOn: s.qa.enabled, onPress: () => u(d => void (d.qa.enabled = !d.qa.enabled)) }),
          }),
        ],
      })}

      {card(kit, {
        key: 'router',
        title: 'Model router',
        accent,
        aside: s.router.strategy !== 'off' && pane.router.lastDecision !== null ? `Last: ${pane.router.lastDecision}` : undefined,
        footer: s.router.strategy === 'off' ? undefined : 'Never downgrades while Frontier Max is on. Switches only while the context is small.',
        rows: k => [
          row(k, {
            key: 'ro-strategy',
            label: 'Pick a model for each task',
            subtitle: sentence(STRATEGY_HINT[s.router.strategy] ?? ''),
            control: picker(k, {
              key: 'ro-strategy',
              value: s.router.strategy,
              options: [
                { value: 'off', label: 'Off', hint: STRATEGY_HINT.off },
                { value: 'balanced', label: 'Balanced', hint: STRATEGY_HINT.balanced },
                { value: 'performance', label: 'Performance', hint: STRATEGY_HINT.performance },
                { value: 'economy', label: 'Economy', hint: STRATEGY_HINT.economy },
                { value: 'custom', label: 'Custom', hint: STRATEGY_HINT.custom },
              ],
              onSelect: v => u(d => void (d.router.strategy = (['off', 'balanced', 'performance', 'economy', 'custom'].includes(v) ? v : 'off') as typeof d.router.strategy)),
            }),
          }),
          s.router.strategy !== 'off' &&
            row(k, {
              key: 'ro-main',
              label: 'Main conversation',
              control: switchControl(k, { key: 'ro-main', isOn: s.router.mainLoop, onPress: () => u(d => void (d.router.mainLoop = !d.router.mainLoop)) }),
            }),
          s.router.strategy !== 'off' &&
            row(k, {
              key: 'ro-sub',
              label: 'Subagents',
              control: switchControl(k, { key: 'ro-sub', isOn: s.router.subagents, onPress: () => u(d => void (d.router.subagents = !d.router.subagents)) }),
            }),
          ...(s.router.strategy === 'custom'
            ? (['trivial', 'simple', 'standard', 'hard', 'explore', 'plan', 'general'] as const).map(c =>
                row(k, {
                  key: `ro-c-${c}`,
                  label: CLASS_LABEL[c] ?? c,
                  control: picker(k, { key: `ro-c-${c}`, value: s.router.custom[c], options: MODELS, onSelect: v => u(d => void (d.router.custom[c] = asAlias(v))) }),
                }),
              )
            : []),
        ],
      })}

      {card(kit, {
        key: 'progress',
        title: 'Run progress',
        accent,
        footer:
          pane.planSource === 'tasks'
            ? 'Counted from Claude Code’s own task list.'
            : 'Claude Code offers no task list here, so Control Room gives Claude a small milestones tool. Progress is done of total, never estimated.',
        rows: k => [
          pane.planSource === 'tasks'
            ? row(k, { key: 'pr-source', label: 'Milestones', subtitle: 'From Claude’s task list', value: 'Automatic', valueTone: 'muted' })
            : row(k, {
                key: 'pr-milestones',
                label: 'Keep milestones for the run',
                subtitle: s.progress.milestones ? 'Claude records its steps; Activity and the status bar count them' : 'No run progress is shown',
                control: switchControl(k, { key: 'pr-milestones', isOn: s.progress.milestones, onPress: () => u(d => void (d.progress.milestones = !d.progress.milestones)) }),
              }),
        ],
      })}
    </Box>
  )
}
