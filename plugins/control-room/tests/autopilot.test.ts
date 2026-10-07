import { describe, expect, test } from 'claude-code/testing'

import { type Autopilot, type AutopilotConfig, type AutopilotEvent, initialAutopilot, isHandoffActive, recordOf, recover, resolveThreshold, step } from '../hooks/features/autopilot'

const CFG: AutopilotConfig = { continuation: 'clear', fallbackToCompact: true, autoContinue: true }

function run(events: AutopilotEvent[], cfg: AutopilotConfig = CFG, start: Autopilot = initialAutopilot()) {
  let model = start
  const effects: string[] = []
  for (const event of events) {
    const out = step(model, event, cfg)
    model = out.model
    effects.push(...out.effects.filter(e => e.kind !== 'notify').map(e => e.kind))
  }
  return { model, effects }
}

const ARM: AutopilotEvent = { kind: 'configure', enabled: true, threshold: 700_000, isClamped: false }

describe('threshold', () => {
  test('tokens and percentages resolve against the live window', () => {
    expect(resolveThreshold({ mode: 'tokens', tokens: 700_000, percent: 70, window: 1_000_000, autoCompactAt: undefined }).threshold).toBe(700_000)
    expect(resolveThreshold({ mode: 'percent', tokens: 0, percent: 70, window: 1_000_000, autoCompactAt: undefined }).threshold).toBe(700_000)
    expect(resolveThreshold({ mode: 'percent', tokens: 0, percent: 70, window: undefined, autoCompactAt: undefined }).threshold).toBeNull()
  })

  test('a threshold above the window is capped inside it', () => {
    expect(resolveThreshold({ mode: 'tokens', tokens: 900_000, percent: 0, window: 200_000, autoCompactAt: undefined }).threshold).toBe(194_000)
  })

  test("the threshold is kept under Claude Code's auto-compact point", () => {
    const r = resolveThreshold({ mode: 'percent', tokens: 0, percent: 95, window: 1_000_000, autoCompactAt: 967_000 })
    expect(r.isClamped).toBe(true)
    expect(r.threshold).toBe(917_000)
    expect(resolveThreshold({ mode: 'percent', tokens: 0, percent: 70, window: 1_000_000, autoCompactAt: 967_000 }).isClamped).toBe(false)
  })
})

