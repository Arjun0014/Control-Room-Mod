/**
 * Control Room's design system: a handful of components every page is made
 * of, each drawn natively per surface.
 *
 * Terminal: quiet glyph controls that work with the keyboard (Tab, Enter)
 * and the pointer alike: `● On`, `● Standard  ○ Strict`, `Ask ▾` opening its
 * options in place, `−  70%  +`. No popups: the terminal's own Select cannot
 * be picked or closed with the pointer.
 * Desktop / VS Code: native buttons and popups, SVG meters.
 * Mobile: native buttons, choices in place, SVG meters.
 *
 * Layout rhythm: a section is a dim small-caps title, its rows, and at most
 * a short dim footnote; one blank line between sections. A row is a label
 * column and a control, with its detail beside it when it fits, else below.
 */

import type { RenderElement } from 'claude-code'

import type { Tone } from '../../types'
import type { Kit } from './kit'
import { G, meterCells, sparkline, svgBar, svgSpark, toneProps } from './theme'

/** Desktop and VS Code draw native controls; the terminal and mobile get the in-place forms. */
export const isNative = (kit: Kit): boolean => kit.surface === 'desktop' || kit.surface === 'vscode'

export type Choice = { value: string; label: string; hint?: string }

/** A control and the cells it takes; `below` is drawn under its row (an open picker). */
export type Control = { element: RenderElement; width: number; below?: RenderElement | null }

/** The label column of control rows: a share of the width, never cramped, never more than half. */
export function labelWidth(kit: Kit, longest?: number): number {
  const base = Math.min(24, Math.max(14, Math.floor(kit.columns * 0.38)))
  if (longest === undefined) return base
  return Math.min(Math.max(base, longest + 2), Math.max(base, Math.floor(kit.columns * 0.5)))
}

// ---------------------------------------------------------------------------
// Structure

