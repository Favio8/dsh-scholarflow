import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SCENE } from './motion/tokens.ts'
import { mirrorOf } from './source-measure.ts'
import type { ZoomAnchor } from './pane-zoom.tsx'

/**
 * The rewrite entry (PRD §5.2 / SPEC v1.2 §12.1). The fixed toolbar that used to sit above the
 * text is gone: the menu appears next to the selection the user just made, offers the four
 * common transformations plus a custom request, and **choosing one calls no model**. The choice
 * becomes an instruction in the bottom overlay, where the user can add to it or send it as is.
 */
export type RewriteAction = 'rewrite' | 'polish' | 'shorten' | 'expand' | 'custom'

export const REWRITE_ACTIONS: { action: RewriteAction; label: string; instruction: string }[] = [
  { action: 'rewrite', label: 'AI 改写', instruction: '在不改变事实、数字、专有名词和引用的前提下改写这段文字。' },
  { action: 'polish', label: '润色', instruction: '润色这段文字，使其表达更通顺准确；不要新增事实或结论。' },
  { action: 'shorten', label: '精简', instruction: '精简这段文字，保留全部事实、限定条件和引用；不要删除必要信息。' },
  { action: 'expand', label: '扩写', instruction: '在不引入新事实、数字或来源的前提下，把这段文字写得更充分。' },
  { action: 'custom', label: '自定义要求…', instruction: '' },
]

/**
 * A measuring mirror belongs to this textarea only. It reads real typography and scroll
 * position; it neither rewrites the editor nor inspects host UI. It is also the reason the
 * menu can be placed without a transform on any ancestor of the editor.
 */
export function sourceSelectionRect(area: HTMLTextAreaElement): DOMRect {
  return sourceRangeRect(area, area.selectionStart, area.selectionEnd)
}

export function sourceRangeRect(area: HTMLTextAreaElement, start: number, end: number): DOMRect {
  const mirror = mirrorOf(area), span = document.createElement('span')
  const style = window.getComputedStyle(area), bounds = area.getBoundingClientRect()
  mirror.append(document.createTextNode(area.value.slice(0, start)))
  span.textContent = area.value.slice(start, end) || '\u200b'
  mirror.append(span); document.body.append(mirror)
  try {
    const rect = span.getClientRects()[0] ?? span.getBoundingClientRect()
    const left = Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - 16))
    return new DOMRect(left, rect.top, Math.max(0, Math.min(rect.right, bounds.right) - left), Math.min(rect.height, parseFloat(style.lineHeight)))
  } finally { mirror.remove() }
}

/**
 * Bring a source offset into view with a top margin. Measured rather than estimated from a line
 * index: a wrapped paragraph does not occupy one row per logical line, so "line index × line
 * height" lands somewhere else entirely once the pane wraps (SF-086).
 */
export function revealSourceOffset(area: HTMLTextAreaElement, offset: number, margin: number): void {
  const delta = sourceRangeRect(area, offset, offset).top - area.getBoundingClientRect().top - margin
  if (Math.abs(delta) > 1) area.scrollTop += delta
}

/**
 * Keep the text under the zoom anchor where it is. Scaling `scrollTop` by the zoom ratio is exact
 * for the preview, whose CSS `zoom` scales the scroll extent linearly, but not for the source pane:
 * a larger font wraps a paragraph into more rows than the ratio accounts for. So the offset at the
 * anchor is found before the change and measured again after it, and that offset is returned to the
 * same place on screen. This runs on zoom only, which the wheel handler already batches by frame.
 */
export function textareaZoomAnchor(area: React.RefObject<HTMLTextAreaElement | null>): ZoomAnchor {
  return {
    capture(point) {
      const node = area.current
      if (!node) return undefined
      // `sourceRangeRect` is monotonic in the offset, so the offset at the anchor is a search.
      const target = node.getBoundingClientRect().top + point.y
      let low = 0, high = node.value.length
      while (low < high) {
        const middle = (low + high + 1) >> 1
        if (sourceRangeRect(node, middle, middle).top <= target) low = middle
        else high = middle - 1
      }
      return { offset: low, top: sourceRangeRect(node, low, low).top }
    },
    restore(token) {
      const node = area.current, held = token as { offset: number; top: number } | undefined
      if (!node || !held) return
      const delta = sourceRangeRect(node, held.offset, held.offset).top - held.top
      if (Math.abs(delta) > 1) node.scrollTop += delta
    },
  }
}

