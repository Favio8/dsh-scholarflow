import React, { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

export type SelectionContext = { context: any; selection: any; snapshot: any; binding: any }
const SOURCE = 'scholarflow-selection'
const PREFIX = 'sf-selection:'
const listeners = new Set<() => void>()
let detail: SelectionContext | undefined
const publish = () => listeners.forEach(listener => listener())
const readReference = (ref: string): SelectionContext => {
  if (!ref.startsWith(PREFIX)) throw new Error('无效的论文选区引用。')
  return JSON.parse(decodeURIComponent(ref.slice(PREFIX.length)))
}
function quote(card: SelectionContext) {
  const snapshot = card.snapshot
  return `引用 ${snapshot.documentPath}${snapshot.chapterPath.length ? ` · ${snapshot.chapterPath.join(' / ')}` : ''}\n` +
    snapshot.sourceText.split(/\r\n|\r|\n/).map((line: string) => `> ${line}`).join('\n')
}

// DSH owns chip selection, deletion, undo, persistence and submission. Carry
// the immutable snapshot inside the reference so restored drafts need no cache.
export function createSelectionReferences(ctx: any) {
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: SOURCE, showGroupTitle: false,
    candidates: async () => [], onPick: () => undefined,
    openReference(session: any, reference: any) {
      const card = readReference(reference.ref)
      if (card.binding.sessionId !== session.sessionId) return false
      detail = card; publish(); return true
    },
    codec: {
      clipboardText: (ref: string) => quote(readReference(ref)),
      serialize: async (ref: string) => {
        const card = readReference(ref)
        const snapshot = card.snapshot
        return '\n[论文选文引用，仅作讨论上下文]\n' + quote(card) +
          `\n来源版本：${snapshot.revisionId}；源码位置：${snapshot.sourceRange.startUtf16}–${snapshot.sourceRange.endUtf16}。` +
          `\n段落：${snapshot.blockIds.join('、')}；引用：${snapshot.citations.map((row: any) => row.citeKey).join('、') || '无'}。` +
          '\n[选文引用结束]\n'
      },
    },
  }), 'scholarflow: native selection reference codec')
  return {
    attach(card: SelectionContext, insertion: any) {
      const owner = ctx.sessions.binding(card.binding.sessionId)
      if (!owner) throw new Error('当前会话已切换，请重新选择正文。')
      const ref = PREFIX + encodeURIComponent(JSON.stringify(card))
      const accepted = owner.ctx.bail(owner.ctx, 'slash/input-insert-reference', {
        span: { ...insertion, start: insertion.end, end: insertion.end },
        reference: { source: SOURCE, ref, label: `选文 · ${card.snapshot.selectedCharacters} 字`, appearance: 'file', clipboardText: quote(card) },
      }) === true
      if (!accepted) throw new Error('输入框正在提交或已变化，请再次添加选文。')
    },
    focus(sessionId: string) {
      const owner = ctx.sessions.binding(sessionId)
      if (owner) ctx.conversation.input.for(owner.ctx).focus()
    },
  }
}

