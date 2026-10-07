import type { ProcessSpawnChunk, ProcessSpawnResult, SessionUsage } from 'claude-code'

import type { Host, SpawnStream } from '../../hooks/host'

/** Lets every pending promise chain run (the test environment has no timers). */
export async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

/**
 * The engine as the Runtime sees it, in memory: a manual clock and a record
 * of every effect, so Runtime behaviour is tested without an engine at all.
 */
export function fakeHost(options: { cwd?: string; samplerLines?: string[]; handoffMtime?: () => number | null } = {}) {
  let time = 1_000_000
  let seq = 0
  const timers: { id: number; at: number; every: number | null; fn: () => void; isCancelled: boolean }[] = []
  const kept = {
    appended: [] as string[],
    submitted: [] as string[],
    commands: [] as string[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    store: {} as Record<string, unknown>,
    published: {} as Record<string, unknown>,
    spawned: [] as string[][],
    compacted: 0,
    scrolledToTop: 0,
    registeredTools: [] as string[],
    /** `$.state`'s autopilot record: kept across a new Runtime (a reload), as the engine keeps it. */
    autopilotRecord: null as import('../../types').AutopilotRecord | null,
  }
  const live = {
    usage: { startedAt: 0, context: { tokens: 10_000, window: 1_000_000, percent: 1 }, rateLimits: [], cost: { usd: 0.5 } } as SessionUsage,
    sessionId: 'S1',
    /** The tools the session offers: no task list tool by default, as in Claude Code 2.1.29x. */
    tools: ['Bash', 'Read', 'Edit', 'Write'] as string[],
  }
  const schedule = (ms: number, fn: () => void, every: number | null) => {
    const t = { id: ++seq, at: time + ms, every, fn, isCancelled: false }
    timers.push(t)
    return { cancel: () => void (t.isCancelled = true) }
  }

  const host: Host = {
    pluginRoot: '/plugin',
    now: async () => time,
    after: (ms, fn) => schedule(ms, fn, null),
    every: (ms, fn) => schedule(ms, fn, ms),
    sessionId: async () => live.sessionId,
    sessionRoot: async () => options.cwd ?? '/work',
    sessionModel: async () => 'claude-opus-5-5',
    usage: async () => live.usage,
    usageSummary: async () => live.usage,
    version: async () => ({ version: '2.1.292', base: '2.1.292' }),
    surfaces: async () => ['terminal'],
    appendForModel: async text => {
      kept.appended.push(text)
      return true
    },
    compact: async () => {
      kept.compacted += 1
      return { messages: [], tokensBefore: 900_000, tokensAfter: 40_000 }
    },
    submit: async text => {
      kept.submitted.push(text)
      return { text }
    },
    runCommand: async command => {
      kept.commands.push(command)
      return { text: '' }
    },
    registerCommand: async () => undefined,
    listCommands: async () => [],
    listAgents: async () => [],
    listTools: async () => live.tools.map(name => ({ name, description: '', mcp: false })),
    registerTool: async spec => {
      kept.registeredTools.push(spec.name)
      return `mcp__control-room__${spec.name}`
    },
    stopTask: async () => ({ result: 'stopped' }),
    classify: async () => 'premature',
    toast: text => void kept.toasts.push(text),
    status: text => void kept.statuses.push(text),
    open: async () => ({ isPlaced: true }),
    close: async () => undefined,
    panes: async () => [],
    scrollPaneToTop: async () => void (kept.scrolledToTop += 1),
    ask: async () => 'Deny',
    copy: async () => true,
    readText: async () => '',
    stat: async path => {
      if (path.endsWith('NEXT_SESSION_PROMPT.md')) {
        const m = options.handoffMtime?.() ?? time + 1
        if (m === null) throw new Error('ENOENT')
        return { kind: 'file', size: 100, mtimeMs: m, isLink: false }
      }
      return { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path }
    },
    exists: async () => false,
    storeGet: async key => kept.store[key],
    storeSet: async (key, value) => void (kept.store[key] = JSON.parse(JSON.stringify(value))),
    storeDelete: async key => void delete kept.store[key],
    settings: async () => ({}),
    spawn: argv => {
      kept.spawned.push([...argv])
      const lines = options.samplerLines ?? []
      async function* gen(): AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> {
        for (const line of lines) yield { stream: 'stdout', text: `${line}\n` }
        // A real sampler never exits on its own; this one waits until the test ends.
        await new Promise<never>(() => undefined)
        return { code: 0, signal: null }
      }
      const g = gen()
      return Object.assign(g, { result: Promise.resolve({ code: 0, signal: null }) }) as SpawnStream
    },
    publishHud: async v => void (kept.published.hud = v),
    publishPane: async v => void (kept.published.pane = v),
    publishResources: async v => void (kept.published.resources = v),
    publishChain: async v => void (kept.published.chain = v),
    publishActivity: async v => void (kept.published.activity = v),
    publishPermissions: async v => void (kept.published.permissions = v),
    publishFocus: async v => void (kept.published.focus = v),
    publishSpinner: async v => void (kept.published.spinner = v),
    saveAutopilotRecord: async record => void (kept.autopilotRecord = record === null ? null : JSON.parse(JSON.stringify(record))),
    loadAutopilotRecord: async () => kept.autopilotRecord,
    invalidateDescribes: () => undefined,
  }

  /** Moves the clock, firing due timers in order and letting their work settle. */
  async function advance(ms: number): Promise<void> {
    const end = time + ms
    for (;;) {
      await flush()
      const due = timers.filter(t => !t.isCancelled && t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (due === undefined) break
      time = due.at
      if (due.every === null) due.isCancelled = true
      else due.at += due.every
      due.fn()
    }
    time = end
    await flush()
  }

  return { host, kept, live, advance, now: () => time }
}
