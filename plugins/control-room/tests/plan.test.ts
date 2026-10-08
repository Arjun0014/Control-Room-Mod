import { describe, expect, test } from 'claude-code/testing'

import { applyTool, emptyPlan, fromMilestones, fromTodoWrite, objectiveOf, planOf, progressOf } from '../hooks/features/plan'
import { continuationContext } from '../hooks/features/prompts'

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed', activeForm = `${content}ing`) => ({ content, status, activeForm })

describe('run plan', () => {
  test('a TodoWrite list is the plan: done of total, the task under way and the next one', () => {
    const plan = fromTodoWrite(emptyPlan(), [todo('Parse input', 'completed'), todo('Write tests', 'in_progress', 'Writing tests'), todo('Update docs', 'pending')], 1, 10)
    const p = progressOf(plan)
    expect([p.done, p.total]).toEqual([1, 3])
    expect(p.current?.activeForm).toBe('Writing tests')
    expect(p.next?.subject).toBe('Update docs')
  })

  test('the milestone in progress is the one under way, ahead of later ones still being verified', () => {
    // This run's own list after a handoff: an early milestone in hand, later ones built and awaiting review.
    const plan = fromMilestones(
      emptyPlan(),
      {
        milestones: [
          { title: 'Understand the code', status: 'completed', evidence: 'read' },
          { title: 'Verify the cache against the API', status: 'in_progress', doing: 'Checking the second refresh' },
          { title: 'Verify the handoff', status: 'pending' },
          { title: 'Redesign the status bar', status: 'verifying', evidence: 'tests pass' },
          { title: 'Redesign Kit', status: 'verifying', evidence: 'contact sheet' },
        ],
      },
      2,
      10,
    )
    expect(progressOf(plan).current?.subject).toBe('Verify the cache against the API')
    // With nothing in progress, the latest one being verified is what Claude is on.
    const checking = fromMilestones(plan, { milestones: [{ title: 'Redesign the status bar', status: 'verifying' }, { title: 'Redesign Kit', status: 'verifying' }] }, 2, 20)
    expect(progressOf(checking).current?.subject).toBe('Redesign Kit')
  })

  test('a rewritten list drops open work it no longer names, but never forgets finished work', () => {
    const first = fromTodoWrite(emptyPlan(), [todo('A', 'completed'), todo('B', 'in_progress'), todo('C', 'pending')], 1, 10)
    const second = fromTodoWrite(first, [todo('B', 'completed'), todo('D', 'pending')], 1, 20)
    expect(second.tasks.map(t => `${t.subject}:${t.status}`)).toEqual(['A:completed', 'B:completed', 'D:pending'])
    expect(second.tasks[0]!.doneAt).toBe(10)
  })

  test('after a handoff the fresh context re-plans: earlier open work goes, finished work stays', () => {
    const before = fromTodoWrite(emptyPlan(), [todo('A', 'completed'), todo('B', 'completed'), todo('C', 'in_progress'), todo('D', 'pending')], 1, 10)
    // Session 2 writes its own list from the handoff notes; C was renamed, D dropped.
    const after = fromTodoWrite(before, [todo('Finish C', 'in_progress'), todo('E', 'pending')], 2, 20)
    expect(progressOf(after)).toMatchObject({ done: 2, total: 4 })
    expect(after.tasks.map(t => t.subject)).toEqual(['A', 'B', 'Finish C', 'E'])
  })

  test('the Task tools build the plan by id; a deleted task leaves it, TaskList is the truth', () => {
    let plan = emptyPlan()
    plan = applyTool(plan, { tool: 'TaskCreate', input: { subject: 'Build parser', description: '', activeForm: 'Building the parser' }, result: { task: { id: '1', subject: 'Build parser' } }, session: 1, now: 1 })
    plan = applyTool(plan, { tool: 'TaskCreate', input: { subject: 'Ship', description: '' }, result: { task: { id: '2', subject: 'Ship' } }, session: 1, now: 2 })
    plan = applyTool(plan, { tool: 'TaskCreate', input: { subject: 'Spike', description: '' }, result: { task: { id: '3', subject: 'Spike' } }, session: 1, now: 3 })
    plan = applyTool(plan, { tool: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' }, result: { success: true }, session: 1, now: 4 })
    plan = applyTool(plan, { tool: 'TaskUpdate', input: { taskId: '3', status: 'deleted' }, result: { success: true }, session: 1, now: 5 })
    expect(progressOf(plan)).toMatchObject({ done: 0, total: 2 })
    expect(progressOf(plan).current?.activeForm).toBe('Building the parser')
    plan = applyTool(plan, { tool: 'TaskList', input: {}, result: { tasks: [{ id: '1', subject: 'Build parser', status: 'completed', blockedBy: [] }, { id: '2', subject: 'Ship', status: 'pending', blockedBy: [] }] }, session: 1, now: 6 })
    expect(progressOf(plan)).toMatchObject({ done: 1, total: 2 })
    // Any other tool, or a malformed result, leaves the plan as it was.
    expect(applyTool(plan, { tool: 'Read', input: {}, result: {}, session: 1, now: 7 })).toBe(plan)
    expect(applyTool(plan, { tool: 'TaskCreate', input: { subject: 'x' }, result: 'oops', session: 1, now: 8 })).toBe(plan)
  })

  test('a stored plan is validated: anything malformed reads as no plan', () => {
    expect(planOf(undefined).tasks).toEqual([])
    expect(planOf({ tasks: 'x' }).tasks).toEqual([])
    expect(planOf({ tasks: [{ subject: 'A', status: 'done' }, { subject: 'B', status: 'pending' }] }).tasks.map(t => t.subject)).toEqual(['B'])
  })

  test('the objective is the request in its own words, never a bare "yes"', () => {
    expect(objectiveOf('Redesign Activity around signal instead of raw tool spam. Then update the docs.')).toBe('Redesign Activity around signal instead of raw tool spam.')
    expect(objectiveOf('/cr status\nFix the flaky login test')).toBe('Fix the flaky login test')
    expect(objectiveOf('yes')).toBeNull()
    expect(objectiveOf('   ')).toBeNull()
  })
})

describe('the fresh context after a handoff', () => {
  test('is told the open milestones, so it rebuilds its task list and progress carries on', () => {
    const text = continuationContext({
      runNumber: 3,
      sessionNumber: 2,
      handoffPath: '/work/NEXT_SESSION_PROMPT.md',
      policies: [],
      milestones: [
        { subject: 'Profile the renderer', status: 'completed' },
        { subject: 'Rewrite the hot loop', status: 'in_progress' },
        { subject: 'Run the regression suite', status: 'pending' },
      ],
    })
    expect(text).toContain('1 of 3 milestones done')
    expect(text).toContain('[in progress] Rewrite the hot loop; Run the regression suite')
    expect(text).not.toContain('Profile the renderer')
    expect(continuationContext({ runNumber: 3, sessionNumber: 2, handoffPath: 'x', policies: [] })).not.toContain('task list')
  })
})