export function section(
  kit: Kit,
  input: { key: string; title?: string; aside?: string; footer?: string; children: readonly (RenderElement | null | false)[] },
): RenderElement {
  const { Box, Text } = kit.ui
  const children = input.children.filter((c): c is RenderElement => c !== null && c !== false)
  return (
    <Box key={`section-${input.key}`} flexDirection="column" marginTop={1}>
      {input.title === undefined ? null : (
        <Box flexDirection="row" justifyContent="space-between" key={`section-${input.key}-head`}>
          <Text dimColor bold>
            {input.title.toUpperCase()}
          </Text>
          {input.aside === undefined || input.aside === '' ? null : (
            <Text dimColor wrap="truncate-start">
              {input.aside}
            </Text>
          )}
        </Box>
      )}
      {children}
      {input.footer === undefined || input.footer === '' ? null : (
        <Box key={`section-${input.key}-foot`}>
          <Text dimColor wrap="wrap">
            {input.footer}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * A settings row: label, control, detail. The detail sits beside the
 * control when the line holds it, else under it; a control too wide for
 * the line moves under the label.
 */
export function row(
  kit: Kit,
  input: { key: string; label: string; control?: Control; value?: string; valueTone?: Tone; detail?: string; detailTone?: Tone; labelWidth?: number; isDim?: boolean },
): RenderElement {
  const { Box, Text } = kit.ui
  const lw = input.labelWidth ?? labelWidth(kit)
  const detail = input.detail === undefined || input.detail === '' ? null : input.detail
  const control = input.control
  const valueWidth = control?.width ?? (input.value?.length ?? 0)
  const isStacked = control !== undefined && lw + control.width > kit.columns
  const isDetailInline = detail !== null && !isStacked && lw + valueWidth + 2 + detail.length <= kit.columns
  const value =
    control !== undefined ? (
      control.element
    ) : input.value === undefined ? null : (
      <Text key={`${input.key}-value`} {...toneProps(input.valueTone ?? 'normal')} wrap="truncate-end">
        {input.value}
      </Text>
    )
  const detailEl = (indent: number) =>
    detail === null ? null : (
      <Box key={`${input.key}-detail`} marginLeft={indent} flexShrink={1}>
        <Text {...toneProps(input.detailTone ?? 'muted')} dimColor={input.detailTone === undefined || input.detailTone === 'muted'} wrap="wrap">
          {detail}
        </Text>
      </Box>
    )
  return (
    <Box key={`row-${input.key}`} flexDirection="column">
      <Box flexDirection="row">
        <Box width={isStacked ? undefined : lw} flexShrink={0} paddingRight={1}>
          <Text dimColor={input.isDim === true} wrap="truncate-end">
            {input.label}
          </Text>
        </Box>
        {isStacked ? null : value}
        {isDetailInline ? (
          <Box marginLeft={2} flexShrink={1}>
            <Text {...toneProps(input.detailTone ?? 'muted')} dimColor={input.detailTone === undefined || input.detailTone === 'muted'} wrap="truncate-end">
              {detail}
            </Text>
          </Box>
        ) : null}
      </Box>
      {isStacked ? (
        <Box marginLeft={2} key={`${input.key}-stacked`}>
          {value}
        </Box>
      ) : null}
      {detail !== null && !isDetailInline ? detailEl(isStacked ? 2 : lw) : null}
      {control?.below === undefined || control.below === null ? null : (
        <Box marginLeft={isStacked ? 2 : lw} key={`${input.key}-below`}>
          {control.below}
        </Box>
      )}
    </Box>
  )
}

/** Label left, value right, on one line; an optional dim line under it. */
export function stat(kit: Kit, input: { key: string; label: string; value: string; tone?: Tone; under?: string; underRight?: string }): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box key={`stat-${input.key}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>{input.label}</Text>
        <Text bold {...toneProps(input.tone ?? 'normal')}>
          {input.value}
        </Text>
      </Box>
      {input.under === undefined && input.underRight === undefined ? null : (
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor wrap="truncate-end">
            {input.under ?? ''}
          </Text>
          <Text dimColor wrap="truncate-start">
            {input.underRight ?? ''}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** A dim line with text at both ends ("312k of 1M tokens ........ hands off at 700k"). */
export function pair(kit: Kit, input: { key: string; left: string; right?: string; rightTone?: Tone }): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box key={`pair-${input.key}`} flexDirection="row" justifyContent="space-between">
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {input.left}
        </Text>
      </Box>
      {input.right === undefined ? null : (
        <Box flexShrink={0} marginLeft={2}>
          <Text {...toneProps(input.rightTone ?? 'muted')} dimColor={input.rightTone === undefined || input.rightTone === 'muted' ? true : undefined}>
            {input.right}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** Something that needs the person: a bordered card with a title, a line and actions. */
export function callout(
  kit: Kit,
  input: { key: string; tone: Tone; title: string; text?: string; actions?: readonly { key: string; label: string; onPress: () => void; isPrimary?: boolean }[] },
): RenderElement {
  const { Box, Text } = kit.ui
  const color = toneProps(input.tone).color ?? 'text'
  return (
    <Box key={`callout-${input.key}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
      <Text bold color={color}>
        {input.title}
      </Text>
      {input.text === undefined ? null : <Text wrap="wrap">{input.text}</Text>}
      {input.actions === undefined || input.actions.length === 0 ? null : buttons(kit, input.actions, `callout-${input.key}`)}
    </Box>
  )
}

/** Explicit actions: `[ Hand off now ]` in the terminal, native buttons elsewhere. */
export function buttons(kit: Kit, list: readonly { key: string; label: string; onPress: () => void; isPrimary?: boolean; isHidden?: boolean }[], key = 'actions'): RenderElement {
  const { Box, Button } = kit.ui
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      {list
        .filter(b => b.isHidden !== true)
        .map(b => (
          <Button key={b.key} label={b.label} variant={b.isPrimary === true ? 'primary' : 'secondary'} onPress={b.onPress} />
        ))}
    </Box>
  )
}

export function note(kit: Kit, text: string, key = 'note'): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box key={key}>
      <Text dimColor wrap="wrap">
        {text}
      </Text>
    </Box>
  )
}

export function emptyState(kit: Kit, text: string, key = 'empty'): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box key={key}>
      <Text dimColor italic>
        {text}
      </Text>
    </Box>
  )
}

