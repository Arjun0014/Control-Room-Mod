/**
 * Context Autopilot as a pure state machine: `step(model, event, config)`
 * returns the next model and the effects the runtime must carry out
 * (append a notice, submit the handoff prompt, run /clear, ...). Keeping the
 * transitions pure makes every path unit-testable without an engine.
 *
 *   off → armed → pending → requested → handoff → verifying → clearing → resuming → armed
 *                                                    ↘ compacting ↗
 *   any failure that cannot be recovered automatically → awaiting (START FRESH CONTEXT)
 *
 * Every step is moved on by an event, never by a timer: the turn that crossed
 * the threshold ending, the handoff turn starting (recognised by its prompt)
 * and ending, the notes checked on disk, the fresh session reported, the
 * continuation turn starting. A turn that is not Control Room's own (a prompt
 * the person queued) never moves a handoff step on.
 */

import type { ContinuationMethod } from '../core/settings'

export type AutopilotState =
  | 'off'
  | 'armed'
  | 'pending'
  | 'requested'
  | 'handoff'
  | 'verifying'
  | 'clearing'
  | 'compacting'
  | 'resuming'
  | 'awaiting'

export type Autopilot = {
  state: AutopilotState
  /** The effective threshold in tokens, or null while the window is unknown. */
  threshold: number | null
  /** True when the threshold was lowered under Claude Code's own auto-compact point. */
  isClamped: boolean
  triggeredTokens: number | null
  triggeredAt: number | null
  /** When the handoff prompt was submitted: the handoff file must be newer. */
  handoffSince: number | null
  retries: number
  /** Do not trigger again until the context passes this many tokens. */
  snoozeUntil: number | null
  /** Handoffs completed in this process (each one a new session in the chain). */
  completed: number
  /** One human-readable line describing what the autopilot is doing. */
  note: string
  lastError: string | null
}

/**
 * Whose turn it is: the person's, Control Room's own handoff, retry or
 * continuation, another (no typed prompt), or unknown (it began before a
 * reload of the plugin, so its start was never seen).
 */
export type TurnKind = 'person' | 'handoff' | 'retry' | 'continuation' | 'other' | 'unknown'

/** A turn that may be the handoff's: its own, or one whose start a reload hid (the handoff carried on across it). */
const isHandoffTurn = (turn: TurnKind): boolean => turn === 'handoff' || turn === 'retry' || turn === 'unknown'

export type AutopilotConfig = {
  continuation: ContinuationMethod
  fallbackToCompact: boolean
  autoContinue: boolean
}

export type AutopilotEvent =
  | { kind: 'configure'; enabled: boolean; threshold: number | null; isClamped: boolean }
  | { kind: 'context'; tokens: number; window: number | undefined; isInTurn: boolean; now: number }
  | { kind: 'turnComplete'; reason: 'answer' | 'aborted' | 'refusal' | 'error'; turn: TurnKind; now: number }
  /** The handoff prompt's turn began (recognised by its text at turn.start). */
  | { kind: 'handoffStarted'; now: number }
  /** The person started a turn of their own while the fresh context waited for the continuation. */
  | { kind: 'personTookOver'; now: number }
  | { kind: 'handoffVerified'; isOk: boolean; now: number }
  | { kind: 'clearDone'; now: number }
  | { kind: 'clearFailed'; error: string }
  | { kind: 'compactDone'; now: number }
  | { kind: 'compactFailed'; error: string }
  | { kind: 'submitFailed'; error: string }
  | { kind: 'continuationStarted'; now: number }
  | { kind: 'engineCompacted' }
  | { kind: 'manualHandoff'; now: number }
  | { kind: 'manualFresh'; now: number }
  | { kind: 'snooze'; tokens: number; window: number | undefined }
  | { kind: 'externalClear' }