/**
 * A DOMRect for a selection made in the rendered preview, so both views place the menu the
 * same way and a selection maps to the same document range (PRD §5.2).
 */
export function renderedSelectionRect(range: Range): DOMRect {
  const rects = range.getClientRects()
  return rects[0] ?? range.getBoundingClientRect()
}

export function SelectionMenu({ anchor, busy, onAction, onClose, hasModels = true, getAnchor }: {
  anchor: DOMRect; busy: boolean; hasModels?: boolean; onAction: (action: RewriteAction) => void; onClose: () => void; getAnchor?: () => DOMRect
}) {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.top, ready: false })
  // Positioning runs before paint, so the menu is never briefly drawn at a stale spot and the
  // Portal's hit area matches what the user sees while it animates in.
  useLayoutEffect(() => {
    const box = root.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))
    const preferred = anchor.top - box.height - 9
    const top = Math.max(8, Math.min(preferred >= 8 ? preferred : anchor.bottom + 9, window.innerHeight - box.height - 8))
    setPosition({ left, top, ready: true })
  }, [anchor])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    const scroll = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return
      if (!getAnchor) { onClose(); return }
      const actual = getAnchor(), box = root.current!.getBoundingClientRect()
      setPosition({ left: Math.max(8, Math.min(actual.left, window.innerWidth - box.width - 8)),
        top: Math.max(8, actual.top > box.height + 9 ? actual.top - box.height - 9 : actual.bottom + 9), ready: true })
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  const buttons = root.current?.querySelectorAll('button')
  const focusAt = (index: number) => {
    const list = [...(buttons ?? [])]
    if (!list.length) return
    list[(index + list.length) % list.length]?.focus()
  }
  return createPortal(<div ref={root} className="sf-selection-menu" role="toolbar" aria-label="选文操作"
    style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
    onPointerDown={event => event.preventDefault()}
    onKeyDown={event => {
      const list = [...(buttons ?? [])]
      const index = list.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'ArrowRight') { event.preventDefault(); focusAt(index + 1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); focusAt(index - 1) }
      if (event.key === 'Home') { event.preventDefault(); focusAt(0) }
      if (event.key === 'End') { event.preventDefault(); focusAt(list.length - 1) }
    }}>
    {REWRITE_ACTIONS.map((entry, index) => <button key={entry.action} type="button" disabled={busy || !hasModels}
      onClick={() => onAction(entry.action)}
      title={entry.instruction || '自己写修改要求'}>{entry.label}</button>)}
  </div>, document.body)
}

export const SELECTION_MENU_CSS = `
.sf-selection-menu{position:fixed;z-index:60;display:flex;gap:var(--sf-space-hair);padding:var(--sf-space-1);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-lg);
  background:var(--dsw-alias-bg-base,var(--sf-surface));box-shadow:var(--sf-shadow-2);
  animation:sf-menu-in var(--sf-dur-quick,150ms) var(--sf-ease-out,cubic-bezier(.22,.61,.36,1))}
.sf-selection-menu button{font:inherit;font-size:var(--sf-font-sm);padding:var(--sf-space-1) var(--sf-space-2);border:0;border-radius:var(--sf-radius-md);background:transparent;color:inherit;cursor:pointer}
.sf-selection-menu button:hover:not(:disabled){background:var(--sf-accent-soft);color:var(--sf-accent-text)}
.sf-selection-menu button:disabled{opacity:var(--sf-disabled-opacity);cursor:default}
.sf-selection-menu button:focus-visible{outline:var(--sf-focus-width) solid var(--sf-focus-color);outline-offset:1px}
@keyframes sf-menu-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.sf-selection-menu{animation:none}}
.sf-rewrite-anchor{background:var(--sf-warn-soft);border-radius:var(--sf-radius-sm);box-shadow:inset 0 -1px 0 var(--sf-warn-border)}
`
