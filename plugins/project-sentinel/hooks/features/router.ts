/**
 * Model Router: picks a model per task class, conservatively.
 *
 * Subagents are routed at spawn (cache-neutral: each starts a fresh
 * context). The main conversation is routed once per turn, never per step,
 * and only when it is cheap to do so: switching models re-sends the whole
 * conversation uncached to the other model, and a smaller model may not hold
 * the context at all. Frontier Max vetoes downgrades unless the strategy is
 * Custom.
 *
 * No model id is hard-coded. A subagent's model may be an alias, which the
 * engine resolves; a request's model may not (an alias there fails the turn),
 * so the main conversation is only ever routed to an id the engine has
 * already reported answering in this session.
 */

import type { ModelAlias, RouterStrategy, Settings } from '../core/settings'

export type TaskClass = 'trivial' | 'simple' | 'standard' | 'hard'

export type Tier = 1 | 2 | 3 | 4

export type Family = Exclude<ModelAlias, 'session'>

/** haiku 1 < sonnet 2 < opus 3 < fable 4; unknown ids read as opus-class (never assumed cheap). */
export function tierOf(model: string): Tier {
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 1
  if (m.includes('sonnet')) return 2
  if (m.includes('fable')) return 4
  return 3
}

/** The family a model id belongs to, or null for an id that names none (a gateway's own name). */
export function familyOf(model: string): Family | null {
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('opus')) return 'opus'
  if (m.includes('fable')) return 'fable'
  return null
}

export const ALIAS_TIER: Record<Family, Tier> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

/** The aliases the engine documents for a subagent's model; any other family needs a seen id. */
const SPAWN_ALIASES: ReadonlySet<Family> = new Set(['haiku', 'sonnet', 'opus'])

/** Ids the engine reported answering this session, by family. */
export type KnownModels = ReadonlyMap<Family, string>

const HARD =
  /\b(architect(ure)?|design|debug|investigat|root cause|race condition|deadlock|concurren|performance|optimi[sz]|security|vulnerab|migrat|refactor (the|a) (whole|entire)|rewrite|distributed|algorithm|prove|formal|complex|tricky|subtle|why (does|is|do)|figure out|plan (the|a|out)|multi[- ]file|across the (codebase|repo))/i
const STANDARD = /\b(implement|build|create|add|fix|write|update|change|refactor|integrate|test|port|convert|support|handle)\b/i
const SIMPLE = /\b(what|where|which|show|list|find|explain|describe|summari[sz]e|read|look up|check|rename|typo|format|comment)\b/i
const TRIVIAL = /^\s*(ok(ay)?|thanks?( you)?|ty|yes|no|y|n|sure|great|cool|nice|got it|continue|go on|go ahead|proceed|done|lgtm)[.! ]*$/i

/** A cheap, deterministic task class for a prompt. */
export function classifyTask(text: string): { cls: TaskClass; why: string } {
  const t = text.trim()
  if (t === '' || TRIVIAL.test(t)) return { cls: 'trivial', why: 'acknowledgement' }
  const words = t.split(/\s+/).length
  if (HARD.test(t) || words > 160) return { cls: 'hard', why: HARD.test(t) ? 'design / debugging / analysis' : 'long, detailed request' }
  if (STANDARD.test(t)) return { cls: 'standard', why: 'implementation task' }
  if (SIMPLE.test(t) || words <= 12) return { cls: 'simple', why: 'lookup or short question' }
  return { cls: 'standard', why: 'general task' }
}

type Table = Record<TaskClass, ModelAlias> & { explore: ModelAlias; plan: ModelAlias; general: ModelAlias }

const TABLES: Record<Exclude<RouterStrategy, 'off' | 'custom'>, Table> = {
  balanced: { trivial: 'haiku', simple: 'sonnet', standard: 'session', hard: 'session', explore: 'haiku', plan: 'session', general: 'sonnet' },
  performance: { trivial: 'sonnet', simple: 'session', standard: 'session', hard: 'fable', explore: 'sonnet', plan: 'opus', general: 'opus' },
  economy: { trivial: 'haiku', simple: 'haiku', standard: 'sonnet', hard: 'session', explore: 'haiku', plan: 'sonnet', general: 'haiku' },
}

