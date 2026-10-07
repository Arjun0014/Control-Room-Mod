import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Settings } from '../hooks/core/settings'
import { TABS } from '../hooks/ui/pane/frame'
import { SESSION, world } from './fixtures/world'

const ENGINE_ROW = { type: 'Text' as const, props: {}, children: ['ENGINE ROW'] }

const bandProps = (bodyColumns: number) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
})

const paneProps = (bodyColumns: number, placement: 'dock' | 'inline' = 'dock') => ({
  title: 'Control Room',
  isFocused: true,
  bodyColumns,
  placement,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

const toolRow = (id: string, tool = 'Bash', input: unknown = { command: 'npm test' }) => ({
  tool_use_id: id,
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
})

async function boot($: Engine, w: ReturnType<typeof world>) {
  await $.session.start(SESSION)
  await w.clock.advance(300)
}

const saved = (w: ReturnType<typeof world>) => w.store['settings.v1'] as Settings

describe('ui', () => {
  test('the HUD band draws its vital signs on terminal and desktop at every width', async ($, on) => {
    const w = world(on, { tokens: 684_000 })
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const columns of [44, 80, 120, 200]) {
        const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'AbovePrompt', props: bandProps(columns), viewport: { columns, rows: 40 } })
        expect(await ui.find({ text: /Context/ }), `${surface} ${columns}`).toBeDefined()
        expect(await ui.find({ type: 'Button', key: 'open' }), `${surface} ${columns}`).toBeDefined()
        await ui.unmount()
      }
    }
  })

  test('the HUD shows only what is on: off systems take no room', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    const quiet = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    expect(await quiet.find({ text: /Hands off/ })).toBeUndefined()
    expect(await quiet.find({ text: /Frontier/ })).toBeUndefined()
    await quiet.unmount()
    await $.command.run({ command: 'cr', args: 'profile frontier', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await w.clock.advance(300)
    const busy = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    expect(await busy.find({ text: /Frontier Max/ })).toBeDefined()
    expect(await busy.find({ text: /Hands off at 70%/ })).toBeDefined()
  })

  test('the band yields to surveys and to a hidden HUD', async ($, on) => {
    const w = world(on)
    on('ui.render', { component: 'AbovePrompt' }, () => ENGINE_ROW)
    await boot($, w)
    const survey = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: { ...bandProps(100), hasSurvey: true } })
    expect(await survey.find({ text: /Context/ })).toBeUndefined()
    await survey.unmount()
    await $.command.run({ command: 'cr', args: 'hud status', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
    await w.clock.advance(300)
    const hidden = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(100) })
    expect(await hidden.find({ text: /Context/ })).toBeUndefined()
    expect(w.kept.statuses.some(s => s !== undefined && s.startsWith('◆ Context'))).toBe(true)
  })

  test('every section draws on terminal, desktop and mobile, docked and inline', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    await boot($, w)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      for (const [columns, placement] of [[44, 'dock'], [66, 'dock'], [140, 'inline']] as const) {
        const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(columns, placement), viewport: { columns: 200, rows: 50, isFullscreen: placement === 'dock' } })
        for (const tab of TABS) {
          await ui.press({ key: `tab-${tab.id}` })
          await w.clock.advance(300)
          expect(await ui.drawn(), `${surface} ${columns} ${tab.id}`).toBeDefined()
          expect(await ui.find({ text: /Control Room/ }), `${surface} ${columns} ${tab.id}`).toBeDefined()
        }
        await ui.unmount()
      }
    }
  })

  test('the terminal never draws a dropdown; desktop uses its native popup', async ($, on) => {
    const w = world(on)
    await boot($, w)
    for (const surface of ['terminal', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      await ui.press({ key: 'tab-guardrails' })
      await w.clock.advance(300)
      expect(await ui.find({ type: 'Select' }), surface).toBeUndefined()
      await ui.unmount()
    }
    const desktop = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await desktop.press({ key: 'tab-guardrails' })
    await w.clock.advance(300)
    await desktop.select({ key: 'perm-push', value: 'deny' })
    await w.clock.advance(2000)
    expect(saved(w).permissions.push).toBe('deny')
  })

  test('a picker opens in place, picks, and closes, with keys or the pointer', async ($, on) => {
    const w = world(on)
    await boot($, w)
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await ui.press({ key: 'tab-guardrails' })
    await w.clock.advance(300)
    expect(await ui.find({ type: 'Button', key: 'perm-push:deny' })).toBeUndefined()
    await ui.press({ key: 'perm-push' })
    await w.clock.advance(300)
    expect(await ui.find({ type: 'Button', key: 'perm-push:deny' })).toBeDefined()
    await ui.press({ key: 'perm-push:deny' })
    await w.clock.advance(2000)
    expect(saved(w).permissions.push).toBe('deny')
    expect(await ui.find({ type: 'Button', key: 'perm-push:deny' })).toBeUndefined()
    await ui.press({ key: 'perm-push' })
    await w.clock.advance(300)
    await ui.press({ key: 'perm-push' })
    await w.clock.advance(300)
    expect(await ui.find({ type: 'Button', key: 'perm-push:ask' })).toBeUndefined()
  })

  test('Control Centre controls change and persist settings', async ($, on) => {
    const w = world(on)
    await boot($, w)
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await ui.press({ key: 'tab-behavior' })
    await w.clock.advance(300)
    await ui.press({ key: 'fr-on' })
    await w.clock.advance(2000)
    expect(saved(w).frontier.enabled).toBe(true)
    expect(saved(w).guard.enabled).toBe(true)
    await ui.press({ key: 'gu-strict:strict' })
    await ui.press({ key: 'gu-turn-inc' })
    await w.clock.advance(2000)
    expect(saved(w).guard).toMatchObject({ strictness: 'strict', maxPerTurn: 3 })
    await ui.press({ key: 'tab-guardrails' })
    await w.clock.advance(300)
    await ui.press({ key: 'sa-mode' })
    await w.clock.advance(300)
    await ui.press({ key: 'sa-mode:limit' })
    await w.clock.advance(300)
    await ui.press({ key: 'sa-limit-dec' })
    await w.clock.advance(2000)
    expect(saved(w).subagents).toMatchObject({ mode: 'limit', limit: 1 })
    await ui.press({ key: 'tab-context' })
    await w.clock.advance(300)
    await ui.press({ key: 'ap-enabled' })
    await w.clock.advance(300)
    await ui.press({ key: 'ap-threshold-inc' })
    await ui.press({ key: 'ap-cont:manual' })
    await w.clock.advance(2000)
    expect(saved(w).autopilot).toMatchObject({ enabled: true, thresholdPercent: 75, continuation: 'manual' })
    await ui.press({ key: 'tab-setup' })
    await w.clock.advance(300)
    await ui.press({ key: 'apply-low-resource' })
    await w.clock.advance(2000)
    expect(saved(w).resources.level).toBe('low')
    expect(saved(w).profile).toBe('low-resource')
  })

  test('mobile draws choices in place, as buttons', async ($, on) => {
    const w = world(on)
    await boot($, w)
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'mobile', component: 'Pane', requestId: 'control-room', props: paneProps(60) })
    await ui.press({ key: 'tab-behavior' })
    await w.clock.advance(300)
    await ui.press({ key: 'ro-strategy' })
    await w.clock.advance(300)
    await ui.press({ key: 'ro-strategy:economy' })
    await w.clock.advance(2000)
    expect(saved(w).router.strategy).toBe('economy')
  })

  test('Focus View draws a compact tool row that expands in place', async ($, on) => {
    const w = world(on)
    on('ui.render', { component: 'ToolUse' }, () => ENGINE_ROW)
    await boot($, w)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'ToolUse', requestId: `t-${surface}`, props: toolRow(`t-${surface}`), viewport: { columns: 100, rows: 40 } })
      expect(await ui.find({ text: /npm test/ })).toBeDefined()
      expect(await ui.find({ text: /ENGINE ROW/ })).toBeUndefined()
      await ui.press({ key: `expand-t-${surface}` })
      await w.clock.advance(300)
      await ui.redraw()
      expect(await ui.find({ text: /ENGINE ROW/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('Focus View off restores the engine rows; results and diffs follow their switches', async ($, on) => {
    const w = world(on)
    on('ui.render', { component: 'ToolUse' }, () => ENGINE_ROW)
    on('ui.render', { component: 'ToolResult' }, () => ENGINE_ROW)
    await boot($, w)
    const result = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'ToolResult', requestId: 'e1', props: { tool_use_id: 'e1', tool: 'Edit', output: {}, isErrored: false } })
    expect(await result.find({ text: /ENGINE ROW/ })).toBeUndefined()
    await $.command.run({ command: 'cr', args: 'focus off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
    await w.clock.advance(300)
    await result.redraw()
    expect(await result.find({ text: /ENGINE ROW/ })).toBeDefined()
    const row = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'ToolUse', requestId: 'b1', props: toolRow('b1') })
    expect(await row.find({ text: /ENGINE ROW/ })).toBeDefined()
  })

  test('the spinner carries the activity summary while a turn runs', async ($, on) => {
    const w = world(on)
    const seen: (string | null)[] = []
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      seen.push(e.props.message)
      return ENGINE_ROW
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await boot($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await w.clock.advance(300)
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Spinner', requestId: 'main', props: { word: 'Working', message: null, suffix: '…', mode: 'tool-use' } })
    await ui.drawn()
    expect(seen.at(-1)).toContain('Working · 1 tool')
  })
})