describe('state machine', () => {
  test('the full happy path: pending → handoff → verified → clear → resume → armed', () => {
    const r = run([
      ARM,
      { kind: 'context', tokens: 650_000, window: 1_000_000, isInTurn: true, now: 1 },
      { kind: 'context', tokens: 702_000, window: 1_000_000, isInTurn: true, now: 2 },
      { kind: 'turnComplete', reason: 'answer', now: 3 },
      { kind: 'handoffStarted', now: 4 },
      { kind: 'turnComplete', reason: 'answer', now: 5 },
      { kind: 'handoffVerified', isOk: true, now: 6 },
      { kind: 'clearDone', now: 7 },
      { kind: 'continuationStarted', now: 8 },
    ])
    expect(r.effects).toEqual(['appendPending', 'submitHandoff', 'verifyHandoff', 'clear', 'submitContinuation'])
    expect(r.model.state).toBe('armed')
    expect(r.model.completed).toBe(1)
  })

  test('below the threshold nothing happens', () => {
    const r = run([ARM, { kind: 'context', tokens: 699_999, window: 1_000_000, isInTurn: true, now: 1 }, { kind: 'turnComplete', reason: 'answer', now: 2 }])
    expect(r.model.state).toBe('armed')
    expect(r.effects).toEqual([])
  })

  test('crossing between turns starts the handoff at once', () => {
    const r = run([ARM, { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: false, now: 1 }])
    expect(r.model.state).toBe('requested')
    expect(r.effects).toEqual(['submitHandoff'])
  })

  test('an interrupted turn does not start the handoff', () => {
    const r = run([ARM, { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: true, now: 1 }, { kind: 'turnComplete', reason: 'aborted', now: 2 }])
    expect(r.model.state).toBe('pending')
    expect(r.effects).toEqual(['appendPending'])
  })

  test('a missing handoff file is retried once, then the context is NOT cleared', () => {
    const r = run([
      ARM,
      { kind: 'manualHandoff', now: 1 },
      { kind: 'handoffStarted', now: 2 },
      { kind: 'turnComplete', reason: 'answer', now: 3 },
      { kind: 'handoffVerified', isOk: false, now: 4 },
      { kind: 'turnComplete', reason: 'answer', now: 5 },
      { kind: 'handoffVerified', isOk: false, now: 6 },
    ])
    expect(r.effects).toEqual(['submitHandoff', 'verifyHandoff', 'submitRetry', 'verifyHandoff'])
    expect(r.effects).not.toContain('clear')
    expect(r.model.state).toBe('awaiting')
  })

  test('a refused /clear falls back to compaction only when allowed', () => {
    const toClearing: AutopilotEvent[] = [ARM, { kind: 'manualHandoff', now: 1 }, { kind: 'handoffStarted', now: 2 }, { kind: 'turnComplete', reason: 'answer', now: 3 }, { kind: 'handoffVerified', isOk: true, now: 4 }]
    const withFallback = run([...toClearing, { kind: 'clearFailed', error: 'refused' }, { kind: 'compactDone', now: 5 }, { kind: 'continuationStarted', now: 6 }])
    expect(withFallback.effects).toEqual(['submitHandoff', 'verifyHandoff', 'clear', 'compact', 'submitContinuation'])
    expect(withFallback.model.state).toBe('armed')
    const noFallback = run([...toClearing, { kind: 'clearFailed', error: 'refused' }], { ...CFG, fallbackToCompact: false })
    expect(noFallback.model.state).toBe('awaiting')
    const fresh = step(noFallback.model, { kind: 'manualFresh', now: 9 }, CFG)
    expect(fresh.effects.map(e => e.kind)).toEqual(['clear'])
  })

  test('compaction is used directly when chosen, and manual mode waits for the person', () => {
    const path: AutopilotEvent[] = [ARM, { kind: 'manualHandoff', now: 1 }, { kind: 'handoffStarted', now: 2 }, { kind: 'turnComplete', reason: 'answer', now: 3 }, { kind: 'handoffVerified', isOk: true, now: 4 }]
    expect(run(path, { ...CFG, continuation: 'compact' }).effects.at(-1)).toBe('compact')
    expect(run(path, { ...CFG, continuation: 'manual' }).model.state).toBe('awaiting')
  })

  test('Claude Code compacting first cancels a pending handoff', () => {
    const r = run([ARM, { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: true, now: 1 }, { kind: 'engineCompacted' }])
    expect(r.model.state).toBe('armed')
  })

  test('snooze waits for further growth', () => {
    const r = run([ARM, { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: true, now: 1 }, { kind: 'snooze', tokens: 710_000, window: 1_000_000 }, { kind: 'context', tokens: 750_000, window: 1_000_000, isInTurn: true, now: 2 }])
    expect(r.model.state).toBe('armed')
    expect(r.model.snoozeUntil).toBe(810_000)
    const later = step(r.model, { kind: 'context', tokens: 811_000, window: 1_000_000, isInTurn: true, now: 3 }, CFG)
    expect(later.model.state).toBe('pending')
  })

  test('the person clearing resets the machine; disabling stops everything', () => {
    const pending = run([ARM, { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: true, now: 1 }]).model
    expect(step(pending, { kind: 'externalClear' }, CFG).model.state).toBe('armed')
    expect(step(pending, { kind: 'configure', enabled: false, threshold: null, isClamped: false }, CFG).model.state).toBe('off')
  })

  test('handoff states are the ones that suspend the guard', () => {
    expect(isHandoffActive('pending')).toBe(true)
    expect(isHandoffActive('handoff')).toBe(true)
    expect(isHandoffActive('armed')).toBe(false)
    expect(isHandoffActive('awaiting')).toBe(false)
  })
})

