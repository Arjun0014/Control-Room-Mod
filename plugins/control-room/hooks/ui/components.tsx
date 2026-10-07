/**
 * Shared building blocks for the HUD and the Control Centre. Each takes the
 * Kit and returns an element tree; the same tree draws on the terminal (Ink)
 * and on Desktop (native controls).
 */

import type { RenderElement } from 'claude-code'

import type { Tone } from '../../types'
import { clean, truncate } from '../core/text'
import type { Kit } from './kit'
import { G, toneProps } from './theme'

export function title(kit: Kit, text: string, right?: string): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text bold color="claude">
        {text.toUpperCase()}
      </Text>
      {right === undefined ? null : <Text dimColor>{right}</Text>}
    </Box>
  )
}

export function hint(kit: Kit, text: string): RenderElement {
  const { Text } = kit.ui
  return (
    <Text dimColor wrap="wrap">
      {text}
    </Text>
  )
}

export function rule(kit: Kit): RenderElement {
  const { Text } = kit.ui
  return <Text dimColor>{G.rule.repeat(Math.max(4, Math.min(kit.columns, 200)))}</Text>
}

export function toned(kit: Kit, text: string, tone: Tone): RenderElement {
  const { Text } = kit.ui
  return <Text {...toneProps(tone)}>{text}</Text>
}

/** `Label ........ value` with the value toned. */
export function field(kit: Kit, label: string, value: string, tone: Tone = 'normal', detail?: string): RenderElement {
  const { Box, Text } = kit.ui
  const labelWidth = Math.min(22, Math.max(12, Math.floor(kit.columns * 0.34)))
  return (
    <Box flexDirection="row">
      <Box width={labelWidth} flexShrink={0} paddingRight={1}>
        <Text dimColor wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text {...toneProps(tone)} wrap="wrap">
          {value}
        </Text>
        {detail === undefined || detail === '' ? null : (
          <Text dimColor wrap="wrap">
            {detail}
          </Text>
        )}
      </Box>
    </Box>
  )
}

/** A status card: title, headline value, one line of detail. */
export function card(kit: Kit, input: { key: string; title: string; value: string; tone: Tone; detail?: string; width: number }): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box key={input.key} flexDirection="column" width={input.width} paddingRight={1} marginBottom={1}>
      <Text dimColor wrap="truncate-end">
        {input.title}
      </Text>
      <Text {...toneProps(input.tone)} wrap="truncate-end">
        {input.value}
      </Text>
      {input.detail === undefined || input.detail === '' ? null : (
        <Text dimColor wrap="wrap">
          {input.detail}
        </Text>
      )}
    </Box>
  )
}

/** The label column of a control row: a fixed share of the width, always a cell clear of the control. */
export function labelWidthOf(kit: Kit, longest?: number): number {
  const base = Math.min(26, Math.max(14, Math.floor(kit.columns * 0.4)))
  if (longest === undefined) return base
  return Math.min(Math.max(base, longest + 1), Math.max(base, Math.floor(kit.columns * 0.5)))
}

/**
 * Label, control and detail on one line; the detail moves to a dim line of
 * its own under the control when the line would not hold it.
 */
