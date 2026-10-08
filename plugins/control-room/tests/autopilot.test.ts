import { describe, expect, test } from 'claude-code/testing'

import { continuationPrompt, handoffPrompt, ownPromptKind } from '../hooks/features/prompts'
import { type Autopilot, type AutopilotConfig, type AutopilotEvent, type TurnKind, handoffPoint, initialAutopilot, isHandoffActive, recordOf, recover, resolveThreshold, roomOf, step } from '../hooks/features/autopilot'

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

/** A turn ending: by default the person's own, answered. */
const ended = (now: number, turn: TurnKind = 'person', reason: 'answer' | 'aborted' = 'answer'): AutopilotEvent => ({ kind: 'turnComplete', reason, turn, now })

describe("Control Room's own turns", () => {
  test("a turn is recognised by its prompt, framed as Claude Code frames a plugin's message or not", () => {
    const handoff = handoffPrompt({ tokens: 77_000, window: 1_000_000, handoffFile: 'NEXT_SESSION_PROMPT.md', runNumber: 1, sessionNumber: 1, planTool: 'mcp__control-room__milestones' })
    // Seen live on 2.1.293: the turn's text is the engine's frame, then the prompt.
    expect(ownPromptKind(`The cr-test plugin sent a message:\n${handoff}`)).toBe('handoff')
    expect(ownPromptKind(`The control-room plugin sent a message:\r\n${handoff}`)).toBe('handoff')
    expect(ownPromptKind(handoff)).toBe('handoff')
    const continuation = continuationPrompt({ sessionNumber: 2, handoffPath: 'C:\\Web UI\\x\\NEXT_SESSION_PROMPT.md' })
    expect(ownPromptKind(`The control-room plugin sent a message:\n${continuation}`)).toBe('continuation')
    // A frame worded otherwise, or on the prompt's own line, still never stalls a handoff.
    expect(ownPromptKind(`[from plugin control-room]\n\n${handoff}`)).toBe('handoff')
    expect(ownPromptKind(`The control-room plugin sent a message: ${handoff}`)).toBe('handoff')
    // The person's own words are the person's, even when they quote the frame.
    expect(ownPromptKind('The control-room plugin sent a message: what does it mean?')).toBeNull()
    expect(ownPromptKind('Please write the final handoff for this context window')).toBeNull()
  })
})

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
      ended(3),
      { kind: 'handoffStarted', now: 4 }, ended(5, 'handoff'),
      { kind: 'handoffVerified', isOk: true, now: 6 },
      { kind: 'clearDone', now: 7 },
      { kind: 'continuationStarted', now: 8 },
    ])
    expect(r.effects).toEqual(['appendPending', 'submitHandoff', 'verifyHandoff', 'clear', 'submitContinuation'])
    expect(r.model.state).toBe('armed')
    expect(r.model.completed).toBe(1)
  })

  test('a fresh context that starts near the threshold gets room to work instead of handing off after every turn', () => {
    // Seen live: a 64k handoff point and a 60k base; session 2 handed off after its first turn.
    const arm: AutopilotEvent = { kind: 'configure', enabled: true, threshold: 64_000, isClamped: false }
    const handoff: AutopilotEvent[] = [
      { kind: 'context', tokens: 66_000, window: 1_000_000, isInTurn: true, now: 1 },
      ended(2),
      { kind: 'handoffStarted', now: 3 }, ended(4, 'handoff'),
      { kind: 'handoffVerified', isOk: true, now: 5 },
      { kind: 'clearDone', now: 6 },
      { kind: 'continuationStarted', now: 7 },
    ]
    const after = run([arm, ...handoff])
    expect(after.model.isFreshContext).toBe(true)
    // The fresh context's first reading: 62k, within 20k of 64k. It hands off at 82k instead, and says so once.
    const first = step(after.model, { kind: 'context', tokens: 62_000, window: 1_000_000, isInTurn: true, now: 8 }, CFG)
    expect(first.model.state).toBe('armed')
    expect(handoffPoint(first.model)).toBe(82_000)
    expect(first.effects.map(e => e.kind)).toEqual(['notify'])
    expect(JSON.stringify(first.effects)).toContain('hands off at 82k')
    const working = run([{ kind: 'context', tokens: 75_000, window: 1_000_000, isInTurn: true, now: 9 }, ended(10)], CFG, first.model)
    expect(working.model.state).toBe('armed')
    expect(working.effects).toEqual([])
    const due = run([{ kind: 'context', tokens: 83_000, window: 1_000_000, isInTurn: true, now: 11 }], CFG, working.model)
    expect(due.model.state).toBe('pending')
    // A fresh context with room to spare keeps the threshold as set, silently.
    const roomy = step(after.model, { kind: 'context', tokens: 30_000, window: 1_000_000, isInTurn: true, now: 8 }, CFG)
    expect(handoffPoint(roomy.model)).toBe(64_000)
    expect(roomy.effects).toEqual([])
    // The room grows with the threshold: a tenth of it, at least 20k.
    expect(roomOf(64_000)).toBe(20_000)
    expect(roomOf(800_000)).toBe(80_000)
    // The first context of a session is not held back (a reload mid-context must not move a due handoff).
    expect(run([arm, { kind: 'context', tokens: 66_000, window: 1_000_000, isInTurn: true, now: 1 }]).model.state).toBe('pending')
  })

  test('below the threshold nothing happens', () => {
    const r = run([ARM, { kind: 'context', tokens: 699_999, window: 1_000_000, isInTurn: true, now: 1 }, ended(2)])
    expect(r.model.state).toBe('armed')
    expect(r.effects).toEqual([])
  })

  test('crossing between turns starts the handoff at once', () => {
    const r = run([ARM, { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: false, now: 1 }])
    expect(r.model.state).toBe('requested')
    expect(r.effects).toEqual(['submitHandoff'])
  })

  test('an interrupted turn does not start the handoff', () => {
    const r = run([ARM, { kind: 'context', tokens: 710_000, window: 1_000_000, isInTurn: true, now: 1 }, ended(2, 'person', 'aborted')])
    expect(r.model.state).toBe('pending')
    expect(r.effects).toEqual(['appendPending'])
  })

  test('a missing handoff file is retried once, then the context is NOT cleared', () => {
    const r = run([
      ARM,
      { kind: 'manualHandoff', now: 1 },
      { kind: 'handoffStarted', now: 2 }, ended(3, 'handoff'),
      { kind: 'handoffVerified', isOk: false, now: 4 },
      ended(5, 'retry'),
      { kind: 'handoffVerified', isOk: false, now: 6 },
    ])
    expect(r.effects).toEqual(['submitHandoff', 'verifyHandoff', 'submitRetry', 'verifyHandoff'])
    expect(r.effects).not.toContain('clear')
    expect(r.model.state).toBe('awaiting')
  })

  test('a refused /clear falls back to compaction only when allowed', () => {
    const toClearing: AutopilotEvent[] = [ARM, { kind: 'manualHandoff', now: 1 }, { kind: 'handoffStarted', now: 2 }, ended(3, 'handoff'), { kind: 'handoffVerified', isOk: true, now: 4 }]
    const withFallback = run([...toClearing, { kind: 'clearFailed', error: 'refused' }, { kind: 'compactDone', now: 5 }, { kind: 'continuationStarted', now: 6 }])
    expect(withFallback.effects).toEqual(['submitHandoff', 'verifyHandoff', 'clear', 'compact', 'submitContinuation'])
    expect(withFallback.model.state).toBe('armed')
    const noFallback = run([...toClearing, { kind: 'clearFailed', error: 'refused' }], { ...CFG, fallbackToCompact: false })
    expect(noFallback.model.state).toBe('awaiting')
    const fresh = step(noFallback.model, { kind: 'manualFresh', now: 9 }, CFG)
    expect(fresh.effects.map(e => e.kind)).toEqual(['clear'])
  })

  test('compaction is used directly when chosen, and manual mode waits for the person', () => {
    const path: AutopilotEvent[] = [ARM, { kind: 'manualHandoff', now: 1 }, { kind: 'handoffStarted', now: 2 }, ended(3, 'handoff'), { kind: 'handoffVerified', isOk: true, now: 4 }]
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

  test('only the handoff turn moves the handoff on: a prompt the person queued in between does not', () => {
    // The person's queued prompt runs first and ends while the handoff prompt waits behind it.
    const requested = run([ARM, { kind: 'manualHandoff', now: 1 }, ended(2, 'person')])
    expect(requested.model.state).toBe('requested')
    expect(requested.effects).toEqual(['submitHandoff'])
    // The handoff turn starts (recognised by its prompt); a person's turn ending meanwhile is not its end.
    const handing = run([{ kind: 'handoffStarted', now: 3 }, ended(4, 'person')], CFG, requested.model)
    expect(handing.model.state).toBe('handoff')
    expect(handing.effects).toEqual([])
    const done = step(handing.model, ended(5, 'handoff'), CFG)
    expect(done.model.state).toBe('verifying')
    expect(done.model.handoffSince).toBe(3)
    // Neither a continuation nor an unrelated turn ends a handoff.
    expect(step(handing.model, ended(6, 'continuation'), CFG).model.state).toBe('handoff')
  })

  test('the handoff starts when its own turn begins, also after a reload left it waiting', () => {
    const awaiting = recover(run([ARM]).model, recordOf(run([ARM, { kind: 'manualHandoff', now: 1 }]).model, 'S1', 2)!, { sessionId: 'S1' }).model
    expect(awaiting.state).toBe('awaiting')
    const started = step(awaiting, { kind: 'handoffStarted', now: 3 }, CFG)
    expect(started.model.state).toBe('handoff')
    expect(started.model.lastError).toBeNull()
    // A handoff turn beginning while nothing was asked for changes nothing.
    expect(step(run([ARM]).model, { kind: 'handoffStarted', now: 4 }, CFG).model.state).toBe('armed')
  })

  test('the person typing in the fresh context first takes over: no continuation is waited for', () => {
    const resuming = run([ARM, { kind: 'manualHandoff', now: 1 }, { kind: 'handoffStarted', now: 2 }, ended(3, 'handoff'), { kind: 'handoffVerified', isOk: true, now: 4 }, { kind: 'clearDone', now: 5 }])
    expect(resuming.model.state).toBe('resuming')
    const taken = step(resuming.model, { kind: 'personTookOver', now: 6 }, CFG)
    expect(taken.model.state).toBe('armed')
    expect(taken.model.completed).toBe(1)
    expect(step(run([ARM]).model, { kind: 'personTookOver', now: 7 }, CFG).model.completed).toBe(0)
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
    for (const events of [[crossing], [crossing, ended(2), { kind: 'handoffStarted', now: 3 }]] as AutopilotEvent[][]) {
      const before = at(events)
      const back = recover(armed(), recordOf(before, 'S1', 9)!, { sessionId: 'S1' })
      expect(back.model.state).toBe(before.state)
      expect(back.effects).toEqual([])
      expect(back.model.handoffSince).toBe(before.handoffSince)
    }
    // The handoff turn ends after the reload (its start was never seen): the notes are checked, not asked for again.
    const handoff = recover(armed(), recordOf(at([crossing, ended(2), { kind: 'handoffStarted', now: 3 }]), 'S1', 9)!, { sessionId: 'S1' }).model
    expect(step(handoff, ended(4, 'unknown'), CFG).effects.map(e => e.kind)).toEqual(['verifyHandoff'])
    // Context still above the threshold after the reload never starts a second handoff.
    expect(step(handoff, { kind: 'context', tokens: 800_000, window: 1_000_000, isInTurn: true, now: 5 }, CFG).effects).toEqual([])
  })

  test('a check or a clear that was owed is carried out; an unsure step waits for the person', () => {
    const verifying = at([crossing, ended(2), { kind: 'handoffStarted', now: 3 }, ended(4, 'handoff')])
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
