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
    <div className={`sf-overlay${collapsed ? ' sf-overlay-mini' : ''}`} ref={root} role="region" aria-label={label} data-sf-overlay-space={Math.round(height + 20)}>
      {!!tabs?.length && tabs.length > 1 && <div className="sf-overlay-tabs" role="tablist">
        {tabs.map(tab => <button key={tab.id} role="tab" type="button" aria-selected={tab.id === active} aria-pressed={tab.id === active}
          onClick={() => onTab?.(tab.id)}>{tab.label}{tab.badge ? ` · ${tab.badge}` : ''}</button>)}
      </div>}
      {collapsed ? <button type="button" onClick={onCollapse} aria-label="恢复修改输入">{active === 'task' ? '待答问题' : '继续修改'} ↗</button> : children}
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
.sf-middle-column[data-overlay-open=true] .sf-source-input{padding-bottom:calc(var(--sf-overlay-space,0px) + 220px)}
.sf-middle-column[data-overlay-open=true] .sf-paper-scroll{padding-bottom:calc(var(--sf-overlay-space,0px) + 40px)}
.sf-overlay{position:absolute;left:var(--sf-space-3);right:var(--sf-space-3);bottom:var(--sf-space-3);z-index:30;box-sizing:border-box;
  background:var(--dsw-alias-bg-base,var(--sf-surface));border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-xl);box-shadow:var(--sf-shadow-2);
  padding:var(--sf-space-2) var(--sf-space-3);font-size:var(--sf-font-md);max-height:45%;overflow:auto;pointer-events:auto}
/* The host sets data-ds-dark-theme on body; the old .sf-app[data-theme=dark] selector was never written by anything. */
.sf-overlay-tabs{display:flex;gap:var(--sf-space-1);margin-bottom:var(--sf-space-2)}
.sf-overlay-tabs button{font:inherit;font-size:var(--sf-font-sm);padding:var(--sf-space-1) var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-pill);background:transparent;color:inherit;cursor:pointer}
.sf-overlay-tabs button[aria-selected=true]{background:var(--sf-accent-soft);border-color:var(--sf-accent);color:var(--sf-accent-text)}
.sf-overlay-head{display:flex;align-items:center;gap:var(--sf-space-2);font-size:var(--sf-font-sm)}
.sf-overlay-title{flex:1;font-weight:500}
.sf-overlay-head button{font:inherit;font-size:var(--sf-font-sm);padding:var(--sf-space-1) var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;color:inherit;cursor:pointer}
.sf-overlay-collapsed{display:flex;align-items:center;gap:var(--sf-space-3);font-size:var(--sf-font-sm)}
.sf-overlay-collapsed span{flex:1;color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-overlay-row{display:flex;align-items:flex-end;gap:var(--sf-space-2);margin-top:var(--sf-space-2)}
.sf-overlay-row textarea,.sf-overlay-row input{flex:1;min-width:0;font:inherit;font-size:var(--sf-font-md);padding:var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;color:inherit;resize:vertical}
.sf-overlay-row button{flex:none;font:inherit;font-size:var(--sf-font-sm);padding:var(--sf-space-2) var(--sf-space-3);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;color:inherit;cursor:pointer}
.sf-overlay-row button.sf-primary{background:var(--sf-accent);border-color:var(--sf-accent);color:var(--sf-on-accent)}
.sf-overlay-note{margin:var(--sf-space-2) 0 0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-overlay-mini{left:auto;width:auto;padding:var(--sf-space-1) var(--sf-space-2)}.sf-overlay-mini button{border:0!important;font-size:var(--sf-font-sm)!important}
.sf-overlay-row{margin:0;align-items:center;gap:var(--sf-space-2)}
.sf-app .sf-overlay-row textarea{min-height:32px;max-height:96px;resize:none;line-height:22px;font-size:var(--sf-font-md);border:0;padding:var(--sf-space-1) var(--sf-space-2);border-radius:var(--sf-radius-md);overflow-y:auto}
.sf-overlay-row select{width:70px;flex:none;border:0!important;padding:var(--sf-space-2) 0!important;font-size:var(--sf-font-sm)!important;white-space:nowrap}
.sf-overlay-row button{white-space:nowrap;min-width:var(--sf-space-6);min-height:var(--sf-space-6);padding:var(--sf-space-1) var(--sf-space-2)!important}
.sf-overlay-row .sf-overlay-close{border:0!important;background:transparent!important;color:inherit!important}
@container (max-width:640px){.sf-overlay{left:var(--sf-space-2);right:var(--sf-space-2);bottom:var(--sf-space-2)}.sf-overlay-mini{left:auto}}
`
