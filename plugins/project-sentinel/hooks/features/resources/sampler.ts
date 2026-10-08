/**
 * Host CPU/RAM sampling, lightweight and dependency-free.
 *
 * - Windows: one long-lived PowerShell process. It P/Invokes
 *   GetSystemTimes/GlobalMemoryStatusEx (true interval CPU %, near-zero
 *   steady-state cost) and falls back to CIM queries where Add-Type is not
 *   allowed (constrained language mode). It runs as `-Command` text, which
 *   the execution policy does not govern, so it changes no policy.
 * - macOS: one long-lived `top -l 0` for CPU, plus `sysctl
 *   kern.memorystatus_level` (the kernel's memory-free percentage, i.e.
 *   memory pressure) per sample.
 * - Linux: no process at all — /proc/stat and /proc/meminfo are read on a timer.
 *
 * Only machine-wide aggregates are read: no process lists, names or
 * arguments. Parsers are pure and unit-tested.
 */

export type Platform = 'windows' | 'macos' | 'linux' | 'unknown'

export type Sample = { at: number; cpu: number | null; ram: number | null }

/** Platform from what the session can see: a drive-letter cwd is Windows; /proc is Linux. */
export function platformOf(input: { cwd: string; hasProcStat: boolean; hasMacSystem: boolean }): Platform {
  if (/^[A-Za-z]:[\\/]/.test(input.cwd) || input.cwd.startsWith('\\\\')) return 'windows'
  if (input.hasProcStat) return 'linux'
  if (input.hasMacSystem) return 'macos'
  return 'unknown'
}

/**
 * The samplers report every this many seconds. Their commands are written out in full, as fixed
 * text, at the one place they are started (`spawnSampler` in register.tsx); the monitor takes a
 * reading from them at the interval the person set.
 */
export const SAMPLER_EVERY_SEC = 2

/** One line of the Windows sampler: `P <cpu%> <availBytes> <totalBytes>` or `C <cpu%> <freeKB> <totalKB>`. */
export function parseWindowsLine(line: string, at: number): Sample | null {
  const m = /^([PC])\s+([\d.]+)\s+(\d+)\s+(\d+)\s*$/.exec(line.trim())
  if (!m) return null
  const cpu = Number(m[2])
  const avail = Number(m[3])
  const total = Number(m[4])
  if (!Number.isFinite(cpu) || !(total > 0)) return null
  return { at, cpu: clampPct(cpu), ram: clampPct(100 * (1 - avail / total)) }
}

const lastPhys: { used: number | null } = { used: null }

/** macOS: `M CPU usage: 5.26% user, 10.52% sys, 84.21% idle ## 63` (63 = % memory free). */
export function parseMacLine(line: string, at: number): Sample | null {
  const t = line.trim()
  if (t.startsWith('R ')) {
    lastPhys.used = parsePhysMem(t.slice(2))
    return null
  }
  if (!t.startsWith('M ')) return null
  const idle = /([\d.]+)%\s*idle/.exec(t)
  const cpu = idle ? clampPct(100 - Number(idle[1])) : null
  const freeMatch = /##\s*(\d+)\s*$/.exec(t)
  const ram = freeMatch ? clampPct(100 - Number(freeMatch[1])) : lastPhys.used
  return { at, cpu, ram }
}

/** `PhysMem: 15G used (2588M wired, 1092M compressor), 81M unused.` → used %. */
export function parsePhysMem(text: string): number | null {
  const used = /([\d.]+)([KMGT])\s+used/.exec(text)
  const unused = /([\d.]+)([KMGT])\s+unused/.exec(text)
  if (!used || !unused) return null
  const u = toBytes(Number(used[1]), used[2]!)
  const f = toBytes(Number(unused[1]), unused[2]!)
  return u + f > 0 ? clampPct((100 * u) / (u + f)) : null
}

const toBytes = (n: number, unit: string): number => n * ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[unit] ?? 1)

export type ProcStat = { idle: number; total: number }

/** The aggregate `cpu` line of /proc/stat. */
export function parseProcStat(text: string): ProcStat | null {
  const line = text.split('\n').find(l => l.startsWith('cpu '))
  if (!line) return null
  const n = line.trim().split(/\s+/).slice(1).map(Number)
  if (n.length < 4 || n.some(x => !Number.isFinite(x))) return null
  const idle = (n[3] ?? 0) + (n[4] ?? 0)
  const total = n.slice(0, 8).reduce((a, b) => a + b, 0)
  return { idle, total }
}

export function cpuBetween(a: ProcStat, b: ProcStat): number | null {
  const total = b.total - a.total
  const idle = b.idle - a.idle
  return total > 0 ? clampPct((100 * (total - idle)) / total) : null
}

/** Used % from /proc/meminfo (MemAvailable-based, which counts reclaimable cache as free). */
export function parseMeminfo(text: string): number | null {
  const get = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)
    return m ? Number(m[1]) : null
  }
  const total = get('MemTotal')
  const available = get('MemAvailable') ?? ((get('MemFree') ?? 0) + (get('Cached') ?? 0) + (get('Buffers') ?? 0))
  if (total === null || total <= 0) return null
  return clampPct(100 * (1 - available / total))
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n * 10) / 10))
