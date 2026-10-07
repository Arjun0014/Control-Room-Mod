/**
 * The Resource Governor's live side: runs one sampler for the platform,
 * evaluates pressure against the session's ceilings, and reports level
 * changes. It never touches any process but its own sampler.
 */

import { LIMITS } from '../constants'
import {
  type Ceilings,
  type Pressure,
  UNKNOWN,
  evaluate,
} from '../features/resources/pressure'
import {
  type Platform,
  type ProcStat,
  type Sample,
  cpuBetween,
  macArgv,
  parseMacLine,
  parseMeminfo,
  parseProcStat,
  parseWindowsLine,
  platformOf,
  windowsArgv,
} from '../features/resources/sampler'
import type { Host, SpawnStream } from '../host'

export type MonitorStatus = 'off' | 'starting' | 'live' | 'unavailable'

export class ResourceMonitor {
  status: MonitorStatus = 'off'
  platform: Platform = 'unknown'
  samples: Sample[] = []
  pressure: Pressure = UNKNOWN
  error: string | null = null

  private stream: SpawnStream | null = null
  private timer: { cancel: () => void } | null = null
  private lastProc: ProcStat | null = null
  private generation = 0
  private ceilings: Ceilings | null = null
  private restarts = 0

  constructor(
    private readonly onSample: (pressure: Pressure, previous: Pressure) => void,
    private readonly onStatus: () => void,
  ) {}

  async detectPlatform(host: Host, cwd: string): Promise<Platform> {
    if (this.platform !== 'unknown') return this.platform
    const isWindows = /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('\\\\')
    const hasProcStat = !isWindows && (await host.exists('/proc/stat').catch(() => false))
    const hasMacSystem = !isWindows && !hasProcStat && (await host.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false))
    this.platform = platformOf({ cwd, hasProcStat, hasMacSystem })
    return this.platform
  }

  /** Starts (or restarts) sampling for these ceilings; stops when null. */
  async configure(host: Host, cwd: string, ceilings: Ceilings | null, intervalSec: number): Promise<void> {
    const wasRunning = this.ceilings !== null && this.status !== 'off'
    const sameInterval = this.interval === intervalSec
    this.ceilings = ceilings
    if (ceilings === null) {
      this.stop()
      return
    }
    if (wasRunning && sameInterval && this.status !== 'unavailable') {
      this.reevaluate(Date.now())
      return
    }
    this.stop()
    this.interval = intervalSec
    this.restarts = 0
    await this.start(host, cwd)
  }

  private interval = 5

  private async start(host: Host, cwd: string): Promise<void> {
    const generation = ++this.generation
    this.status = 'starting'
    this.error = null
    this.onStatus()
    const platform = await this.detectPlatform(host, cwd)
    if (generation !== this.generation) return
    if (platform === 'linux') {
      this.timer = host.every(this.interval * 1000, () => void this.readProc(host, generation))
      void this.readProc(host, generation)
      return
    }
    if (platform === 'windows' || platform === 'macos') {
      const argv = platform === 'windows' ? windowsArgv(this.interval) : macArgv(this.interval)
      void this.consume(host, argv, platform, generation, cwd)
      return
    }
    this.fail('unsupported platform: monitoring needs Windows, macOS or Linux')
  }

  private async consume(host: Host, argv: string[], platform: Platform, generation: number, cwd: string): Promise<void> {
    let buffer = ''
    try {
      const stream = host.spawn(argv)
      this.stream = stream
      for await (const chunk of stream) {
        if (generation !== this.generation) break
        if (chunk.stream !== 'stdout') continue
        buffer += chunk.text
        let i: number
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).replace(/\r$/, '')
          buffer = buffer.slice(i + 1)
          const at = Date.now()
          const sample = platform === 'windows' ? parseWindowsLine(line, at) : parseMacLine(line, at)
          if (sample !== null) this.push(sample)
        }
        if (buffer.length > 4096) buffer = buffer.slice(-1024)
      }
      if (generation === this.generation) this.fail('the sampler exited')
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error.message : String(error))
    } finally {
      if (this.stream !== null && generation === this.generation) this.stream = null
    }
    if (generation === this.generation && this.restarts < 2) {
      this.restarts += 1
      this.timer = host.after(15_000, () => {
        if (generation === this.generation && this.ceilings !== null) void this.start(host, cwd)
      })
    }
  }

  private async readProc(host: Host, generation: number): Promise<void> {
    try {
      const [stat, mem] = await Promise.all([host.readText('/proc/stat'), host.readText('/proc/meminfo')])
      if (generation !== this.generation) return
      const proc = parseProcStat(stat)
      const cpu = proc !== null && this.lastProc !== null ? cpuBetween(this.lastProc, proc) : null
      this.lastProc = proc
      if (cpu === null && this.samples.length === 0) return
      this.push({ at: Date.now(), cpu, ram: parseMeminfo(mem) })
    } catch (error) {
      if (generation === this.generation) this.fail(`cannot read /proc: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private push(sample: Sample): void {
    this.samples.push(sample)
    if (this.samples.length > 120) this.samples.splice(0, this.samples.length - 120)
    if (this.status !== 'live') {
      this.status = 'live'
      this.error = null
      this.onStatus()
    }
    this.reevaluate(sample.at)
  }

  reevaluate(now: number): void {
    if (this.ceilings === null) return
    const previous = this.pressure
    this.pressure = evaluate({
      samples: this.samples,
      ceilings: this.ceilings,
      previous,
      now,
      windowMs: Math.max(15_000, this.interval * 3000),
      staleMs: Math.max(LIMITS.sampleStaleMs, this.interval * 4000),
    })
    this.onSample(this.pressure, previous)
  }

  private fail(message: string): void {
    this.status = 'unavailable'
    this.error = message
    this.pressure = UNKNOWN
    this.onStatus()
  }

  stop(): void {
    this.generation += 1
    this.timer?.cancel()
    this.timer = null
    const stream = this.stream
    this.stream = null
    if (stream !== null) void stream.return(undefined as never).catch(() => undefined)
    this.status = 'off'
    this.pressure = UNKNOWN
    this.error = null
    this.lastProc = null
    this.onStatus()
  }

  cpuSeries(n: number): number[] {
    return this.samples.slice(-n).map(s => Math.round(s.cpu ?? 0))
  }

  ramSeries(n: number): number[] {
    return this.samples.slice(-n).map(s => Math.round(s.ram ?? 0))
  }
}
