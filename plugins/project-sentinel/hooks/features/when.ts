/**
 * When a watcher wakes, from what the person typed: a small strict grammar, never a guess.
 *
 *   in 2h · in 90m · in 1h30m · in 1.5 hours · in 2 hours 15 minutes · in an hour · in half an hour
 *   at 14:00 · at 09:15 · at 21 · at 9am · at 2:30 pm · at noon · tomorrow at 9am · tomorrow 14:00
 *
 * The runtime has no date parser of its own (the mod environment offers `Date` and no locale
 * parsing), and `Date.parse` reads none of these. So this reads exactly these forms and refuses
 * the rest with a reason. A clock time whose hour could be either half of the day (1 to 12, no
 * leading zero, no am or pm) is ambiguous: both readings come back, and the caller asks the
 * person instead of choosing. Times are local; today's time that has passed means tomorrow's,
 * said so in words. At least a minute ahead, at most a week.
 *
 * Pure.
 */

import { clock } from '../core/format'

export const MIN_AHEAD_MS = 60_000
export const MAX_AHEAD_MS = 7 * 24 * 60 * 60_000

export type WhenResult =
  | { kind: 'at'; at: number; words: string }
  | { kind: 'ambiguous'; options: { at: number; label: string }[] }
  /** `isRange`: a time read correctly that is too soon or too far ahead. */
  | { kind: 'error'; message: string; isRange?: boolean }

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  'forty-five': 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
}

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000 }

function unitOf(word: string): 'd' | 'h' | 'm' | null {
  if (/^(d|day|days)$/.test(word)) return 'd'
  if (/^(h|hr|hrs|hour|hours)$/.test(word)) return 'h'
  if (/^(m|min|mins|minute|minutes)$/.test(word)) return 'm'
  return null
}

/** "2h", "1h30m", "1.5 hours", "an hour", "half an hour", "2 hours 15 minutes": milliseconds, or null. */
export function parseDuration(text: string): number | null {
  let t = text.trim().toLowerCase().replace(/\band\b/g, ' ').replace(/,/g, ' ')
  if (t === '') return null
  let total = 0
  // "half an hour", "half a day"
  t = t.replace(/\bhalf an? (hour|day)\b/g, (_, u: string) => {
    total += (u === 'hour' ? UNIT_MS.h! : UNIT_MS.d!) / 2
    return ' '
  })
  // "an hour and a half"
  t = t.replace(/\ba half\b/g, () => {
    total += UNIT_MS.h! / 2
    return ' '
  })
  const re = /(\d+(?:\.\d+)?|[a-z]+(?:-[a-z]+)?)\s*([a-z]+)/g
  let rest = t
  let matched = false
  for (const m of t.matchAll(re)) {
    const amount = /^\d/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!]
    const unit = unitOf(m[2]!)
    if (amount === undefined || !Number.isFinite(amount) || unit === null) return null
    total += amount * UNIT_MS[unit]!
    rest = rest.replace(m[0], ' ')
    matched = true
  }
  if (rest.trim() !== '' || (!matched && total === 0)) return null
  return total > 0 ? Math.round(total) : null
}

/** Today's (or the given day's) local time h:mm. */
function dayAt(now: number, dayOffset: number, hour: number, minute: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, hour, minute, 0, 0).getTime()
}

