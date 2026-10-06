import React, { useSyncExternalStore } from 'react'

// rc.2's native buttons reuse the first blank session, including ScholarFlow.
// Its Slot API cannot wrap the sidebar's child-owning entry. Recognize only
// these installed native controls, leaving history and the mode picker alone.
export function nativeNewSessionButton(button: Element): { workspaceId?: string } | undefined {
  const label = button.getAttribute('aria-label') ?? ''
  if (label === '新建会话' || label === 'New session') return {}
  if (!/^在“.+”中新建会话$|^New session in .+$/.test(label)) return
  const row = button.closest('[data-row-key^="workspace:"]')
  if (row) return { workspaceId: row.getAttribute('data-row-key')!.slice('workspace:'.length) || undefined }
}

export async function createStandardSession(ctx: any, workspaceId?: string) {
  const signal = ctx.layout.beginNavigation()
  const workspaces = ctx.workspaces.list.getSnapshot().items
  const sessions = ctx.sessions.list.getSnapshot()
  if (workspaceId === undefined) {
    const current = ctx.uiSession.adapter.current.getSnapshot().key
    const owner = workspaces.find((item: any) => item.sessionIds.includes(current))
    // The same current/recent-workspace preference as the native new action.
    const latest = (item: any) => Math.max(Date.parse(item.createdAt), ...item.sessionIds.map((id: string) => sessions.byId[id]?.updatedAt ?? -Infinity))
    workspaceId = owner?.workspaceId ?? workspaces.reduce((recent: any, item: any) => !recent || latest(item) > latest(recent) ? item : recent, undefined)?.workspaceId
  }
  const result = await ctx.connection.rpc.call('/api', 'session/create', {
    args: { request: { ...(workspaceId && { workspaceId }), agentPreset: 'standard' } },
  })
  if (!result.ok) throw new Error(result.error.message)
  if (signal.aborted) return
  await ctx.sessions.refresh()
  if (!signal.aborted) await ctx.uiWorkspace.openSession(result.value.sessionId)
}

export function connectNewSessionEntry(ctx: any) {
  ctx.effect(() => {
    const listeners = new Set<() => void>()
    let message = '', live = true
    const publish = (value: string) => { message = value; listeners.forEach(listener => listener()) }
    function Notice() {
      const error = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => message, () => message)
      return error ? <div role="alert" style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 1500, padding: 16,
        background: 'var(--dsw-alias-bg-base, white)', border: '1px solid #d45151', borderRadius: 8 }}>
        <p>新会话未能创建：{error}</p><button onClick={() => publish('')}>关闭</button>
      </div> : null
    }
    const click = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null
      if (!button || (button as HTMLButtonElement).disabled) return
      const target = nativeNewSessionButton(button)
      if (!target) return
      event.preventDefault(); event.stopImmediatePropagation()
      publish('')
      void createStandardSession(ctx, target.workspaceId).catch(error => { if (live) publish(error.message) })
    }
    window.addEventListener('click', click, true)
    const disposeNotice = ctx.slots.register({ name: 'shell.overlay', id: 'scholarflow-new-session-notice' }, Notice)
    return () => { live = false; window.removeEventListener('click', click, true); disposeNotice(); listeners.clear() }
  }, 'scholarflow: native new buttons start in standard mode')
}
