/**
 * Development only: plays a short, scripted piece of work so Control Room's
 * status bar, Activity and run progress can be captured for screenshots
 * without a model (see README.md).
 *
 * `/demo` submits a request and answers each of the turn's model steps from
 * a script, so the turn is a genuine engine turn: Claude Code runs every tool
 * call in it through Control Room's hooks, its own permission check and the
 * tool itself. The tests really fail and pass, the edits really land in the
 * sample project. Only the model's words and its token counts are scripted.
 *
 * `/demo calls` replays the same work as bare tool calls, outside any turn.
 * `/demo slow` paces the scripted turn, for a capture while it runs.
 * `/demo miss` reports a model change halfway through, which rebuilds the
 * prompt cache: Control Room's Cache reading and Cache health show it.
 */

import type { Register, ToolCallArgs, TurnStepChunk, TurnStepResult } from 'claude-code'

/** Control Room's milestones tool, offered where Claude Code has no task list. */
const MILESTONES_TOOL = 'mcp__project-sentinel__milestones'

/** The request the scripted turn answers: the run's objective. */
const REQUEST = 'The ISS speed test fails. Fix it, add orbitalPeriod with a test, and document the helpers.'

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

type State = 'pending' | 'in_progress' | 'completed'
type Call = { name: string; input: Record<string, unknown> }
type Step = { say?: string; calls: Call[] }

/** The milestones tool's whole list for these states, as Claude sends it. */
function milestonesCall(states: readonly State[], objective?: string): Call {
  const milestones = MILESTONES.map(([title, doing], i) => {
    const status = states[i] ?? 'pending'
    return status === 'in_progress' ? { title, status, doing } : { title, status }
  })
  return { name: MILESTONES_TOOL, input: objective === undefined ? { milestones } : { objective, milestones } }
}

/** TodoWrite's whole list for these states, where Claude Code offers it instead. */
function todosCall(states: readonly State[]): Call {
  return { name: 'TodoWrite', input: { todos: MILESTONES.map(([content, activeForm], i) => ({ content, activeForm, status: states[i] ?? 'pending' })) } }
}

/** The scripted turn, one entry per model step; the last one answers. */
function script(root: string, via: 'milestones' | 'todos' | null): Step[] {
  const at = (path: string) => `${root}/${path}`
  const plan = (states: readonly State[], objective?: string): Call[] =>
    via === 'milestones' ? [milestonesCall(states, objective)] : via === 'todos' ? [todosCall(states)] : []
  const bash = (command: string, description: string): Call => ({ name: 'Bash', input: { command, description } })
  return [
    {
      say: "I'll reproduce the failing test first.",
      calls: [
        ...plan(['in_progress', 'pending', 'pending', 'pending'], 'Fix the ISS test, add orbitalPeriod, document the helpers'),
        { name: 'Read', input: { file_path: at('src/orbit.js') } },
        { name: 'Read', input: { file_path: at('test/orbit.test.js') } },
        { name: 'Grep', input: { pattern: 'orbitalSpeed', path: root } },
      ],
    },
    { calls: [bash('npm test', 'Run the tests')] },
    {
      say: '`orbitalSpeed` multiplies by 2, which doubles every result. Removing the factor.',
      calls: [
        ...plan(['completed', 'in_progress', 'pending', 'pending']),
        { name: 'Edit', input: { file_path: at('src/orbit.js'), old_string: 'Math.sqrt((G * mass) / radius) * 2', new_string: 'Math.sqrt((G * mass) / radius)' } },
      ],
    },
    { calls: [bash('npm test', 'Run the tests')] },
    {
      say: 'Fixed. Now `orbitalPeriod`, with a test.',
      calls: [
        ...plan(['completed', 'completed', 'in_progress', 'pending']),
        { name: 'Write', input: { file_path: at('src/period.js'), content: PERIOD } },
        { name: 'Write', input: { file_path: at('test/period.test.js'), content: PERIOD_TEST } },
      ],
    },
    { calls: [bash('npm test', 'Run the tests'), bash('npm run lint', 'Lint the sources')] },
    {
      say: 'The project has no lint script, so I will say so rather than invent one. Documenting the helpers.',
      calls: [
        ...plan(['completed', 'completed', 'completed', 'in_progress']),
        { name: 'Edit', input: { file_path: at('README.md'), old_string: 'Small helpers for circular orbits.', new_string: 'Small helpers for circular orbits: `orbitalSpeed` and `orbitalPeriod`.' } },
      ],
    },
    { calls: plan(['completed', 'completed', 'completed', 'completed']) },
    {
      say: [
        'Done.',
        '',
        '- `orbitalSpeed` no longer doubles its result; the ISS test passes.',
        '- `orbitalPeriod` is new, with a test (the ISS goes round in about 92 minutes).',
        '- The README names both helpers.',
        '',
        'Tests pass, 2 of 2. `npm run lint` fails because the project has no lint script; say if you want one.',
      ].join('\n'),
      calls: [],
    },
  ]
}

/** The share of the context window the scripted turn reports at each step: a session well under way. */
const contextAt = (index: number) => 0.41 + 0.012 * index

/** With `/demo miss`, the step from which the requests report another model (a switch, as `/model` makes one). */
const MISS_AT = 4

