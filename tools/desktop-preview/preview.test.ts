import { describe, test } from 'claude-code/testing'

import { SESSION, world } from './fixtures/world'

const band = (bodyColumns: number) => ({ hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} })
const WIDTHS = [120, 96, 64]
const PANE = 90
const cmd = (args: string) => ({ command: 'cr', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })

describe('preview', () => {
  test('desktop band states', async ($, on) => {
    on('tool.call', { tool: 'Bash' }, ($, e) =>
      e.command === 'npm run lint' ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nnpm error Missing script: "lint"' } : { result: { stdout: 'ok', stderr: '', interrupted: false } },
    )
    const w = world(on, { tokens: 240_000 })
    w.store['cache.v1'] = { v: 1, ttl: '1h', ttlSource: 'engine', verified: 'unknown', verifiedAt: null }
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
    let read = 0
    on('turn.step', async function* ($, e) {
      const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: read, cache_creation_input_tokens: 240_000 - read, model: e.model }
      read = 240_000
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage }
    })
    await $.session.start(SESSION)
    await w.clock.advance(300)
    await $.command.run(cmd('autopilot on'))
    await w.clock.advance(300)
    const dump = async (name: string, surfaces: readonly ('desktop' | 'terminal')[] = ['desktop']) => {
      for (const surface of surfaces) {
        for (const columns of surface === 'desktop' ? WIDTHS : [150, 100, 80]) {
          const ui = await $.ui.mount({ plugin: 'control-room', surface, component: 'AbovePrompt', props: band(columns), viewport: { columns, rows: 40 } })
          console.log(`PREVIEW\t${name}\t${surface}\t${columns}\t${JSON.stringify(await ui.drawn())}`)
          await ui.unmount()
        }
      }
    }
    await dump('ready')
    await $.turn.start({ text: 'go', turnId: 't1' })
    // A turn under way before Claude lists milestones, the cache warm from its first request.
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 2 })) void _
    await w.clock.advance(300)
    await dump('working-no-plan')
    await $.tool.call({
      tool: 'mcp__control-room__milestones',
      milestones: [
        { title: 'Understand the code', status: 'completed' },
        { title: 'Investigate the Git strip', status: 'completed' },
        { title: 'Verify the cache', status: 'in_progress', doing: 'Running the regression tests' },
        { title: 'Verify Autopilot', status: 'pending' },
        { title: 'Redesign the status bar', status: 'verifying' },
        { title: 'Redesign Kit', status: 'verifying' },
        { title: 'Panel hierarchy', status: 'verifying' },
        { title: 'Milestone quality', status: 'verifying' },
        { title: 'Docs and screenshots', status: 'pending' },
        { title: 'Release', status: 'pending' },
      ],
    } as never)
    for await (const _ of $.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 })) void _
    await w.clock.advance(300)
    await dump('working')
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 2, model: 'claude-opus-5-5', effort: 'high', messageCount: 4 })) void _
    await $.turn.complete({ answer: 'done', durationMs: 46_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(300)
    await dump('done-failing')
    // Away for a while: the cache shows its time left.
    await w.clock.advance(12 * 60_000)
    await dump('away')
    await $.command.run(cmd('companion on'))
    await w.clock.advance(300)
    await dump('kit', ['desktop', 'terminal'])
    // The panel's pages, as a docked pane draws them.
    const pane = { title: 'Control Room', isFocused: true, bodyColumns: PANE, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
    const ui = await $.ui.mount({ plugin: 'control-room', surface: 'desktop', component: 'Pane', requestId: 'control-room', props: pane, viewport: { columns: PANE, rows: 80 } })
    for (const tab of ['overview', 'context', 'behavior', 'guardrails', 'activity', 'setup']) {
      await ui.press({ key: `tab-${tab}` })
      await w.clock.advance(300)
      console.log(`PREVIEW\tpane-${tab}\tdesktop\t${PANE}\t${JSON.stringify(await ui.drawn())}`)
    }
    await ui.unmount()
  })
})
