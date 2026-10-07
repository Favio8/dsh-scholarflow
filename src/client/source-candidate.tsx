import React, { useLayoutEffect, useRef, useState } from 'react'
import { sourceRangeRect } from './selection-menu.tsx'

/** A source textarea cannot contain a block widget. Anchor its proposal just below the
 * target line, above the following source lines; preview uses a normal block after the
 * selected paragraph. Neither surface inserts proposal text into the manuscript. */
export function SourceCandidate({ area, end, identity, children }: {
  area: React.RefObject<HTMLTextAreaElement | null>; end: number; identity: string; children: React.ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, height: 180, visible: false })
  useLayoutEffect(() => {
    const input = area.current!, parent = input.parentElement!
    const locate = () => {
      const box = parent.getBoundingClientRect(), target = sourceRangeRect(input, end, end)
      const top = target.bottom - box.top + 6
      setPosition({ top, height: Math.max(80, box.height - top - 8), visible: target.bottom >= box.top && target.top < box.bottom })
    }
    // Make room below a target near the bottom, without jumping to the start of the paper.
    const box = parent.getBoundingClientRect(), target = sourceRangeRect(input, end, end)
    const needed = target.bottom - box.top + 186 - box.height
    if (needed > 0 && target.top < box.bottom && target.bottom >= box.top) input.scrollTop += needed
    locate()
    input.addEventListener('scroll', locate)
    const observer = new ResizeObserver(locate); observer.observe(parent)
    return () => { input.removeEventListener('scroll', locate); observer.disconnect() }
  }, [area, end, identity])
  return <div ref={root} className="sf-source-candidate" style={{ top: position.top, maxHeight: position.height }} hidden={!position.visible}
    onMouseUp={event => event.stopPropagation()}>{children}</div>
}

export const SOURCE_CANDIDATE_CSS = `
.sf-source-candidate{position:absolute;left:46px;right:10px;z-index:3;overflow:auto;overscroll-behavior:contain;background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;box-shadow:0 4px 16px #0002}
.sf-source-candidate .sf-rewrite{margin:0}
.sf-source-editor[data-candidate=true] .sf-source-input{padding-bottom:220px}
`
