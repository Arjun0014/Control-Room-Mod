/**
 * Behavior: how Claude works. Each system is one switch; its finer settings
 * appear only while it is on, so the page stays short.
 */

import type { RenderElement } from 'claude-code'

import type { ModelAlias, PaneModel } from '../../../types'
import type { Kit } from '../kit'
import { labelWidth, note, picker, row, section, segmented, stepper, switchControl } from '../primitives'
import { detailOf } from './overview'

const MODELS: readonly { value: ModelAlias; label: string; hint: string }[] = [
  { value: 'session', label: 'Session model', hint: "this session's model" },
  { value: 'haiku', label: 'Haiku', hint: 'fastest, lowest cost' },
  { value: 'sonnet', label: 'Sonnet', hint: 'balanced' },
  { value: 'opus', label: 'Opus', hint: 'deep work' },
  { value: 'fable', label: 'Fable', hint: 'the most capable' },
]

const asAlias = (v: string): ModelAlias => (MODELS.find(m => m.value === v)?.value ?? 'session')

const CLASS_LABEL: Record<string, string> = {
  trivial: 'Quick replies',
  simple: 'Questions',
  standard: 'Building',
  hard: 'Hard problems',
  explore: 'Explore agents',
  plan: 'Plan agents',
  general: 'Other agents',
}

export function behaviorPage(kit: Kit, pane: PaneModel): RenderElement {
  const { Box } = kit.ui
  const s = pane.settings
  const st = pane.status
  const u = kit.actions.update
  const lw = labelWidth(kit, 'Continuations per turn'.length)

  return (
    <Box flexDirection="column">
      {section(kit, {
        key: 'frontier',
        title: 'Frontier Max',
        footer: 'Senior-engineer standards (verify, finish, report honestly) and the strongest reasoning effort the model supports.',
        children: [
          row(kit, {
            key: 'fr-on',
            label: 'Frontier Max',
            labelWidth: lw,
            control: switchControl(kit, {
              key: 'fr-on',
              isOn: s.frontier.enabled,
              onPress: () =>
                u(d => {
                  d.frontier.enabled = !d.frontier.enabled
                  if (d.frontier.enabled) d.guard.enabled = true
                }),
            }),
            ...(s.frontier.enabled ? detailOf(st.frontier) : {}),
          }),
          s.frontier.enabled &&
            row(kit, {
              key: 'fr-effort',
              label: 'Effort',
              labelWidth: lw,
              control: picker(kit, {
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
            row(kit, {
              key: 'fr-sub',
              label: 'Subagents too',
              labelWidth: lw,
              control: switchControl(kit, { key: 'fr-sub', isOn: s.frontier.subagentEffort, onPress: () => u(d => void (d.frontier.subagentEffort = !d.frontier.subagentEffort)) }),
              detail: s.frontier.subagentEffort ? 'costs more' : undefined,
            }),
        ],
      })}

      {section(kit, {
        key: 'qa',
        title: 'Release check',
        footer: 'Claude verifies before it calls work done, and says plainly what it could not check.',
        children: [row(kit, { key: 'qa-on', label: 'Verify first', labelWidth: lw, control: switchControl(kit, { key: 'qa-on', isOn: s.qa.enabled, onPress: () => u(d => void (d.qa.enabled = !d.qa.enabled)) }) })],
      })}

      {section(kit, {
        key: 'guard',
        title: 'Lazy-exit guard',
        footer: 'Continues the turn when Claude stops before the job is done. It stays out of the way of a handoff, plan mode and your decisions.',
        children: [
          row(kit, {
            key: 'gu-on',
            label: 'Guard',
            labelWidth: lw,
            control: switchControl(kit, { key: 'gu-on', isOn: s.guard.enabled, onPress: () => u(d => void (d.guard.enabled = !d.guard.enabled)) }),
            ...(s.guard.enabled ? detailOf(st.guard) : {}),
          }),
          s.guard.enabled &&
            row(kit, {
              key: 'gu-strict',
              label: 'Strictness',
              labelWidth: lw,
              control: segmented(kit, {
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
            row(kit, {
              key: 'gu-turn',
              label: 'Continuations per turn',
              labelWidth: lw,
              control: stepper(kit, {
                key: 'gu-turn',
                display: String(s.guard.maxPerTurn),
                onDecrease: s.guard.maxPerTurn > 1 ? () => u(d => void (d.guard.maxPerTurn -= 1)) : undefined,
                onIncrease: s.guard.maxPerTurn < 5 ? () => u(d => void (d.guard.maxPerTurn += 1)) : undefined,
              }),
            }),
          s.guard.enabled &&
            row(kit, {
              key: 'gu-model',
              label: 'Smart check',
              labelWidth: lw,
              control: switchControl(kit, { key: 'gu-model', isOn: s.guard.modelCheck, onPress: () => u(d => void (d.guard.modelCheck = !d.guard.modelCheck)) }),
              detail: 'a small model call when unsure',
            }),
        ],
      })}

      {section(kit, {
        key: 'router',
        title: 'Model router',
        footer: s.router.strategy === 'off' ? 'Picks a model for each task. Off: every task uses the session model.' : 'Never downgrades while Frontier Max is on. Switches only while the context is small.',
        children: [
          row(kit, {
            key: 'ro-strategy',
            label: 'Router',
            labelWidth: lw,
            control: picker(kit, {
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
            row(kit, {
              key: 'ro-main',
              label: 'Main conversation',
              labelWidth: lw,
              control: switchControl(kit, { key: 'ro-main', isOn: s.router.mainLoop, onPress: () => u(d => void (d.router.mainLoop = !d.router.mainLoop)) }),
            }),
          s.router.strategy !== 'off' &&
            row(kit, {
              key: 'ro-sub',
              label: 'Subagents',
              labelWidth: lw,
              control: switchControl(kit, { key: 'ro-sub', isOn: s.router.subagents, onPress: () => u(d => void (d.router.subagents = !d.router.subagents)) }),
            }),
          ...(s.router.strategy === 'custom'
            ? (['trivial', 'simple', 'standard', 'hard', 'explore', 'plan', 'general'] as const).map(k =>
                row(kit, {
                  key: `ro-c-${k}`,
                  label: CLASS_LABEL[k] ?? k,
                  labelWidth: lw,
                  control: picker(kit, { key: `ro-c-${k}`, value: s.router.custom[k], options: MODELS, onSelect: v => u(d => void (d.router.custom[k] = asAlias(v))) }),
                }),
              )
            : []),
          s.router.strategy !== 'off' && pane.router.lastDecision !== null && note(kit, `Last choice: ${pane.router.lastDecision}`, 'ro-last'),
        ],
      })}
    </Box>
  )
}
