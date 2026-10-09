import { describe, expect, test } from 'claude-code/testing'

import { heavyKinds, isHeavy } from '../hooks/features/resources/heavy'
import { UNKNOWN, ceilingsOf, evaluate, gateHeavy } from '../hooks/features/resources/pressure'
import type { Ceilings, Pressure } from '../hooks/features/resources/pressure'
import {
  cpuBetween,
  cpuOfTopLine,
  memoryOfLevel,
  parseMeminfo,
  parsePhysMem,
  parseProcStat,
  parseSysteminfoTotal,
  parseTypeperfLine,
  platformOf,
} from '../hooks/features/resources/sampler'

describe('samplers', () => {
  // `systeminfo /fo csv /nh` as Windows 11 writes it (English); field 23 is Total Physical Memory.
  const SYSTEMINFO =
    '"AJ","Microsoft Windows 11 Home","10.0.26200 N/A Build 26200","Microsoft Corporation","Standalone Workstation","Multiprocessor Free",' +
    '"aj@example.com","N/A","00000-00000-00000-AAAAA","9/1/2025, 10:00:00 AM","10/8/2026, 9:00:00 AM","Acme","Laptop 15","x64-based PC",' +
    '"1 Processor(s) Installed.,[01]: Intel64 Family 6 Model 140 Stepping 1 GenuineIntel ~2419 Mhz","Acme 1.2, 1/1/2024","C:\\WINDOWS",' +
    '"C:\\WINDOWS\\system32","\\Device\\HarddiskVolume1","en-us;English (United States)","00004009","(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi",' +
    '"11,642 MB","1,476 MB","33,426 MB","4,552 MB","28,874 MB","C:\\pagefile.sys","WORKGROUP","\\\\AJ"\r\n'

  test('Windows: typeperf lines against the total from systeminfo', () => {
    const total = parseSysteminfoTotal(SYSTEMINFO)
    expect(total).toBe(11_642 * 1024 * 1024)
    // 3,119 MB of 11,642 MB available: 73.2% in use.
    expect(parseTypeperfLine('"10/08/2026 20:14:26.719","34.008431","3270508544.000000"', 5, total)).toEqual({ at: 5, cpu: 34, ram: 73.2 })
    // A locale that writes the fraction after a comma; the total not known yet gives the CPU alone.
    expect(parseTypeperfLine('"08.10.2026 20:14:26.719","7,9","3270508544,000000"', 5, null)).toEqual({ at: 5, cpu: 7.9, ram: null })
    // The header, a missed sample, typeperf's closing words and its error read as nothing.
    expect(parseTypeperfLine('"(PDH-CSV 4.0)","\\\\AJ\\Processor(_Total)\\% Processor Time","\\\\AJ\\Memory\\Available Bytes"', 5, total)).toBeNull()
    expect(parseTypeperfLine('"10/08/2026 20:14:28.724"," "," "', 5, total)).toBeNull()
    expect(parseTypeperfLine('Exiting, please wait...', 5, total)).toBeNull()
    expect(parseTypeperfLine('Error: No valid counters.', 5, total)).toBeNull()
  })

  test('Windows: the total from systeminfo in other locales, and what is not one', () => {
    const at = (memory: string) => SYSTEMINFO.replace('"11,642 MB"', `"${memory}"`)
    expect(parseSysteminfoTotal(at('11.642 MB'))).toBe(11_642 * 1024 * 1024)
    expect(parseSysteminfoTotal(at('11\u202f642 Mo'))).toBe(11_642 * 1024 * 1024)
    expect(parseSysteminfoTotal(at('N/A'))).toBeNull()
    expect(parseSysteminfoTotal('')).toBeNull()
    expect(parseSysteminfoTotal('ERROR: Access denied.')).toBeNull()
  })

  test('macOS: the CPU from top, memory from the kernel level or PhysMem', () => {
    expect(cpuOfTopLine('CPU usage: 5.26% user, 10.52% sys, 84.21% idle ')).toBe(15.8)
    expect(cpuOfTopLine('Load Avg: 1.71, 1.80, 1.86')).toBeNull()
    expect(memoryOfLevel('63\n')).toBe(37)
    expect(memoryOfLevel('')).toBeNull()
    expect(memoryOfLevel('sysctl: unknown oid')).toBeNull()
    expect(parsePhysMem('PhysMem: 15G used (2588M wired, 1092M compressor), 1G unused.')).toBe(93.8)
  })

  test('Linux: /proc/stat deltas and MemAvailable', () => {
    const a = parseProcStat('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 1 1 1')!
    const b = parseProcStat('cpu  150 0 150 900 0 0 0 0 0 0\n')!
    expect(cpuBetween(a, b)).toBe(50)
    expect(parseMeminfo('MemTotal:       16000000 kB\nMemFree:  1000 kB\nMemAvailable:    4000000 kB\n')).toBe(75)
  })

  test('platform detection', () => {
    expect(platformOf({ cwd: 'C:\\work', hasProcStat: false, hasMacSystem: false })).toBe('windows')
    expect(platformOf({ cwd: '/home/a', hasProcStat: true, hasMacSystem: false })).toBe('linux')
    expect(platformOf({ cwd: '/Users/a', hasProcStat: false, hasMacSystem: true })).toBe('macos')
  })
})

