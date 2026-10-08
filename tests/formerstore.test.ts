import { describe, expect, test } from 'claude-code/testing'

import { CARRIED_KEY, carriedWrites, configDirOf, formerStorePaths, sourceOf, storeFileName } from '../hooks/app/formerStore'
import { Runtime } from '../hooks/app/runtime'
import { defaultSettings } from '../hooks/core/settings'
import type { Settings } from '../hooks/core/settings'
import { fakeHost } from './fixtures/fake-host'

describe('the store kept under the former name', () => {
  test('store files are named as Claude Code names them (checked against real stores)', async () => {
    expect(await storeFileName('control-room', 'inline')).toBe('control-room_inline-7b750613ef16.json')
    expect(await storeFileName('control-room', 'control-room')).toBe('control-room_control-room-8bbff897507c.json')
    expect(await storeFileName('cr-test', 'inline')).toBe('cr-test_inline-f63a99e15d2a.json')
  })

  test('the configuration folder comes from the transcript path; anything else is not trusted', () => {
    expect(configDirOf('C:\\Users\\a\\.claude\\projects\\C--work\\2a.jsonl')).toBe('C:\\Users\\a\\.claude')
    expect(configDirOf('/home/a/.claude/projects/-work/2a.jsonl')).toBe('/home/a/.claude')
    expect(configDirOf('/tmp/cfg/projects/-work/2a.jsonl')).toBe('/tmp/cfg')
    expect(configDirOf('/home/a/elsewhere/2a.jsonl')).toBeNull()
    expect(configDirOf('')).toBeNull()
    expect(configDirOf(undefined)).toBeNull()
  })

  test('an installed copy keeps its store under the marketplace, a plugin loaded in place under inline', () => {
    expect(sourceOf('C:\\Users\\a\\.claude\\plugins\\cache\\control-room\\project-sentinel\\1.4.0')).toBe('control-room')
    expect(sourceOf('/home/a/.claude/plugins/cache/mine/project-sentinel/1.4.0')).toBe('mine')
    expect(sourceOf('C:\\Web UI\\Control Room Mod\\plugins\\project-sentinel')).toBe('inline')
  })

  test('the same source is looked for first, then the others', async () => {
    const paths = await formerStorePaths('/home/a/.claude', 'control-room')
    expect(paths).toEqual([
      '/home/a/.claude/plugins/store/control-room_control-room-8bbff897507c.json',
      '/home/a/.claude/plugins/store/control-room_inline-7b750613ef16.json',
    ])
    expect((await formerStorePaths('C:\\Users\\a\\.claude', 'inline'))[0]).toBe('C:\\Users\\a\\.claude\\plugins\\store\\control-room_inline-7b750613ef16.json')
  })

  test('what comes along: never over what the new store holds; runs merged, the counter never going back', () => {
    const former = {
      'settings.v1': { version: 1, autopilot: { thresholdPercent: 80 } },
      'quest.v1': { xp: 120 },
      'cache.v1': { v: 1, ttl: '1h' },
      'runs.counter.v1': 32,
      'runs.index.v1': ['r32', 'r31', 'gone'],
      'run.v1.r32': { v: 1, id: 'r32', number: 32, sessions: [] },
      'run.v1.r31': { v: 1, id: 'r31', number: 31, sessions: [] },
      'something.else': true,
    }
    const fresh = carriedWrites(former, { settings: false, quest: false, cache: false, counter: 1, index: ['n1'] })
    expect(Object.keys(fresh).sort()).toEqual(['cache.v1', 'quest.v1', 'run.v1.r31', 'run.v1.r32', 'runs.counter.v1', 'runs.index.v1', 'settings.v1'])
    expect(fresh['runs.index.v1']).toEqual(['n1', 'r32', 'r31'])
    expect(fresh['runs.counter.v1']).toBe(32)
    const kept = carriedWrites(former, { settings: true, quest: true, cache: true, counter: 40, index: ['r32'] })
    expect(Object.keys(kept).sort()).toEqual(['run.v1.r31', 'runs.index.v1'])
    expect(carriedWrites('not a store', { settings: false, quest: false, cache: false, counter: 0, index: [] })).toEqual({})
  })

  test('a whole carry-over: settings, runs, the Quest log and the cache memory come along once, and the new run is numbered after them', async () => {
    const old = defaultSettings()
    old.autopilot.enabled = true
    old.autopilot.thresholdPercent = 80
    old.permissions.network = 'deny'
    const store = {
      'settings.v1': old,
      'runs.counter.v1': 32,
      'runs.index.v1': ['r32'],
      'run.v1.r32': { v: 1, id: 'r32', number: 32, startedAt: 1, updatedAt: 2, root: '/work', profile: 'normal', status: 'ended', sessions: [{ id: 's-old', index: 1, startedAt: 1, endedAt: 2, start: 'startup', end: 'exit', peakTokens: 0, lastTokens: 0, window: null, costUsd: 3, turns: 4, transitions: [] }] },
      'quest.v1': { xp: 120, achievements: [], recent: [] },
      'cache.v1': { v: 1, ttl: '1h', ttlSource: 'observed', verified: 'unknown', verifiedAt: null, effortRebuilds: [] },
    }
    const file = '/home/a/.claude/plugins/store/control-room_inline-7b750613ef16.json'
    const f = fakeHost({ files: { [file]: JSON.stringify(store) }, pluginRoot: '/home/a/src/plugins/project-sentinel' })
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await f.advance(200)
    expect(rt.settings.autopilot.enabled).toBe(false)
    await rt.onClassicSessionStart({ source: 'startup', sessionId: 'session-1', transcriptPath: '/home/a/.claude/projects/-work/session-1.jsonl' })
    await f.advance(2000)
    expect(rt.settings.autopilot.enabled).toBe(true)
    expect(rt.settings.autopilot.thresholdPercent).toBe(80)
    expect(rt.settings.permissions.network).toBe('deny')
    expect(rt.cache.memory.ttl).toBe('1h')
    expect(rt.quest.xp).toBe(120)
    expect(rt.run?.number).toBe(33)
    expect(f.kept.store['runs.index.v1']).toContain('r32')
    expect(f.kept.store['run.v1.r32']).toBeDefined()
    expect(f.kept.store[CARRIED_KEY]).toMatchObject({ from: 'control-room_inline-7b750613ef16.json', keys: 6 })
    expect(rt.notes.join(' ')).toContain('Project Sentinel is Control Room renamed')
    // Once: a later session leaves the store as it is, even if it changed since.
    ;(f.kept.store['settings.v1'] as Settings).autopilot.thresholdPercent = 60
    const next = new Runtime()
    next.bind(f.host)
    await next.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await next.onClassicSessionStart({ source: 'startup', sessionId: 'session-2', transcriptPath: '/home/a/.claude/projects/-work/session-2.jsonl' })
    expect(next.settings.autopilot.thresholdPercent).toBe(60)
    expect(next.notes.join(' ')).not.toContain('Project Sentinel is Control Room renamed')
  })

  test('with no former store, nothing changes and it is not looked for again', async () => {
    const f = fakeHost()
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await rt.onClassicSessionStart({ source: 'startup', sessionId: 'session-1', transcriptPath: '/home/a/.claude/projects/-work/session-1.jsonl' })
    expect(f.kept.store[CARRIED_KEY]).toMatchObject({ from: null, keys: 0 })
    expect(rt.notes.join(' ')).not.toContain('renamed')
  })

  test('without a transcript path nothing is looked for, so a later session can still carry it over', async () => {
    const f = fakeHost()
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await rt.onClassicSessionStart({ source: 'startup', sessionId: 'session-1' })
    expect(f.kept.store[CARRIED_KEY]).toBeUndefined()
  })
})
