/**
 * Profiles: named configurations of every Control Room system at once.
 *
 * A profile is a complete SystemSettings value, so applying one is
 * deterministic (no leftovers from the previous profile). The person can
 * still override any individual setting afterwards; the profile then reads
 * as modified. Pure: no engine access.
 */

import {
  type CustomProfile,
  DEFAULT_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_LABEL,
  type Settings,
  type SystemSettings,
  clone,
  deepEqual,
  defaultSystems,
  slugOf,
  systemsOf,
} from './settings'

export type ProfileInfo = {
  id: string
  name: string
  tagline: string
  isBuiltin: boolean
  systems: SystemSettings
}

const normal = (): SystemSettings => defaultSystems()

const frontier = (): SystemSettings => {
  const s = defaultSystems()
  s.frontier = { enabled: true, effort: 'max', subagentEffort: false }
  s.guard = { ...s.guard, enabled: true, strictness: 'standard' }
  s.autopilot = { ...s.autopilot, enabled: true, thresholdMode: 'percent', thresholdPercent: 70 }
  s.resources = { ...s.resources, level: 'medium', cpu: 70, ram: 85, enforcement: 'limit' }
  return s
}

const lowResource = (): SystemSettings => {
  const s = defaultSystems()
  s.resources = { ...s.resources, level: 'low', cpu: 50, ram: 75, enforcement: 'strict' }
  s.subagents = { ...s.subagents, mode: 'limit', limit: 1 }
  return s
}

const releaseQa = (): SystemSettings => {
  const s = defaultSystems()
  s.qa = { enabled: true }
  s.guard = { ...s.guard, enabled: true, strictness: 'strict', maxPerTurn: 3 }
  s.autopilot = { ...s.autopilot, enabled: true, thresholdMode: 'percent', thresholdPercent: 70 }
  s.subagents = { ...s.subagents, mode: 'limit', limit: 2 }
  s.focus = { ...s.focus, diffs: true }
  s.resources = { ...s.resources, level: 'medium', cpu: 70, ram: 85, enforcement: 'limit' }
  s.permissions = {
    ...DEFAULT_PERMISSIONS,
    install: 'ask',
    download: 'ask',
    delete: 'ask',
    commit: 'ask',
    push: 'ask',
    gitDestructive: 'deny',
    deploy: 'ask',
    dangerous: 'deny',
  }
  return s
}

export const BUILTIN_PROFILES: readonly Omit<ProfileInfo, 'systems'>[] = [
  { id: 'normal', name: 'Normal', tagline: 'Claude Code as usual, quieter', isBuiltin: true },
  {
    id: 'frontier',
    name: 'Frontier Max',
    tagline: 'Maximum effort, finishes the job',
    isBuiltin: true,
  },
  {
    id: 'low-resource',
    name: 'Low Resource',
    tagline: 'Gentle on your machine',
    isBuiltin: true,
  },
  {
    id: 'release-qa',
    name: 'Release / QA',
    tagline: 'Verifies before calling it done',
    isBuiltin: true,
  },
]

const BUILDERS: Record<string, () => SystemSettings> = {
  normal,
  frontier,
  'low-resource': lowResource,
  'release-qa': releaseQa,
}

/** Every profile the person can pick: the built-ins, then their own. */
export function listProfiles(settings: Settings): ProfileInfo[] {
  const builtins = BUILTIN_PROFILES.map(p => ({ ...p, systems: BUILDERS[p.id]!() }))
  const custom = settings.customProfiles.map(c => ({
    id: `custom:${c.id}`,
    name: c.name,
    tagline: 'Saved by you',
    isBuiltin: false,
    systems: clone(c.systems),
  }))
  return [...builtins, ...custom]
}

export function findProfile(settings: Settings, id: string): ProfileInfo | undefined {
  const wanted = id.trim().toLowerCase()
  return listProfiles(settings).find(
    p => p.id === wanted || p.name.toLowerCase() === wanted || slugOf(p.name) === wanted || p.id === `custom:${wanted}`,
  )
}

/** Settings with the profile's systems applied (bookkeeping and UI kept). */
export function applyProfile(settings: Settings, profile: ProfileInfo): Settings {
  return { ...settings, ...clone(profile.systems), profile: profile.id }
}

