/**
 * Publishes view models into `$.state`, coalesced and only when they
 * changed: each render site subscribes to the atoms it reads, so a change in
 * activity redraws the Activity tab and the spinner, not the transcript.
 */

import { LIMITS } from '../constants'
import type { Host } from '../host'
import type { Runtime } from './runtime'
import * as Views from './views'

export type ViewKey = 'hud' | 'pane' | 'resources' | 'chain' | 'activity' | 'permissions' | 'focus' | 'spinner'

const ALL: readonly ViewKey[] = ['hud', 'pane', 'resources', 'chain', 'activity', 'permissions', 'focus', 'spinner']

export class Publisher {
  private dirty = new Set<ViewKey>()
  private last = new Map<ViewKey, string>()
  private lastStatus: string | undefined | null = null
  private timer: { cancel: () => void } | null = null
  private isFlushing = false

  constructor(
    private readonly host: () => Host | null,
    private readonly rt: Runtime,
  ) {}

  mark(...keys: ViewKey[]): void {
    for (const k of keys) this.dirty.add(k)
    this.schedule()
  }

  markAll(): void {
    this.mark(...ALL)
  }

  /** After /clear the engine's `$.state` starts empty: publish everything again. */
  forgetPublished(): void {
    this.last.clear()
    this.lastStatus = null
  }

  private schedule(): void {
    const host = this.host()
    if (host === null || this.timer !== null) return
    this.timer = host.after(LIMITS.publishCoalesceMs, () => {
      this.timer = null
      void this.flush()
    })
  }

  async flush(): Promise<void> {
    const host = this.host()
    if (host === null || this.isFlushing) return
    this.isFlushing = true
    try {
      const keys = [...this.dirty]
      this.dirty.clear()
      for (const key of keys) await this.publish(host, key)
      await this.publishStatus(host)
    } finally {
      this.isFlushing = false
      if (this.dirty.size > 0) this.schedule()
    }
  }

  private async publish(host: Host, key: ViewKey): Promise<void> {
    const rt = this.rt
    let value: unknown
    let send: (v: never) => Promise<void>
    switch (key) {
      case 'hud':
        value = Views.hudOf(rt)
        send = host.publishHud
        break
      case 'pane':
        value = Views.paneOf(rt)
        send = host.publishPane
        break
      case 'resources':
        value = Views.resourcesOf(rt)
        send = host.publishResources
        break
      case 'chain':
        value = Views.chainOf(rt)
        send = host.publishChain
        break
      case 'activity':
        value = Views.activityOf(rt)
        send = host.publishActivity
        break
      case 'permissions':
        value = Views.permissionsOf(rt)
        send = host.publishPermissions
        break
      case 'focus':
        value = Views.focusOf(rt)
        send = host.publishFocus
        break
      case 'spinner':
        value = Views.spinnerOf(rt)
        send = host.publishSpinner
        break
    }
    const json = JSON.stringify(value)
    if (this.last.get(key) === json) return
    this.last.set(key, json)
    await send(value as never).catch(() => {
      this.last.delete(key)
    })
  }

  private async publishStatus(host: Host): Promise<void> {
    const mode = this.rt.settings.ui.hud
    const text = mode === 'status' || mode === 'both' ? Views.statusLineOf(Views.hudOf(this.rt)) : undefined
    if (text === this.lastStatus) return
    this.lastStatus = text
    host.status(text)
  }
}
