import React, { useLayoutEffect } from 'react'
import { sourceRangeRect } from './selection-menu.tsx'

/** Keep the source target above a readable reserved row; the textarea has no inline
 * widget API. Preview uses an AST block after the selected paragraph. */
export function SourceCandidate({ area, end, identity, children }: {
  area: React.RefObject<HTMLTextAreaElement | null>; end: number; identity: string; children: React.ReactNode
}) {
  useLayoutEffect(() => {
    const input = area.current
    if (!input) return
    // A textarea has no block-widget API. Reserve a readable row below the panes rather
    // than cover the following source lines; keep the captured target immediately above it.
    const target = sourceRangeRect(input, end, end), box = input.getBoundingClientRect()
    input.scrollTop += target.bottom - box.bottom + 24
  }, [area, end, identity])
  return <div className="sf-source-candidate"
    onMouseUp={event => event.stopPropagation()}>{children}</div>
}

export const SOURCE_CANDIDATE_CSS = `
.sf-source-candidate{flex:none;min-height:0;max-height:42%;margin:6px 12px;overflow:auto;overscroll-behavior:contain;background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px}
.sf-source-candidate .sf-rewrite{margin:0;max-height:320px;display:flex;flex-direction:column}
.sf-source-candidate .sf-rewrite-reading{flex:1;min-height:0}
.sf-source-candidate .sf-rewrite>header,.sf-source-candidate .sf-rewrite-actions,.sf-source-candidate .sf-rewrite-technical{flex:none}
.sf-middle-column[data-overlay-open=true] .sf-source-candidate{margin-bottom:var(--sf-overlay-space,0px)}
`
