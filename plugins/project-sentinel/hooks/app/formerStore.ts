/**
 * Project Sentinel was called Control Room (`control-room`) until 1.4.0.
 *
 * Claude Code keeps a plugin's `$.store` under its name, in one file per name
 * and source: `<config>/plugins/store/<name>_<source>-<id>.json`, where the id
 * is the first twelve hex digits of the SHA-256 of `<name>@<source>` and the
 * source is `inline` for a plugin loaded in place (a folder, a directory
 * marketplace) or the marketplace's name for an installed copy. So the renamed
 * plugin starts with an empty store, and the person's settings, runs, Quest
 * log and cache memory stay behind under the old name.
 *
 * Once, when the plugin first loads, before its settings are read, the old
 * store's file is read and what Project Sentinel knows is copied over: never
 * what this store already holds, and never anything else. The configuration
 * folder comes from the environment (`CLAUDE_CONFIG_DIR`, else `.claude` in the
 * home folder), or from the session's transcript path at its start. An update
 * can load the plugin into a session that is already running, where no
 * session start follows, so the load is the moment that counts. Of the old
 * stores (one per source), the one written last holds the person's settings.
 * The old file is only read: never written, moved or deleted. A marker in the
 * new store (`migrated.v1`) makes it happen once.
 *
 * Pure except `readFormerStore`, which reads through the Host.
 */

import { LIMITS, STORE_KEYS } from '../constants'
import type { Host } from '../host'

export const FORMER_NAME = 'control-room'

/** Set once the carry-over has been looked into, whatever it found. */
export const CARRIED_KEY = 'migrated.v1'

export type CarriedMarker = { from: string | null; at: number; keys: number }

/** The configuration folder from a transcript's path: `<config>/projects/<project>/<session>.jsonl`. */
export function configDirOf(transcriptPath: string | undefined): string | null {
  if (transcriptPath === undefined || transcriptPath.trim() === '') return null
  const parts = transcriptPath.split(/[\\/]/)
  const at = parts.lastIndexOf('projects')
  if (at < 1 || at !== parts.length - 3) return null
  const sep = transcriptPath.includes('\\') && !transcriptPath.includes('/') ? '\\' : '/'
  return parts.slice(0, at).join(sep)
}

/** What the environment says about where Claude Code keeps its configuration. */
export type ConfigEnv = { claudeConfigDir: string | undefined; userProfile: string | undefined; home: string | undefined }

/**
 * The configuration folder from the environment, as Claude Code finds it:
 * `CLAUDE_CONFIG_DIR` when set, else `.claude` in the home folder (Windows'
 * `USERPROFILE` first, which is what Claude Code reads there; `HOME` elsewhere).
 */
export function configDirFromEnv(env: ConfigEnv): string | null {
  const own = env.claudeConfigDir?.trim()
  if (own !== undefined && own !== '') return own
  const home = [env.userProfile, env.home].map(v => v?.trim()).find((v): v is string => v !== undefined && v !== '')
  if (home === undefined) return null
  const sep = home.includes('\\') && !home.includes('/') ? '\\' : '/'
  return `${home.replace(/[\\/]+$/, '')}${sep}.claude`
}

/** The source Claude Code keys this load's store by: an installed copy's marketplace, else `inline`. */
export function sourceOf(pluginRoot: string): string {
  const parts = pluginRoot.split(/[\\/]/)
  const at = parts.lastIndexOf('cache')
  if (at > 0 && parts[at - 1] === 'plugins' && parts[at + 1] !== undefined && parts[at + 1] !== '') return parts[at + 1]!
  return 'inline'
}

/** The store's file name for a plugin name and a source, as Claude Code names it. */
export async function storeFileName(name: string, source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${name}@${source}`))
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${name}_${source}-${hex.slice(0, 12)}.json`
}