export type AutopilotEffect =
  | { kind: 'appendPending'; tokens: number; threshold: number; window: number | undefined }
  | { kind: 'submitHandoff' }
  | { kind: 'submitRetry' }
  | { kind: 'verifyHandoff' }
  | { kind: 'clear' }
  | { kind: 'compact' }
  | { kind: 'submitContinuation'; via: 'clear' | 'compact' }
  | { kind: 'notify'; text: string; level: 'info' | 'warn' | 'error' }

export type Step = { model: Autopilot; effects: AutopilotEffect[] }

export function initialAutopilot(): Autopilot {
  return {
    state: 'off',
    threshold: null,
    isClamped: false,
    triggeredTokens: null,
    triggeredAt: null,
    handoffSince: null,
    retries: 0,
    snoozeUntil: null,
    completed: 0,
    note: 'Off',
    lastError: null,
  }
}

/**
 * The effective threshold: tokens as set, or a percentage of the live
 * window; kept below Claude Code's auto-compact point when that is known,
 * so the handoff runs before the engine compacts on its own.
 */
export function resolveThreshold(input: {
  mode: 'tokens' | 'percent'
  tokens: number
  percent: number
  window: number | undefined
  autoCompactAt: number | undefined
}): { threshold: number | null; isClamped: boolean } {
  let threshold: number | null =
    input.mode === 'tokens'
      ? input.tokens
      : input.window === undefined
        ? null
        : Math.round((input.window * input.percent) / 100)
  if (threshold !== null && input.window !== undefined) threshold = Math.min(threshold, Math.round(input.window * 0.97))
  let isClamped = false
  if (threshold !== null && input.autoCompactAt !== undefined && input.autoCompactAt > 0) {
    const margin = input.window === undefined ? 20_000 : Math.round(input.window * 0.05)
    const ceiling = Math.max(10_000, input.autoCompactAt - margin)
    if (threshold > ceiling) {
      threshold = ceiling
      isClamped = true
    }
  }
  return { threshold, isClamped }
}

const BUSY: readonly AutopilotState[] = ['requested', 'handoff', 'verifying', 'clearing', 'compacting', 'resuming']

/** States in which the autopilot wants Claude to stop rather than continue. */
export const isHandoffActive = (state: AutopilotState): boolean =>
  state === 'pending' || BUSY.includes(state)

const set = (model: Autopilot, patch: Partial<Autopilot>): Autopilot => ({ ...model, ...patch })

function proceedAfterHandoff(model: Autopilot, cfg: AutopilotConfig): Step {
  switch (cfg.continuation) {
    case 'clear':
      return { model: set(model, { state: 'clearing', note: 'Handoff written. Starting a fresh context' }), effects: [{ kind: 'clear' }] }
    case 'compact':
      return { model: set(model, { state: 'compacting', note: 'Handoff written. Compacting the context' }), effects: [{ kind: 'compact' }] }
    case 'manual':
      return {
        model: set(model, { state: 'awaiting', note: 'Handoff written. Start fresh when you’re ready' }),
        effects: [{ kind: 'notify', text: 'Handoff written. Start the fresh context from Control Room when you’re ready.', level: 'info' }],
      }
  }
}

// ---------------------------------------------------------------------------
// Surviving a reload

/** The handoff in flight, as `$.state` keeps it (see AutopilotRecord in the type contract). */
export type AutopilotRecord = {
  sessionId: string
  state: string
  triggeredTokens: number | null
  triggeredAt: number | null
  handoffSince: number | null
  retries: number
  snoozeUntil: number | null
  lastError: string | null
  note: string
  at: number
}

const STATES: readonly AutopilotState[] = ['off', 'armed', 'pending', 'requested', 'handoff', 'verifying', 'clearing', 'compacting', 'resuming', 'awaiting']

/**
 * What must outlive a reload: nothing while plainly watching, the handoff's
 * place while one is under way or waiting, a snooze while it holds.
 */
