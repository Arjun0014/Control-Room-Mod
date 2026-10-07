/**
 * Control Room — the hooks module.
 *
 * This file is deliberately thin: it builds the Host adapter from `$` (the
 * one place the engine interface is spelled, as `claude plugin validate`
 * requires) and registers every hook, each a few lines delegating to the
 * Runtime. Gating hooks carry a `.catch` that falls back to Claude Code's
 * own behaviour — never to anything looser.
 */

import { atom, read } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import { PANE_ID } from './constants'
import { POLICY_SECTION_ID } from './core/policy'
import { isObviouslyDangerous } from './features/permissions/categories'
import { isEditTool, isShellTool } from './features/permissions/decide'
import { actionsOf } from './app/actions'
import { Runtime } from './app/runtime'
import * as Views from './app/views'
import type { Host } from './host'
import { type Kit, uiOf } from './ui/kit'
import { hudView } from './ui/hud'
import { TAB_NEEDS, paneView } from './ui/pane/frame'
import { collapseBar, compactToolRow, hiddenRow } from './ui/rows'

// ---------------------------------------------------------------------------
// `$.state` atoms: literal references, as the validator requires.

const HUD = { plugin: 'control-room', key: 'hud' } as const
const PANE = { plugin: 'control-room', key: 'pane' } as const
const RESOURCES = { plugin: 'control-room', key: 'resources' } as const
const CHAIN = { plugin: 'control-room', key: 'chain' } as const
const ACTIVITY = { plugin: 'control-room', key: 'activity' } as const
const PERMISSIONS = { plugin: 'control-room', key: 'permissions' } as const
const FOCUS = { plugin: 'control-room', key: 'focus' } as const
const SPINNER = { plugin: 'control-room', key: 'spinner' } as const
const AUTOPILOT = { plugin: 'control-room', key: 'autopilot' } as const

const blank = new Runtime()
const hudAtom = atom(HUD, Views.hudOf(blank))
const paneAtom = atom(PANE, Views.paneOf(blank))
const resourcesAtom = atom(RESOURCES, Views.resourcesOf(blank))
const chainAtom = atom(CHAIN, Views.chainOf(blank))
const activityAtom = atom(ACTIVITY, Views.activityOf(blank))
const permissionsAtom = atom(PERMISSIONS, Views.permissionsOf(blank))
const focusAtom = atom(FOCUS, Views.focusOf(blank))
const spinnerAtom = atom(SPINNER, Views.spinnerOf(blank))

// ---------------------------------------------------------------------------
// The Host: every engine call Control Room makes, spelled once.

