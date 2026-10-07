import React, { useMemo, useState } from 'react'
import { projectMarkdown } from '../core/editing/markdown.ts'
import { MarkdownView } from './markdown.tsx'
import { ApplicationError, ErrorNotice } from './application-error.tsx'

/**
 * The candidate sits under the text it would replace (PRD §5.3 / SPEC v1.2 §12.3). It shows
 * the original and the proposed text together with the changes marked, keeps the original
 * visible at all times, and never applies itself: accepting is a click, and the click is what
 * writes, not the end of an animation.
 */
export type RewriteCandidate = { id: string; action: string; instruction: string; origin?: 'source' | 'preview'
  start: number; end: number; before: string; after: string
  protectedFactChanges?: string[]; citationChanges?: { added: string[]; removed: string[] }
  state: 'generating' | 'ready' | 'accepted' | 'discarded' | 'stopped' | 'failed'
  note?: string; elapsedMs?: number; phase?: string; diagnostic?: { code: string; message: string; details?: ApplicationError['details'] } }

const ACTION_LABEL: Record<string, string> = { rewrite: 'AI 改写', polish: '润色', shorten: '精简', expand: '扩写', custom: '自定义改写' }

/** Word-level diff so insertions and deletions are visible instead of implied. */
export function diffSegments(before: string, after: string) {
  const left = before.split(/(\s+|(?<=[\u4e00-\u9fa5])|(?=[\u4e00-\u9fa5]))/).filter(Boolean)
  const right = after.split(/(\s+|(?<=[\u4e00-\u9fa5])|(?=[\u4e00-\u9fa5]))/).filter(Boolean)
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const segments: { kind: 'same' | 'add' | 'remove'; text: string }[] = []
  const push = (kind: 'same' | 'add' | 'remove', text: string) => {
    const last = segments.at(-1)
    if (last && last.kind === kind) last.text += text
    else segments.push({ kind, text })
  }
  let i = 0, j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { push('same', left[i]); i++; j++ }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('remove', left[i]); i++ }
    else { push('add', right[j]); j++ }
  }
  while (i < left.length) push('remove', left[i++])
  while (j < right.length) push('add', right[j++])
  return segments
}

/** Facts, numbers and citations that moved: the parts a reader has to check by hand. */
export function protectedChanges(before: string, after: string) {
  const numbers = (text: string) => new Set(text.match(/\d+(?:\.\d+)?%?/g) ?? [])
  const citations = (text: string) => new Set(text.match(/\[[^\]]+\]|sf_[A-Za-z0-9_]+/g) ?? [])
  const changes: string[] = []
  for (const value of numbers(before)) if (!numbers(after).has(value)) changes.push(`数字 ${value} 在候选里不再出现`)
  for (const value of numbers(after)) if (!numbers(before).has(value)) changes.push(`候选新增了数字 ${value}，需要核对来源`)
  for (const value of citations(before)) if (!citations(after).has(value)) changes.push(`引用 ${value} 被移除`)
  for (const value of citations(after)) if (!citations(before).has(value)) changes.push(`候选新增引用 ${value}`)
  return changes
}

