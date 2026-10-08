import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { THEME_CSS } from './theme/tokens.ts'

/** Electron has no window.prompt. Use the same editable dialog in both clients. */
export function useTextPrompt() {
  const [request, setRequest] = useState<{ title: string; value: string; multiline: boolean; resolve: (value?: string) => void }>()
  const pending = useRef(request); pending.current = request
  const origin = useRef<HTMLElement | null>(null)
  const element = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = element.current
    if (request && node) node.showModal()
    return () => { if (node?.open) node.close() }
  }, [Boolean(request)])
  useEffect(() => () => pending.current?.resolve(undefined), [])
  const ask = (title: string, value = '', multiline = false) => {
    origin.current = document.activeElement as HTMLElement | null
    return new Promise<string | undefined>(resolve => setRequest({ title, value, multiline, resolve }))
  }
  const finish = (value?: string) => {
    request?.resolve(value); setRequest(undefined)
    requestAnimationFrame(() => { if (origin.current?.isConnected) origin.current.focus() })
  }
  const dialog = request && createPortal(<dialog ref={element} className="sf-text-prompt-modal" aria-label={request.title}
    onCancel={event => { event.preventDefault(); finish() }}>
    <style>{THEME_CSS + `.sf-text-prompt-modal{border:0;padding:0;border-radius:var(--sf-radius-xl);font:inherit}.sf-text-prompt-modal::backdrop{background:var(--sf-scrim)}.sf-text-prompt{width:min(520px,calc(100vw - 32px));padding:var(--sf-space-5);box-sizing:border-box;border-radius:var(--sf-radius-xl);background:var(--dsw-alias-bg-base,var(--sf-surface));color:var(--dsw-alias-label-primary,var(--sf-text));box-shadow:var(--sf-shadow-3)}.sf-text-prompt input,.sf-text-prompt textarea{box-sizing:border-box;width:100%;margin:var(--sf-space-3) 0;padding:var(--sf-space-2);font:inherit;color:inherit;background:transparent;border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md)}.sf-text-prompt footer{display:flex;gap:var(--sf-space-2);justify-content:flex-end}.sf-text-prompt button{padding:var(--sf-space-2) var(--sf-space-4);font:inherit;color:inherit;background:transparent;border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md)}`}</style>
    <form className="sf-text-prompt"
      onSubmit={event => { event.preventDefault(); finish(request.value) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish() }
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input,textarea,button:not(:disabled)')]
          const first = controls[0], last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <label>{request.title}{request.multiline
        ? <textarea autoFocus rows={8} value={request.value} onChange={event => setRequest({ ...request, value: event.target.value })} />
        : <input autoFocus value={request.value} onChange={event => setRequest({ ...request, value: event.target.value })} />}</label>
      <footer><button type="button" onClick={() => finish()}>取消</button><button type="submit" disabled={!request.value.trim()}>确认</button></footer>
    </form>
  </dialog>, document.body)
  return { ask, dialog }
}
