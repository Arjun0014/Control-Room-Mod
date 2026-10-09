/**
 * The latest handoff, in Context: what it left behind for the fresh context
 * (Handoff Health) and what the fresh context picked up (Continuity), each
 * item counted from the tool calls Control Room saw. And Ready to resume: what
 * a fresh context would get now (the Resume Preview), and whether it is safe to
 * start one (docs/ORCHESTRATION.md, Resume state).
 */

import type { RenderElement } from 'claude-code'

import type { HandoffCheckView, HandoffView, ResumeView, Tone } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { card, field, listItem, note, pair } from '../primitives'
import { ACCENT, G } from '../theme'

const LOOK: Record<HandoffCheckView['state'], { glyph: string; tone: Tone }> = {
  ok: { glyph: G.ok, tone: 'good' },
  missing: { glyph: G.fail, tone: 'warn' },
  none: { glyph: G.ring, tone: 'muted' },
}

/** "4 of 5": what could be done and was, leaving out what was not needed. */
export function scoreText(checks: readonly HandoffCheckView[]): string {
  const counted = checks.filter(c => c.state !== 'none')
  return `${counted.filter(c => c.state === 'ok').length} of ${counted.length}`
}

function checkItem(kit: Kit, prefix: string, c: HandoffCheckView): RenderElement {
  const look = LOOK[c.state]
  return listItem(kit, {
    key: `${prefix}-${c.id}`,
    glyph: look.glyph,
    tone: look.tone,
    text: c.label,
    right: c.detail,
    rightTone: c.state === 'missing' ? 'warn' : 'muted',
    isDim: c.state === 'none',
  })
}

/**
 * Ready to resume: what a fresh context gets (the run, its milestones, what it reads, what it
 * carries, what it does next), and why a fresh start is not offered when it is not. Project
 * Sentinel starts one for Autopilot's handoff, a watcher's fresh wake and the Cold Resume Guard's
 * Start fresh; the last two only while this reads Ready.
 */
export function resumeCard(kit: Kit, view: ResumeView, isAwaiting: boolean): RenderElement {
  const { Text } = kit.ui
  const carries = [view.queued > 0 ? fmt.plural(view.queued, 'queued item') : '', view.decisions > 0 ? fmt.plural(view.decisions, 'open decision') : ''].filter(Boolean).join(' · ')
  return card(kit, {
    key: 'resume',
    title: 'Ready to resume',
    accent: ACCENT.context,
    aside: view.isHealthy ? 'Ready' : 'Not ready',
    footer: isAwaiting
      ? 'What the fresh context gets when you start it.'
      : 'What a fresh context would get now. A watcher’s fresh wake and the Cold Resume Guard’s Start fresh are offered only while this is ready.',
    rows: k => [
      view.objective === null && view.run === null
        ? null
        : field(k, { key: 'resume-run', label: 'Run', content: <Text wrap="truncate-end">{[view.run === null ? null : `Run ${view.run}`, view.objective].filter(Boolean).join(' · ')}</Text> }),
      field(k, { key: 'resume-done', label: 'Done', content: <Text wrap="truncate-end">{view.total === 0 ? 'No milestones' : `${view.doneCount} of ${fmt.plural(view.total, 'milestone')}`}</Text> }),
      view.current === null ? null : field(k, { key: 'resume-now', label: 'Under way', content: <Text wrap="truncate-end">{view.current}</Text> }),
      ...view.reads.map((r, i) => listItem(k, { key: `resume-read-${i}`, glyph: r.isOk ? G.ok : G.fail, tone: r.isOk ? 'good' : 'warn', text: r.label })),
      carries === '' ? null : field(k, { key: 'resume-carries', label: 'Carries', content: <Text wrap="truncate-end">{carries}</Text> }),
      view.next === null ? null : field(k, { key: 'resume-next', label: 'Next', content: <Text wrap="truncate-end">{view.next}</Text> }),
      ...view.problems.map((p, i) => note(k, `${G.warn} ${p}`, `resume-problem-${i}`, 'warn')),
    ],
  })
}

export function handoffCard(kit: Kit, view: HandoffView): RenderElement {
  const aside = `Session ${view.fromSession}${view.toSession === null ? '' : ` → ${view.toSession}`} · ${fmt.clock(view.at)}`
  return card(kit, {
    key: 'last-handoff',
    title: 'Last handoff',
    accent: ACCENT.context,
    aside,
    footer: 'Counted from the tool calls Control Room saw, never from what Claude said.',
    rows: k => [
      pair(k, { key: 'handoff-left', left: 'Left for the fresh context', right: scoreText(view.health) }),
      ...view.health.map(c => checkItem(k, 'health', c)),
      view.continuity !== null
        ? pair(k, { key: 'handoff-picked', left: `Picked up in session ${view.toSession ?? view.fromSession + 1}`, right: scoreText(view.continuity) })
        : view.isChecking
          ? note(k, `Picked up: checked when session ${view.toSession ?? view.fromSession + 1}'s first turn ends.`, 'handoff-checking')
          : view.via === 'compact'
            ? note(k, 'The context was compacted, so the work carried on in the same session.', 'handoff-compact')
            : null,
      ...(view.continuity ?? []).map(c => checkItem(k, 'continuity', c)),
    ],
  })
}