/** A list line: status glyph, text, a right-aligned detail. */
export function listItem(kit: Kit, input: { key: string; glyph: string; tone: Tone; text: string; right?: string; isDim?: boolean }): RenderElement {
  const { Box, Text } = kit.ui
  return (
    <Box key={input.key} flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text {...toneProps(input.tone)}>{input.glyph}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor={input.isDim === true} wrap="truncate-end">
          {input.text}
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

// ---------------------------------------------------------------------------
// Controls

/** On / off. */
export function switchControl(kit: Kit, input: { key: string; isOn: boolean; onPress: () => void }): Control {
  const { Button } = kit.ui
  if (isNative(kit)) {
    const label = input.isOn ? 'On' : 'Off'
    return { element: <Button key={input.key} label={label} variant={input.isOn ? 'primary' : 'secondary'} onPress={input.onPress} />, width: label.length + 4 }
  }
  const label = input.isOn ? `${G.dot} On` : `${G.ring} Off`
  return { element: <Button key={input.key} label={label} plain dimColor={!input.isOn} onPress={input.onPress} />, width: label.length }
}

/** A few short options side by side, the chosen one marked. */
export function segmented(kit: Kit, input: { key: string; value: string; options: readonly Choice[]; onSelect: (value: string) => void }): Control {
  const { Box, Button } = kit.ui
  if (isNative(kit)) {
    return {
      element: (
        <Box key={input.key} flexDirection="row" columnGap={1}>
          {input.options.map(o => (
            <Button key={`${input.key}:${o.value}`} label={o.label} variant={o.value === input.value ? 'primary' : 'secondary'} onPress={() => input.onSelect(o.value)} />
          ))}
        </Box>
      ),
      width: input.options.reduce((n, o) => n + o.label.length + 5, -1),
    }
  }
  return {
    element: (
      <Box key={input.key} flexDirection="row" columnGap={2}>
        {input.options.map(o => (
          <Button
            key={`${input.key}:${o.value}`}
            label={`${o.value === input.value ? G.dot : G.ring} ${o.label}`}
            plain
            dimColor={o.value !== input.value}
            onPress={() => input.onSelect(o.value)}
          />
        ))}
      </Box>
    ),
    width: input.options.reduce((n, o) => n + o.label.length + 4, -2),
  }
}

/**
 * One of many: the current value with a chevron. Desktop and VS Code open
 * their native popup; the terminal and mobile open the options in place,
 * under the row, each with its one-line hint, and close on a pick.
 */
export function picker(kit: Kit, input: { key: string; value: string; options: readonly Choice[]; onSelect: (value: string) => void }): Control {
  const { Box, Button, Select, Text } = kit.ui
  const current = input.options.find(o => o.value === input.value) ?? input.options[0]
  const shown = current?.label ?? input.value
  if (isNative(kit) && Select !== undefined) {
    return {
      element: <Select key={input.key} options={input.options.map(o => ({ value: o.value, label: o.label }))} value={input.value} onSelect={value => input.onSelect(value)} />,
      width: shown.length + 4,
    }
  }
  const isOpen = kit.openPicker === input.key
  const label = `${shown} ${isOpen ? G.up : G.down}`
  const optionWidth = Math.max(...input.options.map(o => o.label.length)) + 4
  const below = isOpen ? (
    <Box key={`${input.key}-options`} flexDirection="column">
      {input.options.map(o => (
        <Box key={`${input.key}-option-${o.value}`} flexDirection="row">
          <Box width={optionWidth} flexShrink={0}>
          <Button
            key={`${input.key}:${o.value}`}
            label={`${o.value === input.value ? G.dot : G.ring} ${o.label}`}
            plain
            dimColor={o.value !== input.value}
            onPress={() => {
              kit.actions.togglePicker(null)
              if (o.value !== input.value) input.onSelect(o.value)
            }}
          />
          </Box>
          {o.hint === undefined ? null : (
            <Box flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {o.hint}
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  ) : null
  return {
    element: <Button key={input.key} label={label} plain onPress={() => kit.actions.togglePicker(input.key)} />,
    width: label.length,
    below,
  }
}

/** A number with − and +. */
export function stepper(kit: Kit, input: { key: string; display: string; onDecrease?: () => void; onIncrease?: () => void }): Control {
  const { Box, Button, Text } = kit.ui
  const noop = () => undefined
  if (isNative(kit)) {
    return {
      element: (
        <Box key={input.key} flexDirection="row" columnGap={1} alignItems="center">
          <Button key={`${input.key}-dec`} label={G.minus} onPress={input.onDecrease ?? noop} />
          <Text>{input.display}</Text>
          <Button key={`${input.key}-inc`} label={G.plus} onPress={input.onIncrease ?? noop} />
        </Box>
      ),
      width: input.display.length + 12,
    }
  }
  return {
    element: (
      <Box key={input.key} flexDirection="row">
        <Button key={`${input.key}-dec`} label={G.minus} plain dimColor={input.onDecrease === undefined} onPress={input.onDecrease ?? noop} />
        <Text>{`  ${input.display}  `}</Text>
        <Button key={`${input.key}-inc`} label={G.plus} plain dimColor={input.onIncrease === undefined} onPress={input.onIncrease ?? noop} />
      </Box>
    ),
    width: input.display.length + 6,
  }
}

/** A button that navigates or acts, drawn as a value with a chevron (`No limit ›`). */
export function link(kit: Kit, input: { key: string; label: string; onPress: () => void }): Control {
  const { Button } = kit.ui
  const label = `${input.label} ${G.chevron}`
  return { element: <Button key={input.key} label={label} plain onPress={input.onPress} />, width: label.length + (isNative(kit) ? 4 : 0) }
}

// ---------------------------------------------------------------------------
// Meters

/** A thin line meter with a threshold marker; an SVG bar where the surface draws SVG. */
export function meterBar(kit: Kit, input: { key: string; fraction: number; marker?: number | null; tone: Tone; width: number; alt: string }): RenderElement {
  const { Text, Svg } = kit.ui
  if (Svg !== undefined) {
    return <Svg key={input.key} source={svgBar({ fraction: input.fraction, marker: input.marker, tone: input.tone, width: Math.max(8, input.width) * 8, height: 10 })} alt={input.alt} height={10} />
  }
  const c = meterCells(input.fraction, input.width, input.marker)
  return (
    <Text key={input.key} wrap="truncate-end">
      {runs(kit, input.key, c, input.tone)}
    </Text>
  )
}

/** The meter's cells grouped into runs of one style (filled, empty, marker), as nested Texts. */
function runs(kit: Kit, key: string, c: { filled: number; marker: number; width: number }, tone: Tone): RenderElement[] {
  const { Text } = kit.ui
  const kindOf = (i: number) => (i === c.marker ? 'marker' : i < c.filled ? 'filled' : 'empty')
  const out: RenderElement[] = []
  let start = 0
  for (let i = 1; i <= c.width; i++) {
    if (i === c.width || kindOf(i) !== kindOf(start)) {
      const kind = kindOf(start)
      const glyph = kind === 'marker' ? G.marker : kind === 'filled' ? G.lineFull : G.lineEmpty
      const style = kind === 'marker' ? { color: 'claude' } : kind === 'filled' ? toneProps(tone) : { dimColor: true }
      out.push(
        <Text key={`${key}-run-${start}`} {...style}>
          {glyph.repeat(i - start)}
        </Text>,
      )
      start = i
    }
  }
  return out
}

/** A sparkline of 0–100 readings; SVG where the surface draws SVG. */
export function spark(kit: Kit, input: { key: string; values: readonly number[]; tone: Tone; width: number; ceiling?: number | null; alt: string }): RenderElement {
  const { Text, Svg } = kit.ui
  if (Svg !== undefined) {
    return <Svg key={input.key} source={svgSpark(input.values, { tone: input.tone, width: Math.max(8, input.width) * 8, height: 18, ceiling: input.ceiling })} alt={input.alt} height={18} />
  }
  return (
    <Text key={input.key} {...toneProps(input.tone)}>
      {sparkline(input.values, input.width)}
    </Text>
  )
}

// ---------------------------------------------------------------------------
// Navigation

/**
 * The section bar. Terminal: labels with the chosen one bright and an
 * accent underline beneath it, which doubles as the header's rule; two rows
 * when one will not fit. Native surfaces: buttons, the chosen one primary.
 */
export function navBar<T extends string>(kit: Kit, input: { tabs: readonly { id: T; label: string }[]; current: T; onSelect: (id: T) => void }): RenderElement {
  const { Box, Button, Text } = kit.ui
  if (isNative(kit)) {
    return (
      <Box key="nav" flexDirection="row" flexWrap="wrap" columnGap={1}>
        {input.tabs.map(t => (
          <Button key={`tab-${t.id}`} label={t.label} variant={t.id === input.current ? 'primary' : 'secondary'} onPress={() => input.onSelect(t.id)} />
        ))}
      </Box>
    )
  }
  const widthAt = (gap: number) => input.tabs.reduce((n, t) => n + t.label.length, 0) + gap * (input.tabs.length - 1)
  const gap = widthAt(3) <= kit.columns ? 3 : widthAt(2) <= kit.columns ? 2 : 0
  const tab = (t: { id: T; label: string }) => (
    <Button key={`tab-${t.id}`} label={t.label} plain dimColor={t.id !== input.current} onPress={() => input.onSelect(t.id)} />
  )
  if (gap === 0) {
    const half = Math.ceil(input.tabs.length / 2)
    return (
      <Box key="nav" flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          {input.tabs.slice(0, half).map(tab)}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          {input.tabs.slice(half).map(tab)}
        </Box>
        <Text dimColor>{G.lineEmpty.repeat(Math.max(4, kit.columns))}</Text>
      </Box>
    )
  }
  const underline: RenderElement[] = []
  let used = 0
  input.tabs.forEach((t, i) => {
    if (i > 0) {
      underline.push(
        <Text key={`nav-gap-${i}`} dimColor>
          {G.lineEmpty.repeat(gap)}
        </Text>,
      )
      used += gap
    }
    const isCurrent = t.id === input.current
    underline.push(
      <Text key={`nav-line-${t.id}`} {...(isCurrent ? { color: 'claude' } : { dimColor: true })}>
        {(isCurrent ? G.lineFull : G.lineEmpty).repeat(t.label.length)}
      </Text>,
    )
    used += t.label.length
  })
  if (kit.columns > used) {
    underline.push(
      <Text key="nav-rest" dimColor>
        {G.lineEmpty.repeat(kit.columns - used)}
      </Text>,
    )
  }
  return (
    <Box key="nav" flexDirection="column">
      <Box flexDirection="row" columnGap={gap}>
        {input.tabs.map(tab)}
      </Box>
      <Text wrap="truncate-end">{underline}</Text>
    </Box>
  )
}