export function SelectionDetails({ card, onClose, onTool }: { card: SelectionContext; onClose: () => void; onTool?: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  return createPortal(<div className="sf-selection-detail-backdrop" onPointerDown={onClose}>
    <section className="sf-selection-detail" role="dialog" aria-modal="true" aria-label="选文详情" onPointerDown={event => event.stopPropagation()}>
      <header><strong>选文详情</strong><button aria-label="关闭选文详情" onClick={onClose}>×</button></header>
      <p className="sf-selection-origin">{card.snapshot.documentPath} · {card.snapshot.selectedCharacters} 字</p>
      {card.snapshot.chapterPath.length > 0 && <p className="sf-selection-origin">{card.snapshot.chapterPath.join(' / ')}</p>}
      <blockquote>{card.snapshot.sourceText}</blockquote>
      <details><summary>稿件版本与引用</summary><p>版本：{card.snapshot.revisionId}</p><p>范围：{card.snapshot.sourceRange.startUtf16}–{card.snapshot.sourceRange.endUtf16}</p>
        <p>引用：{card.snapshot.citations.map((row: any) => `${row.citeKey}${row.registered ? '' : '（未登记）'}`).join('、') || '无'}</p></details>
      {onTool && <button className="sf-selection-revise" onClick={() => { onClose(); onTool() }}>查看修改建议</button>}
    </section>
  </div>, document.body)
}

export function SelectionReferenceDetails({ sessionId }: { sessionId?: string }) {
  const card = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => detail, () => undefined)
  const close = () => { detail = undefined; publish() }
  useEffect(() => { close() }, [sessionId])
  return card && card.binding.sessionId === sessionId ? <SelectionDetails card={card} onClose={close} /> : null
}

export const SELECTION_CSS = `
.sf-selection-menu{position:fixed;z-index:2000;display:flex;align-items:center;max-width:calc(100vw - 16px);border:1px solid var(--dsw-alias-border-l3,var(--sf-border));background:var(--dsw-alias-bg-layer-1,var(--sf-surface));color:var(--dsw-alias-label-primary,var(--sf-text));border-radius:var(--sf-radius-xl);box-shadow:var(--sf-shadow-2);overflow:hidden;font-family:system-ui,sans-serif;font-size:var(--sf-font-md);line-height:var(--sf-leading-tight)}
.sf-selection-menu button{appearance:none!important;border:0!important;border-radius:0!important;background:transparent!important;color:inherit!important;font:inherit!important;padding:var(--sf-space-2) var(--sf-space-3)!important;white-space:nowrap;cursor:pointer}
.sf-selection-menu button+button{border-left:1px solid var(--dsw-alias-border-l3,var(--sf-border-soft))!important}
.sf-selection-menu button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--sf-hover))!important}.sf-selection-menu button:disabled{opacity:var(--sf-disabled-opacity);cursor:default}
.sf-selection-detail-backdrop{position:fixed;inset:0;z-index:2100;background:var(--sf-scrim);display:flex;align-items:center;justify-content:center;padding:var(--sf-space-5);box-sizing:border-box}
.sf-selection-detail{box-sizing:border-box;width:440px;max-width:100%;max-height:75vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,var(--sf-surface));color:var(--dsw-alias-label-primary,var(--sf-text));border:1px solid var(--dsw-alias-border-l3,var(--sf-border));border-radius:var(--sf-radius-xl);box-shadow:var(--sf-shadow-3);padding:var(--sf-space-4);font-family:system-ui,sans-serif;font-size:var(--sf-font-md);line-height:var(--sf-leading-body)}
.sf-selection-detail header{display:flex;align-items:center;justify-content:space-between;gap:var(--sf-space-4)}.sf-selection-detail button{font:inherit;color:inherit;background:transparent;border:0;cursor:pointer}.sf-selection-detail header button{font-size:var(--sf-font-2xl);line-height:1;padding:var(--sf-space-hair) var(--sf-space-2)}
.sf-selection-origin{color:var(--dsw-alias-label-secondary,var(--sf-muted));overflow-wrap:anywhere;margin:var(--sf-space-2) 0}.sf-selection-detail blockquote{margin:var(--sf-space-4) 0;padding:var(--sf-space-2) var(--sf-space-4);border-left:3px solid var(--sf-accent-border);background:var(--sf-accent-soft);white-space:pre-wrap;overflow-wrap:anywhere}
.sf-selection-detail details{font-size:var(--sf-font-sm);overflow-wrap:anywhere}.sf-selection-detail summary{cursor:pointer;color:var(--dsw-alias-label-secondary,var(--sf-muted))}.sf-selection-detail .sf-selection-revise{margin-top:var(--sf-space-3);color:var(--sf-accent-text)}
`