export function RewriteCandidateView({ candidate, onAccept, onDiscard, onUndo, onStop, onRegenerate, canAccept, busy, citationOrder = [] }: {
  candidate: RewriteCandidate; onAccept: () => void; onDiscard: () => void; onUndo?: () => void; onStop?: () => void
  onRegenerate?: () => void; canAccept: boolean; busy: boolean; citationOrder?: string[]
}) {
  const working = candidate.state === 'generating'
  const ready = candidate.state === 'ready' && !!candidate.after.trim()
  const preview = useMemo(() => ready ? projectMarkdown(candidate.after, citationOrder) : undefined, [ready, candidate.after, citationOrder])
  const [showDiff, setShowDiff] = useState(false)
  const changes = candidate.state === 'ready' ? (candidate.protectedFactChanges ?? protectedChanges(candidate.before, candidate.after)) : []
  const citations = candidate.citationChanges
  return <section className="sf-rewrite" data-state={candidate.state} aria-label="改写候选" data-sf-protected="true" onMouseUp={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <header>
      <strong>{ACTION_LABEL[candidate.action] ?? '改写候选'}</strong>
      {!!candidate.instruction && <span className="sf-rewrite-instruction">{candidate.instruction}</span>}
      <span className="sf-rewrite-state" role="status">{stateLabel(candidate)}</span>
    </header>
    {/* The gradient belongs to the candidate's own area and stops the moment the state does. */}
    {working && <div className="sf-rewrite-sweep" aria-hidden="true"><span className="sf-rewrite-spinner" /><span>{candidate.phase ?? '正在生成候选…'}</span>
      {candidate.elapsedMs !== undefined && <span className="sf-rewrite-elapsed">已用 {formatElapsed(candidate.elapsedMs)}</span>}
      {onStop && <button type="button" disabled={busy} onClick={onStop}>停止</button>}</div>}
    {ready && preview && <>
      <div className="sf-rewrite-reading"><MarkdownView projection={preview} /></div>
      <details className="sf-rewrite-technical" onToggle={event => setShowDiff(event.currentTarget.open)}><summary>查看原文与差异</summary>{showDiff && <div className="sf-rewrite-diff">
      <div className="sf-rewrite-before"><b>原文</b><p>{candidate.before}</p></div>
      <div className="sf-rewrite-after"><b>新文</b><p>{diffSegments(candidate.before, candidate.after).map((segment, index) =>
        segment.kind === 'same' ? <React.Fragment key={index}>{segment.text}</React.Fragment>
          : segment.kind === 'add' ? <ins key={index}>{segment.text}</ins> : <del key={index}>{segment.text}</del>)}</p></div>
      </div>}</details>
    </>}
    {!!(changes.length || citations?.added.length || citations?.removed.length) && <details className="sf-rewrite-facts">
      <summary>事实、数字与引用变化（{changes.length + (citations?.added.length ?? 0) + (citations?.removed.length ?? 0)}）</summary>
      {changes.map(change => <p key={change}>{change}</p>)}
      {!!citations?.added.length && <p>新增引用：{citations.added.join('、')}</p>}
      {!!citations?.removed.length && <p>移除引用：{citations.removed.join('、')}</p>}
    </details>}
    {candidate.diagnostic ? <ErrorNotice error={new ApplicationError(candidate.diagnostic)} /> : candidate.note && <p className="sf-rewrite-note" role="status">{candidate.note}</p>}
    <div className="sf-rewrite-actions">
      {ready && <>
        <button type="button" className="sf-primary" disabled={busy || !canAccept} onClick={onAccept} data-sf-accept>√ 采用</button>
        <button type="button" disabled={busy} onClick={onDiscard} data-sf-discard>× 放弃</button>
      </>}
      {(candidate.state === 'stopped' || candidate.state === 'failed') && onRegenerate &&
        <button type="button" disabled={busy} onClick={onRegenerate}>重新生成</button>}
      {(candidate.state === 'stopped' || candidate.state === 'failed') && <button type="button" disabled={busy} onClick={onDiscard}>× 放弃</button>}
      {candidate.state === 'accepted' && onUndo && <button type="button" disabled={busy} onClick={onUndo} data-sf-undo>撤销接受</button>}
    </div>
  </section>
}

function stateLabel(candidate: RewriteCandidate) {
  switch (candidate.state) {
    case 'generating': return '正在生成'
    case 'ready': return '候选已生成 · 未自动应用'
    case 'accepted': return '已接受 · 进入编辑缓冲'
    case 'discarded': return '已放弃 · 原文未改变'
    case 'stopped': return '已停止 · 原文未改变'
    default: return '生成失败 · 原文未改变'
  }
}

function formatElapsed(ms: number) { return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒` }

export const REWRITE_CSS = `
.sf-rewrite{margin:10px 0 14px;border:1px solid #4475e755;border-radius:10px;background:#4475e70d;font-size:13px;position:relative;overflow:hidden;transition:background-color var(--sf-dur-quick,150ms),border-color var(--sf-dur-quick,150ms);animation:sf-candidate-in var(--sf-dur-quick,150ms) var(--sf-ease-out)}
.sf-rewrite[data-state=accepted]{background:#3ca36f0a;border-color:#3ca36f44}
@keyframes sf-candidate-in{from{opacity:0}to{opacity:1}}
.sf-rewrite>header{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid #8882;flex-wrap:wrap}
.sf-rewrite>header strong{font-size:12.5px}
.sf-rewrite-instruction{flex:1;min-width:120px;font-size:12px;color:var(--dsw-alias-label-secondary,#727780);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-rewrite-state{font-size:12px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-rewrite-sweep{position:relative;display:flex;align-items:center;gap:9px;padding:12px}
.sf-rewrite-sweep::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(100deg,#4475e700,#4475e72e,#7a4fe02e,#3ca36f2e,#4475e700);
  background-size:300% 100%;animation:sf-sweep var(--sf-sweep,2.8s) var(--sf-ease-in-out,cubic-bezier(.4,0,.2,1)) infinite}
.sf-rewrite-spinner{flex:none;width:12px;height:12px;border:2px solid var(--sf-accent,#3f68d8);border-right-color:transparent;border-radius:50%;animation:sf-spin 1s linear infinite}
.sf-rewrite-sweep>span:nth-child(2){flex:1;font-size:12.5px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-rewrite-elapsed{font-size:12px;color:var(--dsw-alias-label-secondary,#727780);font-variant-numeric:tabular-nums}
.sf-rewrite-sweep>button{font:inherit;font-size:12px;padding:4px 10px;border:1px solid #8884;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
/* A finished, stopped or failed candidate must not keep animating. */
.sf-rewrite[data-state=ready] .sf-rewrite-sweep::before,.sf-rewrite[data-state=stopped] .sf-rewrite-sweep::before,
.sf-rewrite[data-state=failed] .sf-rewrite-sweep::before,.sf-rewrite[data-state=discarded] .sf-rewrite-sweep::before,
.sf-rewrite[data-state=accepted] .sf-rewrite-sweep::before{animation:none;background:none}
.sf-rewrite-diff{display:flex;flex-direction:column}
.sf-rewrite-before,.sf-rewrite-after{padding:10px 12px}
.sf-rewrite-before{border-bottom:1px solid #8882;background:#d451510a}
.sf-rewrite-after{background:#3ca36f0a}
.sf-rewrite-diff b{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary,#727780);margin-bottom:4px}
.sf-rewrite-diff p{margin:0;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
.sf-rewrite-before del{background:#d4515122;text-decoration:line-through;text-decoration-color:#b04a4a}
.sf-rewrite-after del{background:#d4515122;color:#b04a4a;text-decoration:line-through}
.sf-rewrite-after ins{background:#3ca36f22;text-decoration:none}
.sf-rewrite-facts{padding:8px 12px;border-top:1px solid #8882;font-size:12px}
.sf-rewrite-facts summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#727780)}
.sf-rewrite-facts p{margin:6px 0 0;line-height:1.6}
.sf-rewrite-note{margin:0;padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-rewrite-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid #8882}
.sf-rewrite-actions button{font:inherit;font-size:12.5px;padding:6px 12px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
.sf-rewrite-actions button.sf-primary{background:var(--sf-accent,#3f68d8);border-color:var(--sf-accent,#3f68d8);color:#fff}
.sf-rewrite-reading{padding:6px 14px;max-height:300px;overflow:auto}
.sf-rewrite-reading .sf-prose{font-size:inherit!important;line-height:1.75!important}
.sf-rewrite-technical{padding:6px 12px;font-size:12px}.sf-rewrite-technical summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.sf-rewrite-actions{position:sticky;bottom:0;background:var(--dsw-alias-bg-base,#fff);z-index:1}
.sf-rewrite-reading .sf-prose p{margin:8px 0!important}
@keyframes sf-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){
  .sf-rewrite-sweep::before{animation:none;background:#4475e70d}
  .sf-rewrite-spinner{animation:none;border-right-color:var(--sf-accent,#3f68d8)}
}
`
