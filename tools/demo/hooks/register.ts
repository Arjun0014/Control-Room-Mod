/**
 * Development only: replays a short, scripted piece of work through real
 * tools, so Control Room's Activity, run progress and status bar can be
 * captured for screenshots without a model turn (see README.md).
 *
 * Every step is a genuine `$.tool.call`: it runs through Control Room's
 * hooks, Claude Code's permission check and the tool itself. The tests
 * really fail and pass, the edits really land in the sample project.
 */

import type { Register, ToolCallArgs } from 'claude-code'

/** Control Room's milestones tool, offered where Claude Code has no task list. */
const MILESTONES_TOOL = 'mcp__control-room__milestones'

/** The milestones, as Claude would list them: subject and its "doing" form. */
const MILESTONES: readonly (readonly [string, string])[] = [
  ['Reproduce the failing ISS test', 'Reproducing the failing ISS test'],
  ['Fix orbitalSpeed', 'Fixing orbitalSpeed'],
  ['Add orbitalPeriod with a test', 'Adding orbitalPeriod'],
  ['Document the helpers', 'Documenting the helpers'],
]

const PERIOD = `// The time one circular orbit takes.
const G = 6.674e-11

/** Orbital period (s) at radius r (m) around a body of mass m (kg). */
export function orbitalPeriod(mass, radius) {
  return 2 * Math.PI * Math.sqrt(radius ** 3 / (G * mass))
}
`

const PERIOD_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orbitalPeriod } from '../src/period.js'

test('the ISS goes round in about 92 minutes', () => {
  const minutes = orbitalPeriod(5.972e24, 6_371_000 + 420_000) / 60
  assert.ok(Math.abs(minutes - 92.7) < 1, \`got \${minutes}\`)
})
`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'demo', description: 'Replay the scripted demo work (development only)' })
    return started
  })

  on('command.run', { command: 'demo' }, async $ => {
    const root = (await $.session.root()).replace(/[\\/]+$/, '')
    const at = (path: string) => `${root}/${path}`
    const shell = (command: string, description: string) => $.tool.call({ tool: 'Bash', command, description }).catch(() => undefined)
    // The task list as Claude would keep it here: Control Room's milestones
    // tool where it is offered, else the Task tools, else TodoWrite.
    const names = new Set((await $.tool.list()).map(t => t.name))
    const via = names.has(MILESTONES_TOOL) ? 'milestones' : names.has('TaskCreate') ? 'tasks' : 'todos'
    const ids: string[] = []
    if (via === 'tasks') {
      for (const [subject, activeForm] of MILESTONES) {
        const created = await $.tool.call({ tool: 'TaskCreate', subject, description: subject, activeForm })
        const task = (created as { result?: { task?: { id?: unknown } } }).result?.task
        ids.push(typeof task?.id === 'string' ? task.id : '')
      }
    }
    const plan = async (states: readonly ('pending' | 'in_progress' | 'completed')[]) => {
      const status = (i: number) => states[i] ?? 'pending'
      if (via === 'milestones') {
        const milestones = MILESTONES.map(([title, doing], i) => (status(i) === 'in_progress' ? { title, status: status(i), doing } : { title, status: status(i) }))
        // Registered at run time, so the generated tool types do not name it.
        await $.tool.call({ tool: MILESTONES_TOOL, milestones } as unknown as ToolCallArgs)
      } else if (via === 'todos') {
        await $.tool.call({ tool: 'TodoWrite', todos: MILESTONES.map(([content, activeForm], i) => ({ content, activeForm, status: status(i) })) })
      } else {
        for (const [i, s] of states.entries()) if (s !== 'pending' && ids[i] !== '') await $.tool.call({ tool: 'TaskUpdate', taskId: ids[i] ?? '', status: s })
      }
    }

    await plan(['in_progress', 'pending', 'pending', 'pending'])
    await $.tool.call({ tool: 'Read', file_path: at('src/orbit.js') })
    await $.tool.call({ tool: 'Read', file_path: at('test/orbit.test.js') })
    await $.tool.call({ tool: 'Grep', pattern: 'orbitalSpeed', path: root })
    await shell('npm test', 'Run the tests')

    await plan(['completed', 'in_progress', 'pending', 'pending'])
    await $.tool.call({ tool: 'Edit', file_path: at('src/orbit.js'), old_string: 'Math.sqrt((G * mass) / radius) * 2', new_string: 'Math.sqrt((G * mass) / radius)' })
    await shell('npm test', 'Run the tests')

    await plan(['completed', 'completed', 'in_progress', 'pending'])
    await $.tool.call({ tool: 'Write', file_path: at('src/period.js'), content: PERIOD })
    await $.tool.call({ tool: 'Write', file_path: at('test/period.test.js'), content: PERIOD_TEST })
    await shell('npm test', 'Run the tests')
    await shell('npm run lint', 'Lint the sources')

    await plan(['completed', 'completed', 'completed', 'in_progress'])
    await $.tool.call({ tool: 'Edit', file_path: at('README.md'), old_string: 'Small helpers for circular orbits.', new_string: 'Small helpers for circular orbits: `orbitalSpeed` and `orbitalPeriod`.' })
    await $.tool.call({ tool: 'Write', file_path: at('NEXT_SESSION_PROMPT.md'), content: '# Next session\n\nDocument the helpers, then add a lint script.\n' })
    return { text: 'Demo replayed: open Control Room (/cr) and look at Activity.' }
  })
}
