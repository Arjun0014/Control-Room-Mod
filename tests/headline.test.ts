import { describe, expect, test } from 'claude-code/testing'

import { Runtime } from '../hooks/app/runtime'
import * as Views from '../hooks/app/views'
import { chipsOf, endsWithQuestion, wakeAt } from '../hooks/app/headline'
import { defaultSettings } from '../hooks/core/settings'
import type { Settings } from '../hooks/core/settings'
import { fakeHost } from './fixtures/fake-host'

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

const stop = (rt: Runtime, input: Partial<Parameters<Runtime['onStop']>[0]> = {}) =>
  rt.onStop({ stopHookActive: false, lastMessage: 'Done.', background: [], wakeups: [], permissionMode: 'default', ...input })

const plan = (rt: Runtime, milestones: { title: string; status: string; doing?: string; blocker?: string }[]) => rt.recordMilestones({ milestones }, undefined)

describe('the headline', () => {
  test('before anything happens: ready, with the objective only when Claude stated it', async () => {
    const { rt } = await started()
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'ready', text: 'Ready' })
    // The person's raw request is never the headline.
    rt.onPromptSubmit('lets wait for s-002, update all releveant docs', { kind: 'composer' })
    expect(Views.hudOf(rt).headline.text).toBe('Ready')
    rt.recordMilestones({ objective: 'Record the S-002 result and update the docs', milestones: [{ title: 'Record the S-002 result', status: 'pending' }] }, undefined)
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'ready', text: 'Record the S-002 result and update the docs', detail: '0 of 1 milestones done' })
  })

  test('working: the milestone in Claude’s words and its place; a check running says so; thinking between calls', async () => {
    const { rt } = await started()
    await rt.onTurnStart({ turnId: 't1', text: 'Fix the scheduler.' })
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'thinking', text: 'Thinking' })
    plan(rt, [{ title: 'Fix the scheduler', status: 'in_progress', doing: 'Rewriting the cache scheduler' }, { title: 'Validate the fix', status: 'pending' }])
    expect(Views.hudOf(rt).headline).toEqual({ state: 'working', text: 'Rewriting the cache scheduler', detail: 'step 1 of 2', tone: 'info' })
    await rt.beforeTool('Bash', { command: 'npm test' }, 'c1', undefined)
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'validating', text: 'Running tests', detail: 'step 1 of 2' })
    plan(rt, [{ title: 'Fix the scheduler', status: 'verifying', doing: 'Checking the scheduler against the live API' }, { title: 'Validate the fix', status: 'pending' }])
    rt.afterTool('Bash', { command: 'npm test' }, 'c1', { result: { stdout: 'ok', stderr: '', interrupted: false } } as never)
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'validating', text: 'Checking the scheduler against the live API' })
  })

  test('between turns, waiting for a result is told apart from waiting for you, blocked, idle and complete', async () => {
    const { rt } = await started()
    await rt.onTurnStart({ turnId: 't1', text: 'Run the S-002 experiment and record it.' })
    plan(rt, [{ title: 'Launch S-002', status: 'completed' }, { title: 'Record the S-002 score', status: 'pending' }])
    // A background job still running as the turn stops: the run waits for it, not for the next prompt.
    await stop(rt, { background: [{ id: 'b1', type: 'shell', description: 'the S-002 run' }] })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'Launched.' })
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'waitingExternal', text: 'Waiting for the S-002 run', detail: 'running in the background' })
    expect(Views.missionOf(rt)).toMatchObject({ nowState: 'waitingExternal', now: 'Waiting for the S-002 run · running in the background' })
    // A scheduled wake-up instead.
    await rt.onTurnStart({ turnId: 't2', text: 'Check back later.' })
    const at = new Date(2026, 9, 8, 5, 37).getTime()
    await stop(rt, { wakeups: [{ schedule: '37 5 8 10 *', recurring: false }] })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'I will check back.' })
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'waitingExternal', text: 'Waiting to check back', detail: `wakes at 05:37` })
    expect(wakeAt('37 5 8 10 *', false, at - 3_600_000)).toBe(at)
    // A milestone marked waiting, then one blocked on the person.
    await rt.onTurnStart({ turnId: 't3', text: 'Go on.' })
    plan(rt, [{ title: 'Launch S-002', status: 'completed' }, { title: 'Record the S-002 score', status: 'waiting', blocker: 'the S-002 score' }])
    await stop(rt)
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'Waiting.' })
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'waitingExternal', text: 'Waiting for the S-002 score', detail: 'step 2 of 2' })
    await rt.onTurnStart({ turnId: 't4', text: 'Go on.' })
    plan(rt, [{ title: 'Launch S-002', status: 'completed' }, { title: 'Publish the report', status: 'blocked', blocker: 'needs the API key' }])
    await stop(rt)
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'Blocked.' })
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'blocked', text: 'Blocked: needs the API key' })
    // Claude asked something: waiting for you.
    await rt.onTurnStart({ turnId: 't5', text: 'Go on.' })
    plan(rt, [{ title: 'Launch S-002', status: 'completed' }, { title: 'Publish the report', status: 'pending' }])
    await stop(rt, { lastMessage: 'The report is drafted. Should I publish it to the shared drive?' })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'Should I publish it?' })
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'waitingUser', text: 'Waiting for your answer' })
    // Nothing awaited: the last turn's outcome on the status bar, idle in Activity.
    await rt.onTurnStart({ turnId: 't6', text: 'Go on.' })
    await stop(rt, { lastMessage: 'Published.' })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'Published.' })
    expect(Views.hudOf(rt).headline.state).toBe('done')
    expect(Views.missionOf(rt)).toMatchObject({ nowState: 'idle', now: 'Idle, ready for your next prompt' })
    // Every milestone done: complete.
    plan(rt, [{ title: 'Launch S-002', status: 'completed' }, { title: 'Publish the report', status: 'completed' }])
    expect(Views.hudOf(rt).headline).toMatchObject({ state: 'complete', text: 'All 2 milestones done' })
  })

  test('a question is read from the last words, past formatting', () => {
    expect(endsWithQuestion('Done.\n\nShould I push it?')).toBe(true)
    expect(endsWithQuestion('**Want me to push it?**')).toBe(true)
    expect(endsWithQuestion('What changed?\n\nAll done.')).toBe(false)
    expect(endsWithQuestion('```\nwhy?\n```')).toBe(false)
  })

  test('chips: only what needs a look, the most pressing first', () => {
    const calm = { failing: [], attention: 0, guard: { isOn: true, continued: 0 }, load: null, agents: { running: 0, limit: null, mode: 'unrestricted' }, quest: null }
    expect(chipsOf(calm)).toEqual([])
    const busy = chipsOf({
      ...calm,
      failing: ['Lint'],
      attention: 2,
      load: { cpu: 40, ram: 93, cpuTone: 'good', ramTone: 'bad', cpuSeries: [], ramSeries: [] },
      agents: { running: 2, limit: null, mode: 'unrestricted' },
    })
    expect(busy.map(c => c.text)).toEqual(['Lint failing', '2 issues', 'RAM 93%', '2 agents'])
    expect(busy[0]?.tone).toBe('bad')
  })
})
