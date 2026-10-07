/**
 * Behavior: how Claude works. One card per system, so each reads on its
 * own: the card title carries the system's live state, the first row is
 * its switch with a one-line description, and its finer settings follow
 * only while it is on.
 */

import type { RenderElement } from 'claude-code'

import type { ModelAlias, PaneModel } from '../../../types'
import type { Kit } from '../kit'
import { card, picker, row, segmented, stepper, switchControl } from '../primitives'
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

  return (
    <Box flexDirection="column">
      {card(kit, {
        key: 'frontier',
        title: 'Frontier Max',
        accent,
        aside: s.frontier.enabled ? st.frontier.text : undefined,
        rows: k => [
          row(k, {
            key: 'fr-on',
            label: 'Frontier Max',
            subtitle: 'Senior-engineer standards and the strongest reasoning the model offers',
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
                  { value: 'xhigh', label: 'Extra high' },
                  { value: 'high', label: 'High' },
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
            label: 'Lazy-exit guard',
            subtitle: 'Keeps Claude going when it stops before the job is done',
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
            label: 'Verify before done',
            subtitle: 'Claude tests before it calls work done, and says what it could not check',
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
            label: 'Router',
            subtitle: s.router.strategy === 'off' ? 'Every task uses the session model' : 'Picks a model for each task',
            control: picker(k, {
              key: 'ro-strategy',
              value: s.router.strategy,
              options: [
                { value: 'off', label: 'Off' },
                { value: 'balanced', label: 'Balanced', hint: 'lighter for quick work' },
                { value: 'performance', label: 'Performance', hint: 'stronger for hard work' },
                { value: 'economy', label: 'Economy', hint: 'lightest that fits' },
                { value: 'custom', label: 'Custom', hint: 'you choose per task' },
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
    </Box>
  )
}
