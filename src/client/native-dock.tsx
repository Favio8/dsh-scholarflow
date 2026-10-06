import React, { useSyncExternalStore } from 'react'

export const CHAT_KIND = 'scholarflow-chat'
export const CHAT_ID = 'dsh-scholarflow/chat'

export function openExistingChat(ctx: any, options?: any) {
  const sessionId = ctx.sidebarRight.mounted.getSnapshot()
  const tab = ctx.sidebarRight.openTabs.getSnapshot().find((tab: any) => tab.sessionId === sessionId && tab.kind === CHAT_KIND)
  if (tab) { ctx.sidebarRight.focus(tab.tabId); if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded() }
  else ctx.sidebarRight.openTab(CHAT_KIND, options)
}

// Only explicitly opened ScholarFlow surfaces shadow the reserved Conversation
// cell. panelInfo remains null, so the native rightbar keeps its current Session.
export function createWorkbenchNavigation(ctx: any, Workspace: React.ComponentType<any>) {
  const listeners = new Set<() => void>()
  let enabledSession: string | undefined
  let chatRequest: { sessionId: string; afterOpen?: () => void } | undefined
  let shadow: (() => void) | undefined
  let snapshot = { sessionId: undefined as string | undefined, active: false }
  const source = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const revealChat = () => {
    if (!chatRequest || !snapshot.active || snapshot.sessionId !== chatRequest.sessionId || ctx.sidebarRight.mounted.getSnapshot() !== chatRequest.sessionId) return
    const request = chatRequest; chatRequest = undefined
    openExistingChat(ctx)
    if (request.afterOpen) window.requestAnimationFrame(request.afterOpen)
  }
  const sync = () => {
    const sessionId = ctx.uiSession.adapter.current.getSnapshot().key
    if (enabledSession !== sessionId || ctx.layout.panelInfo.getSnapshot().activePanelId !== null) enabledSession = undefined
    const selected = !!sessionId && enabledSession === sessionId
    if (!selected) chatRequest = undefined
    if (selected && !shadow) shadow = ctx.slots.register({ name: 'main', key: 'conversation', priority: -50 }, Workspace)
    else if (!selected && shadow) { shadow(); shadow = undefined }
    const active = selected && ctx.layout.panelInfo.getSnapshot().activePanelId === null
    if (snapshot.sessionId !== sessionId || snapshot.active !== active) {
      snapshot = { sessionId, active }; listeners.forEach(listener => listener())
    }
  }
  const selectedPreset = () => {
    const sessionId = ctx.uiSession.adapter.current.getSnapshot().key
    return ctx.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.agentPreset
  }
  ctx.effect(() => {
    const disposeSlot = ctx.slots.inject('main', () => { sync(); return () => { shadow?.(); shadow = undefined } })
    const disposeCurrent = ctx.uiSession.adapter.current.subscribe(sync), disposePanel = ctx.layout.panelInfo.subscribe(sync)
    // rc.2 publishes a fresh selection for EVERY native navigation, including
    // startSession reusing the same blank Session. Catalog refreshes are separate.
    let navigatedSession = ctx.uiSession.adapter.current.getSnapshot().key
    const disposeNavigation = ctx.uiWorkspace.selection.subscribe(() => {
      const previous = navigatedSession
      enabledSession = undefined; sync()
      queueMicrotask(() => {
        const current = ctx.uiSession.adapter.current.getSnapshot().key; navigatedSession = current
        const session = ctx.sessions.list.getSnapshot().byId[current]
        if (selectedPreset() === 'scholarflow' && (current !== previous || !session?.blank)) { enabledSession = current; sync() }
      })
    })
    let lastPreset = selectedPreset()
    const disposePreset = ctx.sessions.list.subscribe(() => {
      const preset = selectedPreset()
      if (preset !== lastPreset) {
        lastPreset = preset
        if (preset === 'scholarflow') { ctx.layout.selectPanel(null); enabledSession = ctx.uiSession.adapter.current.getSnapshot().key }
        else enabledSession = undefined
        sync()
      }
    })
    const disposeMounted = ctx.sidebarRight.mounted.subscribe(revealChat)
    return () => { disposePreset(); disposeMounted(); disposeNavigation(); disposeCurrent(); disposePanel(); disposeSlot(); listeners.clear() }
  }, 'scholarflow: scoped native Conversation surface')
  return {
    source,
    open(sessionId = ctx.uiSession.adapter.current.getSnapshot().key) {
      // Without a session there is nothing to surface; the panel that used to stand in
      // for it was removed with the workbench entry (SPEC v1.1 §10).
      if (!sessionId) return
      ctx.layout.selectPanel(null); enabledSession = sessionId; sync()
    },
    ordinary() {
      enabledSession = undefined; sync(); ctx.layout.selectPanel(null)
    },
    openChat(sessionId: string, afterOpen?: () => void) {
      if (!snapshot.active || snapshot.sessionId !== sessionId) return
      chatRequest = { sessionId, afterOpen }; revealChat()
    },
  }
}

