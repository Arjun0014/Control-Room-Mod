import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Settings } from '../hooks/core/settings'
import { MAX_COLUMNS, TABS } from '../hooks/ui/pane/frame'
import { navRowColumns } from '../hooks/ui/primitives'
import { ACCENT, TIMELINE, meter } from '../hooks/ui/theme'
import { SESSION, world } from './fixtures/world'

const ENGINE_ROW = { type: 'Text' as const, props: {}, children: ['ENGINE ROW'] }

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && !Array.isArray(n)
const keyOf = (n: unknown): string => (isNode(n) && typeof n.props?.key === 'string' ? n.props.key : '')
const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')
function each(n: unknown, visit: (n: Node) => void): void {
  if (!isNode(n)) return
  visit(n)
  for (const c of n.children ?? []) each(c, visit)
}

/** The first Text under a node (a card head's title, a row's label). Texts carry no keys once drawn; Boxes do. */
function firstText(n: unknown): string {
  let found: string | null = null
  each(n, d => {
    if (found === null && d.type === 'Text') found = textOf(d)
  })
  return found ?? ''
}

/** Every card in a drawn tree: its title and the labels of the rows inside it. */
function cardsOf(tree: unknown): { title: string; labels: string[] }[] {
  const out: { title: string; labels: string[] }[] = []
  each(tree, n => {
    const m = /^card-(.+)$/.exec(keyOf(n))
    if (m === null || /-(head|box|foot)$/.test(m[1]!)) return
    let title = ''
    const labels: string[] = []
    each(n, d => {
      if (keyOf(d) === `card-${m[1]}-head`) title = firstText(d)
      else if (keyOf(d).startsWith('row-')) labels.push(firstText(d))
    })
    out.push({ title, labels })
  })
  return out
}

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

/** The run's last handoff as stored: what it left behind, and what session 2 picked up. */
const LAST_HANDOFF = {
  at: 950_000,
  fromSession: 1,
  toSession: 2,
  via: 'clear',
  health: [
    { id: 'runState', label: 'Run state saved', state: 'ok', detail: 'Milestones sent again' },
    { id: 'milestone', label: 'Milestone under way captured', state: 'ok', detail: 'Rewrite the hot loop' },
    { id: 'notes', label: 'Handoff notes written', state: 'ok', detail: 'NEXT_SESSION_PROMPT.md' },
    { id: 'docs', label: 'Project docs updated', state: 'ok', detail: 'README.md' },
    { id: 'validation', label: 'Validation recorded', state: 'ok', detail: 'Tests passing' },
    { id: 'claudeMd', label: 'CLAUDE.md', state: 'none', detail: 'No update needed' },
  ],
  currentKey: 'rewrite the hot loop',
  currentSubject: 'Rewrite the hot loop',
  done: 1,
  total: 3,
  continuity: [
    { id: 'notesRead', label: 'Handoff notes read', state: 'ok', detail: 'NEXT_SESSION_PROMPT.md' },
    { id: 'runState', label: 'Run state restored', state: 'ok', detail: '1 of 3 milestones' },
    { id: 'milestone', label: 'Milestone picked up', state: 'ok', detail: 'Rewrite the hot loop' },
    { id: 'docsRead', label: 'Project docs read', state: 'missing', detail: 'None opened' },
    { id: 'resumed', label: 'Work resumed', state: 'ok', detail: '2 edits' },
  ],
}

