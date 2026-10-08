/**
 * Resource pressure: machine-wide CPU/RAM against the session's ceilings.
 *
 * CPU is averaged over a short sliding window (spikes are normal, sustained
 * load is the signal); RAM uses the latest reading (it moves slowly and
 * matters as soon as it is high). Levels:
 *   ok        well under the ceilings
 *   elevated  within 10 points of a ceiling
 *   high      at or over a ceiling for two consecutive samples
 *   critical  10+ points over a ceiling, or RAM at 95%+
 */

import type { ResourceEnforcement, ResourceLevel, Settings } from '../../core/settings'
import type { Sample } from './sampler'

export type PressureLevel = 'unknown' | 'ok' | 'elevated' | 'high' | 'critical'

export type Ceilings = { cpu: number; ram: number; maxHeavy: number; enforcement: ResourceEnforcement; level: ResourceLevel }

const PRESETS: Record<Exclude<ResourceLevel, 'off' | 'custom'>, { cpu: number; ram: number; maxHeavy: number }> = {
  low: { cpu: 50, ram: 75, maxHeavy: 1 },
  medium: { cpu: 70, ram: 85, maxHeavy: 2 },
  high: { cpu: 90, ram: 92, maxHeavy: 3 },
}

export function ceilingsOf(r: Settings['resources']): Ceilings | null {
  if (r.level === 'off') return null
  if (r.level === 'custom') {
    const maxHeavy = r.cpu <= 55 ? 1 : r.cpu <= 80 ? 2 : 3
    return { cpu: r.cpu, ram: r.ram, maxHeavy, enforcement: r.enforcement, level: r.level }
  }
  return { ...PRESETS[r.level], enforcement: r.enforcement, level: r.level }
}

export const presetOf = (level: Exclude<ResourceLevel, 'off' | 'custom'>) => PRESETS[level]

export type Pressure = {
  level: PressureLevel
  cpu: number | null
  ram: number | null
  /** Which resource drives the level. */
  driver: 'cpu' | 'ram' | null
  /** Samples over a ceiling in a row (for the 'high' debounce). */
  overStreak: number
}

export const UNKNOWN: Pressure = { level: 'unknown', cpu: null, ram: null, driver: null, overStreak: 0 }

/** CPU averaged over the samples of the last `windowMs`. */
export function windowedCpu(samples: readonly Sample[], now: number, windowMs: number): number | null {
  const recent = samples.filter(s => s.cpu !== null && now - s.at <= windowMs)
  if (recent.length === 0) return null
  return recent.reduce((sum, s) => sum + (s.cpu ?? 0), 0) / recent.length
}

export function evaluate(input: {
  samples: readonly Sample[]
  ceilings: Ceilings
  previous: Pressure
  now: number
  windowMs: number
  staleMs: number
}): Pressure {
  const latest = input.samples.at(-1)
  if (!latest || input.now - latest.at > input.staleMs) return UNKNOWN
  const cpu = windowedCpu(input.samples, input.now, input.windowMs)
  const ram = latest.ram
  const { ceilings } = input
  const cpuOver = cpu === null ? -Infinity : cpu - ceilings.cpu
  const ramOver = ram === null ? -Infinity : ram - ceilings.ram
  const worst = Math.max(cpuOver, ramOver)
  const driver = worst === -Infinity ? null : cpuOver >= ramOver ? 'cpu' : 'ram'
  const isOver = worst >= 0
  const overStreak = isOver ? input.previous.overStreak + 1 : 0
  let level: PressureLevel
  if (worst === -Infinity) level = 'unknown'
  else if (worst >= 10 || (ram !== null && ram >= 95)) level = 'critical'
  else if (isOver && overStreak >= 2) level = 'high'
  else if (worst >= -10) level = 'elevated'
  else level = 'ok'
  return { level, cpu: cpu === null ? null : Math.round(cpu * 10) / 10, ram, driver, overStreak }
}

/** Whether the session is over its ceilings (heavy-job limits apply). */
export const isOver = (p: Pressure): boolean => p.level === 'high' || p.level === 'critical'

export type HeavyGate = { isAllowed: true } | { isAllowed: false; reason: string }

/**
 * Whether one more heavy job may start: `inform` never refuses; `limit`
 * refuses beyond `maxHeavy` running jobs while over a ceiling (and any new
 * heavy job when critical); `strict` refuses any new heavy job while over.
 */
export function gateHeavy(input: { pressure: Pressure; ceilings: Ceilings; running: number }): HeavyGate {
  const { pressure, ceilings, running } = input
  if (ceilings.enforcement === 'inform' || !isOver(pressure)) return { isAllowed: true }
  const over = pressure.driver === 'ram' ? `RAM is over its ${ceilings.ram}% ceiling` : `CPU is over its ${ceilings.cpu}% ceiling`
  if (ceilings.enforcement === 'strict') return { isAllowed: false, reason: `${over} and the policy is strict` }
  if (pressure.level === 'critical' && running >= 1) return { isAllowed: false, reason: `${over} (critical) with heavy work already running` }
  if (running >= ceilings.maxHeavy) return { isAllowed: false, reason: `${over} and ${running} heavy job${running === 1 ? ' is' : 's are'} already running (limit ${ceilings.maxHeavy})` }
  return { isAllowed: true }
}
