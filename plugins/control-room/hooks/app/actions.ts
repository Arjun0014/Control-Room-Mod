/**
 * The Control Centre's actions: what every Button, Select and Input calls.
 * Each goes through the Runtime, which validates, persists, reconfigures
 * the live systems and republishes the views.
 */

import { deleteCustomProfile, saveCustomProfile } from '../core/profiles'
import { defaultSettings } from '../core/settings'
import type { Actions } from '../ui/kit'
import type { Runtime } from './runtime'

export function actionsOf(rt: Runtime): Actions {
  return {
    openPane: () => void rt.openPane(true),
    closePane: () => void rt.closePane(),
    togglePane: () => void rt.togglePane(),
    setTab: tab => rt.setTab(tab),
    togglePicker: key => rt.togglePicker(key),
    setActivitySub: sub => {
      rt.ui.activitySub = sub
      rt.publisher.mark('pane')
    },
    update: change => rt.update(draft => void change(draft)),
    applyProfile: id => void rt.applyProfileById(id),
    saveProfile: name => {
      const clean = name.trim()
      if (clean === '') return
      rt.update(s => saveCustomProfile(s, clean, Date.now()))
      rt.host?.toast(`Profile “${clean}” saved`, 3000)
    },
    deleteProfile: id => rt.update(s => deleteCustomProfile(s, id)),
    handoff: () => rt.requestHandoff(),
    fresh: () => rt.startFreshContext(),
    snooze: () => rt.snoozeAutopilot(),
    stopTask: taskId => void rt.stopBackgroundTask(taskId),
    selectFile: path => rt.selectChangedFile(path),
    clearChanges: () => {
      rt.activity.clearChanges()
      rt.ui.selectedPath = null
      rt.publisher.mark('activity', 'pane')
    },
    toggleRow: id => rt.toggleRow(id),
    toggleFocus: () =>
      rt.update(s => {
        s.focus.enabled = !s.focus.enabled
      }),
    resetSettings: () => {
      rt.update(s => ({ ...defaultSettings(), customProfiles: s.customProfiles }))
      rt.host?.toast('Settings reset to Normal', 3000)
    },
    copy: (text, surface) => void rt.host?.copy(text, surface),
  }
}
