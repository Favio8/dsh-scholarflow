import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A measuring mirror belongs to this textarea only. It reads real typography
// and scroll position; it neither rewrites the editor nor inspects host UI.
export function sourceSelectionRect(area: HTMLTextAreaElement): DOMRect {
  const mirror = document.createElement('div'), span = document.createElement('span')
  const style = window.getComputedStyle(area), bounds = area.getBoundingClientRect()
  for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'tab-size', 'padding', 'border', 'box-sizing']) {
    mirror.style.setProperty(property, style.getPropertyValue(property))
  }
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre',
    left: `${bounds.left - area.scrollLeft}px`, top: `${bounds.top - area.scrollTop}px`, width: `${bounds.width}px` })
  mirror.append(document.createTextNode(area.value.slice(0, area.selectionStart)))
  span.textContent = area.value.slice(area.selectionStart, area.selectionEnd) || '\u200b'
  mirror.append(span); document.body.append(mirror)
  try {
    const rect = span.getClientRects()[0] ?? span.getBoundingClientRect()
    const top = Math.max(bounds.top, Math.min(rect.top, bounds.bottom - 22))
    return new DOMRect(Math.max(bounds.left, Math.min(rect.left, bounds.right - 20)), top, Math.min(rect.width, bounds.width), Math.min(rect.height, 24))
  } finally { mirror.remove() }
}

export function SelectionMenu({ anchor, busy, onAdd, onDetails, onAsk, onClose }: {
  anchor: DOMRect; busy: boolean; onAdd: () => void; onDetails: () => void; onAsk: () => void; onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.top, ready: false })
  useLayoutEffect(() => {
    const box = root.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))
    const preferred = anchor.top - box.height - 9
    const top = Math.max(8, Math.min(preferred >= 8 ? preferred : anchor.bottom + 9, window.innerHeight - box.height - 8))
    setPosition({ left, top, ready: true })
  }, [anchor])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const scroll = (event: Event) => { if (!root.current?.contains(event.target as Node)) onClose() }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  return createPortal(<div ref={root} className="sf-selection-menu" role="toolbar" aria-label="选文操作"
    style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
    onPointerDown={event => event.preventDefault()}>
    <button disabled={busy} onClick={onAdd}>添加到对话</button>
    <button disabled={busy} onClick={onDetails}>更多详情</button>
    <button disabled={busy} onClick={onAsk}>在侧边聊天中提问</button>
  </div>, document.body)
}
