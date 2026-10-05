import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { WorkbenchIcon } from './workbench-chrome.tsx'

const KEY = 'sf-workbench-layout:v1'
function preferences() {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    return { width: Number.isInteger(value.width) && value.width >= 280 && value.width <= 700 ? value.width : 360,
      collapsed: value.collapsed === true }
  } catch { return { width: 360, collapsed: false } }
}
// UI preferences only: manuscript, Session input and project facts stay in their
// existing owners. Hiding the panel never unmounts the Host conversation scope.
export function WorkbenchLayout({ header, children, agent }: { header: ReactNode; children: ReactNode; agent: (close: () => void) => ReactNode }) {
  const [prefs, setPrefs] = useState(preferences), [narrow, setNarrow] = useState(false), [mobileOpen, setMobileOpen] = useState(false)
  const [maxWidth, setMaxWidth] = useState(700), shell = useRef<HTMLDivElement>(null), pane = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null)
  const paneId = useId(), open = narrow ? mobileOpen : !prefs.collapsed
  useEffect(() => {
    const element = shell.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      setNarrow(width < 760); setMaxWidth(Math.max(280, Math.min(700, Math.floor(width - 420))))
    })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  useEffect(() => { try { window.localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* Optional layout preference, never paper data. */ } }, [prefs])
  const resize = (value: number) => setPrefs(previous => ({ ...previous, width: Math.max(280, Math.min(maxWidth, Math.round(value))) }))
  const hide = () => {
    if (narrow) setMobileOpen(false); else setPrefs(previous => ({ ...previous, collapsed: true }))
    toggle.current?.focus()
  }
  return <div ref={shell} className="sf-app" data-sf-narrow={narrow ? 'true' : 'false'}>
    <header className="sf-header">{header} <button ref={toggle} className="sf-chat-icon" aria-label={open ? '收起当前会话面板' : '展开当前会话面板'} title={open ? '收起当前会话面板' : '展开当前会话面板'} aria-controls={paneId} aria-expanded={open} onClick={() => {
      if (narrow) setMobileOpen(!mobileOpen); else setPrefs(previous => ({ ...previous, collapsed: !previous.collapsed }))
    }}><WorkbenchIcon kind="panel" /></button></header>
    <div className="sf-columns" data-agent-open={open ? 'true' : 'false'}>
      <main className="sf-body" hidden={narrow && open}>{children}</main>
      <div role="separator" aria-label="调整当前会话面板宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={maxWidth}
        aria-valuenow={Math.min(prefs.width, maxWidth)} aria-controls={paneId} tabIndex={0} className="sf-agent-resize" hidden={narrow || !open}
        onKeyDown={event => {
          const width = Math.min(prefs.width, maxWidth)
          const next = event.key === 'ArrowLeft' ? width + 20 : event.key === 'ArrowRight' ? width - 20 : event.key === 'Home' ? 280 : event.key === 'End' ? maxWidth : undefined
          if (next !== undefined) { event.preventDefault(); resize(next) }
        }}
        onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) } }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId) && pane.current) resize(pane.current.getBoundingClientRect().right - event.clientX) }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />
      <aside ref={pane} id={paneId} className="sf-agent" aria-label="DSH 当前会话" hidden={!open}
        style={{ width: narrow ? '100%' : Math.min(prefs.width, maxWidth), minWidth: narrow ? 0 : 280 }}
        onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); hide() } }}>
        {narrow && <button onClick={hide}>返回论文工作台</button>}{agent(hide)}
      </aside>
    </div>
  </div>
}
