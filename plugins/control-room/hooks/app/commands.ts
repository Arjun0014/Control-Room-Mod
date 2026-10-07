/**
 * `/control-room [sub-command]` (alias `/cr`): everything the panel does,
 * typeable — handy over Remote Control, in `-p` runs and for muscle memory.
 * With no argument it opens or closes the panel. Replies use the panel's words.
 */

import type { CommandRunResult } from 'claude-code'

import * as fmt from '../core/format'
import { listProfiles } from '../core/profiles'
import { defaultSettings } from '../core/settings'
import * as Chain from '../features/chain'
import type { Runtime } from './runtime'
import { hudOf, profileOf, runLabelOf, statusOf } from './views'

const HELP = [
  'Control Room  (/cr or /control-room)',
  '  /cr                       open or close Control Room',
  '  /cr status                everything at a glance',
  '  /cr profile [name]        list profiles, or switch (normal, frontier, low-resource, release-qa, yours)',
  '  /cr autopilot on|off|70%|700k',
  '  /cr handoff               hand off now, then continue in a fresh context',
  '  /cr fresh                 start the fresh context when a handoff is waiting',
  '  /cr frontier|guard|qa|focus on|off',
  '  /cr resources off|low|medium|high|60/80',
  '  /cr agents unlimited|off|ask|<n>',
  '  /cr router off|balanced|performance|economy|custom',
  '  /cr hud band|status|both|off',
  '  /cr reset confirm         back to Normal (custom profiles are kept)',
].join('\n')

const onOff = (word: string | undefined): boolean | null =>
  word === undefined ? null : ['on', 'true', 'yes', '1', 'enable', 'enabled'].includes(word) ? true : ['off', 'false', 'no', '0', 'disable', 'disabled'].includes(word) ? false : null

export function statusText(rt: Runtime): string {
  const hud = hudOf(rt)
  const st = statusOf(rt)
  const p = profileOf(rt)
  const totals = rt.run === null ? null : Chain.totals(rt.run, Date.now())
  const ctx = hud.ctx.pct === null ? 'waiting for the first response' : `${hud.ctx.pct}% · ${fmt.tokens(hud.ctx.tokens)} of ${fmt.tokens(hud.ctx.window)} tokens`
  const runCost = totals !== null && totals.sessions > 1 ? ` · ${fmt.cost(totals.costUsd)}${totals.isCostPartial ? '+' : ''} this run` : ''
  const lines: [string, string][] = [
    ['Context', ctx],
    ['Cost', `${fmt.cost(hud.cost.usd)} this session${runCost}`],
    ['Autopilot', rt.settings.autopilot.enabled ? `${st.autopilot.text} · ${rt.autopilot.note}` : st.autopilot.text],
    ['Frontier Max', st.frontier.text],
    ['Lazy-exit guard', st.guard.text],
    ['Release check', st.qa.text],
    ['Model router', st.router.text],
    ['Subagents', st.subagents.text],
    ['Machine load', st.load.text],
    ['Focus view', st.focus.text],
  ]
  const head = `◆ Control Room · ${p.name}${p.isModified ? ' (edited)' : ''} · ${runLabelOf(rt)}`
  return [head, ...lines.map(([label, value]) => `${label.padEnd(17)}${value}`)].join('\n')
}

