/**
 * The latest handoff, in Context: what it left behind for the fresh context
 * (Handoff Health) and what the fresh context picked up (Continuity), each
 * item counted from the tool calls Control Room saw.
 */

import type { RenderElement } from 'claude-code'

import type { HandoffCheckView, HandoffView, Tone } from '../../../types'
import * as fmt from '../../core/format'
import type { Kit } from '../kit'
import { card, listItem, note, pair } from '../primitives'
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

export function handoffCard(kit: Kit, h: HandoffView): RenderElement {
  const aside = `Session ${h.fromSession}${h.toSession === null ? '' : ` → ${h.toSession}`} · ${fmt.clock(h.at)}`
  return card(kit, {
    key: 'last-handoff',
    title: 'Last handoff',
    accent: ACCENT.context,
    aside,
    footer: 'Counted from the tool calls Control Room saw, never from what Claude said.',
    rows: k => [
      pair(k, { key: 'handoff-left', left: 'Left for the fresh context', right: scoreText(h.health) }),
      ...h.health.map(c => checkItem(k, 'health', c)),
      h.continuity !== null
        ? pair(k, { key: 'handoff-picked', left: `Picked up in session ${h.toSession ?? h.fromSession + 1}`, right: scoreText(h.continuity) })
        : h.isChecking
          ? note(k, `Picked up: checked when session ${h.toSession ?? h.fromSession + 1}'s first turn ends.`, 'handoff-checking')
          : h.via === 'compact'
            ? note(k, 'The context was compacted, so the work carried on in the same session.', 'handoff-compact')
            : null,
      ...(h.continuity ?? []).map(c => checkItem(k, 'continuity', c)),
    ],
  })
}
