import { describe, expect, test } from 'claude-code/testing'

import { heavyKinds, isHeavy } from '../hooks/features/resources/heavy'
import { UNKNOWN, ceilingsOf, evaluate, gateHeavy } from '../hooks/features/resources/pressure'
import type { Ceilings, Pressure } from '../hooks/features/resources/pressure'
import { cpuBetween, macArgv, parseMacLine, parseMeminfo, parsePhysMem, parseProcStat, parseWindowsLine, platformOf, windowsArgv } from '../hooks/features/resources/sampler'

describe('samplers', () => {
  test('Windows lines: P/Invoke bytes and CIM kilobytes', () => {
    expect(parseWindowsLine('P 7.9 3129274368 12207001600', 5)).toEqual({ at: 5, cpu: 7.9, ram: 74.4 })
    expect(parseWindowsLine('C 9 3031636 11920900', 5)).toEqual({ at: 5, cpu: 9, ram: 74.6 })
    expect(parseWindowsLine('garbage', 5)).toBeNull()
    expect(parseWindowsLine('P 5 1 0', 5)).toBeNull()
  })

  test('macOS: top CPU line with the kernel memory-free level', () => {
    expect(parseMacLine('M CPU usage: 5.26% user, 10.52% sys, 84.21% idle ## 63', 1)).toEqual({ at: 1, cpu: 15.8, ram: 37 })
    expect(parsePhysMem('PhysMem: 15G used (2588M wired, 1092M compressor), 1G unused.')).toBe(93.8)
  })

  test('Linux: /proc/stat deltas and MemAvailable', () => {
    const a = parseProcStat('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 1 1 1')!
    const b = parseProcStat('cpu  150 0 150 900 0 0 0 0 0 0\n')!
    expect(cpuBetween(a, b)).toBe(50)
    expect(parseMeminfo('MemTotal:       16000000 kB\nMemFree:  1000 kB\nMemAvailable:    4000000 kB\n')).toBe(75)
  })

  test('platform detection and sampler commands', () => {
    expect(platformOf({ cwd: 'C:\\work', hasProcStat: false, hasMacSystem: false })).toBe('windows')
    expect(platformOf({ cwd: '/home/a', hasProcStat: true, hasMacSystem: false })).toBe('linux')
    expect(platformOf({ cwd: '/Users/a', hasProcStat: false, hasMacSystem: true })).toBe('macos')
    expect(windowsArgv(5)[0]).toBe('powershell.exe')
    expect(windowsArgv(5).at(-1)).toContain('GetSystemTimes')
    expect(macArgv(5).join(' ')).toContain('kern.memorystatus_level')
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

  test('a stale sample reads as unknown', () => {
    expect(evaluate({ samples: [at(90, 90, 0)], ceilings, previous: UNKNOWN, now: 60_000, windowMs: 15_000, staleMs: 30_000 }).level).toBe('unknown')
  })

  test('presets and custom ceilings', () => {
    expect(ceilingsOf({ level: 'off', cpu: 70, ram: 85, intervalSec: 5, enforcement: 'limit' })).toBeNull()
    expect(ceilingsOf({ level: 'low', cpu: 99, ram: 99, intervalSec: 5, enforcement: 'strict' })).toEqual({ cpu: 50, ram: 75, maxHeavy: 1, enforcement: 'strict', level: 'low' })
    expect(ceilingsOf({ level: 'custom', cpu: 60, ram: 80, intervalSec: 5, enforcement: 'inform' })?.maxHeavy).toBe(2)
  })

  test('heavy jobs are gated only when over a ceiling', () => {
    const ok: Pressure = { level: 'ok', cpu: 20, ram: 40, driver: 'cpu', overStreak: 0 }
    const high: Pressure = { level: 'high', cpu: 80, ram: 40, driver: 'cpu', overStreak: 2 }
    const critical: Pressure = { level: 'critical', cpu: 95, ram: 40, driver: 'cpu', overStreak: 3 }
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