describe('ui', () => {
  test('a coarse meter never hides a reading past its threshold under the tick', () => {
    // 88k of a 1M window, handing off at 60k, in the status bar's ten cells.
    expect(meter(0.088, 10, 0.06)).toBe('┃━────────')
    expect(meter(0.03, 10, 0.06)).toBe('┃─────────')
    expect(meter(0.69, 10, 0.7)).toBe('━━━━━━┃───')
    expect(meter(1, 10, 0.7)).toBe('━━━━━━┃━━━')
    expect(meter(0.5, 10)).toBe('━━━━━─────')
  })

  test('the HUD band draws its vital signs on terminal and desktop at every width', async ($, on) => {
    const w = world(on, { tokens: 684_000 })
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const columns of [44, 80, 120, 200]) {
        const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'AbovePrompt', props: bandProps(columns), viewport: { columns, rows: 40 } })
        expect(await ui.find({ text: /68%/ }), `${surface} ${columns}`).toBeDefined()
        expect(await ui.find({ text: /\$1\.25/ }), `${surface} ${columns}`).toBeDefined()
        expect(await ui.find({ type: 'Button', key: 'open' }), `${surface} ${columns}`).toBeDefined()
        // The terminal names its readings only where there is room; Desktop captions each cell at every width.
        const isLabelled = surface === 'terminal' ? columns >= 72 : true
        const [contextName, runName] = surface === 'terminal' ? [/CONTEXT/, /RUN/] : [/^Context/, /^Run$/]
        expect((await ui.find({ text: contextName })) !== undefined, `${surface} ${columns}`).toBe(isLabelled)
        expect((await ui.find({ text: runName })) !== undefined, `${surface} ${columns}`).toBe(isLabelled)
        await ui.unmount()
      }
    }
  })

  test('the status bar shows live readings only, never settings', async ($, on) => {
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
    expect(await busy.find({ text: /CONTEXT/ })).toBeDefined()
    expect(await busy.find({ text: /Frontier Max/ })).toBeUndefined()
    expect(await busy.find({ text: /Hands off/ })).toBeUndefined()
  })

  test('the band yields to surveys and to a hidden HUD', async ($, on) => {
    const w = world(on)
    on('ui.render', { component: 'AbovePrompt' }, () => ENGINE_ROW)
    await boot($, w)
    const survey = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: { ...bandProps(100), hasSurvey: true } })
    expect(await survey.find({ text: /CONTEXT/ })).toBeUndefined()
    await survey.unmount()
    await $.command.run({ command: 'cr', args: 'hud status', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
    await w.clock.advance(300)
    const hidden = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(100) })
    expect(await hidden.find({ text: /CONTEXT/ })).toBeUndefined()
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

  test('a row never repeats the title of its card', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    await boot($, w)
    await $.command.run({ command: 'cr', args: 'profile frontier', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await w.clock.advance(300)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      let checked = 0
      for (const tab of TABS) {
        await ui.press({ key: `tab-${tab.id}` })
        await w.clock.advance(300)
        for (const c of cardsOf(await ui.drawn())) {
          if (c.title === '') continue
          checked += 1
          for (const label of c.labels) expect(label.toLowerCase(), `${surface} ${tab.id}: ${c.title}`).not.toBe(c.title.toLowerCase())
        }
      }
      expect(checked, surface).toBeGreaterThan(10)
      await ui.unmount()
    }
  })

  test('a wide frame keeps the page to a readable width, centred, on every surface; a narrower one fills its room', async ($, on) => {
    const w = world(on)
    await boot($, w)
    const mount = (surface: 'terminal' | 'desktop', columns: number, placement: 'dock' | 'inline') =>
      $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(columns, placement), viewport: { columns: columns + 2, rows: 50, isFullscreen: placement === 'dock' } })
    for (const [surface, placement] of [['terminal', 'inline'], ['desktop', 'dock']] as const) {
      const wide = await mount(surface, 180, placement)
      expect(await wide.drawn(), surface).toMatchObject({ props: { alignItems: 'center' } })
      expect((await wide.find({ key: 'page-body' }))?.props.width, surface).toBe(MAX_COLUMNS + 2)
      await wide.unmount()
    }
    for (const [surface, columns, placement] of [['terminal', 66, 'dock'], ['desktop', 50, 'dock']] as const) {
      const ui = await mount(surface, columns, placement)
      expect((await ui.find({ key: 'page-body' }))?.props.width, `${surface} ${columns}`).toBeUndefined()
      await ui.unmount()
    }
  })

  test('desktop section buttons: one row when every label fits, else three equal cells per row with each button centred', async ($, on) => {
    const w = world(on)
    await boot($, w)
    for (const [columns, isOneRow] of [[MAX_COLUMNS + 2, true], [navRowColumns(TABS), true], [navRowColumns(TABS) - 1, false], [50, false], [30, false]] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'Pane', requestId: 'control-room', props: paneProps(columns + 2) })
      const nav = await ui.find({ key: 'nav' })
      const rows = (nav?.children ?? []).filter(c => /^nav-row-\d+$/.test(keyOf(c))) as Node[]
      if (isOneRow) {
        expect(rows.length, `${columns}`).toBe(0)
        expect((nav?.children ?? []).map(keyOf), `${columns}`).toEqual(TABS.map(t => `tab-${t.id}`))
      } else {
        expect(rows.length, `${columns}`).toBe(2)
        for (const r of rows) {
          const cells = (r.children ?? []) as Node[]
          expect(cells.map(c => keyOf(c).replace(/^nav-cell-/, '')).every(id => TABS.some(t => t.id === id)), `${columns}`).toBe(true)
          expect(cells.length, `${columns}`).toBe(3)
          expect(new Set(cells.map(c => c.props?.width)).size, `${columns}: equal cells`).toBe(1)
          for (const c of cells) expect(c.props?.justifyContent, `${columns}`).toBe('center')
        }
      }
      await ui.unmount()
    }
  })

  test('on desktop a truncating line may narrow below its text; the terminal tree is unchanged', async ($, on) => {
    const w = world(on)
    await boot($, w)
    const shrinkers = async (surface: 'terminal' | 'desktop') => {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(48) })
      let clipped = 0
      each(await ui.drawn(), n => {
        if (n.type === 'Box' && n.props?.minWidth === 0 && n.props.overflow === 'hidden') clipped += 1
      })
      await ui.unmount()
      return clipped
    }
    expect(await shrinkers('desktop')).toBeGreaterThan(5)
    expect(await shrinkers('terminal')).toBe(0)
  })

  test('on desktop the profile name field moves under its label in a narrow pane', async ($, on) => {
    const w = world(on)
    await boot($, w)
    await $.command.run({ command: 'cr', args: 'guard on', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await w.clock.advance(300)
    const at = async (columns: number) => {
      const ui = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'Pane', requestId: 'control-room', props: paneProps(columns) })
      await ui.press({ key: 'tab-setup' })
      await w.clock.advance(300)
      const where = { beside: await ui.find({ key: 'profile-save-right' }), under: await ui.find({ key: 'profile-save-stacked' }) }
      await ui.unmount()
      return where
    }
    const narrow = await at(54)
    expect(narrow.under).toBeDefined()
    expect(narrow.beside).toBeUndefined()
    const wide = await at(120)
    expect(wide.beside).toBeDefined()
    expect(wide.under).toBeUndefined()
  })

  test('a segmented choice sits beside its label when the text fits, under it when it would not', async ($, on) => {
    const w = world(on)
    await boot($, w)
    await $.command.run({ command: 'cr', args: 'guard on', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await w.clock.advance(300)
    const at = async (columns: number, placement: 'dock' | 'inline') => {
      const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(columns, placement) })
      await ui.press({ key: 'tab-behavior' })
      await w.clock.advance(300)
      const where = { beside: await ui.find({ key: 'gu-strict-right' }), under: await ui.find({ key: 'gu-strict-stacked' }) }
      await ui.unmount()
      return where
    }
    // Docked (a 60-cell card): the description would wrap beside the choice, so it moves under.
    const docked = await at(66, 'dock')
    expect(docked.under).toBeDefined()
    expect(docked.beside).toBeUndefined()
    // A wide frame (a 76-cell card): there is room for both on one line.
    const wide = await at(100, 'inline')
    expect(wide.beside).toBeDefined()
    expect(wide.under).toBeUndefined()
    // Switches never move, however narrow.
    const narrow = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(44) })
    await narrow.press({ key: 'tab-behavior' })
    await w.clock.advance(300)
    expect(await narrow.find({ key: 'gu-on-right' })).toBeDefined()
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

  test('Activity leads with the run and what needs a look; every call is the secondary view', async ($, on) => {
    // Answers beneath the plugin for the calls this turn makes (registered before the world's catch-all).
    on('tool.call', { tool: 'Write' }, ($, e) => ({ result: { type: 'create', filePath: e.file_path, content: 'export const a = 1\nexport const b = 2\n', structuredPatch: [], originalFile: null } }))
    on('tool.call', { tool: 'Bash' }, ($, e) =>
      e.command === 'npm run lint'
        ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nsrc/a.ts: unused variable' }
        : e.command === 'touch scripts/gen.sh'
          ? { result: { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/work/scripts/gen.sh', hunks: [], created: true as const }], moreFiles: 0 } } }
          : { result: { stdout: 'ok', stderr: '', interrupted: false } },
    )
    const w = world(on, { tokens: 300_000 })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await boot($, w)
    await $.prompt.submit({ text: 'Build the parser and cover it with tests.', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'Build the parser and cover it with tests.', turnId: 't1' })
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Sketch the grammar', status: 'completed', activeForm: 'Sketching the grammar' },
        { content: 'Build the parser', status: 'in_progress', activeForm: 'Building the parser' },
        { content: 'Write the tests', status: 'pending', activeForm: 'Writing the tests' },
      ],
    })
    await $.tool.call({ tool: 'Write', file_path: '/work/src/parser.ts', content: 'export const a = 1\nexport const b = 2\n' })
    await $.tool.call({ tool: 'Bash', command: 'touch scripts/gen.sh' })
    await $.tool.call({ tool: 'Write', file_path: '/work/NEXT_SESSION_PROMPT.md', content: 'notes' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
    await w.clock.advance(300)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      await ui.press({ key: 'tab-activity' })
      await w.clock.advance(300)
      const text = textOf(await ui.drawn())
      for (const expected of ['RUN PROGRESS', 'Build the parser and cover it with tests.', '1 of 3 milestones', 'Building the parser', 'Write the tests', 'THIS TURN', 'ATTENTION', 'unresolved', 'VALIDATION', 'Tests', 'Lint', 'CHANGES', 'CODE', '+2', 'new · diff unavailable']) {
        expect(text, `${surface}: ${expected}`).toContain(expected)
      }
      expect(text, surface).not.toContain('+0 −0')
      // Files are buttons that open their diff; the handoff notes sit folded under generated files.
      expect(await ui.find({ key: 'pick-/work/src/parser.ts' }), surface).toBeDefined()
      expect(await ui.find({ key: 'pick-/work/NEXT_SESSION_PROMPT.md' }), surface).toBeUndefined()
      expect((await ui.find({ key: 'toggle-generated' }))?.props.label, surface).toContain('Generated and temporary · 1')
      await ui.press({ key: 'toggle-generated' })
      await w.clock.advance(300)
      expect(await ui.find({ key: 'pick-/work/NEXT_SESSION_PROMPT.md' }), surface).toBeDefined()
      await ui.press({ key: 'toggle-generated' })
      await w.clock.advance(300)
      // The full call list is one press away, newest first.
      await ui.press({ key: 'sub:raw' })
      await w.clock.advance(300)
      const raw = textOf(await ui.drawn())
      expect(raw.indexOf('npm run lint'), surface).toBeLessThan(raw.indexOf('TodoWrite'))
      await ui.press({ key: 'sub:summary' })
      await w.clock.advance(300)
      await ui.unmount()
    }
  })

  test('the status bar shows run progress apart from context, what Claude is doing, and the run cost only', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'A', status: 'completed', activeForm: 'Doing A' },
        { content: 'B', status: 'completed', activeForm: 'Doing B' },
        { content: 'C', status: 'in_progress', activeForm: 'Running regression tests' },
        { content: 'D', status: 'pending', activeForm: 'Doing D' },
      ],
    })
    await w.clock.advance(300)
    const wide = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    const line = textOf(await wide.drawn())
    // The headline: what Claude is doing in its own words, then where the milestone sits; the instruments below.
    expect(line).toContain('Running regression tests · step 3 of 4')
    expect(line).not.toContain('C · 3 of 4')
    expect(line.indexOf('Running regression tests')).toBeLessThan(line.indexOf('CONTEXT'))
    // Work is a track of stops, Context a meter of segments: two shapes that cannot be confused.
    expect(line).toContain('WORK ●━●━◉─○ 2/4')
    expect(line).toContain('CONTEXT ▇')
    expect(line).toContain('RUN $1.25')
    await wide.unmount()
    // Narrow: no names, the instruments stay apart by shape.
    const narrow = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(48) })
    const small = textOf(await narrow.drawn())
    expect(small).not.toContain('CONTEXT')
    expect(small).toContain('◉─○ 2/4')
    expect(small).toContain('▇')
    expect(small).toContain('30%')
    await narrow.unmount()
    // Desktop: each reading a cell, a caption over its graphic and value; every graphic an image of a fixed size.
    const desktop = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(120) })
    const drawn = await desktop.drawn()
    expect(textOf(drawn)).toContain('Work2 of 4')
    expect(textOf(drawn)).toContain('Context')
    expect(textOf(drawn)).toContain('Run$1.25')
    each(drawn, n => {
      if (n.type !== 'Svg') return
      expect(n.props?.isInteractive, String(n.props?.alt)).toBeUndefined()
      expect(typeof n.props?.width, String(n.props?.alt)).toBe('number')
      expect(typeof n.props?.height, String(n.props?.alt)).toBe('number')
    })
    for (const key of ['cell-work', 'cell-ctx', 'cell-cache', 'cell-run']) expect(await desktop.find({ key }), key).toBeDefined()
    await desktop.unmount()
    // A narrow band takes the compact cells.
    const compact = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(60) })
    expect(textOf(await compact.drawn())).toContain('Work2/4')
    await compact.unmount()
  })

  test('once a turn ends, the top line says what it did, and checks show by name', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, ($, e) =>
      e.command === 'npm run lint' ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nnpm error Missing script: "lint"' } : { result: { stdout: 'ok', stderr: '', interrupted: false } },
    )
    const w = world(on, { tokens: 300_000 })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    const before = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    // Before the first turn there is nothing to say on top: the readings alone.
    expect(textOf(await before.drawn())).not.toContain('Ran ')
    await before.unmount()
    await $.turn.start({ text: 'check it', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(300)
    const after = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    const text = textOf(await after.drawn())
    expect(text).toContain('Ran tests once, passing · lint once, failing')
    // What needs a look is a chip on the right: the failing check by name, shown once, not again as an issue.
    expect(text).toContain('✗ Lint failing')
    expect(text).not.toContain('issue')
    expect(text).not.toContain('Tests failing')
    await after.unmount()
    // Docked beside the panel: the chip still fits.
    const docked = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(79) })
    expect(textOf(await docked.drawn())).toContain('Lint failing')
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

  test('Behavior offers the answer styles on every surface, with a line written in the chosen one', async ($, on) => {
    const w = world(on)
    await boot($, w)
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await ui.press({ key: 'tab-behavior' })
    await w.clock.advance(300)
    const cards = cardsOf(await ui.drawn())
    expect(cards[0]?.title).toBe('ANSWER STYLE')
    await ui.press({ key: 'an-style' })
    await w.clock.advance(300)
    expect(textOf(await ui.drawn())).toContain('Simplified Technical English')
    await ui.press({ key: 'an-style:mission' })
    await w.clock.advance(2000)
    expect(saved(w).answers.style).toBe('mission')
    const text = textOf(await ui.drawn())
    expect(text).toContain('For example')
    expect(text).toContain('GO · tests pass, 3 of 3')
    expect(text).toContain('GO only for what was verified')
    await ui.unmount()
    for (const surface of ['desktop', 'mobile'] as const) {
      const other = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(90) })
      expect(textOf(await other.drawn()), surface).toContain('How Claude writes to you')
      await other.unmount()
    }
  })

  test('Quest log: Activity shows the level, the awards and the achievements; the status bar the level', async ($, on) => {
    const w = world(on, { settings: { answers: { style: 'quest' } } })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    await $.turn.start({ text: 'Build the parser and test it.', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__control-room__milestones', milestones: [{ title: 'Sketch', status: 'completed' }, { title: 'Build', status: 'in_progress', doing: 'Building' }] } as never)
    await w.clock.advance(300)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      await ui.press({ key: 'tab-activity' })
      await w.clock.advance(300)
      const text = textOf(await ui.drawn())
      for (const expected of ['QUEST', 'Level 1', '+50 XP this run', 'Milestone: Sketch', '50 XP', 'First green', 'Comeback', 'Full clear', 'XP counts verified progress only']) {
        expect(text, `${surface}: ${expected}`).toContain(expected)
      }
      await ui.unmount()
    }
    const band = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    expect(textOf(await band.drawn())).toContain('★ Lv 1')
  })

  test('Context draws the run as columns, one per session, against the handoff line', async ($, on) => {
    const run = {
      v: 1,
      id: 'r1',
      number: 7,
      startedAt: 900_000,
      updatedAt: 990_000,
      root: '/work',
      profile: 'normal',
      status: 'active',
      sessions: [
        { id: 'earlier', index: 1, startedAt: 900_000, endedAt: 950_000, start: 'startup', end: 'handoff', peakTokens: 720_000, lastTokens: 718_000, window: 1_000_000, costUsd: 20, turns: 9, model: null, endNote: 'handoff at 700k tokens', transitions: [] },
        { id: 'session-1', index: 2, startedAt: 950_000, endedAt: null, start: 'handoff', end: null, peakTokens: 300_000, lastTokens: 300_000, window: 1_000_000, costUsd: 4, turns: 2, model: null, endNote: null, transitions: [] },
      ],
      lastHandoff: LAST_HANDOFF,
    }
    const w = world(on, { tokens: 300_000, settings: { autopilot: { enabled: true, thresholdMode: 'percent', thresholdPercent: 70 } } })
    w.store['run.v1.r1'] = run
    w.store['runs.index.v1'] = ['r1']
    await boot($, w)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      await ui.press({ key: 'tab-context' })
      await w.clock.advance(300)
      const text = textOf(await ui.drawn())
      expect(text, surface).toContain('Peak context per session · hands off at 70%')
      expect(text, surface).toContain('RUN 7')
      // The last handoff: what it left (5 of 5), and what the fresh context picked up (4 of 5, the docs not read).
      for (const expected of ['LAST HANDOFF', 'Session 1 → 2', 'Left for the fresh context', '5 of 5', 'Picked up in session 2', '4 of 5', 'Project docs read', 'None opened', 'never from what Claude said']) {
        expect(text, `${surface}: ${expected}`).toContain(expected)
      }
      if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('Context shows the prompt cache: how long it stays warm, what it holds, Keep warm, and why it was rebuilt', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    w.store['cache.v1'] = { v: 1, ttl: '1h', ttlSource: 'engine', verified: 'unknown', verifiedAt: null }
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    // Every request writes its whole prompt afresh: the second, on another model, finds nothing cached.
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 300_000, model: e.model } }
    })
    await boot($, w)
    for (const [turnId, model] of [['t1', 'claude-opus-5-5'], ['t2', 'claude-sonnet-5-5']] as const) {
      await $.turn.start({ text: 'Build the parser.', turnId })
      for await (const _ of $.turn.step({ turnId, index: 0, model, effort: 'high', messageCount: 2 })) void _
      await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
    }
    await w.clock.advance(300)
    expect(w.kept.toasts).toContain('Cache rebuilt: 300k tokens · Model changed')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      await ui.press({ key: 'tab-context' })
      await w.clock.advance(300)
      const text = textOf(await ui.drawn())
      for (const expected of ['CACHE', 'Warm · lapses in about', '1-hour cache', '300k tokens cached', 'Keep warm while you are away', 'Ask before a model switch', 'Keep policies stable', 'CACHE HEALTH', '1 rebuild · 1 preventable', 'Model changed: opus-5-5 → sonnet-5-5', 'Preventable. Switch models', 'Switch models at the start of a fresh context', 'derived']) {
        expect(text, `${surface}: ${expected}`).toContain(expected)
      }
      await ui.unmount()
    }
    // The switch and the idle limit are set right there.
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await ui.press({ key: 'tab-context' })
    await w.clock.advance(300)
    expect(await ui.find({ key: 'cache-idle-inc' })).toBeUndefined()
    await ui.press({ key: 'cache-keep' })
    await w.clock.advance(300)
    await ui.press({ key: 'cache-idle-inc' })
    await w.clock.advance(2000)
    expect(saved(w).cache).toMatchObject({ keepWarm: true, maxIdleMinutes: 180 })
    expect(textOf(await ui.drawn())).toContain('Next refresh at')
    await ui.unmount()
    // The status bar names the costly rebuild for a few minutes, in place of the time left.
    const band = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    expect(textOf(await band.drawn())).toContain('CACHE ● rebuilt 300k')
    await band.unmount()
    const desktop = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(120) })
    expect((await desktop.find({ type: 'Svg' }))?.props.alt).toBeDefined()
    expect(textOf(await desktop.drawn())).toContain('rebuilt 300k')
  })

  test('the status bar: what is happening and the run cost on top, then Context, Work and Cache, each its own shape', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    w.store['cache.v1'] = { v: 1, ttl: '1h', ttlSource: 'engine', verified: 'unknown', verifiedAt: null }
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 300_000, model: e.model } }
    })
    await boot($, w)
    // Before the first turn: the top line is quiet, and nothing is cached yet.
    const before = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    const idle = textOf(await before.drawn())
    expect(idle).toContain('Ready')
    expect((await before.find({ type: 'Button', key: 'open' }))?.props.label).toBe('◆ Control Room')
    expect(idle).not.toContain('CACHE')
    await before.unmount()
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'mcp__control-room__milestones', milestones: [{ title: 'Sketch', status: 'completed' }, { title: 'Build', status: 'in_progress', doing: 'Building the parser' }, { title: 'Test', status: 'pending' }] } as never)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 2 })) void _
    await w.clock.advance(300)
    const band = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    const text = textOf(await band.drawn())
    expect(text).toContain('Building the parser · step 2 of 3')
    expect(text).toContain('RUN $1.25')
    expect(text).toContain('WORK ●━◉─○ 1/3')
    // While Claude works its requests keep the cache warm: the reading would only be noise.
    expect(text).not.toContain('CACHE')
    // The headline, then the instruments: what is happening sits above them.
    expect(text.indexOf('Building the parser')).toBeLessThan(text.indexOf('CONTEXT'))
    expect(text.indexOf('Control Room')).toBeLessThan(text.indexOf('CONTEXT'))
    // The button is a filled control, in the brand color while the panel is open.
    expect((await band.find({ type: 'Box', key: 'open-chip' }))?.props.backgroundColor).toBe('subtle')
    await $.command.run({ command: 'cr', args: 'open', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await w.clock.advance(300)
    await band.redraw()
    expect((await band.find({ type: 'Box', key: 'open-chip' }))?.props.backgroundColor).toBe('claude')
    await band.unmount()
    // Desktop: the state's mark, the track, the meter and the clock as SVG, each transparent on the app's theme.
    // The cache keeps its cell while Claude works: warm, its time left no reading while requests keep it so.
    const desktop = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(120) })
    const svgs: Node[] = []
    each(await desktop.drawn(), n => void (n.type === 'Svg' ? svgs.push(n) : undefined))
    expect(svgs.map(s => String(s.props?.alt))).toEqual(['working', 'Work: 1 of 3 milestones done', 'Context 30% used', expect.stringMatching(/^Prompt cache warm/)])
    for (const svg of svgs) expect(String(svg.props?.source)).toContain('color-scheme:light dark')
    expect(textOf(await desktop.find({ key: 'cell-cache' }))).toBe('Cachewarm')
    expect((await desktop.find({ type: 'Button', key: 'open' }))?.props.variant).toBe('primary')
    await desktop.unmount()
    // Once the turn ends and the person is away, the cache shows how long it has left.
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(300)
    const away = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
    expect(textOf(await away.drawn())).toMatch(/CACHE ● (1h|59m) left/)
    await away.unmount()
    for (const [columns, expected] of [[120, /^Cache(1h|59m) left$/], [60, /^Cache(1h|59m)$/]] as const) {
      const remote = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(columns) })
      expect(textOf(await remote.find({ key: 'cell-cache' })), String(columns)).toMatch(expected)
      await remote.unmount()
    }
  })

  test('on Desktop the four readings keep their cells, a quiet word standing in for one with nothing yet', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    // Mobile leaves the band to the engine.
    for (const surface of ['desktop'] as const) {
      for (const [columns, none] of [[120, 'No milestones yet'], [60, 'None']] as const) {
        const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'AbovePrompt', props: bandProps(columns) })
        const where = `${surface} ${columns}`
        // Before any milestone and before anything is cached: Work and Cache keep their place, in dim words.
        const work = await ui.find({ key: 'cell-work' })
        expect(textOf(work), where).toBe(`Work${none}`)
        expect(textOf(await ui.find({ key: 'cell-cache' })), where).toBe('Cache—')
        let dimmed = 0
        each(work, n => void (n.type === 'Text' && n.props?.dimColor === true && textOf(n) === none ? dimmed++ : undefined))
        expect(dimmed, where).toBe(1)
        // The three readings share the row equally; the run's cost takes what it needs at the right edge.
        for (const key of ['cell-work', 'cell-ctx', 'cell-cache']) expect((await ui.find({ key }))?.props.flexGrow, `${where} ${key}`).toBe(1)
        expect((await ui.find({ key: 'cell-run' }))?.props.flexGrow, where).toBe(0)
        await ui.unmount()
      }
    }
  })

  test('Overview leads with the run, then Work, Context and Cache, each with how it starts over', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    await boot($, w)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      const text = textOf(await ui.drawn())
      for (const expected of ['Run 1 · Session 1', '$1.25', 'WORK', 'CONTEXT', 'CACHE', 'Carries across handoffs', 'Starts over', 'Nothing cached yet', 'BEHAVIOR', 'GUARDRAILS', 'ACTIVITY']) {
        expect(text, `${surface}: ${expected}`).toContain(expected)
      }
      expect(text.indexOf('WORK'), surface).toBeLessThan(text.indexOf('CONTEXT'))
      expect(text.indexOf('CONTEXT'), surface).toBeLessThan(text.indexOf('CACHE'))
      expect(text.indexOf('CACHE'), surface).toBeLessThan(text.indexOf('BEHAVIOR'))
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await ui.press({ key: 'sys-keepwarm' })
    await w.clock.advance(2000)
    expect(saved(w).cache.keepWarm).toBe(true)
  })

  test('Kit, the companion: off by default; on, it walks its own row on its own clock, and a click opens Control Room', async ($, on) => {
    const w = world(on, { tokens: 300_000 })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    await boot($, w)
    const off = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    expect(await off.find({ type: 'Client' })).toBeUndefined()
    await off.unmount()
    expect((await $.command.run({ command: 'cr', args: 'companion on', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })).text).toContain('Kit')
    await w.clock.advance(300)

    const band = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'AbovePrompt', props: bandProps(120) })
    const client = await band.find({ type: 'Client' })
    expect(String(client?.props.module)).toContain('companion.client.tsx')
    expect((client?.props.props as { mood: string }).mood).toBe('wake')
    await band.resize({ columns: 100, rows: 2 })
    await band.advance(1000)
    const drawn = textOf(await band.drawn({ in: 'companion' }))
    expect(drawn).toMatch(/[▀▄█]/)
    // It walks: a few seconds later the fox stands somewhere else on its row.
    const where = async () => {
      let left = -1
      each(await band.drawn({ in: 'companion' }), n => {
        if (left < 0 && n.type === 'Box' && typeof n.props?.marginLeft === 'number' && textOf(n).match(/[▀▄█]/)) left = n.props.marginLeft
      })
      return left
    }
    // Claude starts a turn and thinks: Kit paces its lane.
    await $.turn.start({ text: 'Build the parser.', turnId: 't1' })
    await w.clock.advance(300)
    await band.redraw()
    expect(((await band.find({ type: 'Client' }))?.props.props as { mood: string }).mood).toBe('think')
    const before = await where()
    await band.advance(12_000)
    expect(await where()).not.toBe(before)
    // It works on a milestone: busy in one place.
    await $.tool.call({ tool: 'mcp__control-room__milestones', milestones: [{ title: 'Build', status: 'in_progress', doing: 'Building the parser' }, { title: 'Test', status: 'pending' }] } as never)
    await w.clock.advance(300)
    await band.redraw()
    expect(((await band.find({ type: 'Client' }))?.props.props as { mood: string }).mood).toBe('work')
    // A click on Kit opens Control Room.
    await band.pointer({ type: 'down', x: 1, y: 0, button: 'left' })
    await w.clock.advance(300)
    expect(w.kept.opened).toContain('control-room')
    await band.unmount()

    // Desktop: an SVG that animates itself; reduced motion holds it still.
    const kitSvg = async (ui: { drawn: () => Promise<unknown> }) => {
      let found: Node | undefined
      each(await ui.drawn(), n => void (n.type === 'Svg' && String(n.props?.alt).includes('Kit') ? (found = n) : undefined))
      return found
    }
    const desktop = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(120) })
    const svg = await kitSvg(desktop)
    expect(String(svg?.props?.alt)).toContain('Kit')
    // An image that animates itself, of a fixed size: never a sandboxed frame the surface sizes and paints.
    expect(svg?.props?.isInteractive).toBeUndefined()
    expect(svg?.props?.width).toBe(360)
    expect(svg?.props?.height).toBe(68)
    expect(String(svg?.props?.source)).toContain('<animate')
    await desktop.unmount()
    // A narrow band gives it a narrower lane, never one wider than the band.
    const narrowBand = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(40) })
    expect((await kitSvg(narrowBand))?.props?.width).toBe(240)
    await narrowBand.unmount()
    await $.command.run({ command: 'cr', args: 'motion off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await w.clock.advance(300)
    const still = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(120) })
    const held = await kitSvg(still)
    expect(held).toBeDefined()
    expect(String(held?.props?.source)).not.toContain('<animate')
    await still.unmount()
    // Setup carries both switches.
    const pane = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await pane.press({ key: 'tab-setup' })
    await w.clock.advance(300)
    await pane.press({ key: 'ui-companion' })
    await w.clock.advance(2000)
    expect(saved(w).ui).toMatchObject({ companion: false, reducedMotion: true })
  })

  test('panel hierarchy: Setup lists the most telling changes first, Guardrails groups permissions, Now is what Claude is doing', async ($, on) => {
    const w = world(on, {
      tokens: 300_000,
      settings: {
        autopilot: { enabled: true, thresholdPercent: 60 },
        frontier: { enabled: true },
        guard: { enabled: true },
        qa: { enabled: true },
        resources: { level: 'medium' },
        subagents: { mode: 'block' },
        focus: { enabled: false },
        answers: { style: 'brief' },
      },
    })
    await boot($, w)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      await ui.press({ key: 'tab-setup' })
      await w.clock.advance(300)
      let text = textOf(await ui.drawn())
      expect(text, surface).toContain('CHANGED FROM NORMAL')
      // Autopilot and Frontier Max before presentation; four shown, then a way to all of them.
      expect(text, surface).toContain('Hand off at')
      expect(text, surface).not.toContain('Focus')
      expect(String((await ui.find({ type: 'Button', key: 'changes-all' }))?.props.label), surface).toMatch(/^View all \d+/)
      expect(text, surface).not.toMatch(/and \d+ more/)
      await ui.press({ key: 'changes-all' })
      await w.clock.advance(300)
      text = textOf(await ui.drawn())
      expect(String((await ui.find({ type: 'Button', key: 'changes-all' }))?.props.label), surface).toMatch(/^Show fewer/)
      expect(text.indexOf('Hand off at'), surface).toBeLessThan(text.indexOf('Focus'))
      await ui.press({ key: 'changes-all' })
      await w.clock.advance(300)
      // Guardrails: the permissions in groups a person thinks in.
      await ui.press({ key: 'tab-guardrails' })
      await w.clock.advance(300)
      text = textOf(await ui.drawn())
      const order = ['PROJECT', 'Project edits', 'NETWORK', 'Network access', 'GIT', 'Git push', 'EXTERNAL', 'Deploy', 'SAFETY', 'Dangerous commands', 'Ask always asks you first', 'SUBAGENTS']
      for (let i = 1; i < order.length; i++) expect(text.indexOf(order[i - 1]!), `${surface}: ${order[i]}`).toBeLessThan(text.indexOf(order[i]!))
      // Each group is a card of its own, titled in the section's accent: a heading inside a box reads as a row on Desktop.
      for (const id of ['project', 'network', 'git', 'external', 'safety']) {
        const colors = new Set<unknown>()
        each(await ui.find({ key: `card-perm-${id}-head` }), n => void (n.type === 'Text' && n.props?.color !== undefined ? colors.add(n.props.color) : undefined))
        expect([...colors], `${surface} ${id}`).toEqual([ACCENT.guardrails])
      }
      // Overview: Now is what Claude is doing; the machine's readings sit with Guardrails.
      await ui.press({ key: 'tab-overview' })
      await w.clock.advance(300)
      text = textOf(await ui.drawn())
      const now = text.slice(text.indexOf('NOW'), text.indexOf('BEHAVIOR'))
      expect(now, surface).toContain('Ready')
      expect(now, surface).not.toContain('Memory')
      await ui.unmount()
    }
  })

  test('panel details: the permissions’ shared footnote after the last group, the Now mark, the cache’s dot, the turn legend in the strip’s colors', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
    const w = world(on, { tokens: 300_000, settings: { permissions: { commit: 'ask' } } as never })
    w.store['cache.v1'] = { v: 1, ttl: '1h', ttlSource: 'engine', verified: 'unknown', verifiedAt: null }
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 300_000, model: e.model } }
    })
    await boot($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 2 })) void _
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm run build' })
    await w.clock.advance(300)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'Pane', requestId: 'control-room', props: paneProps(66) })
      // Overview: Now carries the state's mark (the status bar's icon on Desktop, set on its first line); the cache a small dot.
      await ui.press({ key: 'tab-overview' })
      await w.clock.advance(300)
      const nowMark: Node[] = []
      each(await ui.find({ key: 'card-now' }), n => void (n.type === 'Svg' ? nowMark.push(n) : undefined))
      if (surface === 'desktop') {
        expect(nowMark.map(n => [n.props?.alt, n.props?.width, n.props?.height])).toEqual([['thinking', 16, 24]])
        expect(String(nowMark[0]?.props?.source)).toContain('translate(0 4)')
      } else expect(nowMark).toEqual([])
      const cacheCard = await ui.find({ key: 'card-life-cache' })
      let clockFaces = 0
      each(cacheCard, n => void (n.type === 'Svg' ? clockFaces++ : undefined))
      expect(clockFaces, surface).toBe(0)
      expect(textOf(cacheCard), surface).toMatch(/● Warm/)
      // Guardrails: Restore safe defaults and the footnote close the permission groups, after the last card.
      await ui.press({ key: 'tab-guardrails' })
      await w.clock.advance(300)
      const keys: string[] = []
      each(await ui.drawn(), n => void (keyOf(n) !== '' ? keys.push(keyOf(n)) : undefined))
      const at = (key: string) => keys.indexOf(key)
      expect(at('card-perm-safety'), surface).toBeGreaterThan(-1)
      expect(at('card-perm-safety'), surface).toBeLessThan(at('foot-permissions'))
      expect(at('foot-permissions'), surface).toBeLessThan(at('perm-reset'))
      expect(at('perm-reset'), surface).toBeLessThan(at('card-agents'))
      expect(textOf(await ui.find({ key: 'foot-permissions' })), surface).toContain('Deny always stops an action')
      // Activity: on Desktop the legend's squares are drawn in the strip's own colors.
      await ui.press({ key: 'tab-activity' })
      await w.clock.advance(300)
      const swatches: Node[] = []
      each(await ui.find({ key: 'turn-legend' }), n => void (n.type === 'Svg' ? swatches.push(n) : undefined))
      if (surface === 'desktop') {
        expect(swatches.map(s => s.props?.alt)).toEqual(['read', 'check'])
        expect(String(swatches[0]?.props?.source)).toContain(`fill="${TIMELINE.read.svg}"`)
        expect(String(swatches[1]?.props?.source)).toContain(`fill="${TIMELINE.check.svg}"`)
      } else {
        expect(swatches).toEqual([])
        expect(textOf(await ui.find({ key: 'turn-legend' }))).toContain('■ read')
      }
      await ui.unmount()
    }
    // Restore safe defaults puts every permission back.
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'terminal', component: 'Pane', requestId: 'control-room', props: paneProps(66) })
    await ui.press({ key: 'tab-guardrails' })
    await w.clock.advance(300)
    await ui.press({ key: 'perm-reset' })
    await w.clock.advance(2000)
    expect(saved(w).permissions.commit).toBe('default')
  })

  test('on Desktop no text of the panel or the status bar trips the app’s monospace rule', async ($, on) => {
    on('tool.call', { tool: 'Write' }, ($, e) => ({ result: { type: 'create', filePath: e.file_path, content: 'a\nb\n', structuredPatch: [], originalFile: null } }))
    on('tool.call', { tool: 'Edit' }, ($, e) => ({ result: { filePath: e.file_path, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+b', '+c'] }] } }))
    on('tool.call', { tool: 'Bash' }, ($, e) => (e.command === 'npm test' ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nFAIL a.test.ts' } : { result: { stdout: 'ok', stderr: '', interrupted: false } }))
    const w = world(on, { tokens: 300_000, settings: { answers: { style: 'quest' }, autopilot: { enabled: true } } })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    w.store['run.v1.r1'] = {
      v: 1,
      id: 'r1',
      number: 3,
      startedAt: 900_000,
      updatedAt: 990_000,
      root: '/work',
      profile: 'normal',
      status: 'active',
      sessions: [
        { id: 'earlier', index: 1, startedAt: 900_000, endedAt: 950_000, start: 'startup', end: 'handoff', peakTokens: 720_000, lastTokens: 718_000, window: 1_000_000, costUsd: 20, turns: 9, model: null, endNote: null, transitions: [] },
        { id: 'session-1', index: 2, startedAt: 950_000, endedAt: null, start: 'handoff', end: null, peakTokens: 300_000, lastTokens: 300_000, window: 1_000_000, costUsd: 4, turns: 2, model: null, endNote: null, transitions: [] },
      ],
      lastHandoff: LAST_HANDOFF,
    }
    w.store['runs.index.v1'] = ['r1']
    w.store['cache.v1'] = { v: 1, ttl: '1h', ttlSource: 'engine', verified: 'unknown', verifiedAt: null }
    // Two requests, the second on another model with nothing cached: the cache card and its health list draw too.
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 300_000, model: e.model } }
    })
    await boot($, w)
    await $.command.run({ command: 'cr', args: 'cache keep on', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await $.turn.start({ text: 'Build the parser and cover it with tests.', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 2 })) void _
    for await (const _ of $.turn.step({ turnId: 't1', index: 1, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 3 })) void _
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Sketch', status: 'completed', activeForm: 'Sketching' }, { content: 'Build', status: 'in_progress', activeForm: 'Building' }] })
    await $.tool.call({ tool: 'Write', file_path: '/work/src/parser.ts', content: 'a\nb\n' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/README.md', old_string: 'a', new_string: 'b\nc' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await w.clock.advance(300)
    // Desktop draws a text in a monospace face when it looks like a table or a rule (the app's own test).
    const looksTabular = (t: string): boolean => {
      if (/[─-▟]/u.test(t) || /[-=_~]{3,}|[-=]{2,}>|<[-=]{2,}/u.test(t)) return true
      const runs = [...t.matchAll(/\S( {2,})(?=\S)/gu)].map(m => m[1]?.length ?? 0)
      return runs.length >= 2 || runs.some(n => n >= 3)
    }
    const offenders: string[] = []
    const check = (tree: unknown, where: string) =>
      each(tree, n => {
        if (n.type !== 'Text' || !(n.children ?? []).every(c => typeof c === 'string')) return
        const t = (n.children as string[]).join('')
        if (t.trim() !== '' && looksTabular(t)) offenders.push(`${where}: ${JSON.stringify(t)}`)
      })
    const band = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'AbovePrompt', props: bandProps(110) })
    check(await band.drawn(), 'status bar')
    await band.unmount()
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'Pane', requestId: 'control-room', props: paneProps(90) })
    for (const tab of TABS) {
      await ui.press({ key: `tab-${tab.id}` })
      await w.clock.advance(300)
      check(await ui.drawn(), tab.id)
    }
    expect(offenders).toEqual([])
  })
})