// Wrap the publicly registered preset seat, preserving its native UI and
// injected controller. A repeated pick of the same blank preset still opens it.
export function connectPresetEntry(ctx: any, navigation: ReturnType<typeof createWorkbenchNavigation>) {
  ctx.effect(() => ctx.slots.inject('conversation.hero.agentPreset', () => {
    let original: any, dispose: (() => void) | undefined
    const sync = () => {
      // The rendered winner is our wrapper. Inspect the registration ledger so
      // shadowing the native seat does not repeatedly remove and reinstall us.
      const entry = ctx.slots.entries('conversation.hero.agentPreset').find((entry: any) => entry.options.id !== 'scholarflow-preset-entry')
      if (entry === original) return
      original = entry; dispose?.(); dispose = undefined
      if (!entry) return
      const Seat = entry.component
      function PresetSeat(props: any) {
        return <Seat {...props} select={async (id: string) => {
          const refusal = await props.select(id)
          if (!refusal && id === 'scholarflow') navigation.open()
          else if (!refusal) navigation.ordinary()
          return refusal
        }} />
      }
      dispose = ctx.slots.register({ name: 'conversation.hero.agentPreset', id: 'scholarflow-preset-entry', priority: -50,
        ...(entry.locale && { locale: entry.locale }), ...(entry.inject && { inject: entry.inject }), ...(entry.store && { store: entry.store }) }, PresetSeat)
    }
    sync(); const unsubscribe = ctx.slots.subscribe('conversation.hero.agentPreset', sync)
    return () => { unsubscribe(); dispose?.() }
  }), 'scholarflow: native preset entry')
}

// rc.2 exposes these native implementations through the public Slot registry.
// Materialize the SAME components with their original locale, injected sources
// and shared store; their actual icons, menus and actions remain owned by DSH.
export function createNativeHeader(ctx: any) {
  const targets = [
    { slot: 'conversation.session.header.utilities', id: 'open-in-app', name: 'scholarflow.native-open-in-app' },
    { slot: 'conversation.session.header.utilities', id: 'session-log-download', name: 'scholarflow.native-session-menu' },
    { slot: 'conversation.session.header.corner', id: undefined, name: 'scholarflow.native-panel-toggle' },
  ]
  const mounted = new Map<string, { entry: any; dispose: () => void }>()
  const listeners = new Set<() => void>()
  let snapshot: string[] = []
  const source = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  ctx.effect(() => {
    const publish = () => { snapshot = targets.filter(target => mounted.has(target.name)).map(target => target.name); listeners.forEach(listener => listener()) }
    const sync = (slot: string) => {
      const entries = ctx.slots.entriesOfSlot(slot)
      let changed = false
      for (const target of targets.filter(target => target.slot === slot)) {
        const entry = entries.find((entry: any) => entry.options.id === target.id)
        const previous = mounted.get(target.name)
        if (previous?.entry === entry) continue
        previous?.dispose(); mounted.delete(target.name)
        if (entry) {
          const dispose = ctx.slots.registerFactory({ name: target.name, scope: 'session',
            ...(entry.locale && { locale: entry.locale }), ...(entry.inject && { inject: entry.inject }),
            ...(entry.store && { store: entry.store }),
          }, entry.component)
          mounted.set(target.name, { entry, dispose })
        }
        changed = true
      }
      if (changed) publish()
    }
    const disposers = [...new Set(targets.map(target => target.slot))].map(slot => ctx.slots.inject(slot, () => {
      sync(slot)
      const unsubscribe = ctx.slots.subscribe(slot, () => sync(slot))
      return () => {
        unsubscribe()
        for (const target of targets.filter(target => target.slot === slot)) { mounted.get(target.name)?.dispose(); mounted.delete(target.name) }
        publish()
      }
    }))
    return () => { disposers.reverse().forEach(dispose => dispose()); listeners.clear() }
  }, 'scholarflow: reuse native header components')
  return source
}

export function NativeTools({ source, sessionId, renderFactorySlot, extra }: { source: ReturnType<typeof createNativeHeader>; sessionId?: string; renderFactorySlot: any; extra?: React.ReactNode }) {
  const factories = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  return <nav className="sf-native-tools" aria-label="工作台工具">
    {sessionId && factories.filter(name => name !== 'scholarflow.native-panel-toggle').map(name => <React.Fragment key={name}>{renderFactorySlot(name, {})}</React.Fragment>)}
    {extra}
    {sessionId && factories.includes('scholarflow.native-panel-toggle') && renderFactorySlot('scholarflow.native-panel-toggle', {})}
  </nav>
}

export const NATIVE_DOCK_CSS = `
.sf-native-header{flex-shrink:0;display:flex;align-items:center;flex-wrap:nowrap;gap:12px;height:44px;padding:0 24px;border-bottom:1px solid #8884}
.sf-workspace-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-native-tools{margin-left:auto;display:flex;align-items:center;gap:12px;flex-shrink:0}
.sf-dock-chat{height:100%;width:100%;min-width:0;border:0;box-sizing:border-box}
.sf-chat-resume{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;box-sizing:border-box;font-size:13px}
.sf-chat-guide{box-sizing:border-box;width:100%;min-height:56px;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xl);cursor:pointer;display:flex;align-items:center;gap:14px;padding:14px 20px}
.sf-chat-guide:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sf-chat-guide>svg{width:26px;height:26px;flex:none;color:var(--dsw-alias-label-secondary)}
.sf-chat-guide>span{display:flex;flex-direction:column;gap:3px;font-size:14px;line-height:1.4}
.sf-chat-guide small{font-size:11px;color:var(--dsw-alias-label-tertiary)}
`
