/**
 * Focus View's transcript rows. A tool call draws as one dim line with its
 * outcome and a ▸ to expand it in place; results and inline diffs fold
 * away. Drawing only — what Claude read is untouched — and every row can
 * be revealed (▸, the Focus toggle, or the Activity tab).
 */

import type { RenderElement } from 'claude-code'

import { clean } from '../core/text'
import { labelOf } from '../features/activity'
import type { Kit } from './kit'
import { G } from './theme'

export type ToolRowProps = {
  tool_use_id: string
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function compactToolRow(kit: Kit, props: ToolRowProps): RenderElement {
  const { Box, Text, Button } = kit.ui
  const label = clean(labelOf(props.tool, asRecord(props.input)), Math.max(10, kit.columns - props.tool.length - 12))
  const status = props.isRunning ? { glyph: G.run, color: 'permission' } : props.isInterrupted ? { glyph: G.stop, color: 'warning' } : props.isErrored ? { glyph: G.fail, color: 'error' } : { glyph: G.ok, color: 'success' }
  const tool = props.tool.startsWith('mcp__') ? props.tool.split('__').slice(1).join('·') : props.tool
  return (
    <Box flexDirection="row" key={`row-${props.tool_use_id}`}>
      <Text color={status.color}>{`${status.glyph} `}</Text>
      <Box flexShrink={1} flexGrow={1}>
        <Text dimColor wrap="truncate-end">
          <Text dimColor bold>{tool}</Text>
          {label === '' ? '' : `  ${label}`}
        </Text>
      </Box>
      <Button key={`expand-${props.tool_use_id}`} label={G.arrow} plain dimColor onPress={() => kit.actions.toggleRow(props.tool_use_id)} />
    </Box>
  )
}

/** A collapse control drawn above an expanded row. */
export function collapseBar(kit: Kit, id: string): RenderElement {
  const { Box, Button } = kit.ui
  return (
    <Box key={`collapse-${id}`}>
      <Button key={`collapse-${id}`} label={`${G.back} collapse`} plain dimColor onPress={() => kit.actions.toggleRow(id)} />
    </Box>
  )
}

export function hiddenRow(kit: Kit): RenderElement {
  const { Box } = kit.ui
  return <Box height={0} />
}
