/**
 * Context Autopilot as a pure state machine: `step(model, event, config)`
 * returns the next model and the effects the runtime must carry out
 * (append a notice, submit the handoff prompt, run /clear, ...). Keeping the
 * transitions pure makes every path unit-testable without an engine.
 *
 *   off → armed → pending → requested → handoff → verifying → clearing → resuming → armed
 *                                                    ↘ compacting ↗
 *   any failure that cannot be recovered automatically → awaiting (START FRESH CONTEXT)
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

export type AutopilotConfig = {
  continuation: ContinuationMethod
  fallbackToCompact: boolean
  autoContinue: boolean
}

export type AutopilotEvent =
  | { kind: 'configure'; enabled: boolean; threshold: number | null; isClamped: boolean }
  | { kind: 'context'; tokens: number; window: number | undefined; isInTurn: boolean; now: number }
  | { kind: 'turnComplete'; reason: 'answer' | 'aborted' | 'refusal' | 'error'; now: number }
  | { kind: 'handoffStarted'; now: number }
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
      return { model: set(model, { state: 'clearing', note: 'Handoff written — starting a fresh context' }), effects: [{ kind: 'clear' }] }
    case 'compact':
      return { model: set(model, { state: 'compacting', note: 'Handoff written — compacting the context' }), effects: [{ kind: 'compact' }] }
    case 'manual':
      return {
        model: set(model, { state: 'awaiting', note: 'Handoff written — press START FRESH CONTEXT to continue' }),
        effects: [{ kind: 'notify', text: 'Handoff written. Start a fresh context from the Control Room when ready.', level: 'info' }],
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
      return { model: set(next, { state: 'armed', note: 'Armed — watching context' }), effects: none }
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
          model: set(triggered, { state: 'pending', note: 'HANDOFF PENDING — finishing the current unit of work' }),
          effects: [
            { kind: 'appendPending', tokens: event.tokens, threshold: model.threshold, window: event.window },
            { kind: 'notify', text: 'Context threshold reached: finishing the current unit of work, then handing off.', level: 'warn' },
          ],
        }
      }
      return {
        model: set(triggered, { state: 'requested', note: 'Threshold reached between turns — starting the handoff' }),
        effects: [
          { kind: 'submitHandoff' },
          { kind: 'notify', text: 'Context threshold reached: starting the handoff turn.', level: 'warn' },
        ],
      }
    }

    case 'turnComplete': {
      if (model.state === 'pending') {
        if (event.reason === 'aborted') {
          return { model: set(model, { note: 'HANDOFF PENDING — interrupted; handoff waits for the next completed turn' }), effects: none }
        }
        return { model: set(model, { state: 'requested', note: 'Work boundary reached — starting the handoff turn' }), effects: [{ kind: 'submitHandoff' }] }
      }
      if (model.state === 'handoff') {
        if (event.reason === 'aborted') {
          return {
            model: set(model, { state: 'awaiting', note: 'Handoff interrupted — resume it from the Control Room' }),
            effects: [{ kind: 'notify', text: 'Handoff interrupted. Resume it from the Control Room when ready.', level: 'warn' }],
          }
        }
        return { model: set(model, { state: 'verifying', note: 'Checking the handoff notes' }), effects: [{ kind: 'verifyHandoff' }] }
      }
      return { model, effects: none }
    }

    case 'handoffStarted':
      if (model.state !== 'requested') return { model, effects: none }
      return { model: set(model, { state: 'handoff', handoffSince: event.now, note: 'Handoff turn running' }), effects: none }

    case 'handoffVerified': {
      if (model.state !== 'verifying') return { model, effects: none }
      if (event.isOk) return proceedAfterHandoff(set(model, { retries: 0 }), cfg)
      if (model.retries < 1) {
        return {
          model: set(model, { state: 'handoff', retries: model.retries + 1, note: 'Handoff notes missing — asking Claude to write them' }),
          effects: [{ kind: 'submitRetry' }],
        }
      }
      return {
        model: set(model, {
          state: 'awaiting',
          lastError: 'handoff file not written',
          note: 'Handoff notes not found — the context was NOT cleared',
        }),
        effects: [{ kind: 'notify', text: 'Handoff notes were not written, so the context was not cleared. Review and continue manually.', level: 'error' }],
      }
    }

    case 'clearDone':
      if (model.state !== 'clearing') return { model, effects: none }
      if (!cfg.autoContinue) {
        return {
          model: set(model, { state: 'armed', completed: model.completed + 1, triggeredTokens: null, note: 'Fresh context ready — continue when you are' }),
          effects: [{ kind: 'notify', text: 'Fresh context ready. Auto-continue is off.', level: 'info' }],
        }
      }
      return { model: set(model, { state: 'resuming', note: 'Fresh context — resuming the work' }), effects: [{ kind: 'submitContinuation', via: 'clear' }] }

    case 'clearFailed':
      if (model.state !== 'clearing') return { model, effects: none }
      if (cfg.fallbackToCompact) {
        return {
          model: set(model, { state: 'compacting', lastError: event.error, note: '/clear was refused — compacting instead' }),
          effects: [{ kind: 'compact' }, { kind: 'notify', text: `/clear was refused (${event.error}); compacting instead.`, level: 'warn' }],
        }
      }
      return {
        model: set(model, { state: 'awaiting', lastError: event.error, note: '/clear was refused — press START FRESH CONTEXT' }),
        effects: [{ kind: 'notify', text: `Automatic /clear was refused: ${event.error}`, level: 'error' }],
      }

    case 'compactDone':
      if (model.state !== 'compacting') return { model, effects: none }
      if (!cfg.autoContinue) {
        return {
          model: set(model, { state: 'armed', completed: model.completed + 1, triggeredTokens: null, note: 'Context compacted — continue when you are' }),
          effects: none,
        }
      }
      return { model: set(model, { state: 'resuming', note: 'Context compacted — resuming the work' }), effects: [{ kind: 'submitContinuation', via: 'compact' }] }

    case 'compactFailed':
      if (model.state !== 'compacting') return { model, effects: none }
      return {
        model: set(model, { state: 'awaiting', lastError: event.error, note: 'Compaction failed — press START FRESH CONTEXT' }),
        effects: [{ kind: 'notify', text: `Compaction failed: ${event.error}`, level: 'error' }],
      }

    case 'submitFailed':
      if (!BUSY.includes(model.state)) return { model, effects: none }
      return {
        model: set(model, { state: 'awaiting', lastError: event.error, note: 'Could not start the next step automatically' }),
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
          note: 'Armed — continuing in a fresh context',
        }),
        effects: none,
      }

    case 'engineCompacted':
      if (model.state === 'pending' || model.state === 'requested') {
        return { model: set(model, { state: 'armed', note: 'Claude Code compacted the context first — handoff cancelled' }), effects: none }
      }
      return { model, effects: none }

    case 'manualHandoff':
      if (BUSY.includes(model.state)) return { model, effects: none }
      return {
        model: set(model, { state: 'requested', triggeredAt: event.now, retries: 0, lastError: null, note: 'Handoff requested by you' }),
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
          note: 'Armed — new context (cleared by you)',
        }),
        effects: none,
      }
  }
}
