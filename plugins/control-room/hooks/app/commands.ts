/**
 * `/control-room [sub-command]` (alias `/cr`): everything the Control Centre
 * does, typeable — handy over Remote Control, in `-p` runs and for muscle
 * memory. With no argument it toggles the Control Centre.
 */

import type { CommandRunResult } from 'claude-code'

import * as fmt from '../core/format'
import { listProfiles } from '../core/profiles'
import { defaultSettings } from '../core/settings'
import * as Chain from '../features/chain'
import type { Runtime } from './runtime'
import { hudOf, runLabelOf, statusLineOf } from './views'

const HELP = [
  'Control Room commands (/control-room or /cr):',
  '  (none)                 open or close the Control Centre',
  '  status                 one-screen status',
  '  profile [name]         list profiles, or apply one (normal, frontier, low-resource, release-qa, or yours)',
  '  autopilot on|off|70%|700k   Context Autopilot and its threshold',
  '  handoff                run the handoff now (notes + NEXT_SESSION_PROMPT.md), then continue fresh',
  '  fresh                  start the fresh context after a written handoff',
  '  frontier on|off · guard on|off · qa on|off · focus on|off',
  '  resources off|low|medium|high|<cpu>/<ram>',
  '  agents unlimited|off|ask|<n>',
  '  router off|balanced|performance|economy|custom',
  '  hud band|status|both|off',
  '  reset                  back to safe defaults (Normal)',
].join('\n')

const onOff = (word: string | undefined): boolean | null =>
  word === undefined ? null : ['on', 'true', 'yes', '1', 'enable', 'enabled'].includes(word) ? true : ['off', 'false', 'no', '0', 'disable', 'disabled'].includes(word) ? false : null

export function statusText(rt: Runtime): string {
  const hud = hudOf(rt)
  const totals = rt.run === null ? null : Chain.totals(rt.run, Date.now())
  const lines = [
    statusLineOf(hud),
    `${runLabelOf(rt)} · ${totals === null ? '' : `${fmt.plural(totals.sessions, 'session')} · run cost ${fmt.cost(totals.costUsd)}${totals.isCostPartial ? ' (partial)' : ''}`}`,
    `Autopilot: ${rt.autopilot.note}${rt.autopilot.threshold === null ? '' : ` (threshold ${fmt.tokens(rt.autopilot.threshold)})`}`,
    `Guard: ${rt.effective.guard.isActive ? 'active' : (rt.effective.guard.reason ?? 'off')} · Router: ${rt.settings.router.strategy} · Subagents: ${rt.subagentLabel()} · Focus View: ${rt.settings.focus.enabled ? 'on' : 'off'}`,
  ]
  if (rt.settings.resources.level !== 'off') {
    const p = rt.monitor.pressure
    lines.push(`Resources: ${rt.settings.resources.level} · ${rt.monitor.status}${p.cpu === null ? '' : ` · CPU ${Math.round(p.cpu)}%`}${p.ram === null ? '' : ` · RAM ${Math.round(p.ram)}%`} · ${p.level}`)
  }
  return lines.join('\n')
}

export async function handleCommand(rt: Runtime, args: string): Promise<CommandRunResult> {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const [verb, a1, a2] = words

  switch (verb) {
    case undefined: {
      const result = await rt.togglePane()
      if (result === 'closed') return { text: 'Control Room closed.' }
      if (result === 'opened') return { text: 'Control Room opened.' }
      return { text: `${statusText(rt)}\n(The Control Centre pane is not shown on this surface; use the sub-commands, e.g. /cr help.)` }
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
        return { text: `Context Autopilot ${toggle ? 'on' : 'off'}.` }
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
      return { text: `Context Autopilot on, threshold ${m[2] === '%' ? `${n}%` : fmt.tokens(rt.settings.autopilot.thresholdTokens)}.` }
    }
    case 'handoff':
      rt.requestHandoff()
      return { text: 'Handoff requested: Claude will write the handoff notes, then the work continues in a fresh context.' }
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
      return { text: `${verb === 'qa' ? 'Release/QA mode' : verb[0]!.toUpperCase() + verb.slice(1)} ${toggle ? 'on' : 'off'}.` }
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
      return { text: `Resource Governor: ${rt.settings.resources.level}${rt.settings.resources.level === 'custom' ? ` (CPU ${rt.settings.resources.cpu}%, RAM ${rt.settings.resources.ram}%)` : ''}. Claude was told about the change.` }
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
      return { text: `Model Router: ${a1}.` }
    }
    case 'hud': {
      const valid = ['band', 'status', 'both', 'off']
      if (a1 === undefined || !valid.includes(a1)) return { text: `Usage: /cr hud ${valid.join('|')}` }
      rt.update(s => {
        s.ui.hud = a1 as 'band' | 'status' | 'both' | 'off'
      })
      return { text: `HUD: ${a1}.` }
    }
    case 'reset': {
      if (a1 !== 'confirm') return { text: 'This resets every Control Room setting (custom profiles kept). Run /cr reset confirm to proceed.' }
      rt.update(s => ({ ...defaultSettings(), customProfiles: s.customProfiles }))
      return { text: 'Control Room settings reset to the Normal profile.' }
    }
    default:
      void a2
      return { text: `Unknown sub-command "${verb}".\n${HELP}` }
  }
}
