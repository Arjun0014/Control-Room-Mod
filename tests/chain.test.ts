import { describe, expect, test } from 'claude-code/testing'

import { countTurn, currentSession, endRun, isRun, measure, newRun, recordTransition, rollOver, totals, updateIndex } from '../hooks/features/chain'

const start = () => newRun({ id: 'r1', number: 14, sessionId: 's1', root: '/p', profile: 'frontier', start: 'startup', now: 1000 })

describe('Session Chain', () => {
  test('a run tracks peak context, cost and turns per session', () => {
    let run = start()
    run = measure(run, { tokens: 300_000, window: 1_000_000, costUsd: 1.5 }, 2000)
    run = measure(run, { tokens: 702_000, window: 1_000_000, costUsd: 3.84 }, 3000)
    run = countTurn(countTurn(run, 3000), 3000)
    const s = currentSession(run)!
    expect(s.peakTokens).toBe(702_000)
    expect(s.costUsd).toBe(3.84)
    expect(s.turns).toBe(2)
  })

  test('handoffs roll over into a new session of the same run', () => {
    let run = measure(start(), { tokens: 702_000, window: 1_000_000, costUsd: 3.84 }, 2000)
    run = rollOver(run, { end: 'handoff', endNote: 'handoff at 702k', nextId: 's2', nextStart: 'handoff', now: 3000 })
    run = measure(run, { tokens: 699_000, window: 1_000_000, costUsd: 4.1 }, 4000)
    run = rollOver(run, { end: 'handoff', endNote: null, nextId: 's3', nextStart: 'handoff', now: 5000 })
    run = measure(run, { tokens: 381_000, window: 1_000_000, costUsd: 3.48 }, 6000)
    expect(run.sessions.map(s => [s.index, s.end, s.peakTokens])).toEqual([
      [1, 'handoff', 702_000],
      [2, 'handoff', 699_000],
      [3, null, 381_000],
    ])
    const t = totals(run, 7000)
    expect(t.sessions).toBe(3)
    expect(t.handoffs).toBe(2)
    expect(Math.round((t.costUsd ?? 0) * 100)).toBe(1142)
    expect(t.isCostPartial).toBe(false)
  })

  test('cost that was not reported is never invented', () => {
    let run = start()
    run = rollOver(run, { end: 'clear', endNote: null, nextId: 's2', nextStart: 'clear', now: 2000 })
    run = measure(run, { tokens: 10, window: 100, costUsd: 2 }, 3000)
    const t = totals(run, 4000)
    expect(t.costUsd).toBe(2)
    expect(t.isCostPartial).toBe(true)
    expect(totals(start(), 1).costUsd).toBeNull()
  })

  test('rolling over to an existing session id does not duplicate it', () => {
    const run = rollOver(start(), { end: 'clear', endNote: null, nextId: 's1', nextStart: 'clear', now: 2000 })
    expect(run.sessions).toHaveLength(1)
  })

  test('transitions, ending, validation and the index', () => {
    let run = recordTransition(start(), { kind: 'auto-compact', at: 2000, tokensBefore: 900_000, tokensAfter: 60_000 })
    expect(currentSession(run)!.transitions).toHaveLength(1)
    run = endRun(run, 'exit', 3000)
    expect(run.status).toBe('ended')
    expect(currentSession(run)!.end).toBe('exit')
    expect(isRun(run)).toBe(true)
    expect(isRun({ v: 2 })).toBe(false)
    const { index, dropped } = updateIndex(['a', 'b'], 'b')
    expect(index).toEqual(['b', 'a'])
    expect(dropped).toEqual([])
  })
})
