import type { On, SessionUsage } from 'claude-code'
import { mock } from 'claude-code/testing'

/**
 * A session the plugin runs in, answered from memory beneath it: every
 * engine call Control Room makes has an answer here, and what the plugin
 * asked for is kept for the test to read.
 */
export type World = ReturnType<typeof world>

export function world(on: On, options: { settings?: unknown; window?: number; tokens?: number; isHandoffWritten?: boolean } = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store: Record<string, unknown> = options.settings === undefined ? {} : { 'settings.v1': options.settings }
  const kept = {
    submitted: [] as string[],
    appended: [] as string[],
    commandsRun: [] as { command: string; args: string }[],
    registered: [] as string[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    opened: [] as string[],
    asked: [] as string[],
    spawned: [] as string[][],
  }
  const live = {
    sessionId: 'session-1',
    usage: {
      startedAt: 0,
      context: { tokens: options.tokens, window: options.window ?? 1_000_000, percent: undefined },
      rateLimits: [],
      cost: { usd: 1.25 },
    } as SessionUsage,
    askAnswer: 'Deny',
    isHandoffWritten: options.isHandoffWritten ?? true,
  }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.id', () => ({ value: live.sessionId }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: live.usage }))
  on('session.version', () => ({ value: { version: '2.1.292', base: '2.1.292' } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.messages', () => ({ value: [] }))
  // From Claude Code 2.1.293 the test kit stores the row beneath this hook, and a hook must relay
  // what `next(e)` stored. Before it, this world is the bottom and answers from memory.
  on('session.append', async ($, e, next) => {
    const text = e.message.content.map(b => (typeof b.text === 'string' ? b.text : '')).join('')
    kept.appended.push(text)
    const stored = await next(e).catch(() => undefined)
    return stored ?? { message: e.message, uuid: `row-${kept.appended.length}` }
  })
  on('session.compact', () => ({ messages: [], tokensBefore: 900_000, tokensAfter: 40_000 }))

  on('command.register', ($, e) => {
    kept.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('command.list', () => ({ value: [] }))
  on('command.run', ($, e) => {
    kept.commandsRun.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    kept.submitted.push(e.text)
    return { text: e.text, origin: e.origin }
  })

  on('agent.list', () => ({ value: [] }))
  on('model.classify', () => ({ value: 'premature' }))
  on('settings.read', () => ({ value: {} }))

  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ deny: 'no files in this world' }))
  on('fs.stat', ($, e) => {
    if (e.path.endsWith('NEXT_SESSION_PROMPT.md')) {
      return live.isHandoffWritten
        ? { value: { kind: 'file' as const, size: 120, mtimeMs: clock.now() + 1, isLink: false } }
        : { deny: 'ENOENT' }
    }
    return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
  })

  on('process.spawn', async function* ($, e) {
    kept.spawned.push([...e.argv])
    return { value: { code: 0, signal: null } }
  })

  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))

  on('ui.toast', ($, e) => {
    kept.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    kept.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    kept.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: kept.opened.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]?.question ?? ''
    kept.asked.push(question)
    return { result: { questions: e.questions, answers: { [question]: live.askAnswer } } }
  })
  on('tool.call', ($, e) => ({ result: { ok: true, tool: e.tool } }))

  return { clock, store, kept, live }
}

export const SESSION = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
