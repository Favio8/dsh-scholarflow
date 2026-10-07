import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
    <style>{`.sf-text-prompt-modal{border:0;padding:0;border-radius:12px;font:inherit}.sf-text-prompt-modal::backdrop{background:#0004}.sf-text-prompt{width:min(520px,calc(100vw - 32px));padding:22px;box-sizing:border-box;border-radius:12px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);box-shadow:0 8px 32px #0003}.sf-text-prompt input,.sf-text-prompt textarea{box-sizing:border-box;width:100%;margin:12px 0;padding:10px;font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px}.sf-text-prompt footer{display:flex;gap:10px;justify-content:flex-end}.sf-text-prompt button{padding:8px 16px;font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px}`}</style>
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