/** A local time ahead of `now`, said as a person would: "14:00", "tomorrow 09:00", "Sat 09:00". */
export function clockAhead(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86_400_000)
  if (days <= 0) return clock(at)
  if (days === 1) return `tomorrow ${clock(at)}`
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${clock(at)}`
}

/**
 * A countdown to a wake: "42m", "1h 42m", "2d 3h", "under a minute", "now". Minutes round up, as a
 * countdown reads: armed "in 2h", it says 2h until a whole minute has passed.
 */
export function untilWords(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  // To the second first: "in 1m", armed a few milliseconds after it was read, is still a minute.
  const s = Math.round(ms / 1000)
  if (s < 60) return 'under a minute'
  const m = Math.ceil(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** How long ago: "43 minutes ago", "2 hours ago", "just now". */
export function agoWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

function checkRange(at: number, now: number, words: string): WhenResult {
  if (at - now < MIN_AHEAD_MS) return { kind: 'error', message: 'A watcher needs to wake at least a minute from now.', isRange: true }
  if (at - now > MAX_AHEAD_MS) return { kind: 'error', message: 'A watcher wakes within a week.', isRange: true }
  return { kind: 'at', at, words }
}

/**
 * Reads "in 2h", "after 90 minutes", "at 14:00", "tomorrow at 9am" (with or without the leading
 * word for a duration: "2h"). An ambiguous clock time returns both readings, nearest first.
 */
export function parseWhen(text: string, now: number): WhenResult {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b([ap])\.m\.?/g, '$1m')
  if (t === '') return { kind: 'error', message: 'Say when: "in 2h" or "at 14:00".' }

  const rel = /^(?:in|after|for) (.+)$/.exec(t)
  const asDuration = parseDuration(rel === null ? t : rel[1]!)
  if (asDuration !== null) return checkRange(now + asDuration, now, `in ${untilWords(asDuration)}`)
  if (rel !== null) return { kind: 'error', message: `"${text.trim()}" is not a duration I can read: try "in 2h" or "in 90m".` }

  const abs = /^(tomorrow )?(?:at |by |around )?(?:(noon|midday|midnight)|(\d{1,2})(?:[:.h](\d{2}))?(?: ?(am|pm))?)( tomorrow)?$/.exec(t)
  if (abs === null) return { kind: 'error', message: `"${text.trim()}" is not a time I can read: try "in 2h" or "at 14:00".` }
  const isTomorrow = abs[1] !== undefined || abs[6] !== undefined
  let hour: number
  let minute: number
  let isAmbiguous = false
  if (abs[2] !== undefined) {
    hour = abs[2] === 'midnight' ? 0 : 12
    minute = 0
  } else {
    hour = Number(abs[3])
    minute = abs[4] === undefined ? 0 : Number(abs[4])
    const meridiem = abs[5]
    if (minute > 59) return { kind: 'error', message: `"${text.trim()}" is not a time.` }
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) return { kind: 'error', message: `"${text.trim()}" is not a time.` }
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0)
    } else {
      if (hour > 23) return { kind: 'error', message: `"${text.trim()}" is not a time.` }
      // 1 to 12 with no leading zero and no am or pm reads either way: 2:30 is 02:30 or 14:30.
      isAmbiguous = hour >= 1 && hour <= 12 && !abs[3]!.startsWith('0')
    }
  }
  const resolve = (h: number): number => {
    const today = dayAt(now, isTomorrow ? 1 : 0, h, minute)
    return !isTomorrow && today - now < MIN_AHEAD_MS ? dayAt(now, 1, h, minute) : today
  }
  if (isAmbiguous) {
    const morning = hour === 12 ? 0 : hour
    const evening = hour === 12 ? 12 : hour + 12
    const options = [morning, evening]
      .map(h => resolve(h))
      .filter(at => at - now >= MIN_AHEAD_MS && at - now <= MAX_AHEAD_MS)
      .sort((a, b) => a - b)
      .map(at => ({ at, label: `${clockAhead(at, now)} (in ${untilWords(at - now)})` }))
    if (options.length === 1) return { kind: 'at', at: options[0]!.at, words: `at ${clockAhead(options[0]!.at, now)}` }
    return { kind: 'ambiguous', options }
  }
  const at = resolve(hour)
  return checkRange(at, now, `at ${clockAhead(at, now)}`)
}

/**
 * Splits `/cr watch` arguments into when and what: "in 2h S-002 result", "at 14:00 Check the score",
 * "tomorrow at 9am the nightly run". The longest leading phrase that reads as a time wins; the rest
 * is the label. Null when no leading time is found.
 */
export function splitWatchArgs(args: string, now: number): { when: string; label: string; result: WhenResult } | null {
  const words = args.trim().split(/\s+/).filter(Boolean)
  // A time read correctly but out of range ("in 9 days") is said as such, not as no time at all.
  let outOfRange: { when: string; label: string; result: WhenResult } | null = null
  for (let n = Math.min(words.length, 7); n >= 1; n--) {
    const head = words.slice(0, n).join(' ')
    if (!/^(in|after|at|by|around|tomorrow|noon|midnight|\d)/i.test(head)) continue
    const result = parseWhen(head, now)
    if (result.kind === 'error') {
      if (result.isRange === true && outOfRange === null) outOfRange = { when: head, label: words.slice(n).join(' ').trim(), result }
      continue
    }
    return { when: head, label: words.slice(n).join(' ').trim(), result }
  }
  return outOfRange
}

/** "14:05" style labels for the wake's own reading, with the countdown: "14:00 · in 1h 42m". */
export function wakeWords(at: number, now: number): string {
  return `${clockAhead(at, now)} · ${at <= now ? 'due now' : `in ${untilWords(at - now)}`}`
}