/** Where the old store may be, the same source first: an in-place load and an installed copy keep separate stores. */
export async function formerStorePaths(configDir: string, source: string): Promise<string[]> {
  const sep = configDir.includes('\\') && !configDir.includes('/') ? '\\' : '/'
  const sources = [...new Set([source, 'inline', FORMER_NAME])]
  const names = await Promise.all(sources.map(s => storeFileName(FORMER_NAME, s)))
  return names.map(n => [configDir, 'plugins', 'store', n].join(sep))
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Whether the status bar published under the former name in this session is
 * Control Room's. Claude Desktop hands a session its plugins once, when the
 * session's process starts, so an update loads Project Sentinel beside the
 * Control Room that process already runs; the two must never act at once (two
 * handoffs, two answers to one permission check). Read by its shape, so another
 * plugin that happens to be called `control-room` is not taken for it.
 */
export function isFormerHud(value: unknown): boolean {
  return isRecord(value) && typeof value.isVisible === 'boolean' && isRecord(value.profile) && isRecord(value.autopilot) && isRecord(value.ctx)
}

/** The keys this store already holds that a carry-over must not overwrite (and the run index, to merge). */
export type CurrentStore = {
  settings: boolean
  quest: boolean
  cache: boolean
  counter: number
  index: string[]
}

/**
 * What to write into the new store from the old one: the settings, the Quest
 * log and the cache memory where the new store has none yet; every run the
 * merged index keeps (newest first, the new store's own runs ahead); the run
 * counter, never going back. Unknown keys stay behind.
 */
export function carriedWrites(former: unknown, current: CurrentStore): Record<string, unknown> {
  if (!isRecord(former)) return {}
  const out: Record<string, unknown> = {}
  if (!current.settings && isRecord(former[STORE_KEYS.settings])) out[STORE_KEYS.settings] = former[STORE_KEYS.settings]
  if (!current.quest && isRecord(former[STORE_KEYS.quest])) out[STORE_KEYS.quest] = former[STORE_KEYS.quest]
  if (!current.cache && isRecord(former[STORE_KEYS.cache])) out[STORE_KEYS.cache] = former[STORE_KEYS.cache]
  const counter = former[STORE_KEYS.runCounter]
  if (typeof counter === 'number' && Number.isFinite(counter) && Math.floor(counter) > current.counter) out[STORE_KEYS.runCounter] = Math.floor(counter)
  const formerIndex = Array.isArray(former[STORE_KEYS.runsIndex]) ? (former[STORE_KEYS.runsIndex] as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const carried = formerIndex.filter(id => !current.index.includes(id) && isRecord(former[`${STORE_KEYS.runPrefix}${id}`]))
  const index = [...current.index, ...carried].slice(0, LIMITS.runsKept)
  for (const id of carried) if (index.includes(id)) out[`${STORE_KEYS.runPrefix}${id}`] = former[`${STORE_KEYS.runPrefix}${id}`]
  if (carried.some(id => index.includes(id))) out[STORE_KEYS.runsIndex] = index
  return out
}

/**
 * Which old store to carry over: the one written last, since the sessions the
 * person used most recently wrote it (Claude Code keeps one per source, and an
 * old installed copy's can be days older than an in-place load's). Equal times
 * keep the order of `paths`.
 */
export function newestFirst(found: readonly { path: string; mtimeMs: number }[]): string[] {
  return found
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.i - b.i)
    .map(f => f.path)
}

/** The old store written last that reads as JSON; null when there is none. */
export async function readFormerStore(host: Host, configDir: string): Promise<{ file: string; store: unknown } | null> {
  const paths = await formerStorePaths(configDir, sourceOf(host.pluginRoot))
  const found: { path: string; mtimeMs: number }[] = []
  for (const path of paths) {
    const stat = await host.stat(path, false).catch(() => null)
    if (stat !== null && stat.kind === 'file') found.push({ path, mtimeMs: stat.mtimeMs })
  }
  for (const path of newestFirst(found)) {
    try {
      const text = await host.readText(path)
      return { file: path.split(/[\\/]/).at(-1) ?? path, store: JSON.parse(text) as unknown }
    } catch {
      // Not readable, or not JSON: try the next one.
    }
  }
  return null
}