describe('pressure', () => {
  const ceilings: Ceilings = { cpu: 70, ram: 85, maxHeavy: 2, enforcement: 'limit', level: 'medium' }
  const at = (cpu: number, ram: number, t: number) => ({ at: t, cpu, ram })
  const evalAt = (samples: ReturnType<typeof at>[], previous: Pressure = UNKNOWN) =>
    evaluate({ samples, ceilings, previous, now: samples.at(-1)!.at, windowMs: 15_000, staleMs: 30_000 })

  test('levels follow the ceilings, with a debounce for high', () => {
    expect(evalAt([at(20, 40, 1000)]).level).toBe('ok')
    expect(evalAt([at(65, 40, 1000)]).level).toBe('elevated')
    const first = evalAt([at(75, 40, 1000)])
    expect(first.level).toBe('elevated')
    expect(evalAt([at(75, 40, 1000), at(75, 40, 6000)], first).level).toBe('high')
    expect(evalAt([at(85, 40, 1000)]).level).toBe('critical')
    expect(evalAt([at(10, 96, 1000)]).level).toBe('critical')
    expect(evalAt([at(10, 96, 1000)]).driver).toBe('ram')
  })

  test('a machine sitting at its ceiling stays high instead of flapping; it calms only well under it, twice', () => {
    // Seen live (RAM 85%, 86%, 85% against an 85% ceiling): a level change every few seconds, a notice each.
    let p: Pressure = UNKNOWN
    const levels: string[] = []
    const ram = [86, 86, 85, 84, 85, 86, 84, 83, 84, 86, 82, 82, 81]
    ram.forEach((r, i) => {
      p = evalAt([at(30, r, i * 2000)], p)
      levels.push(p.level)
    })
    // High from the second reading over; readings 1–2 points under keep it high; two at 3+ under end it.
    expect(levels).toEqual(['elevated', 'high', 'high', 'high', 'high', 'high', 'high', 'high', 'high', 'high', 'high', 'elevated', 'elevated'])
    // Critical still comes at once, and eases back to high, not to calm.
    const critical = evalAt([at(30, 96, 30_000)], p)
    expect(critical.level).toBe('critical')
    expect(evalAt([at(30, 86, 32_000)], critical).level).toBe('high')
  })

  test('a stale sample reads as unknown', () => {
    expect(evaluate({ samples: [at(90, 90, 0)], ceilings, previous: UNKNOWN, now: 60_000, windowMs: 15_000, staleMs: 30_000 }).level).toBe('unknown')
  })

  test('presets and custom ceilings', () => {
    expect(ceilingsOf({ level: 'off', cpu: 70, ram: 85, intervalSec: 5, enforcement: 'limit' })).toBeNull()
    expect(ceilingsOf({ level: 'low', cpu: 99, ram: 99, intervalSec: 5, enforcement: 'strict' })).toEqual({ cpu: 50, ram: 75, maxHeavy: 1, enforcement: 'strict', level: 'low' })
    expect(ceilingsOf({ level: 'custom', cpu: 60, ram: 80, intervalSec: 5, enforcement: 'inform' })?.maxHeavy).toBe(2)
  })

  test('heavy jobs are gated only when over a ceiling', () => {
    const ok: Pressure = { level: 'ok', cpu: 20, ram: 40, driver: 'cpu', overStreak: 0, clearStreak: 0 }
    const high: Pressure = { level: 'high', cpu: 80, ram: 40, driver: 'cpu', overStreak: 2, clearStreak: 0 }
    const critical: Pressure = { level: 'critical', cpu: 95, ram: 40, driver: 'cpu', overStreak: 3, clearStreak: 0 }
    expect(gateHeavy({ pressure: ok, ceilings, running: 5 }).isAllowed).toBe(true)
    expect(gateHeavy({ pressure: high, ceilings, running: 1 }).isAllowed).toBe(true)
    expect(gateHeavy({ pressure: high, ceilings, running: 2 }).isAllowed).toBe(false)
    expect(gateHeavy({ pressure: critical, ceilings, running: 1 }).isAllowed).toBe(false)
    expect(gateHeavy({ pressure: high, ceilings: { ...ceilings, enforcement: 'strict' }, running: 0 }).isAllowed).toBe(false)
    expect(gateHeavy({ pressure: critical, ceilings: { ...ceilings, enforcement: 'inform' }, running: 9 }).isAllowed).toBe(true)
  })
})

describe('heavy commands', () => {
  test('recognises builds, test suites, installs and containers', () => {
    expect(heavyKinds('npm test')).toEqual(['test'])
    expect(heavyKinds('pnpm run build')).toEqual(['build'])
    expect(heavyKinds('cargo test --all')).toEqual(['test'])
    expect(heavyKinds('pytest -q tests/')).toEqual(['test'])
    expect(heavyKinds('npm ci')).toEqual(['install'])
    expect(heavyKinds('docker build .')).toEqual(['container'])
    expect(heavyKinds('make -j8')).toEqual(['build'])
  })

  test('light commands and quoted words are not heavy', () => {
    for (const c of ['ls -la', 'git status', 'cat README.md', 'git commit -m "make the build pass"', 'echo "npm test"']) expect(isHeavy(c), c).toBe(false)
  })
})