function hostOf($: EngineInterface): Host {
  return {
    pluginRoot: $.plugin.root,
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    every: (ms, fn) => $.clock.every(ms, fn),

    sessionId: () => $.session.id(),
    sessionRoot: () => $.session.root(),
    sessionModel: () => $.session.model(),
    usage: () => $.session.usage(),
    usageSummary: () => $.session.usage({ breakdown: 'summary' }),
    version: () => $.session.version(),
    surfaces: () => $.session.surfaces(),
    appendForModel: text =>
      $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }).then(
        r => r.deny === undefined,
        () => false,
      ),
    compact: instructions => $.session.compact({ instructions }),

    submit: text => $.prompt.submit({ text }),
    runCommand: (command, args) => $.command.run({ command, args: args ?? '' }),
    registerCommand: spec => $.command.register(spec),
    listCommands: () => $.command.list(),

    listAgents: () => $.agent.list(),
    listTools: () => $.tool.list(),
    registerTool: spec => $.tool.register(spec).then(r => r.tool),
    stopTask: taskId => $.tool.call({ tool: 'TaskStop', task_id: taskId }),
    classify: (text, labels, model) => $.model.classify(text, labels, model === undefined ? undefined : { model }),

    toast: (text, timeoutMs) => $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs }),
    status: text => $.ui.status(text),
    open: pane => $.ui.open(pane),
    close: pane => $.ui.close(pane),
    panes: () => $.ui.panes(),
    scrollPaneToTop: () => $.ui.scroll({ in: PANE_ID, to: 'start' }).then(() => undefined),
    ask: (question, options, header) => $.ui.ask(question, header === undefined ? options : { options, header }),
    copy: (text, surface) => $.ui.copy({ text, surface }).then(r => r.isCopied),

    readText: path => $.fs.read(path),
    stat: (path, resolve) => $.fs.stat(path, { resolve }),
    exists: path => $.fs.exists(path),

    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    storeDelete: key => $.store.delete(key),

    settings: source => $.settings.read(source === undefined ? undefined : { source }),
    spawn: argv => $.process.spawn({ argv }),

    publishHud: v => $.state.set(HUD, v).then(() => undefined),
    publishPane: v => $.state.set(PANE, v).then(() => undefined),
    publishResources: v => $.state.set(RESOURCES, v).then(() => undefined),
    publishChain: v => $.state.set(CHAIN, v).then(() => undefined),
    publishActivity: v => $.state.set(ACTIVITY, v).then(() => undefined),
    publishPermissions: v => $.state.set(PERMISSIONS, v).then(() => undefined),
    publishFocus: v => $.state.set(FOCUS, v).then(() => undefined),
    publishSpinner: v => $.state.set(SPINNER, v).then(() => undefined),

    saveAutopilotRecord: record => $.state.set(AUTOPILOT, { record }).then(() => undefined),
    loadAutopilotRecord: () => $.state.get(AUTOPILOT).then(read => read.value?.record ?? null),

    invalidateDescribes: () => $.ui.invalidate('tool.describe'),
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export const register: Register = on => {
  const rt = new Runtime()
  const actions = actionsOf(rt)
  const kitOf = (table: Parameters<typeof uiOf>[0], columns: number, surface: RenderSurface, placement?: Kit['placement']): Kit => ({
    ui: uiOf(table, surface),
    actions,
    columns: Math.max(20, columns),
    surface,
    now: Date.now(),
    openPicker: null,
    placement,
  })

  // -------------------------------------------------------------------------
  // Session lifecycle

  on('session.start', async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    const started = await next(e)
    await rt.onSessionStart(e)
    return started
  })

  on('session.end', async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    await rt.onSessionEnd(e).catch(() => undefined)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    const answer = await next(e)
    if (e.permission_mode !== undefined) rt.permissionMode = e.permission_mode
    const context = await rt.onClassicSessionStart({ source: e.source, sessionId: e.session_id, model: e.model })
    return context.length === 0 ? answer : { ...answer, additionalContext: [...(answer.additionalContext ?? []), ...context] }
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', ($, e, next) => {
    if (e.permission_mode !== undefined) rt.permissionMode = e.permission_mode
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.attach', async ($, e, next) => {
    const answer = await next(e)
    if (!rt.surfaces.includes(e.surface)) rt.surfaces = [...rt.surfaces, e.surface]
    rt.publisher.mark('pane')
    return answer
  })

  on('session.measure', ($, e, next) => {
    rt.onMeasure(e)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId === undefined) rt.onCompacted(e.trigger, answer)
    return answer
  }).catch(($, e, next) => next(e))

  // -------------------------------------------------------------------------
  // Prompts and the system prompt

  on('prompt.submit', async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    await rt.ensureLoaded()
    const extra = rt.onPromptSubmit(e.text, e.origin)
    return next(extra.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...extra] })
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const answer = await next(e)
    const section = rt.composeSection()
    if (section === null) return answer
    return { sections: [...answer.sections.filter(s => s.id !== POLICY_SECTION_ID), section] }
  }).catch(($, e, next) => next(e))

  // -------------------------------------------------------------------------
  // Turns

  on('turn.start', ($, e, next) => {
    rt.onTurnStart({ turnId: e.turnId, text: e.text })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const want = rt.stepRequest(e)
    const request = want.model === undefined && want.effort === undefined ? e : { ...e, ...want }
    const answer = yield* next(request)
    rt.stepResponse(e, want, answer)
    return answer
  })

  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)
    await rt.onTurnComplete({ agentId: e.agentId, reason: e.reason, answer: e.answer })
    return answer
  })

  on('classic.Stop', async ($, e, next) => {
    const answer = await next(e)
    if (answer.block !== undefined || answer.preventContinuation === true) return answer
    const block = await rt.onStop({
      stopHookActive: e.stop_hook_active,
      lastMessage: e.last_assistant_message ?? '',
      backgroundCount: (e.background_tasks ?? []).length,
      permissionMode: e.permission_mode,
    })
    return block === null ? answer : { ...answer, block }
  }).catch(($, e, next) => next(e))

  // -------------------------------------------------------------------------
  // Tools: permissions, resources, activity

  // Control Room's own milestones tool, offered only where Claude Code has no task list.
  // Registered before the general hook, so it answers the call itself.
  on('tool.call', { tool: /^mcp__control-room__milestones$/ }, async ($, e) => {
    if (rt.host === null) rt.bind(hostOf($))
    await rt.ensureLoaded()
    return { result: rt.recordMilestones(isRecord(e) ? { ...e } : {}, e.agentId) }
  })

  on('tool.call', async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    const tool = String(e.tool)
    const input: Record<string, unknown> = isRecord(e) ? { ...e } : {}
    const refusal = await rt.beforeTool(tool, input, e.tool_use_id, e.agentId)
    if (refusal !== null) return { deny: refusal }
    let answer: Awaited<ReturnType<typeof next>> | undefined
    try {
      answer = await next(e)
      return answer
    } finally {
      rt.afterTool(tool, input, e.tool_use_id, answer, e.agentId)
    }
  }).catch(($, e, next) => {
    // Fail safe: a crash in the full classifier still never lets an obvious catastrophe through.
    const raw = (e as unknown as Record<string, unknown>).command
    const command = isShellTool(String(e.tool)) && typeof raw === 'string' ? raw : ''
    if (!next.called && command !== '' && isObviouslyDangerous(command)) {
      return { deny: 'Control Room Permission Policy: refused a dangerous command (safety fallback).' }
    }
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    return rt.checkTool(e.tool, e.input, verdict)
  }).catch(($, e, next) => next(e))

  // -------------------------------------------------------------------------
  // Subagents

  on('agent.offer', async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    await rt.ensureLoaded()
    return rt.isAgentOffered(e) ? next(e) : { isOffered: false }
  }).catch(($, e, next) => (rt.settings.subagents.mode === 'block' ? { isOffered: false } : next(e)))

  on('agent.spawn', async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    const decision = await rt.onAgentSpawn(e)
    if (decision.deny !== undefined) return { deny: decision.deny }
    return next(decision.model === undefined ? e : { ...e, model: decision.model })
  }).catch(($, e, next) =>
    rt.settings.subagents.mode === 'block' && !next.called ? { deny: 'Control Room: subagents are disabled in this session.' } : next(e),
  )

  // -------------------------------------------------------------------------
  // Commands

  on('command.run', { command: ['control-room', 'cr'] }, async ($, e, next) => {
    if (rt.host === null) rt.bind(hostOf($))
    if (!rt.isOwnCommand(e.command)) return next(e)
    await rt.ensureLoaded()
    return rt.runCommand(e.args)
  }).catch(($, e, next) =>
    next.called ? next(e) : { text: 'Control Room could not complete that command (details in the debug log: claude --debug).' },
  )

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const answer = await next(e)
    if (answer.deny === undefined) {
      rt.ui.isPaneOpen = false
      rt.publisher.mark('hud')
    }
    return answer
  }).catch(($, e, next) => next(e))

  // -------------------------------------------------------------------------
  // Drawing

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface === 'mobile') return next(e)
    const hud = await read($, hudAtom)
    if (!hud.isVisible) return next(e)
    const below = await next(e)
    const own = hudView(kitOf($.ui.resolve(e), e.props.bodyColumns, e.surface), hud)
    if (below.type === 'engine') return own
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {own}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const pane = await read($, paneAtom)
    const hud = await read($, hudAtom)
    const needs = TAB_NEEDS[pane.tab]
    const data = {
      pane,
      hud,
      resources: needs.includes('resources') ? await read($, resourcesAtom) : undefined,
      chain: needs.includes('chain') ? await read($, chainAtom) : undefined,
      activity: needs.includes('activity') ? await read($, activityAtom) : undefined,
      permissions: needs.includes('permissions') ? await read($, permissionsAtom) : undefined,
    }
    return paneView(kitOf($.ui.resolve(e), e.props.bodyColumns, e.surface, e.props.placement), data)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const focus = await read($, focusAtom)
    if (!focus.isOn) return next(e)
    const kit = kitOf($.ui.resolve(e), e.viewport?.columns ?? 100, e.surface)
    if (focus.expanded.includes(e.props.tool_use_id)) {
      const { Box } = kit.ui
      return (
        <Box flexDirection="column">
          {collapseBar(kit, e.props.tool_use_id)}
          {await next(e)}
        </Box>
      )
    }
    if (focus.tools === 'hidden') return hiddenRow(kit)
    return compactToolRow(kit, e.props)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const focus = await read($, focusAtom)
    if (!focus.isOn || focus.expanded.includes(e.props.tool_use_id)) return next(e)
    const isDiff = isEditTool(e.props.tool)
    const isShown = isDiff ? focus.diffs : focus.results
    if (isShown || e.props.isErrored) return next(e)
    return hiddenRow(kitOf($.ui.resolve(e), 40, e.surface))
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const focus = await read($, focusAtom)
    if (!focus.isOn || focus.tools !== 'hidden' || e.props.isExpanded) return next(e)
    return hiddenRow(kitOf($.ui.resolve(e), 40, e.surface))
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const spinner = await read($, spinnerAtom)
    if (spinner.line === null) return next(e)
    return next({ ...e, props: { ...e.props, message: spinner.line } })
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const hud = await read($, hudAtom)
    const label = hud.frontier.isOn && hud.profile.id !== 'frontier' ? 'Frontier Max' : hud.profile.id === 'normal' ? null : hud.profile.name
    if (label === null) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, `◆ ${label}`] } })
  })

}
