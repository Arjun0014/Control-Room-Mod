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
  /** Absent on the mobile app: controls fall back to cycling buttons. */
  Select?: ElementConstructor<SelectProps>
  Input?: ElementConstructor<InputProps>
  /** Remote surfaces only (Desktop, VS Code, mobile). */
  Svg?: ElementConstructor<SvgProps>
}

export type Actions = {
  openPane: () => void
  closePane: () => void
  setTab: (tab: TabId) => void
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
}

/**
 * Picks the surface's element table into a Ui. The engine completes every
 * table (an element a surface lacks draws as an empty fragment), so what a
 * surface can really draw is decided by the surface, not by presence.
 */
export function uiOf(table: Partial<Ui> & Pick<Ui, 'Box' | 'Text' | 'Button' | 'Code' | 'Markdown'>, surface: RenderSurface): Ui {
  const hasFields = surface !== 'mobile'
  const hasSvg = surface !== 'terminal'
  return {
    Box: table.Box,
    Text: table.Text,
    Button: table.Button,
    Code: table.Code,
    Markdown: table.Markdown,
    Select: hasFields ? table.Select : undefined,
    Input: hasFields ? table.Input : undefined,
    Svg: hasSvg ? table.Svg : undefined,
  }
}