export async function handleCommand(rt: Runtime, args: string): Promise<CommandRunResult> {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const [verb, a1, a2] = words

  switch (verb) {
    case undefined: {
      const result = await rt.togglePane()
      if (result === 'closed') return { text: 'Control Room closed.' }
      if (result === 'opened') return { text: 'Control Room opened.' }
      return { text: `${statusText(rt)}\n(The panel is not shown on this surface. Every control is a sub-command: /cr help.)` }
    }
    case 'help':
    case '?':
      return { text: HELP }
    case 'status':
      return { text: statusText(rt) }
    case 'open':
      await rt.openPane(true)
      return { text: 'Control Room opened.' }
    case 'close':
      await rt.closePane()
      return { text: 'Control Room closed.' }
    case 'profile':
    case 'profiles': {
      if (a1 === undefined) {
        const list = listProfiles(rt.settings).map(p => `  ${p.id.padEnd(20)} ${p.name} — ${p.tagline}`)
        return { text: `Active: ${rt.profileLabel}\n${list.join('\n')}` }
      }
      const name = words.slice(1).join(' ')
      return rt.applyProfileById(name) ? { text: `Profile ${rt.profileLabel} applied.` } : { text: `No profile named "${name}". Try /cr profile.` }
    }
    case 'autopilot':
    case 'auto': {
      const toggle = onOff(a1)
      if (toggle !== null) {
        rt.update(s => {
          s.autopilot.enabled = toggle
        })
        return { text: `Autopilot ${toggle ? 'on' : 'off'}.` }
      }
      const m = a1 === undefined ? null : /^(\d+(?:\.\d+)?)(%|k|m)?$/.exec(a1)
      if (m === null) return { text: 'Usage: /cr autopilot on|off|70%|700k' }
      const n = Number(m[1])
      rt.update(s => {
        s.autopilot.enabled = true
        if (m[2] === '%') {
          s.autopilot.thresholdMode = 'percent'
          s.autopilot.thresholdPercent = n
        } else {
          s.autopilot.thresholdMode = 'tokens'
          s.autopilot.thresholdTokens = m[2] === 'k' ? n * 1000 : m[2] === 'm' ? n * 1_000_000 : n
        }
      })
      return { text: `Autopilot on. Hands off at ${m[2] === '%' ? `${rt.settings.autopilot.thresholdPercent}%` : fmt.tokens(rt.settings.autopilot.thresholdTokens)}.` }
    }
    case 'handoff':
      rt.requestHandoff()
      return { text: 'Handing off: Claude writes the handoff notes, then the work continues in a fresh context.' }
    case 'fresh':
      if (rt.autopilot.state !== 'awaiting') {
        return { text: 'No written handoff is waiting. Run /cr handoff first (it writes the notes, then continues fresh), or /clear to discard this context.' }
      }
      rt.startFreshContext()
      return { text: 'Starting a fresh context…' }
    case 'frontier':
    case 'guard':
    case 'qa':
    case 'focus': {
      const toggle = onOff(a1)
      if (toggle === null) return { text: `Usage: /cr ${verb} on|off` }
      rt.update(s => {
        if (verb === 'frontier') {
          s.frontier.enabled = toggle
          if (toggle) s.guard.enabled = true
        }
        if (verb === 'guard') s.guard.enabled = toggle
        if (verb === 'qa') s.qa.enabled = toggle
        if (verb === 'focus') s.focus.enabled = toggle
      })
      const name = { frontier: 'Frontier Max', guard: 'Lazy-exit guard', qa: 'Release check', focus: 'Focus view' }[verb]
      return { text: `${name} ${toggle ? 'on' : 'off'}${verb === 'frontier' && toggle ? ', with the lazy-exit guard' : ''}.` }
    }
    case 'resources':
    case 'res': {
      if (a1 === undefined) return { text: 'Usage: /cr resources off|low|medium|high|<cpu>/<ram>' }
      const custom = /^(\d{2,3})\/(\d{2,3})$/.exec(a1)
      if (['off', 'low', 'medium', 'high'].includes(a1)) {
        rt.update(s => {
          s.resources.level = a1 as 'off' | 'low' | 'medium' | 'high'
        })
      } else if (custom !== null) {
        rt.update(s => {
          s.resources.level = 'custom'
          s.resources.cpu = Number(custom[1])
          s.resources.ram = Number(custom[2])
        })
      } else return { text: 'Usage: /cr resources off|low|medium|high|<cpu>/<ram>' }
      const r = rt.settings.resources
      if (r.level === 'off') return { text: 'Machine load limit off. Readings only.' }
      const ceilings = rt.effective.resources.ceilings
      return { text: `Machine load ${r.level.charAt(0).toUpperCase()}${r.level.slice(1)}: ceilings at CPU ${ceilings?.cpu ?? r.cpu}% · RAM ${ceilings?.ram ?? r.ram}%. Claude was told.` }
    }
    case 'agents':
    case 'subagents': {
      if (a1 === undefined) return { text: 'Usage: /cr agents unlimited|off|ask|<n>' }
      const n = Number(a1)
      rt.update(s => {
        if (a1 === 'unlimited' || a1 === 'unrestricted') s.subagents.mode = 'unrestricted'
        else if (a1 === 'off' || a1 === 'block' || a1 === 'none') s.subagents.mode = 'block'
        else if (a1 === 'ask') s.subagents.mode = 'ask'
        else if (Number.isInteger(n) && n > 0) {
          s.subagents.mode = 'limit'
          s.subagents.limit = n
        }
      })
      return { text: `Subagents: ${rt.subagentLabel()}.` }
    }
    case 'router': {
      const valid = ['off', 'balanced', 'performance', 'economy', 'custom']
      if (a1 === undefined || !valid.includes(a1)) return { text: `Usage: /cr router ${valid.join('|')}` }
      rt.update(s => {
        s.router.strategy = a1 as 'off' | 'balanced' | 'performance' | 'economy' | 'custom'
      })
      return { text: `Model router ${a1 === 'off' ? 'off' : `${a1.charAt(0).toUpperCase()}${a1.slice(1)}`}.` }
    }
    case 'hud': {
      const valid = ['band', 'status', 'both', 'off']
      if (a1 === undefined || !valid.includes(a1)) return { text: `Usage: /cr hud ${valid.join('|')}` }
      rt.update(s => {
        s.ui.hud = a1 as 'band' | 'status' | 'both' | 'off'
      })
      const where = { band: 'above the prompt', status: "in Claude Code's status line", both: "above the prompt and in the status line", off: 'hidden' }[a1 as 'band' | 'status' | 'both' | 'off']
      return { text: `Status bar ${where}.` }
    }
    case 'reset': {
      if (a1 !== 'confirm') return { text: 'This resets every Control Room setting (custom profiles kept). Run /cr reset confirm to proceed.' }
      rt.update(s => ({ ...defaultSettings(), customProfiles: s.customProfiles }))
      return { text: 'Settings reset to Normal. Your profiles are kept.' }
    }
    default:
      void a2
      return { text: `Unknown sub-command "${verb}".\n${HELP}` }
  }
}
