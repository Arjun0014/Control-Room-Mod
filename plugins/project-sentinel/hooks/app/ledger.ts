/**
 * The policy ledger: evidence, request by request, that what the person set
 * in Control Room reached Claude. Not "the setting is on", but for each model
 * request of the main conversation: whether the system prompt's composition
 * reached Project Sentinel's hook, the fingerprint of the section it carried,
 * whether Frontier Max was in it, how the policies travelled (the system
 * prompt's section, a note while the cached section is held, or a prompt's
 * context where the hook is never reached), and the model and effort the
 * request was sent with.
 *
 * Fingerprints and flags only: no prompt text is kept. Module memory, reset
 * with each fresh context; the debug log gets one line per request.
 */

import { fingerprint } from '../core/hash'

/** One composition of the system prompt that reached the hook (renders that only measure, such as /context, are left out). */
export type PolicyRender = {
  at: number
  /** Fingerprint of Project Sentinel's section as sent; null when it sent none. */
  hash: string | null
  /** The section's headings ("Frontier Max", "Context Autopilot"). */
  sections: string[]
  frontier: boolean
  /** The effort the Frontier section names, or null. */
  effortLine: string | null
  /** The section as the system prompt already carried it (Keep policies stable), not as the settings now say. */
  isHeld: boolean
  /** The settings were loaded from the store when it was composed (never defaults by accident). */
  isLoaded: boolean
}

/** How the policies reached a request: its system prompt, its held system prompt plus a note, a prompt's context, or not at all. */
export type DeliveryMethod = 'system' | 'held+note' | 'held' | 'context' | 'none'

export type RequestRecord = {
  /** The request's number in this context, from 1. */
  n: number
  at: number
  sessionId: string | null
  turnId: string
  step: number
  model: string
  /** The effort the request was sent with; null for a model that takes none. */
  effort: string | null
  /** What Frontier Max asked for; null when it asked nothing. */
  effortAsked: string | null
  compose: PolicyRender | null
  method: DeliveryMethod
  frontierOn: boolean
  /** Claude reads Frontier Max as in force for this request (its section, or a note that says so). */
  frontierDelivered: boolean
  /** Frontier Max is off, yet Claude still reads it in force (a held section no note has corrected yet). */
  frontierStale: boolean
}

export type FrontierDelivery = {
  isOn: boolean
  /**
   * delivered: the latest request carried it (system section, or a note while the section is held);
   * waiting: on, no request since (a fresh context, or turned on while idle); missing: requests went
   * out without it; stale: off, yet Claude may still read it (the held section, until the note goes);
   * off: off and not in force.
   */
  state: 'delivered' | 'waiting' | 'missing' | 'stale' | 'off'
  method: DeliveryMethod | null
  /** Whether this context's first request carried it; null before the first request. */
  isFirstRequest: boolean | null
  lastAt: number | null
  effort: string | null
  effortAsked: string | null
  requests: number
}

const KEPT = 30
/** A composition this long before a request is not that request's. */
const RENDER_FRESH_MS = 120_000