export function recordOf(model: Autopilot, sessionId: string | null, now: number): AutopilotRecord | null {
  if (sessionId === null || model.state === 'off') return null
  if (model.state === 'armed' && model.snoozeUntil === null) return null
  return {
    sessionId,
    state: model.state,
    triggeredTokens: model.triggeredTokens,
    triggeredAt: model.triggeredAt,
    handoffSince: model.handoffSince,
    retries: model.retries,
    snoozeUntil: model.snoozeUntil,
    lastError: model.lastError,
    note: model.note,
    at: now,
  }
}

/**
 * A fresh runtime after a reload picks the handoff up where the record left
 * it, and never starts a second one. Where the record cannot tell whether a
 * step already happened (a prompt about to be sent, a compaction), it waits
 * for the person instead of repeating the step.
 *
 * `model` is the freshly configured machine (armed, or off when disabled).
 */
export function recover(model: Autopilot, record: AutopilotRecord, ctx: { sessionId: string | null }): Step {
  const none: AutopilotEffect[] = []
  const state = STATES.find(s => s === record.state)
  if (model.state === 'off' || state === undefined || record.sessionId !== ctx.sessionId) return { model, effects: none }
  const kept = set(model, {
    triggeredTokens: record.triggeredTokens,
    triggeredAt: record.triggeredAt,
    handoffSince: record.handoffSince,
    retries: record.retries,
    snoozeUntil: record.snoozeUntil,
    lastError: record.lastError,
  })
  switch (state) {
    case 'off':
      return { model, effects: none }
    case 'armed':
      return { model: set(kept, { state: 'armed', note: record.snoozeUntil === null ? model.note : 'Snoozed until the context grows further' }), effects: none }
    case 'pending':
    case 'handoff':
    case 'awaiting':
      // Nothing was left half-done: the turn under way (or the person) moves it on.
      return { model: set(kept, { state, note: record.note }), effects: none }
    case 'verifying':
      return { model: set(kept, { state: 'verifying', note: 'Checking the handoff notes' }), effects: [{ kind: 'verifyHandoff' }] }
    case 'clearing':
      // The notes were verified and the context is still this session's: the clear is still owed.
      return { model: set(kept, { state: 'clearing', note: 'Handoff written. Starting a fresh context' }), effects: [{ kind: 'clear' }] }
    case 'requested':
    case 'compacting':
      return {
        model: set(kept, { state: 'awaiting', note: state === 'requested' ? 'A reload interrupted the handoff. Hand off when you’re ready' : 'A reload interrupted compaction. Start fresh when you’re ready' }),
        effects: [{ kind: 'notify', text: 'Control Room reloaded in the middle of a handoff, so Autopilot waits for you instead of repeating a step.', level: 'warn' }],
      }
    case 'resuming':
      return {
        model: set(kept, { state: 'armed', completed: model.completed + 1, triggeredTokens: null, triggeredAt: null, handoffSince: null, note: 'Watching the context' }),
        effects: [{ kind: 'notify', text: 'Control Room reloaded as the fresh context began. If Claude is idle, ask it to continue from the handoff notes.', level: 'info' }],
      }
  }
}