/** Whether the current systems differ from the profile they say they came from. */
export function isModified(settings: Settings): boolean {
  const profile = findProfile(settings, settings.profile)
  return profile === undefined ? false : !deepEqual(systemsOf(settings), profile.systems)
}

export function profileLabel(settings: Settings): string {
  const profile = findProfile(settings, settings.profile)
  const name = profile?.name ?? 'Custom'
  return isModified(settings) ? `${name}*` : name
}

export type SettingChange = { path: string; label: string; from: string; to: string }

const LABELS: Record<string, string> = {
  'autopilot.enabled': 'Autopilot',
  'autopilot.thresholdMode': 'Measure by',
  'autopilot.thresholdTokens': 'Hand off at (tokens)',
  'autopilot.thresholdPercent': 'Hand off at (%)',
  'autopilot.continuation': 'Then',
  'autopilot.fallbackToCompact': 'If clearing fails',
  'autopilot.handoffFile': 'Notes file',
  'autopilot.autoContinue': 'Continue on its own',
  'frontier.enabled': 'Frontier Max',
  'frontier.effort': 'Effort',
  'frontier.subagentEffort': 'Effort for subagents',
  'qa.enabled': 'Release check',
  'guard.enabled': 'Lazy-exit guard',
  'guard.strictness': 'Guard strictness',
  'guard.maxPerTurn': 'Continuations per turn',
  'guard.maxPerSession': 'Continuations per session',
  'guard.modelCheck': 'Smart check',
  'router.strategy': 'Model router',
  'router.mainLoop': 'Route main conversation',
  'router.subagents': 'Route subagents',
  'subagents.mode': 'Subagents',
  'subagents.limit': 'Subagent limit',
  'subagents.countTeammates': 'Count teammates',
  'focus.enabled': 'Focus view',
  'focus.tools': 'Tool calls',
  'focus.results': 'Tool results',
  'focus.diffs': 'Inline file diffs',
  'focus.spinner': 'Activity line',
  'resources.level': 'Machine load',
  'resources.cpu': 'CPU ceiling',
  'resources.ram': 'Memory ceiling',
  'resources.intervalSec': 'Sample interval',
  'resources.enforcement': 'When over',
}

for (const category of PERMISSION_CATEGORIES) {
  LABELS[`permissions.${category}`] = PERMISSION_LABEL[category]
}

const show = (v: unknown): string => {
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'number') return v >= 10_000 ? `${Math.round(v / 1000)}k` : String(v)
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function flatten(prefix: string, value: unknown, out: Map<string, unknown>) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(prefix === '' ? k : `${prefix}.${k}`, v, out)
  } else {
    out.set(prefix, value)
  }
}

/** Every setting that differs between two system configurations, labelled. */
export function diffSystems(from: SystemSettings, to: SystemSettings): SettingChange[] {
  const a = new Map<string, unknown>()
  const b = new Map<string, unknown>()
  flatten('', from, a)
  flatten('', to, b)
  const changes: SettingChange[] = []
  for (const [path, next] of b) {
    const prev = a.get(path)
    if (deepEqual(prev, next)) continue
    if (path.startsWith('router.custom.')) continue
    changes.push({ path, label: LABELS[path] ?? path, from: show(prev), to: show(next) })
  }
  return changes
}

/** Saves the current systems as a custom profile (replacing one of the same name). */
export function saveCustomProfile(settings: Settings, name: string, now: number): Settings {
  const clean = name.trim().slice(0, 40)
  if (clean === '') return settings
  const id = slugOf(clean)
  const entry: CustomProfile = { id, name: clean, createdAt: now, systems: clone(systemsOf(settings)) }
  const others = settings.customProfiles.filter(p => p.id !== id)
  const customProfiles = [...others, entry].slice(-12)
  return { ...settings, customProfiles, profile: `custom:${id}` }
}

export function deleteCustomProfile(settings: Settings, id: string): Settings {
  const bare = id.startsWith('custom:') ? id.slice('custom:'.length) : id
  const customProfiles = settings.customProfiles.filter(p => p.id !== bare)
  const profile = settings.profile === `custom:${bare}` ? 'normal' : settings.profile
  return { ...settings, customProfiles, profile }
}
