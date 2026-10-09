import { describe, expect, test } from 'claude-code/testing'

import { handleCommand } from '../hooks/app/commands'
import { Runtime } from '../hooks/app/runtime'
import { ANSWER_STYLE_INFO } from '../hooks/core/answers'
import { policySections } from '../hooks/core/policy'
import { diffSystems } from '../hooks/core/profiles'
import { ANSWER_STYLES, type Settings, defaultSettings, normalizeSettings, systemsOf } from '../hooks/core/settings'
import { answerStylePolicy } from '../hooks/features/prompts'
import { fakeHost, flush } from './fixtures/fake-host'

async function started(patch: (s: Settings) => void = () => undefined) {
  const f = fakeHost()
  const s = defaultSettings()
  patch(s)
  f.kept.store['settings.v1'] = s
  const rt = new Runtime()
  rt.bind(f.host)
  await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await f.advance(200)
  return { rt, ...f }
}

const withStyle = (style: Settings['answers']['style']): Settings => {
  const s = defaultSettings()
  s.answers.style = style
  return s
}

describe('answer styles', () => {
  test('every option reads whole in a docked pane: a short label and a hint of at most 37 characters', () => {
    for (const style of ANSWER_STYLES) {
      expect(ANSWER_STYLE_INFO[style].label.length, style).toBeLessThanOrEqual(16)
      expect(ANSWER_STYLE_INFO[style].hint.length, style).toBeLessThanOrEqual(37)
    }
  })

  test('each style but Standard puts its own rules in front of Claude, for its messages only', () => {
    expect(answerStylePolicy('standard')).toBeNull()
    for (const style of ANSWER_STYLES.filter(s => s !== 'standard')) {
      const text = answerStylePolicy(style) ?? ''
      expect(text, style).toContain('(Control Room)')
      expect(text, style).toContain('not code, commands, file contents or commit messages')
    }
    expect(answerStylePolicy('brief')).toContain('bottom line first')
    const ste = answerStylePolicy('ste') ?? ''
    expect(ste).toContain('ASD-STE100')
    expect(ste).toContain('at most 20 words')
    expect(ste).toContain('at most 25 words')
    expect(ste).toContain('active voice')
    const mission = answerStylePolicy('mission') ?? ''
    expect(mission).toContain('GO')
    expect(mission).toContain('NO-GO')
    expect(mission).toContain('HOLD')
    expect(mission).toContain('Call GO only for what you verified')
    // The game is Control Room's to score: Claude never states points or claims unverified progress.
    expect(answerStylePolicy('quest')).toContain('Never state XP, levels, scores or rewards yourself')
  })

  test('the section is in force unless the person chose a Claude Code output style of their own', () => {
    const names = (s: Settings, native?: string | null) => policySections(s, null, { nativeOutputStyle: native }).map(x => x.name)
    expect(names(withStyle('standard'))).not.toContain('Answer style')
    expect(names(withStyle('brief'))).toContain('Answer style')
    expect(names(withStyle('brief'), 'Explanatory')).not.toContain('Answer style')
  })

  test('the setting is validated, kept in profiles, and labelled in the panel’s words', () => {
    expect(normalizeSettings({ answers: { style: 'ste' } }).answers.style).toBe('ste')
    expect(normalizeSettings({ answers: { style: 'shouting' } }).answers.style).toBe('standard')
    // A store written before answer styles existed reads as Standard.
    expect(normalizeSettings({ frontier: { enabled: true } }).answers.style).toBe('standard')
    const from = systemsOf(defaultSettings())
    const to = systemsOf(withStyle('mission'))
    expect(diffSystems(from, to)).toEqual([{ path: 'answers.style', label: 'Answer style', from: 'Standard', to: 'Mission control' }])
    for (const style of ANSWER_STYLES) expect(ANSWER_STYLE_INFO[style].label.length).toBeGreaterThan(0)
  })

  test('the system prompt carries the style, and stands down for a native output style', async () => {
    const { rt } = await started(s => void (s.answers.style = 'ste'))
    expect(rt.composeSection(null)?.text).toContain('## Answer style: Simplified Technical English')
    expect(rt.composeSection({ name: 'Learning' })?.text ?? '').not.toContain('Answer style')
    expect(rt.nativeOutputStyle).toBe('Learning')
  })

  test('changing the style mid-session tells Claude with its next prompt', async () => {
    const { rt } = await started()
    rt.update(s => void (s.answers.style = 'brief'))
    await flush()
    expect(rt.onPromptSubmit('Go on.', { kind: 'composer' }).some(t => t.includes('the answer style is now Brief'))).toBe(true)
  })

  test('/cr style switches it, lists the styles, and says when a native style outranks it', async () => {
    const { rt } = await started()
    expect((await handleCommand(rt, 'style')).text).toContain('Plain technical')
    expect((await handleCommand(rt, 'style mission')).text).toBe('Answer style Mission control.')
    expect(rt.settings.answers.style).toBe('mission')
    expect((await handleCommand(rt, 'style plain')).text).toBe('Answer style Plain technical.')
    rt.composeSection({ name: 'Explanatory' })
    expect((await handleCommand(rt, 'style brief')).text).toContain('Explanatory, is in use and takes precedence')
    expect((await handleCommand(rt, 'status')).text).toContain('Claude Code style: Explanatory')
  })
})
