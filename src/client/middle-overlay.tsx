import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SfPresence } from './motion/presence.tsx'
import { SCENE } from './motion/tokens.ts'

/**
 * The bottom overlay (SPEC v1.2 §11). It floats against the middle column's content viewport,
 * above the content and below the host's own dialogs, and is the single place that carries
 * both the local rewrite instruction and the questions a task needs answered.
 *
 * It is positioned rather than laid out, so opening it never moves the text above it; the
 * scroller gains matching bottom padding instead, which is what lets the last paragraph and
 * the accept buttons scroll clear of the overlay.
 */

export type OverlayTab = { id: string; label: string; badge?: number }
export type OverlayHostProps = { open: boolean; tabs?: OverlayTab[]; active?: string; onTab?: (id: string) => void
  children: React.ReactNode; onCollapse?: () => void; collapsed?: boolean; label?: string }

export function OverlayHost({ open, tabs, active, onTab, children, onCollapse, collapsed, label = '修改输入' }: OverlayHostProps) {
  const root = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  // Measured, not guessed: the scroller's padding has to equal the real height or the last
  // block either hides behind the overlay or leaves a gap.
  useLayoutEffect(() => {
    const node = root.current
    if (!node) return
    const measure = () => setHeight(node.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open, collapsed, active, children])
  return <SfPresence open={open} offset={SCENE.overlayShift} className="sf-overlay-presence">
    <div className="sf-overlay" ref={root} role="region" aria-label={label} data-sf-overlay-space={Math.round(height + 20)}>
      {!!tabs?.length && tabs.length > 1 && <div className="sf-overlay-tabs" role="tablist">
        {tabs.map(tab => <button key={tab.id} role="tab" type="button" aria-selected={tab.id === active} aria-pressed={tab.id === active}
          onClick={() => onTab?.(tab.id)}>{tab.label}{tab.badge ? ` · ${tab.badge}` : ''}</button>)}
      </div>}
      {collapsed ? <div className="sf-overlay-collapsed">
        <span>已收起；任务等待状态保持可见。</span>
        <button type="button" onClick={onCollapse}>展开</button>
      </div> : <>
        <header className="sf-overlay-head">
          <span className="sf-overlay-title">{label}</span>
          {collapsed === false && onCollapse && <button type="button" onClick={onCollapse}>收起</button>}
        </header>
        {children}
      </>}
    </div>
  </SfPresence>
}

/**
 * Publishes the overlay's height to the middle column so scrolling can clear it. Kept as a
 * hook rather than a wrapper so the editor keeps ownership of its own DOM shape.
 */
export function useOverlaySpace(container: React.RefObject<HTMLElement | null>, attribute = 'data-sf-overlay-space') {
  useEffect(() => {
    const node = container.current
    if (!node) return
    const sync = () => {
      const overlay = node.querySelector<HTMLElement>('.sf-overlay')
      const space = overlay && overlay.offsetParent !== null ? Number(overlay.dataset.sfOverlaySpace ?? 0) : 0
      node.style.setProperty('--sf-overlay-space', `${space}px`)
      node.dataset.overlayOpen = space > 0 ? 'true' : 'false'
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-sf-overlay-space'] })
    return () => observer.disconnect()
  }, [container, attribute])
}

export const OVERLAY_CSS = `
/* Carry the draft viewport through this wrapper; a block with auto height grows with the
   manuscript and leaves the inner editor/preview with no overflow of their own. */
.sf-middle-column{position:relative;isolation:isolate;display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
/* Motion's transform establishes a containing block. Give it the full viewport, and allow
   pointer input through the empty part of that layer to the editor underneath. */
.sf-overlay-presence{position:absolute;inset:0;z-index:30;pointer-events:none}
/* Bottom space is added only while the overlay is present, so the resting editor has none. */
.sf-middle-column[data-overlay-open=true] .sf-editor-scroll{padding-bottom:calc(var(--sf-overlay-space,0px) + 8px)}
.sf-overlay{position:absolute;left:10px;right:10px;bottom:10px;z-index:30;box-sizing:border-box;
  background:var(--dsw-alias-bg-base,#fff);border:1px solid #8884;border-radius:11px;box-shadow:0 10px 28px #0000001a;
  padding:10px 12px;font-size:13px;max-height:60%;overflow:auto;pointer-events:auto}
.sf-app[data-theme=dark] .sf-overlay,html[data-theme=dark] .sf-overlay{background:#1c1d20}
.sf-overlay-tabs{display:flex;gap:4px;margin-bottom:8px}
.sf-overlay-tabs button{font:inherit;font-size:12px;padding:4px 9px;border:1px solid #8884;border-radius:999px;background:transparent;color:inherit;cursor:pointer}
.sf-overlay-tabs button[aria-selected=true]{background:#4475e714;border-color:var(--sf-accent,#3f68d8);color:var(--sf-accent-text,#2f5bc4)}
.sf-overlay-head{display:flex;align-items:center;gap:8px;font-size:12.5px}
.sf-overlay-title{flex:1;font-weight:500}
.sf-overlay-head button{font:inherit;font-size:12px;padding:3px 8px;border:1px solid #8884;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.sf-overlay-collapsed{display:flex;align-items:center;gap:10px;font-size:12px}
.sf-overlay-collapsed span{flex:1;color:var(--dsw-alias-label-secondary,#727780)}
.sf-overlay-row{display:flex;align-items:flex-end;gap:8px;margin-top:8px}
.sf-overlay-row textarea,.sf-overlay-row input{flex:1;min-width:0;font:inherit;font-size:13px;padding:7px 9px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit;resize:vertical}
.sf-overlay-row button{flex:none;font:inherit;font-size:12.5px;padding:7px 12px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
.sf-overlay-row button.sf-primary{background:var(--sf-accent,#3f68d8);border-color:var(--sf-accent,#3f68d8);color:#fff}
.sf-overlay-note{margin:7px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8b9099)}
@container (max-width:640px){.sf-overlay{left:6px;right:6px;bottom:6px}}
`