export function policyRenderOf(text: string | null, input: { at: number; isHeld: boolean; isLoaded: boolean }): PolicyRender {
  const sections = text === null ? [] : (text.match(/^## .+$/gm) ?? []).map(s => s.replace(/^## /, '').replace(/\s*\((Control Room|Project Sentinel)\)\s*$/, '').trim())
  const effort = text === null ? null : (text.match(/Reasoning effort for this session is set to ([^;]+);/)?.[1] ?? null)
  return {
    at: input.at,
    hash: text === null ? null : fingerprint(text),
    sections,
    frontier: sections.some(s => s.startsWith('Frontier Max')),
    effortLine: effort === 'the maximum the model supports' ? 'max' : effort,
    isHeld: input.isHeld,
    isLoaded: input.isLoaded,
  }
}

type Open = { key: string; at: number; turnId: string; step: number; model: string; effort: string | null; effortAsked: string | null; compose: PolicyRender | null }

export class PolicyLedger {
  /** Newest first. */
  records: RequestRecord[] = []
  private count = 0
  private pending: PolicyRender | null = null
  private open: Open | null = null
  /** The last note about the policies that went out in this context (held sections): whether it put Frontier Max in force. */
  private note: { at: number; frontier: boolean } | null = null
  /** The policies as a prompt's context, where the system prompt's hook is never reached. */
  private fallback: { at: number; frontier: boolean } | null = null

  /** A fresh context: its system prompt is composed afresh, and nothing said before counts. */
  reset(): void {
    this.records = []
    this.first = null
    this.count = 0
    this.pending = null
    this.current = null
    this.open = null
    this.note = null
    this.fallback = null
  }

  /**
   * After a reload of the plugin in the same context: the system prompt already in force, as the
   * runtime before this one composed it. A turn under way keeps sending it with no composition this
   * runtime sees (seen live: a reload mid-handoff, the next request carried the section unchanged).
   */
  carried(render: PolicyRender): void {
    if (this.current === null) this.current = render
  }

  /** A composition that reached the hook: it belongs to the request under way, or to the next one. */
  rendered(render: PolicyRender): void {
    this.current = render
    if (this.open !== null && this.open.compose === null) this.open = { ...this.open, compose: render }
    else this.pending = render
  }

  /**
   * The system prompt in force: the last composition. Claude Code composes it once for a turn and
   * sends it again with each request of the turn (seen live: the second request of a turn carried
   * the section with no new composition), so a request with no composition of its own carries this.
   */
  private current: PolicyRender | null = null

  /** A main-thread request is about to go out. */
  stepStarted(input: { key: string; at: number; turnId: string; step: number; model: string; effort: string | null; effortAsked: string | null }): void {
    const fresh = this.pending !== null && input.at - this.pending.at <= RENDER_FRESH_MS ? this.pending : null
    this.pending = null
    this.open = { ...input, compose: fresh ?? this.current }
  }

  /** A note telling Claude which policies apply went out (the system prompt's section is held). */
  noteDelivered(at: number, frontier: boolean): void {
    this.note = { at, frontier }
  }

  /** The policies went out as a prompt's context (the system prompt's hook is not reached here). */
  fallbackDelivered(at: number, frontier: boolean): void {
    this.fallback = { at, frontier }
  }

  /** The request's answer came: its record, with how the policies reached it. */
  stepEnded(key: string, input: { sessionId: string | null; frontierOn: boolean }): RequestRecord | null {
    const o = this.open
    if (o === null || o.key !== key) return null
    this.open = null
    const c = o.compose
    let method: DeliveryMethod
    let frontierInForce: boolean
    if (c !== null && c.hash !== null) {
      const isNoteNewer = this.note !== null && c.isHeld
      method = c.isHeld ? (isNoteNewer ? 'held+note' : 'held') : 'system'
      frontierInForce = isNoteNewer && this.note !== null ? this.note.frontier : c.frontier
    } else if (this.fallback !== null) {
      method = 'context'
      frontierInForce = this.fallback.frontier
    } else {
      method = 'none'
      frontierInForce = false
    }
    this.count += 1
    const record: RequestRecord = {
      n: this.count,
      at: o.at,
      sessionId: input.sessionId,
      turnId: o.turnId,
      step: o.step,
      model: o.model,
      effort: o.effort,
      effortAsked: o.effortAsked,
      compose: c,
      method,
      frontierOn: input.frontierOn,
      frontierDelivered: input.frontierOn && frontierInForce,
      frontierStale: !input.frontierOn && frontierInForce,
    }
    this.records = [record, ...this.records].slice(0, KEPT)
    if (record.n === 1) this.first = record
    return record
  }

  /** This context's first request, kept beyond the window: whether the policies were there from the start. */
  first: RequestRecord | null = null

  /** Frontier Max as Claude has it now, from the requests of this context. */
  frontier(isOn: boolean): FrontierDelivery {
    const last = this.records[0] ?? null
    const first = this.first
    const base = {
      isOn,
      method: last?.method ?? null,
      isFirstRequest: first === null || !first.frontierOn ? null : first.frontierDelivered,
      lastAt: last?.at ?? null,
      effort: last?.effort ?? null,
      effortAsked: last?.effortAsked ?? null,
      requests: this.count,
    }
    if (!isOn) {
      // A note that Frontier Max is off may still be waiting while the held section says it is on.
      const isStale = last !== null && last.frontierStale
      return { ...base, state: isStale ? 'stale' : 'off' }
    }
    if (last === null || !last.frontierOn) return { ...base, state: 'waiting' }
    return { ...base, state: last.frontierDelivered ? 'delivered' : 'missing' }
  }
}

/** One request in a line, for the debug log and /cr diagnostics. */
export function recordLine(r: RequestRecord): string {
  const c = r.compose
  const section = c === null ? 'system prompt hook not reached' : c.hash === null ? 'no Project Sentinel section' : `section ${c.hash}${c.isHeld ? ' (held)' : ''} [${c.sections.join(', ') || 'none'}]`
  const frontier = r.frontierOn ? (r.frontierDelivered ? 'Frontier Max delivered' : 'Frontier Max NOT delivered') : r.frontierStale ? 'Frontier Max off, still in force until its note goes' : 'Frontier Max off'
  const effort = r.effort === null ? 'no effort (the model takes none)' : `effort ${r.effort}${r.effortAsked !== null && r.effortAsked !== r.effort ? ` (asked ${r.effortAsked})` : ''}`
  const loaded = c !== null && !c.isLoaded ? ' · SETTINGS NOT LOADED' : ''
  return `request ${r.n} · turn ${r.turnId.slice(0, 8)} step ${r.step} · ${section} · via ${r.method} · ${frontier} · ${r.model} · ${effort}${loaded}`
}
