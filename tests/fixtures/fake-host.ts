import type { ProcessSpawnChunk, ProcessSpawnResult, SessionUsage } from 'claude-code'

import type { ConfigEnv } from '../../hooks/app/formerStore'
import type { Host, SpawnStream } from '../../hooks/host'

/** Lets every pending promise chain run (the test environment has no timers). */
export async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

/** `systeminfo /fo csv /nh` for a machine with 10,000 MB of memory (its 23rd field is the total). */
export const SYSTEMINFO_10000_MB = `${'"-",'.repeat(22)}"10,000 MB","4,000 MB"\r\n`

/** One `typeperf` sample on Windows: the CPU % and the memory available, in MB of SYSTEMINFO_10000_MB's 10,000. */
export const typeperfLine = (cpu: number, availableMb: number): string =>
  `"10/08/2026 20:14:26.719","${cpu.toFixed(6)}","${(availableMb * 1024 * 1024).toFixed(6)}"`

/**
 * The engine as the Runtime sees it, in memory: a manual clock and a record
 * of every effect, so Runtime behaviour is tested without an engine at all.
 */
export function fakeHost(
  options: {
    cwd?: string
    samplerLines?: string[]
    /** What `systeminfo` writes on Windows (a 10,000 MB machine by default). */
    systemInfo?: string
    /** What `sysctl -n kern.memorystatus_level` writes on macOS ('63' by default: 37% in use). */
    memoryLevel?: string
    handoffMtime?: () => number | null
    files?: Record<string, string>
    /** When each of `files` was last written (1 when not given). */
    fileTimes?: Record<string, number>
    pluginRoot?: string
    /** The environment's configuration hints; none by default, so nothing is carried over at the load. */
    configEnv?: ConfigEnv
    /** Folders that exist (a configuration folder's `plugins/store`). */
    dirs?: string[]
    /** What Control Room, the former name, published as its status bar in this session. */
    formerHud?: unknown
  } = {},
) {
  let time = 1_000_000
  let seq = 0
  const timers: { id: number; at: number; every: number | null; fn: () => void; isCancelled: boolean }[] = []
  const kept = {
    submitted: [] as string[],
    commands: [] as string[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    store: {} as Record<string, unknown>,
    published: {} as Record<string, unknown>,
    spawned: [] as string[][],
    /** One-shot programs the samplers ran (`systeminfo`, `sysctl`). */
    ran: [] as string[],
    compacted: 0,
    scrolledToTop: 0,
    registeredTools: [] as string[],
    /** Keep warm's forks, by the time they went out. */
    forks: [] as number[],
    /** `git status` runs. */
    gitRuns: 0,
    /** `$.state`'s autopilot record: kept across a new Runtime (a reload), as the engine keeps it. */
    autopilotRecord: null as import('../../types').AutopilotRecord | null,
    /** `$.state`'s standby note: kept across a new Runtime (a reload), as the engine keeps it. */
    isStandbyNoted: false,
    /** `$.state`'s policy memo: the section the system prompt carries, kept across a reload. */
    policyMemo: null as { sessionId: string; text: string } | null,
  }
  const live = {
    usage: { startedAt: 0, context: { tokens: 10_000, window: 1_000_000, percent: 1 }, rateLimits: [], cost: { usd: 0.5 } } as SessionUsage,
    sessionId: 'S1',
    /** The tools the session offers: no task list tool by default, as in Claude Code 2.1.29x. */
    tools: ['Bash', 'Read', 'Edit', 'Write'] as string[],
    /** What a fork reads from the cache: the whole prompt by default (a hit). */
    forkRead: 300_000,
    /** The repository the session is in (none by default), and what `git status` says there. */
    repo: null as string | null,
    gitStatus: '## main...origin/main\n',
    /** `$.session.compact` refuses, as in a headless or SDK session (Desktop's host protocol). */
    isCompactTurnOnly: false,
  }
  const schedule = (ms: number, fn: () => void, every: number | null) => {
    const t = { id: ++seq, at: time + ms, every, fn, isCancelled: false }
    timers.push(t)
    return { cancel: () => void (t.isCancelled = true) }
  }

  const host: Host = {
    time: () => time,
    pluginRoot: options.pluginRoot ?? '/plugin',
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
    compact: async () => {
      // A headless or SDK session (Claude Code 2.1.295): compaction runs only inside a turn, as a /compact prompt.
      if (live.isCompactTurnOnly) throw new Error('$.session.compact: not available in a headless (-p / SDK) session yet: compaction here runs inside a turn (a /compact prompt); catch it and carry on')
      kept.compacted += 1
      return { messages: [], tokensBefore: 900_000, tokensAfter: 40_000 }
    },
    submit: async text => {
      kept.submitted.push(text)
      return { text }
    },
    clearContext: async () => {
      kept.commands.push('clear')
      return { text: '' }
    },
    compactCommand: async instructions => {
      kept.commands.push(`compact ${instructions}`)
      return {}
    },
    registerCommand: async () => undefined,
    listCommands: async () => [],
    listAgents: async () => [],
    listTools: async () => live.tools.map(name => ({ name, description: '', mcp: false })),
    registerTool: async spec => {
      kept.registeredTools.push(spec.name)
      return `mcp__project-sentinel__${spec.name}`
    },
    stopTask: async () => ({ result: 'stopped' }),
    classify: async () => 'premature',
    fork: async () => {
      kept.forks.push(time)
      return { isAnswered: true as const, text: 'ok', usage: { input_tokens: 20, output_tokens: 2, cache_read_input_tokens: live.forkRead, cache_creation_input_tokens: live.forkRead === 0 ? 300_000 : 0 } }
    },
    toast: text => void kept.toasts.push(text),
    status: text => void kept.statuses.push(text),
    open: async () => ({ isPlaced: true }),
    close: async () => undefined,
    panes: async () => [],
    scrollPaneToTop: async () => void (kept.scrolledToTop += 1),
    ask: async () => 'Deny',
    checkTool: async () => ({ decision: 'allow' as const }),
    copy: async () => true,
    readText: async path => options.files?.[path] ?? '',
    stat: async path => {
      if (path.endsWith('NEXT_SESSION_PROMPT.md')) {
        const m = options.handoffMtime?.() ?? time + 1
        if (m === null) throw new Error('ENOENT')
        return { kind: 'file', size: 100, mtimeMs: m, isLink: false }
      }
      if (options.files?.[path] !== undefined) return { kind: 'file', size: options.files[path]!.length, mtimeMs: options.fileTimes?.[path] ?? 1, isLink: false }
      return { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path }
    },
    exists: async path => options.dirs?.includes(path) ?? false,
    storeGet: async key => kept.store[key],
    storeSet: async (key, value) => void (kept.store[key] = JSON.parse(JSON.stringify(value))),
    storeDelete: async key => void delete kept.store[key],
    settings: async () => ({}),
    configEnv: async () => options.configEnv ?? { claudeConfigDir: undefined, userProfile: undefined, home: undefined },
    formerHud: async () => options.formerHud,
    isStandbyNoted: async () => kept.isStandbyNoted,
    noteStandby: async () => void (kept.isStandbyNoted = true),
    spawnSampler: platform => {
      kept.spawned.push([platform])
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
    systemInfo: async () => {
      kept.ran.push('systeminfo')
      return { exitCode: 0, stdout: options.systemInfo ?? SYSTEMINFO_10000_MB, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    },
    memoryLevel: async () => {
      kept.ran.push('sysctl')
      return { exitCode: 0, stdout: `${options.memoryLevel ?? '63'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    },
    repoRoot: async () => live.repo,
    gitStatus: async () => {
      kept.gitRuns += 1
      return { exitCode: 0, stdout: live.gitStatus, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
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
    savePolicyMemo: async memo => void (kept.policyMemo = memo === null ? null : { ...memo }),
    loadPolicyMemo: async () => kept.policyMemo,
    invalidateDescribes: () => undefined,
    invalidatePromptContext: () => undefined,
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
