import { describe, expect, test } from 'claude-code/testing'

import { assessExit, isConversational, isRepeat } from '../hooks/features/guard'
import type { GuardInput } from '../hooks/features/guard'

const base: GuardInput = {
  request: 'Implement the CSV export for the reports page and add tests.',
  answer: '',
  toolCount: 12,
  editCount: 3,
  strictness: 'standard',
  hasBackgroundWork: false,
  permissionMode: 'default',
}

const verdict = (answer: string, patch: Partial<GuardInput> = {}) => assessExit({ ...base, ...patch, answer }).verdict

describe('No-Lazy-Exit Guard', () => {
  test('genuinely complete work is allowed to stop', () => {
    expect(verdict('Implemented the CSV export in src/export.ts and added 6 tests. All 48 tests pass and the type check is clean.')).toBe('allow')
  })

  test('real external blockers are allowed to stop', () => {
    expect(verdict('The upload step needs your API key for the storage bucket; I cannot access it without credentials. Everything else is implemented and tested.')).toBe('allow')
    expect(verdict('The deploy failed: permission denied when pushing to the registry.')).toBe('allow')
  })

  test('genuine user decisions are allowed to stop', () => {
    expect(verdict('Both formats are implemented. Which option do you prefer for the default delimiter: comma or semicolon?')).toBe('allow')
  })

  test('optional extras alone do not trigger the guard', () => {
    expect(verdict('Done: the export works and all tests pass. Optionally, a progress bar could be added later.')).toBe('allow')
  })

  test('handing feasible work back is a premature exit', () => {
    const a = assessExit({
      ...base,
      answer:
        "I've added the export button. You'll need to implement the CSV serializer and write the tests yourself. TODO: handle quoting. Let me know if you'd like me to continue.",
    })
    expect(a.verdict).toBe('block')
    expect(a.items.length).toBeGreaterThan(0)
    expect(a.reasons.join(' ')).toContain('handed to the user')
  })

  test('announcing more work and stopping is caught', () => {
    expect(verdict('The schema is ready. Next, I will implement the serializer and wire it into the page.', { strictness: 'strict' })).not.toBe('allow')
  })

  test('conversational turns are never blocked', () => {
    expect(isConversational('What does the export module do?', 0)).toBe(true)
    expect(isConversational('thanks!', 0)).toBe(true)
    expect(isConversational('Fix the failing export test', 0)).toBe(false)
    expect(verdict("You could add tests for it, and you might want to refactor.", { request: 'How would you improve this module?', toolCount: 0, editCount: 0 })).toBe('allow')
  })

  test('background work in flight and plan mode allow the stop', () => {
    const lazy = 'You will need to run the tests yourself. TODO: finish the parser.'
    expect(verdict(lazy, { hasBackgroundWork: true })).toBe('allow')
    expect(verdict(lazy, { permissionMode: 'plan' })).toBe('allow')
  })

  test('strictness moves the bar', () => {
    const mild = 'The parser is implemented for now; the error cases are not yet handled.'
    expect(['block', 'uncertain']).toContain(verdict(mild, { strictness: 'strict' }))
    expect(verdict('It should work for now.', { strictness: 'lenient' })).toBe('allow')
  })

  test('repeats are recognised (stuck-loop protection)', () => {
    expect(isRepeat('I cannot finish this without the key.', 'I cannot finish this without the key!')).toBe(true)
    expect(isRepeat('Implemented the parser.', 'All tests now pass after fixing the edge case.')).toBe(false)
  })
})
