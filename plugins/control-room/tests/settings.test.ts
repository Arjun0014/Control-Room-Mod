import { describe, expect, test } from 'claude-code/testing'

import { applyProfile, deleteCustomProfile, diffSystems, findProfile, isModified, listProfiles, profileLabel, saveCustomProfile } from '../hooks/core/profiles'
import { DEFAULT_PERMISSIONS, defaultSettings, normalizeSettings, safeRelativePath, systemsOf } from '../hooks/core/settings'

describe('settings', () => {
  test('defaults are safe: risky systems off, dangerous commands denied', () => {
    const s = defaultSettings()
    expect(s.profile).toBe('normal')
    expect(s.autopilot.enabled).toBe(false)
    expect(s.frontier.enabled).toBe(false)
    expect(s.router.strategy).toBe('off')
    expect(s.subagents.mode).toBe('unrestricted')
    expect(s.resources.level).toBe('off')
    expect(s.focus.enabled).toBe(true)
    expect(s.focus.results).toBe(false)
    expect(s.focus.diffs).toBe(false)
    expect(s.permissions.dangerous).toBe('deny')
    expect(s.permissions.gitDestructive).toBe('deny')
    expect(s.permissions.push).toBe('ask')
    expect(s.permissions.install).toBe('ask')
  })

  test('garbage normalizes to defaults', () => {
    for (const raw of [undefined, null, 42, 'x', [], { autopilot: 'nope' }]) {
      expect(normalizeSettings(raw)).toEqual(defaultSettings())
    }
  })

  test('values are clamped and unknown enum values fall back', () => {
    const s = normalizeSettings({
      autopilot: { thresholdPercent: 300, thresholdTokens: -5, continuation: 'teleport', enabled: 'yes' },
      guard: { maxPerTurn: 99 },
      resources: { cpu: 5, ram: 150, level: 'turbo' },
      permissions: { dangerous: 'allow-everything', push: 'deny' },
      subagents: { limit: 0 },
    })
    expect(s.autopilot.thresholdPercent).toBe(95)
    expect(s.autopilot.thresholdTokens).toBe(10_000)
    expect(s.autopilot.continuation).toBe('clear')
    expect(s.autopilot.enabled).toBe(false)
    expect(s.guard.maxPerTurn).toBe(5)
    expect(s.resources.cpu).toBe(10)
    expect(s.resources.ram).toBe(100)
    expect(s.resources.level).toBe('off')
    expect(s.permissions.dangerous).toBe('deny')
    expect(s.permissions.push).toBe('deny')
    expect(s.subagents.limit).toBe(1)
  })

  test('the handoff file stays inside the project', () => {
    expect(safeRelativePath('docs/NEXT.md', 'X')).toBe('docs/NEXT.md')
    expect(safeRelativePath('../escape.md', 'X')).toBe('X')
    expect(safeRelativePath('/etc/passwd', 'X')).toBe('X')
    expect(safeRelativePath('C:\\Windows\\x.md', 'X')).toBe('X')
    expect(safeRelativePath('a\\..\\..\\b.md', 'X')).toBe('X')
    expect(safeRelativePath('', 'X')).toBe('X')
  })

  test('round-trips through JSON unchanged', () => {
    const s = normalizeSettings({ frontier: { enabled: true }, autopilot: { enabled: true, thresholdMode: 'tokens', thresholdTokens: 720_000 } })
    expect(normalizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
})

describe('profiles', () => {
  test('built-in profiles are listed in order', () => {
    expect(listProfiles(defaultSettings()).map(p => p.id)).toEqual(['normal', 'frontier', 'low-resource', 'release-qa'])
  })

  test('Frontier Max turns on max effort, the guard, the autopilot and medium resources', () => {
    const s = applyProfile(defaultSettings(), findProfile(defaultSettings(), 'frontier')!)
    expect(s.profile).toBe('frontier')
    expect(s.frontier).toEqual({ enabled: true, effort: 'max', subagentEffort: false })
    expect(s.guard.enabled).toBe(true)
    expect(s.autopilot.enabled).toBe(true)
    expect(s.resources.level).toBe('medium')
    expect(isModified(s)).toBe(false)
    expect(profileLabel(s)).toBe('Frontier Max')
  })

  test('a profile is found by id, name or slug, case-insensitively', () => {
    const s = defaultSettings()
    expect(findProfile(s, 'Frontier Max')?.id).toBe('frontier')
    expect(findProfile(s, 'LOW-RESOURCE')?.id).toBe('low-resource')
    expect(findProfile(s, 'release qa')).toBeUndefined()
    expect(findProfile(s, 'release-qa')?.id).toBe('release-qa')
  })

  test('an override marks the profile modified', () => {
    const s = applyProfile(defaultSettings(), findProfile(defaultSettings(), 'low-resource')!)
    const changed = { ...s, guard: { ...s.guard, enabled: true } }
    expect(isModified(changed)).toBe(true)
    expect(profileLabel(changed)).toBe('Low Resource*')
  })

  test('the diff names exactly what a profile changes', () => {
    const base = defaultSettings()
    const changes = diffSystems(systemsOf(base), findProfile(base, 'frontier')!.systems)
    const paths = changes.map(c => c.path)
    expect(paths).toContain('frontier.enabled')
    expect(paths).toContain('guard.enabled')
    expect(paths).toContain('autopilot.enabled')
    expect(paths).toContain('resources.level')
    expect(paths).not.toContain('permissions.dangerous')
    expect(changes.find(c => c.path === 'frontier.enabled')).toEqual({ path: 'frontier.enabled', label: 'Frontier Max', from: 'Off', to: 'On' })
    // Values read as the panel shows them.
    expect(changes.find(c => c.path === 'resources.level')).toMatchObject({ from: 'Off', to: 'Medium' })
    const tuned: ReturnType<typeof systemsOf> = JSON.parse(JSON.stringify(systemsOf(base)))
    tuned.autopilot.thresholdPercent = 75
    tuned.autopilot.thresholdTokens = 1_500_000
    tuned.resources.intervalSec = 5
    tuned.frontier.effort = 'xhigh'
    const units = diffSystems(systemsOf(base), tuned)
    expect(units.find(c => c.path === 'autopilot.thresholdPercent')).toMatchObject({ label: 'Hand off at', to: '75%' })
    expect(units.find(c => c.path === 'autopilot.thresholdTokens')?.to).toBe('1.5M')
    expect(units.find(c => c.path === 'resources.intervalSec')?.to).toBe('5 s')
    expect(units.find(c => c.path === 'frontier.effort')).toMatchObject({ from: 'Maximum', to: 'Extra high' })
    const lowRes = diffSystems(systemsOf(base), findProfile(base, 'low-resource')!.systems)
    expect(lowRes.find(c => c.path === 'resources.enforcement')).toMatchObject({ label: 'When over', from: 'Hold extra heavy jobs', to: 'Hold all heavy jobs' })
    expect(lowRes.find(c => c.path === 'subagents.mode')).toMatchObject({ from: 'No limit', to: 'Up to a number' })
  })

  test('Release/QA tightens permissions but never loosens them', () => {
    const qa = findProfile(defaultSettings(), 'release-qa')!.systems.permissions
    const rank = { default: 0, allow: 1, ask: 2, deny: 3 } as const
    for (const [category, state] of Object.entries(DEFAULT_PERMISSIONS)) {
      expect(rank[qa[category as keyof typeof qa]] >= rank[state], category).toBe(true)
    }
  })

  test('custom profiles are saved, applied, replaced by name and deleted', () => {
    let s = applyProfile(defaultSettings(), findProfile(defaultSettings(), 'frontier')!)
    s = { ...s, resources: { ...s.resources, level: 'low' } }
    s = saveCustomProfile(s, 'Night Shift', 1)
    expect(s.profile).toBe('custom:night-shift')
    expect(s.customProfiles).toHaveLength(1)
    expect(isModified(s)).toBe(false)
    s = saveCustomProfile(s, 'night shift', 2)
    expect(s.customProfiles).toHaveLength(1)
    expect(findProfile(s, 'night-shift')?.systems.resources.level).toBe('low')
    s = deleteCustomProfile(s, 'custom:night-shift')
    expect(s.customProfiles).toHaveLength(0)
    expect(s.profile).toBe('normal')
  })
})
