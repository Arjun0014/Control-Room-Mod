import { describe, expect, test } from 'claude-code/testing'

import { defaultSettings } from '../hooks/core/settings'
import { CHEAP_SWITCH_TOKENS, type Family, classifyTask, familyOf, routeMain, routeSubagent, tierOf } from '../hooks/features/router'

const router = (strategy: 'off' | 'balanced' | 'performance' | 'economy' | 'custom') => ({ ...defaultSettings().router, strategy })
const none = new Set<string>()
const HAIKU = 'claude-haiku-4-5-20251001'
const FABLE = 'claude-fable-5-1'
const seen = new Map<Family, string>([
  ['haiku', HAIKU],
  ['sonnet', 'claude-sonnet-5-5'],
  ['opus', 'claude-opus-5-5'],
  ['fable', FABLE],
])
const nothingSeen = new Map<Family, string>()
const main = { cls: 'trivial' as const, sessionModel: 'claude-opus-5-5', contextTokens: 1000, isFrontier: false, unavailable: none, known: seen }

describe('Model Router', () => {
  test('task classes', () => {
    expect(classifyTask('thanks').cls).toBe('trivial')
    expect(classifyTask('continue').cls).toBe('trivial')
    expect(classifyTask('where is the config loaded?').cls).toBe('simple')
    expect(classifyTask('add a --verbose flag to the CLI').cls).toBe('standard')
    expect(classifyTask('investigate the race condition in the job scheduler').cls).toBe('hard')
  })

  test('tiers and families from ids, unknown ids never assumed cheap', () => {
    expect(tierOf(HAIKU)).toBe(1)
    expect(tierOf('claude-sonnet-5-5')).toBe(2)
    expect(tierOf('claude-opus-5-5')).toBe(3)
    expect(tierOf(FABLE)).toBe(4)
    expect(tierOf('some-gateway-model')).toBe(3)
    expect(familyOf(HAIKU)).toBe('haiku')
    expect(familyOf('some-gateway-model')).toBeNull()
  })

  test('off routes nothing', () => {
    expect(routeMain({ ...main, router: router('off') }).model).toBeNull()
  })

  test('economy downgrades cheap turns while the context is small, to the id seen answering', () => {
    const r = routeMain({ ...main, router: router('economy'), cls: 'simple', contextTokens: 20_000 })
    expect(r.model).toBe(HAIKU)
  })

  test('the main conversation is never sent a bare alias: an unseen family keeps the session model', () => {
    const r = routeMain({ ...main, router: router('economy'), cls: 'simple', known: nothingSeen })
    expect(r.model).toBeNull()
    expect(r.why).toContain('not seen answering')
  })

  test('a large context is never re-sent to another model for a downgrade', () => {
    const r = routeMain({ ...main, router: router('economy'), cls: 'simple', contextTokens: CHEAP_SWITCH_TOKENS + 1 })
    expect(r.model).toBeNull()
  })

  test('Frontier Max vetoes downgrades unless the strategy is Custom', () => {
    expect(routeMain({ ...main, router: router('economy'), isFrontier: true }).model).toBeNull()
    expect(routeMain({ ...main, router: router('custom'), isFrontier: true }).model).toBe(HAIKU)
  })

  test('performance upgrades hard work even with a large context', () => {
    expect(routeMain({ ...main, router: router('performance'), cls: 'hard', sessionModel: 'claude-sonnet-5-5', contextTokens: 400_000 }).model).toBe(FABLE)
  })

  test('refused families are not chosen again', () => {
    expect(routeMain({ ...main, router: router('economy'), unavailable: new Set(['haiku']) }).model).toBeNull()
  })

  test('subagents: by type, never forks, Claude\'s own choice respected, Frontier floor', () => {
    const base = { router: router('economy'), requested: undefined, isFork: false, isTeammate: false, isFrontier: false, sessionModel: 'claude-opus-5-5', unavailable: none, known: nothingSeen }
    expect(routeSubagent({ ...base, subagentType: 'Explore' }).model).toBe('haiku')
    expect(routeSubagent({ ...base, subagentType: 'Explore', known: seen }).model).toBe(HAIKU)
    expect(routeSubagent({ ...base, subagentType: 'Plan' }).model).toBe('sonnet')
    expect(routeSubagent({ ...base, subagentType: 'general-purpose', isFork: true }).model).toBeNull()
    expect(routeSubagent({ ...base, subagentType: 'Explore', requested: 'opus' }).model).toBeNull()
    expect(routeSubagent({ ...base, subagentType: 'Explore', isFrontier: true }).model).toBe('sonnet')
  })

  test('subagents: a family with no documented alias is only routed once its id was seen', () => {
    const custom = { ...defaultSettings().router, strategy: 'custom' as const, custom: { ...defaultSettings().router.custom, general: 'fable' as const } }
    const base = { router: custom, requested: undefined, isFork: false, isTeammate: false, isFrontier: false, sessionModel: 'claude-opus-5-5', unavailable: none, subagentType: 'general-purpose' }
    expect(routeSubagent({ ...base, known: nothingSeen }).model).toBeNull()
    expect(routeSubagent({ ...base, known: seen }).model).toBe(FABLE)
  })
})