/** The other model of a scripted switch: the same generation, the next family down. */
const otherModel = (model: string) => (model.includes('opus') ? model.replace('opus', 'sonnet') : model.includes('sonnet') ? model.replace('sonnet', 'opus') : 'claude-sonnet-5-5')

export const register: Register = on => {
  /** The scripted turn under way, and its steps, once `/demo` submitted its request. */
  let pending: { steps: Step[]; paceMs: number; isMiss: boolean } | null = null
  let active: { turnId: string; steps: Step[]; paceMs: number; isMiss: boolean } | null = null

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'demo', description: 'Play the scripted demo turn (development only)', argumentHint: '[slow|calls|miss]' })
    return started
  })

  on('turn.start', ($, e, next) => {
    if (pending !== null && e.text.includes(REQUEST)) {
      active = { turnId: e.turnId, ...pending }
      pending = null
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (active !== null && e.turnId === active.turnId && e.agentId === undefined) active = null
    return next(e)
  })

  // Answers the scripted turn's model steps; every other step goes to the model.
  on('turn.step', async function* ($, e, next) {
    const turn = active
    if (turn === null || e.turnId !== turn.turnId || e.agentId !== undefined) return yield* next(e)
    const step = turn.steps[e.index] ?? { say: 'Done.', calls: [] }
    if (turn.paceMs > 0) await $.clock.sleep(turn.paceMs, { signal: next.signal })
    let block = 0
    if (step.say !== undefined) {
      const chunk: TurnStepChunk = { kind: 'text', index: block, text: step.say }
      yield chunk
      block += 1
    }
    for (const [i, call] of step.calls.entries()) {
      yield { kind: 'tool', index: block, id: `toolu_demo_${e.index}_${i}`, name: call.name }
      yield { kind: 'input', index: block, json: JSON.stringify(call.input) }
      block += 1
    }
    const window = (await $.session.usage()).context?.window ?? 200_000
    const prompt = Math.round(window * contextAt(e.index))
    // The cache as a real turn uses it: the first request finds the earlier turns cached and writes
    // its own tail; each later one reads what the one before sent. A scripted switch rebuilds it all.
    const before = e.index === 0 ? Math.round(window * 0.38) : Math.round(window * contextAt(e.index - 1))
    const isSwitch = turn.isMiss && e.index === MISS_AT
    const read = isSwitch ? 0 : before
    const model = turn.isMiss && e.index >= MISS_AT ? otherModel(e.model) : e.model
    const usage = { model, input_tokens: 1_800, cache_read_input_tokens: read, cache_creation_input_tokens: Math.max(0, prompt - read - 1_800), output_tokens: 240 + 60 * step.calls.length }
    const stopReason = step.calls.length > 0 ? ('tool_use' as const) : ('end_turn' as const)
    yield { kind: 'stop', stopReason, usage }
    const result: TurnStepResult = {
      turnId: e.turnId,
      index: e.index,
      answer: step.say ?? '',
      toolUses: step.calls.map(c => ({ name: c.name, input: c.input })),
      stopReason,
      usage,
    }
    return result
  })

  on('command.run', { command: 'demo' }, async ($, e) => {
    const root = (await $.session.root()).replace(/[\\/]+$/, '')
    const names = new Set((await $.tool.list()).map(t => t.name))
    const args = String(e.args ?? '').trim().toLowerCase()
    if (args === 'calls') return replayCalls()
    const via = names.has(MILESTONES_TOOL) ? 'milestones' : names.has('TodoWrite') ? 'todos' : null
    const words = args.split(/\s+/)
    pending = { steps: script(root, via), paceMs: words.includes('slow') ? 4_000 : 900, isMiss: words.includes('miss') }
    $.clock.after(50, () => $.prompt.submit({ text: REQUEST }))
    return { text: 'Playing the scripted turn: watch the status bar, then open Control Room (/cr).' }

    async function replayCalls() {
      const at = (path: string) => `${root}/${path}`
      const shell = (command: string, description: string) => $.tool.call({ tool: 'Bash', command, description }).catch(() => undefined)
      // The task list as Claude would keep it here: Control Room's milestones
      // tool where it is offered, else the Task tools, else TodoWrite.
      const via = names.has(MILESTONES_TOOL) ? 'milestones' : names.has('TaskCreate') ? 'tasks' : 'todos'
      const ids: string[] = []
      if (via === 'tasks') {
        for (const [subject, activeForm] of MILESTONES) {
          const created = await $.tool.call({ tool: 'TaskCreate', subject, description: subject, activeForm })
          const task = (created as { result?: { task?: { id?: unknown } } }).result?.task
          ids.push(typeof task?.id === 'string' ? task.id : '')
        }
      }
      const plan = async (states: readonly State[]) => {
        if (via === 'milestones') {
          // Registered at run time, so the generated tool types do not name it.
          await $.tool.call({ tool: MILESTONES_TOOL, ...milestonesCall(states).input } as unknown as ToolCallArgs)
        } else if (via === 'todos') {
          await $.tool.call({ tool: 'TodoWrite', ...todosCall(states).input } as unknown as ToolCallArgs)
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
    }
  })
}
