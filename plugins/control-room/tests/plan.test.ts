import { describe, expect, test } from 'claude-code/testing'

import { applyTool, emptyPlan, fromTodoWrite, objectiveOf, planOf, progressOf } from '../hooks/features/plan'

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed', activeForm = `${content}ing`) => ({ content, status, activeForm })

describe('run plan', () => {
  test('a TodoWrite list is the plan: done of total, the task under way and the next one', () => {
    const plan = fromTodoWrite(emptyPlan(), [todo('Parse input', 'completed'), todo('Write tests', 'in_progress', 'Writing tests'), todo('Update docs', 'pending')], 1, 10)
    const p = progressOf(plan)
    expect([p.done, p.total]).toEqual([1, 3])
    expect(p.current?.activeForm).toBe('Writing tests')
    expect(p.next?.subject).toBe('Update docs')
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
