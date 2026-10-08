/**
 * Host CPU/RAM sampling, lightweight and dependency-free. Each sampler is one
 * program, named and given fixed arguments where it is started (`hostOf` in
 * register.tsx), never a shell:
 *
 * - Windows: one long-lived `typeperf` (Windows' own performance-counter
 *   reader) for the processor time and the available memory, every
 *   SAMPLER_EVERY_SEC; the machine's total memory comes once from
 *   `systeminfo`. Counter paths are English, as Windows names them in an
 *   English install; where the install names them in another language,
 *   `typeperf` finds none and machine load reads "unavailable".
 * - macOS: one long-lived `top -l 0` for CPU, plus `sysctl -n
 *   kern.memorystatus_level` (the kernel's memory-free percentage, i.e.
 *   memory pressure) per reading.
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

/**
 * One line of `typeperf`'s CSV on Windows: `"<time>","<CPU %>","<available bytes>"`. Its header,
 * its closing words and a missed sample (a blank value) read as null. Memory needs the machine's
 * total, from `systeminfo` (null while unknown: the line then gives the CPU alone).
 */
export function parseTypeperfLine(line: string, at: number, totalBytes: number | null): Sample | null {
  const cells = csvCells(line)
  if (cells.length < 3) return null
  const cpu = decimal(cells[1]!)
  if (cpu === null) return null
  const available = decimal(cells[2]!)
  const ram = totalBytes !== null && totalBytes > 0 && available !== null ? clampPct(100 * (1 - available / totalBytes)) : null
  return { at, cpu: clampPct(cpu), ram }
}

/**
 * The machine's physical memory in bytes, from `systeminfo /fo csv /nh`: its 23rd field, Total
 * Physical Memory, in megabytes grouped as the locale writes numbers (`11,642 MB`, `11.642 MB`).
 */
export function parseSysteminfoTotal(stdout: string): number | null {
  const line = stdout.split('\n').find(l => l.trim() !== '')
  const field = line === undefined ? undefined : csvCells(line)[22]
  const digits = field?.replace(/\D/g, '') ?? ''
  const mb = digits === '' ? NaN : Number(digits)
  return Number.isFinite(mb) && mb >= 64 && mb <= 64 * 1024 * 1024 ? mb * 1024 * 1024 : null
}

/** macOS `top -l`: the CPU in use, from its `CPU usage: 5.26% user, 10.52% sys, 84.21% idle` line; null for any other line. */
export function cpuOfTopLine(line: string): number | null {
  const t = line.trim()
  if (!t.startsWith('CPU usage:')) return null
  const idle = /([\d.]+)%\s*idle/.exec(t)
  return idle ? clampPct(100 - Number(idle[1])) : null
}

/** macOS: memory in use from `sysctl -n kern.memorystatus_level`, the percentage the kernel counts free. */
export function memoryOfLevel(stdout: string): number | null {
  const t = stdout.trim()
  if (!/^\d{1,3}$/.test(t) || Number(t) > 100) return null
  return clampPct(100 - Number(t))
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

/** The fields of one CSV line whose fields are all quoted, as `typeperf` and `systeminfo` write it. */
function csvCells(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(/"((?:[^"]|"")*)"/g)) out.push(m[1]!.replace(/""/g, '"'))
  return out
}

/** A plain decimal (a point or the locale's comma before the fraction), else null. */
function decimal(text: string): number | null {
  const t = text.trim().replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}
