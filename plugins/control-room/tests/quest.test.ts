import { describe, expect, test } from 'claude-code/testing'

import type { ToolCallResult } from 'claude-code'

import { Runtime } from '../hooks/app/runtime'
import { type Settings, defaultSettings } from '../hooks/core/settings'
import { award, emptyQuest, levelOf, questOf, unlockForRun } from '../hooks/features/quest'
import { fakeHost } from './fixtures/fake-host'

async function started(patch: (s: Settings) => void) {
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

let seq = 0

/** One shell command through the runtime's tool hooks, failing or passing. */
async function shell(rt: Runtime, command: string, isOk: boolean): Promise<void> {
  const id = `c${++seq}`
  const input = { command }
  expect(await rt.beforeTool('Bash', input, id, undefined)).toBeNull()
  const result: ToolCallResult = isOk ? { result: { stdout: 'ok', stderr: '', interrupted: false } } : { isError: true, result: 'Exit code 1', text: 'Exit code 1\nFAIL a.test.ts' }
  rt.afterTool('Bash', input, id, result)
}

const milestones = (states: string[]) => ({
  milestones: states.map((status, i) => ({ title: `Step ${i + 1}`, status })),
})

describe('quest log', () => {
  test('levels need more XP each time: 0, 100, 300, 600, 1000', () => {
    expect(levelOf(0)).toEqual({ level: 1, floor: 0, next: 100 })
    expect(levelOf(99).level).toBe(1)
    expect(levelOf(100).level).toBe(2)
    expect(levelOf(299).level).toBe(2)
    expect(levelOf(300)).toEqual({ level: 3, floor: 300, next: 600 })
    expect(levelOf(1000).level).toBe(5)
  })

  test('an award adds its XP and log line, unlocks its achievement once, and reports a level up', () => {
    const first = award(emptyQuest(), { kind: 'green', text: 'Tests pass' }, 10)
    expect(first.xp).toBe(10)
    expect(first.unlocked).toEqual(['first-green'])
    expect(first.state.recent[0]).toEqual({ at: 10, xp: 10, text: 'Tests pass' })
    const again = award(first.state, { kind: 'green', text: 'Lint pass' }, 20)
    expect(again.unlocked).toEqual([])
    const big = award({ ...again.state, xp: 90 }, { kind: 'milestone', text: 'Milestone: A' }, 30)
    expect(big.levelUp).toBe(2)
    expect(unlockForRun(emptyQuest(), { sessions: 3, milestonesDone: 10 }, 40).unlocked).toEqual(['relay', 'long-haul'])
    expect(unlockForRun(emptyQuest(), { sessions: 2, milestonesDone: 9 }, 40).unlocked).toEqual([])
  })

  test('a stored quest is validated: garbage starts over at zero', () => {
    expect(questOf('nope')).toEqual(emptyQuest())
    expect(questOf({ xp: -5, unlocked: { comeback: 7, bogus: 1 }, recent: [{ at: 1, xp: 10, text: 'ok' }, 'x'] })).toEqual({
      v: 1,
      xp: 0,
      unlocked: { comeback: 7 },
      recent: [{ at: 1, xp: 10, text: 'ok' }],
    })
  })

  test('only verified progress pays, and each outcome pays once', async () => {
    const { rt, kept, advance } = await started(s => void (s.answers.style = 'quest'))
    rt.onTurnStart({ turnId: 't1', text: 'build the parser' })
    // Milestones pay when they turn complete, once per run.
    rt.recordMilestones({ objective: 'Build the parser', ...milestones(['in_progress', 'pending', 'pending']) }, undefined)
    expect(rt.quest.xp).toBe(0)
    rt.recordMilestones(milestones(['completed', 'in_progress', 'pending']), undefined)
    expect(rt.quest.xp).toBe(50)
    rt.recordMilestones(milestones(['completed', 'in_progress', 'pending']), undefined)
    rt.recordMilestones(milestones(['pending', 'in_progress', 'pending']), undefined)
    rt.recordMilestones(milestones(['completed', 'in_progress', 'pending']), undefined)
    expect(rt.quest.xp).toBe(50)
    expect(rt.run?.objective).toBe('Build the parser')
    // A failing check that passes again is a comeback; running it again earns nothing.
    await shell(rt, 'npm test', false)
    expect(rt.quest.xp).toBe(50)
    await shell(rt, 'npm test', true)
    expect(rt.quest.xp).toBe(80)
    await shell(rt, 'npm test', true)
    expect(rt.quest.xp).toBe(80)
    // A different check's first pass in the turn pays a little.
    await shell(rt, 'npm run lint', true)
    expect(rt.quest.xp).toBe(90)
    // Finishing a plan of three or more is a full clear.
    rt.recordMilestones(milestones(['completed', 'completed', 'completed']), undefined)
    expect(rt.quest.xp).toBe(90 + 50 + 50 + 100)
    expect(kept.toasts).toContain('Achievement: Comeback')
    expect(kept.toasts).toContain('Achievement: Full clear')
    expect(kept.toasts.some(t => t.startsWith('Level '))).toBe(true)
    await advance(2000)
    expect((kept.store['quest.v1'] as { xp: number }).xp).toBe(290)
    // Activity's numbers: XP, run XP and the log of awards.
    expect(rt.run?.quest?.xp).toBe(290)
  })

  test('nothing is scored unless the Quest log style is chosen', async () => {
    const { rt } = await started(() => undefined)
    rt.onTurnStart({ turnId: 't1', text: 'build' })
    rt.recordMilestones(milestones(['completed', 'pending', 'pending']), undefined)
    await shell(rt, 'npm test', true)
    expect(rt.quest.xp).toBe(0)
  })
})
