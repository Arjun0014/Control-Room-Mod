/**
 * Answer styles in the panel's words: what each is called, one line on what
 * it means, and a sample line written in it, so the person can see the
 * difference before choosing. The words Claude reads are in
 * `features/prompts.ts` (`answerStylePolicy`).
 */

import type { AnswerStyle } from './settings'

export type AnswerStyleInfo = {
  label: string
  /** One line on what it means, as a picker's hint: short enough to read whole in a docked pane. */
  hint: string
  /** A line written in the style, about the same small fix. */
  sample: string | null
  /** What the person should know about it, under the card. */
  note: string | null
}

export const ANSWER_STYLE_INFO: Record<AnswerStyle, AnswerStyleInfo> = {
  standard: {
    label: 'Standard',
    hint: 'Claude Code’s own way',
    sample: null,
    note: null,
  },
  brief: {
    label: 'Brief',
    hint: 'The answer first, then what you need',
    sample: 'Fixed: orbitalSpeed doubled the speed. Tests pass, 3 of 3.',
    note: 'Bottom line up front. Code, commands and error text stay exact.',
  },
  ste: {
    label: 'Plain technical',
    hint: 'Simplified Technical English',
    sample: 'The test failed because the function doubled the speed. Remove the factor 2.',
    note: 'After the writing rules of ASD-STE100: one instruction per sentence, short sentences, active voice. It does not check the STE dictionary.',
  },
  mission: {
    label: 'Mission control',
    hint: 'Status calls: GO, NO-GO, HOLD',
    sample: 'GO · tests pass, 3 of 3. NEXT: you review the README change.',
    note: 'GO only for what was verified. Anything unchecked is HOLD.',
  },
  quest: {
    label: 'Quest log',
    hint: 'XP and levels for verified progress',
    sample: 'Step done: fix the ISS speed. Boss beaten: the orbit test passes.',
    note: 'XP comes from progress Control Room can count: milestones done, checks turning green, clean handoffs. Never from lines written or tools used, and never from Claude’s own claims.',
  },
}

export const answerStyleLabel = (style: AnswerStyle): string => ANSWER_STYLE_INFO[style].label