export function tableOf(settings: Settings['router']): Table | null {
  if (settings.strategy === 'off') return null
  if (settings.strategy === 'custom') return settings.custom
  return TABLES[settings.strategy]
}

export type MainRouteInput = {
  router: Settings['router']
  cls: TaskClass
  sessionModel: string
  contextTokens: number
  isFrontier: boolean
  /** Families whose model the engine refused this session. */
  unavailable: ReadonlySet<string>
  known: KnownModels
  /** The main conversation's prompt cache, as Cache Guardian reads it. */
  cache?: { isWarm: boolean; cachedTokens: number }
}

export type RouteDecision = { model: string | null; why: string }

/** Below this, switching models re-caches little; above it only upgrades for hard work are worth it. */
export const CHEAP_SWITCH_TOKENS = 60_000
/** A smaller-window model is only chosen while the context fits it with room to spare. */
export const SMALL_WINDOW_SAFE_TOKENS = 150_000
/** From this much warm cached context, saving on one request never pays for re-sending it all. */
export const WARM_KEEP_TOKENS = 20_000

export function routeMain(input: MainRouteInput): RouteDecision {
  const table = tableOf(input.router)
  if (table === null || !input.router.mainLoop) return { model: null, why: 'router off for the main conversation' }
  const alias = table[input.cls]
  if (alias === 'session') return { model: null, why: `${input.cls} task → session model` }
  if (input.unavailable.has(alias)) return { model: null, why: `${alias} unavailable this session` }
  const current = tierOf(input.sessionModel)
  const target = ALIAS_TIER[alias]
  if (target === current) return { model: null, why: `${input.cls} task → already ${alias}-class` }
  const isDowngrade = target < current
  if (isDowngrade && input.isFrontier && input.router.strategy !== 'custom') {
    return { model: null, why: 'Frontier Max keeps the session model' }
  }
  if (isDowngrade && input.cache?.isWarm === true && input.cache.cachedTokens >= WARM_KEEP_TOKENS) {
    return { model: null, why: `keeps the warm cache (${Math.round(input.cache.cachedTokens / 1000)}k tokens)` }
  }
  if (alias === 'haiku' && input.contextTokens > SMALL_WINDOW_SAFE_TOKENS) {
    return { model: null, why: 'context too large for a small-window model' }
  }
  if (input.contextTokens > CHEAP_SWITCH_TOKENS && !(input.cls === 'hard' && !isDowngrade)) {
    return { model: null, why: 'switching would re-send a large context uncached' }
  }
  const id = input.known.get(alias)
  if (id === undefined) return { model: null, why: `${input.cls} task → ${alias}, not seen answering yet this session` }
  return { model: id, why: `${input.cls} task → ${alias}` }
}

export function routeSubagent(input: {
  router: Settings['router']
  subagentType: string
  requested: string | undefined
  isFork: boolean
  isTeammate: boolean
  isFrontier: boolean
  sessionModel: string
  unavailable: ReadonlySet<string>
  known: KnownModels
}): RouteDecision {
  const table = tableOf(input.router)
  if (table === null || !input.router.subagents) return { model: null, why: 'router off for subagents' }
  if (input.isFork) return { model: null, why: 'forks inherit the parent model' }
  if (input.requested !== undefined) return { model: null, why: 'model chosen by Claude' }
  const type = input.subagentType.toLowerCase()
  const picked = type.includes('explore') ? table.explore : type.includes('plan') ? table.plan : table.general
  if (picked === 'session') return { model: null, why: `${input.subagentType} → session model` }
  const isFloored = input.isFrontier && input.router.strategy !== 'custom' && ALIAS_TIER[picked] < 2
  const alias: Family = isFloored ? 'sonnet' : picked
  if (input.unavailable.has(alias)) return { model: null, why: `${alias} unavailable this session` }
  const model = input.known.get(alias) ?? (SPAWN_ALIASES.has(alias) ? alias : null)
  if (model === null) return { model: null, why: `${input.subagentType} → ${alias}, not seen answering yet this session` }
  return { model, why: isFloored ? `Frontier Max floor for ${input.subagentType}` : `${input.subagentType} → ${alias}` }
}