export function step(model: Autopilot, event: AutopilotEvent, cfg: AutopilotConfig): Step {
  const none: AutopilotEffect[] = []

  if (event.kind === 'configure') {
    if (!event.enabled) {
      return { model: set(initialAutopilot(), { completed: model.completed, note: 'Off' }), effects: none }
    }
    const next = set(model, { threshold: event.threshold, isClamped: event.isClamped })
    if (model.state === 'off') {
      return { model: set(next, { state: 'armed', note: 'Watching the context' }), effects: none }
    }
    return { model: next, effects: none }
  }

  if (model.state === 'off') return { model, effects: none }

  switch (event.kind) {
    case 'context': {
      if (model.state !== 'armed' || model.threshold === null) return { model, effects: none }
      if (model.snoozeUntil !== null && event.tokens < model.snoozeUntil) return { model, effects: none }
      if (event.tokens < model.threshold) return { model, effects: none }
      const triggered = set(model, {
        triggeredTokens: event.tokens,
        triggeredAt: event.now,
        retries: 0,
        lastError: null,
        snoozeUntil: null,
      })
      if (event.isInTurn) {
        return {
          model: set(triggered, { state: 'pending', note: 'Finishing the current step, then handing off' }),
          effects: [
            { kind: 'appendPending', tokens: event.tokens, threshold: model.threshold, window: event.window },
            { kind: 'notify', text: 'Context reached the handoff point. Claude finishes the current step, then hands off.', level: 'warn' },
          ],
        }
      }
      return {
        model: set(triggered, { state: 'requested', note: 'Threshold reached. Starting the handoff' }),
        effects: [
          { kind: 'submitHandoff' },
          { kind: 'notify', text: 'Context reached the handoff point. Claude is writing the handoff notes.', level: 'warn' },
        ],
      }
    }

    case 'turnComplete': {
      if (model.state === 'pending') {
        if (event.reason === 'aborted') {
          return { model: set(model, { note: 'Interrupted. The handoff waits for the next finished turn' }), effects: none }
        }
        return { model: set(model, { state: 'requested', note: 'Step finished. Starting the handoff' }), effects: [{ kind: 'submitHandoff' }] }
      }
      // Only the handoff turn's own end moves the handoff on; a turn the person queued before it does not.
      if (model.state === 'handoff' && isHandoffTurn(event.turn)) {
        if (event.reason === 'aborted') {
          return {
            model: set(model, { state: 'awaiting', note: 'Handoff interrupted. Resume it when you’re ready' }),
            effects: [{ kind: 'notify', text: 'Handoff interrupted. Resume it from Control Room when you’re ready.', level: 'warn' }],
          }
        }
        return { model: set(model, { state: 'verifying', note: 'Checking the handoff notes' }), effects: [{ kind: 'verifyHandoff' }] }
      }
      return { model, effects: none }
    }

    case 'handoffStarted':
      // From awaiting too: a reload left the handoff waiting, then its prompt's turn began after all.
      if (model.state !== 'requested' && model.state !== 'awaiting') return { model, effects: none }
      return { model: set(model, { state: 'handoff', handoffSince: event.now, lastError: null, note: 'Claude is writing the handoff' }), effects: none }

    case 'personTookOver':
      if (model.state !== 'resuming') return { model, effects: none }
      return {
        model: set(model, { state: 'armed', completed: model.completed + 1, triggeredTokens: null, triggeredAt: null, handoffSince: null, note: 'Watching the context' }),
        effects: none,
      }

    case 'handoffVerified': {
      if (model.state !== 'verifying') return { model, effects: none }
      if (event.isOk) return proceedAfterHandoff(set(model, { retries: 0 }), cfg)
      if (model.retries < 1) {
        return {
          model: set(model, { state: 'handoff', retries: model.retries + 1, note: 'Notes missing. Asking Claude to write them' }),
          effects: [{ kind: 'submitRetry' }],
        }
      }
      return {
        model: set(model, {
          state: 'awaiting',
          lastError: 'handoff file not written',
          note: 'No handoff notes found, so the context was kept',
        }),
        effects: [{ kind: 'notify', text: 'No handoff notes were written, so the context was kept. Check the work and continue by hand.', level: 'error' }],
      }
    }

    case 'clearDone':
      if (model.state !== 'clearing') return { model, effects: none }
      if (!cfg.autoContinue) {
        return {
          model: set(model, { state: 'armed', completed: model.completed + 1, triggeredTokens: null, note: 'Fresh context ready. Continue when you are' }),
          effects: [{ kind: 'notify', text: 'Fresh context ready. Carry on by itself is off, so Claude waits for you.', level: 'info' }],
        }
      }
      return { model: set(model, { state: 'resuming', note: 'Continuing in the fresh context' }), effects: [{ kind: 'submitContinuation', via: 'clear' }] }

    case 'clearFailed':
      if (model.state !== 'clearing') return { model, effects: none }
      if (cfg.fallbackToCompact) {
        return {
          model: set(model, { state: 'compacting', lastError: event.error, note: 'Clearing was refused. Compacting instead' }),
          effects: [{ kind: 'compact' }, { kind: 'notify', text: `Clearing was refused (${event.error}), so the context is compacted instead.`, level: 'warn' }],
        }
      }
      return {
        model: set(model, { state: 'awaiting', lastError: event.error, note: 'Clearing was refused. Start fresh when you’re ready' }),
        effects: [{ kind: 'notify', text: `Clearing was refused: ${event.error}`, level: 'error' }],
      }

    case 'compactDone':
      if (model.state !== 'compacting') return { model, effects: none }
      if (!cfg.autoContinue) {
        return {
          model: set(model, { state: 'armed', completed: model.completed + 1, triggeredTokens: null, note: 'Context compacted. Continue when you are' }),
          effects: none,
        }
      }
      return { model: set(model, { state: 'resuming', note: 'Context compacted. Continuing the work' }), effects: [{ kind: 'submitContinuation', via: 'compact' }] }

    case 'compactFailed':
      if (model.state !== 'compacting') return { model, effects: none }
      return {
        model: set(model, { state: 'awaiting', lastError: event.error, note: 'Compaction failed. Start fresh when you’re ready' }),
        effects: [{ kind: 'notify', text: `Compaction failed: ${event.error}`, level: 'error' }],
      }

    case 'submitFailed':
      if (!BUSY.includes(model.state)) return { model, effects: none }
      return {
        model: set(model, { state: 'awaiting', lastError: event.error, note: 'Couldn’t continue automatically' }),
        effects: [{ kind: 'notify', text: `Autopilot could not continue: ${event.error}`, level: 'error' }],
      }

    case 'continuationStarted':
      if (model.state !== 'resuming') return { model, effects: none }
      return {
        model: set(model, {
          state: 'armed',
          completed: model.completed + 1,
          triggeredTokens: null,
          triggeredAt: null,
          handoffSince: null,
          note: 'Watching the context',
        }),
        effects: none,
      }

    case 'engineCompacted':
      if (model.state === 'pending' || model.state === 'requested') {
        return { model: set(model, { state: 'armed', note: 'Claude Code compacted first, so no handoff was needed' }), effects: none }
      }
      return { model, effects: none }

    case 'manualHandoff':
      if (BUSY.includes(model.state)) return { model, effects: none }
      return {
        model: set(model, { state: 'requested', triggeredAt: event.now, retries: 0, lastError: null, note: 'Handoff requested' }),
        effects: [{ kind: 'submitHandoff' }],
      }

    case 'manualFresh':
      if (model.state === 'clearing' || model.state === 'compacting' || model.state === 'resuming') return { model, effects: none }
      return { model: set(model, { state: 'clearing', lastError: null, note: 'Starting a fresh context' }), effects: [{ kind: 'clear' }] }

    case 'snooze': {
      const margin = event.window === undefined ? 50_000 : Math.round(event.window * 0.1)
      if (model.state !== 'pending' && model.state !== 'awaiting') return { model, effects: none }
      return {
        model: set(model, { state: 'armed', snoozeUntil: event.tokens + margin, note: 'Snoozed until the context grows further' }),
        effects: none,
      }
    }

    case 'externalClear':
      return {
        model: set(model, {
          state: 'armed',
          triggeredTokens: null,
          triggeredAt: null,
          handoffSince: null,
          snoozeUntil: null,
          retries: 0,
          note: 'Watching the context',
        }),
        effects: none,
      }
  }
}