describe('a reload mid-handoff', () => {
  const armed = () => run([ARM]).model
  const at = (events: AutopilotEvent[]) => run([ARM, ...events]).model
  const crossing: AutopilotEvent = { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: true, now: 1 }

  test('nothing is recorded while plainly watching; a snooze and every handoff step are', () => {
    expect(recordOf(armed(), 'S1', 5)).toBeNull()
    expect(recordOf(initialAutopilot(), 'S1', 5)).toBeNull()
    expect(recordOf(at([crossing]), null, 5)).toBeNull()
    expect(recordOf(at([crossing]), 'S1', 5)?.state).toBe('pending')
    expect(recordOf(at([crossing, { kind: 'snooze', tokens: 710_000, window: 1_000_000 }]), 'S1', 5)?.snoozeUntil).toBe(810_000)
  })

  test('steps that cannot be half-done resume as they were, and the turn under way moves them on', () => {
    for (const events of [[crossing], [crossing, { kind: 'turnComplete', reason: 'answer', now: 2 }, { kind: 'handoffStarted', now: 3 }]] as AutopilotEvent[][]) {
      const before = at(events)
      const back = recover(armed(), recordOf(before, 'S1', 9)!, { sessionId: 'S1' })
      expect(back.model.state).toBe(before.state)
      expect(back.effects).toEqual([])
      expect(back.model.handoffSince).toBe(before.handoffSince)
    }
    // The handoff turn ends after the reload: the notes are checked, not asked for again.
    const handoff = recover(armed(), recordOf(at([crossing, { kind: 'turnComplete', reason: 'answer', now: 2 }, { kind: 'handoffStarted', now: 3 }]), 'S1', 9)!, { sessionId: 'S1' }).model
    expect(step(handoff, { kind: 'turnComplete', reason: 'answer', now: 4 }, CFG).effects.map(e => e.kind)).toEqual(['verifyHandoff'])
    // Context still above the threshold after the reload never starts a second handoff.
    expect(step(handoff, { kind: 'context', tokens: 800_000, window: 1_000_000, isInTurn: true, now: 5 }, CFG).effects).toEqual([])
  })

  test('a check or a clear that was owed is carried out; an unsure step waits for the person', () => {
    const verifying = at([crossing, { kind: 'turnComplete', reason: 'answer', now: 2 }, { kind: 'handoffStarted', now: 3 }, { kind: 'turnComplete', reason: 'answer', now: 4 }])
    expect(recover(armed(), recordOf(verifying, 'S1', 9)!, { sessionId: 'S1' }).effects.map(e => e.kind)).toEqual(['verifyHandoff'])
    const clearing = step(verifying, { kind: 'handoffVerified', isOk: true, now: 5 }, CFG).model
    expect(recover(armed(), recordOf(clearing, 'S1', 9)!, { sessionId: 'S1' }).effects.map(e => e.kind)).toEqual(['clear'])
    // Requested: the handoff prompt may or may not have gone out, so it is not sent again.
    const requested = recover(armed(), recordOf(at([{ ...crossing, isInTurn: false }]), 'S1', 9)!, { sessionId: 'S1' })
    expect(requested.model.state).toBe('awaiting')
    expect(requested.effects.map(e => e.kind)).toEqual(['notify'])
  })

  test('a record from another session, or with Autopilot off, changes nothing', () => {
    const record = recordOf(at([crossing]), 'S1', 9)!
    expect(recover(armed(), record, { sessionId: 'S2' }).model.state).toBe('armed')
    expect(recover(initialAutopilot(), record, { sessionId: 'S1' }).model.state).toBe('off')
    expect(recover(armed(), { ...record, state: 'teleporting' }, { sessionId: 'S1' }).model.state).toBe('armed')
  })
})
