/**
 * Session Chain: the current run as a chain of contexts, each with its peak
 * fill, how it ended and what it cost; then recent runs.
 *
 *   Run #14 · 3 sessions · $11.42 · 2 handoffs
 *   S1 ▰▰▰▰▰▰▰▱▱▱ 702k → handoff   $3.84  41 turns
 *   S2 ▰▰▰▰▰▰▰▱▱▱ 699k → handoff   $4.10  38 turns
 *   S3 ▰▰▰▰▱▱▱▱▱▱ 381k   active    $3.48  22 turns
 */

import type { RenderElement } from 'claude-code'

import type { ChainRunView, ChainSessionView, ChainView } from '../../../types'
import * as fmt from '../../core/format'
import { empty, hint, title } from '../components'
import type { Kit } from '../kit'
import { G, meter, toneProps } from '../theme'

const END_LABEL: Record<string, string> = {
  handoff: 'handoff → fresh',
  clear: 'cleared',
  exit: 'exited',
  resume: 'resumed elsewhere',
  logout: 'logged out',
  other: 'ended',
}

function sessionLine(kit: Kit, s: ChainSessionView, isLast: boolean, runIsActive: boolean): RenderElement {
  const { Box, Text } = kit.ui
  const isActive = isLast && runIsActive && s.endedAt === null
  const width = Math.max(6, Math.min(16, kit.columns - 50))
  const window = s.window ?? 0
  const fill = window > 0 ? s.peakTokens / window : 0
  const end = isActive ? 'active' : END_LABEL[s.end ?? 'other'] ?? s.end ?? 'ended'
  return (
    <Box flexDirection="column" key={`s-${s.id}`}>
      <Box flexDirection="row">
        <Box width={4} flexShrink={0}>
          <Text bold={isActive} color={isActive ? 'claude' : undefined}>{`S${s.index}`}</Text>
        </Box>
        <Text {...toneProps(isActive ? 'accent' : 'muted')}>{meter(fill, width)}</Text>
        <Box width={7} flexShrink={0} marginLeft={1}>
          <Text>{fmt.tokens(s.peakTokens > 0 ? s.peakTokens : null)}</Text>
        </Box>
        <Box width={18} flexShrink={0}>
          <Text {...toneProps(isActive ? 'good' : s.end === 'handoff' ? 'info' : 'muted')} wrap="truncate-end">{isActive ? `${G.dot} active` : `→ ${end}`}</Text>
        </Box>
        <Box width={9} flexShrink={0}>
          <Text>{fmt.cost(s.costUsd)}</Text>
        </Box>
        {kit.columns >= 70 ? <Text dimColor>{fmt.plural(s.turns, 'turn')}</Text> : null}
      </Box>
      {s.endNote === null && s.transitions === 0 ? null : (
        <Box marginLeft={4}>
          <Text dimColor wrap="truncate-end">
            {[s.endNote, s.transitions > 0 ? `${fmt.plural(s.transitions, 'compaction')}` : null].filter(Boolean).join(' · ')}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function runHeader(kit: Kit, run: ChainRunView): RenderElement {
  const { Text } = kit.ui
  return (
    <Text wrap="wrap">
      <Text bold>{`Run #${run.number}`}</Text>
      <Text dimColor>{` ${G.mid} ${fmt.when(run.startedAt, kit.now)} ${G.mid} ${fmt.plural(run.sessions.length, 'session')} ${G.mid} ${fmt.cost(run.costUsd)}${run.isCostPartial ? '+' : ''} ${G.mid} ${fmt.plural(run.handoffs, 'handoff')} ${G.mid} ${fmt.duration(run.durationMs)}`}</Text>
    </Text>
  )
}

export function chainTab(kit: Kit, view: ChainView | undefined): RenderElement {
  const { Box, Text } = kit.ui
  if (view === undefined || view.current === null) return empty(kit, 'The run starts with the first turn.')
  const run = view.current
  return (
    <Box flexDirection="column">
      {title(kit, 'Current run', run.root)}
      {runHeader(kit, run)}
      <Box flexDirection="column" marginTop={1}>
        {run.sessions.slice(-12).map((s, i, list) => sessionLine(kit, s, i === list.length - 1, run.status === 'active'))}
      </Box>
      {run.sessions.length > 12 ? <Text dimColor>{`(${run.sessions.length - 12} earlier sessions)`}</Text> : null}
      {title(kit, 'Recent runs')}
      {view.history.length === 0
        ? empty(kit, 'No earlier runs on this machine.')
        : view.history.map(r => (
            <Box key={`run-${r.id}`} flexDirection="row">
              <Box width={10} flexShrink={0}>
                <Text>{`#${r.number}`}</Text>
              </Box>
              <Text dimColor wrap="truncate-end">{`${fmt.when(r.startedAt, kit.now)} ${G.mid} ${fmt.plural(r.sessions.length, 'session')} ${G.mid} ${fmt.cost(r.costUsd)} ${G.mid} ${r.root}`}</Text>
            </Box>
          ))}
      {hint(kit, 'Costs are what Claude Code reports per session; "+" marks a total with sessions whose cost was not reported. Nothing is estimated.')}
    </Box>
  )
}
