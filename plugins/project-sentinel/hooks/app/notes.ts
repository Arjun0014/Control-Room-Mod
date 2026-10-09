/**
 * What Project Sentinel tells Claude outside the system prompt (a setting
 * changed, the machine is busy, the handoff is coming), and how it gets there
 * without disturbing the prompt cache.
 *
 * Until 1.5.0 these notes were hidden rows appended with `$.session.append`
 * while Claude worked. A row appended while a request is on its way reaches
 * the model at the end of the NEXT request, but the transcript keeps it where
 * it was appended. At the next turn Claude Code builds the conversation from
 * the transcript, the note sits elsewhere, and from that point the prompt no
 * longer matches what was cached: the whole rest of the conversation is
 * written to the cache again, and the API drops every later thinking block
 * (Claude Code records a `thinking_drop` with reason `prefix_mismatch`).
 * Measured on a real session (Opus 5.5, 1-hour cache): rebuilds of 301k and
 * 451k tokens at the first request of a turn, each starting at the first such
 * note; reproduced and fixed through a recording proxy (docs/TROUBLESHOOTING.md).
 *
 * Now a note waits in this box and travels one of two ways, both of which keep
 * the conversation byte-for-byte the same at the next turn:
 *   - while a turn runs, with the next batch of tool results: Claude Code's
 *     own hook context (`classic.PostToolBatch` answering `additionalContext`),
 *     filed with that batch, read on the request that follows it;
 *   - otherwise with the next prompt (`prompt.submit` context), the person's or
 *     Project Sentinel's own.
 * A note never goes out on its own, and nothing is appended to the transcript.
 *
 * Pure bookkeeping: the Runtime decides what to say and hands it over here.
 */

/** What a note is about. A newer note of the same kind replaces a waiting one. */
export type NoteKind = 'policies' | 'pressure' | 'resources' | 'autopilot' | 'settings' | 'queue' | 'answers' | 'budget'

export type Note = {
  kind: NoteKind
  text: string
  /** When it was handed over (the Runtime's clock). */
  at: number
}

/** Which way a note left: with a batch of tool results, or with a prompt. */
export type NoteChannel = 'tool-batch' | 'prompt'

export type DeliveredNote = { kind: NoteKind; at: number; deliveredAt: number; channel: NoteChannel; chars: number }

const DELIVERED_KEPT = 20

export class NoteBox {
  private waiting: Note[] = []
  /** The last notes that went out, newest first (diagnostics). */
  delivered: DeliveredNote[] = []

  /** How many notes are waiting. */
  count(): number {
    return this.waiting.length
  }

  kinds(): NoteKind[] {
    return this.waiting.map(n => n.kind)
  }

  has(kind: NoteKind): boolean {
    return this.waiting.some(n => n.kind === kind)
  }

  /** Hands a note over; one of the same kind still waiting is replaced (only the newest is true). */
  put(note: Note): void {
    this.waiting = [...this.waiting.filter(n => n.kind !== note.kind), note]
  }

  /** Withdraws a waiting note (the machine is no longer busy: neither note needs saying). */
  drop(kind: NoteKind): boolean {
    const before = this.waiting.length
    this.waiting = this.waiting.filter(n => n.kind !== kind)
    return this.waiting.length !== before
  }

  /** A fresh context or a compaction: notes about the old system prompt or the old context mean nothing now. */
  clear(): void {
    this.waiting = []
  }

  /** Everything waiting, in the order it was handed over, marked as gone by `channel`. */
  take(channel: NoteChannel, now: number): Note[] {
    const out = this.waiting
    this.waiting = []
    if (out.length > 0) {
      const sent = out.map(n => ({ kind: n.kind, at: n.at, deliveredAt: now, channel, chars: n.text.length }))
      this.delivered = [...sent.reverse(), ...this.delivered].slice(0, DELIVERED_KEPT)
    }
    return out
  }
}
