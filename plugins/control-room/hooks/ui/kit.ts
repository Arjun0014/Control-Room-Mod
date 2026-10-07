/**
 * What every view function receives: the surface's element constructors
 * (from `$.ui.resolve(e)`), the actions its controls call, and the room it
 * has. Views never touch `$`; actions mutate the Runtime, which republishes.
 */

import type {
  BoxProps,
  ButtonProps,
  CodeProps,
  ElementConstructor,
  InputProps,
  MarkdownProps,
  RenderSurface,
  SelectProps,
  SvgProps,
  TextProps,
} from 'claude-code'

import type { ControlRoomSettings, TabId } from '../../types'

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Code: ElementConstructor<CodeProps>
  Markdown: ElementConstructor<MarkdownProps>
  /** Desktop and VS Code only: their native popup works with pointer and keys alike. */
  Select?: ElementConstructor<SelectProps>
  Input?: ElementConstructor<InputProps>
  /** Remote surfaces only (Desktop, VS Code, mobile). */
  Svg?: ElementConstructor<SvgProps>
}

export type Actions = {
  openPane: () => void
  closePane: () => void
  togglePane: () => void
  setTab: (tab: TabId) => void
  /** Opens one in-place picker, or closes it when it is the open one; null closes any. */
  togglePicker: (key: string | null) => void
  setActivitySub: (sub: 'calls' | 'changes') => void
  update: (change: (draft: ControlRoomSettings) => void) => void
  applyProfile: (id: string) => void
  saveProfile: (name: string) => void
  deleteProfile: (id: string) => void
  handoff: () => void
  fresh: () => void
  snooze: () => void
  stopTask: (taskId: string) => void
  selectFile: (path: string | null) => void
  clearChanges: () => void
  toggleRow: (id: string) => void
  toggleFocus: () => void
  resetSettings: () => void
  copy: (text: string, surface: RenderSurface) => void
}

export type Kit = {
  ui: Ui
  actions: Actions
  /** Cells across the body the tree draws into. */
  columns: number
  surface: RenderSurface
  now: number
  /** The in-place picker drawn open, by key. */
  openPicker: string | null
}

/**
 * Picks the surface's element table into a Ui. The engine completes every
 * table (an element a surface lacks draws as an empty fragment), so what a
 * surface can really draw is decided by the surface, not by presence.
 *
 * The terminal's Select is left out on purpose: its option list cannot be
 * picked or closed with the pointer, so the terminal draws choices in place.
 */
export function uiOf(table: Partial<Ui> & Pick<Ui, 'Box' | 'Text' | 'Button' | 'Code' | 'Markdown'>, surface: RenderSurface): Ui {
  const isNative = surface === 'desktop' || surface === 'vscode'
  return {
    Box: table.Box,
    Text: table.Text,
    Button: table.Button,
    Code: table.Code,
    Markdown: table.Markdown,
    Select: isNative ? table.Select : undefined,
    Input: surface === 'mobile' ? undefined : table.Input,
    Svg: surface === 'terminal' ? undefined : table.Svg,
  }
}