function controlRow(kit: Kit, input: { key: string; label: string; control: RenderElement; controlWidth: number; detail?: string; labelWidth?: number }): RenderElement {
  const { Box, Text } = kit.ui
  const labelWidth = input.labelWidth ?? labelWidthOf(kit)
  const detail = input.detail === undefined || input.detail === '' ? null : input.detail
  const isInline = detail !== null && labelWidth + input.controlWidth + 1 + detail.length <= kit.columns
  return (
    <Box flexDirection="column" key={`row-${input.key}`}>
      <Box flexDirection="row">
        <Box width={labelWidth} flexShrink={0} paddingRight={1}>
          <Text wrap="truncate-end">{input.label}</Text>
        </Box>
        {input.control}
        {detail !== null && isInline ? (
          <Box marginLeft={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {detail}
            </Text>
          </Box>
        ) : null}
      </Box>
      {detail !== null && !isInline ? (
        <Box marginLeft={labelWidth} flexShrink={1}>
          <Text dimColor wrap="wrap">
            {detail}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** A two-state control: `● On` / `○ Off`, pressing flips it. */
export function toggle(kit: Kit, input: { key: string; label: string; isOn: boolean; onPress: () => void; detail?: string; labelWidth?: number }): RenderElement {
  const { Button } = kit.ui
  const label = input.isOn ? `${G.dot} On` : `${G.ring} Off`
  return controlRow(kit, {
    key: input.key,
    label: input.label,
    control: <Button key={input.key} label={label} variant={input.isOn ? 'primary' : 'secondary'} onPress={input.onPress} />,
    controlWidth: label.length + 4,
    detail: input.detail,
    labelWidth: input.labelWidth,
  })
}

export type Choice = { value: string; label: string }

/**
 * One-of-several: a Select where the surface has one, else a button that
 * cycles through the options (the mobile app draws no Select yet).
 */
export function choice(kit: Kit, input: { key: string; label: string; value: string; options: readonly Choice[]; onSelect: (value: string) => void; detail?: string; labelWidth?: number }): RenderElement {
  const { Button, Select } = kit.ui
  const current = input.options.find(o => o.value === input.value) ?? input.options[0]
  const control =
    Select === undefined ? (
      <Button
        key={input.key}
        label={`${current?.label ?? input.value} ${G.arrow}`}
        onPress={() => {
          const i = input.options.findIndex(o => o.value === input.value)
          const next = input.options[(i + 1) % input.options.length]
          if (next !== undefined) input.onSelect(next.value)
        }}
      />
    ) : (
      <Select key={input.key} options={input.options} value={input.value} onSelect={value => input.onSelect(value)} />
    )
  const shown = current?.label ?? input.value
  return controlRow(kit, {
    key: input.key,
    label: input.label,
    control,
    controlWidth: shown.length + (Select === undefined ? 6 : 2),
    detail: input.detail,
    labelWidth: input.labelWidth,
  })
}

/** A free-text field where the surface has one (Enter submits). */
export function textField(kit: Kit, input: { key: string; label: string; value: string; placeholder?: string; submitLabel?: string; onSubmit: (value: string) => void }): RenderElement | null {
  const { Box, Text, Input } = kit.ui
  if (Input === undefined) return null
  const labelWidth = labelWidthOf(kit)
  return (
    <Box flexDirection="row" key={`row-${input.key}`}>
      <Box width={labelWidth} flexShrink={0} paddingRight={1}>
        <Text wrap="truncate-end">{input.label}</Text>
      </Box>
      <Input key={input.key} value={input.value} placeholder={input.placeholder} submitLabel={input.submitLabel ?? 'save'} onSubmit={value => input.onSubmit(value)} />
    </Box>
  )
}

export function actionRow(kit: Kit, buttons: readonly { key: string; label: string; onPress: () => void; isPrimary?: boolean; isHidden?: boolean }[]): RenderElement {
  const { Box, Button } = kit.ui
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      {buttons
        .filter(b => b.isHidden !== true)
        .map(b => (
          <Button key={b.key} label={b.label} variant={b.isPrimary ? 'primary' : 'secondary'} onPress={b.onPress} />
        ))}
    </Box>
  )
}

/** A list line: status glyph, text, right-aligned detail. */
export function listLine(kit: Kit, input: { key: string; glyph: string; glyphTone: Tone; text: string; right?: string; isDim?: boolean }): RenderElement {
  const { Box, Text } = kit.ui
  const rightWidth = input.right === undefined ? 0 : Math.min(input.right.length + 1, 18)
  const textWidth = Math.max(8, kit.columns - rightWidth - 3)
  return (
    <Box key={input.key} flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text {...toneProps(input.glyphTone)}>{input.glyph}</Text>
      </Box>
      <Box width={textWidth} flexShrink={1}>
        <Text dimColor={input.isDim === true} wrap="truncate-end">
          {truncate(clean(input.text, 300), textWidth)}
        </Text>
      </Box>
      {input.right === undefined ? null : (
        <Box flexShrink={0} marginLeft={1}>
          <Text dimColor>{input.right}</Text>
        </Box>
      )}
    </Box>
  )
}

export const empty = (kit: Kit, text: string): RenderElement => {
  const { Box, Text } = kit.ui
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text dimColor italic>
        {text}
      </Text>
    </Box>
  )
}
