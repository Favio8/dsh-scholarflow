import React, { useEffect, useMemo, useRef, useState } from 'react'
import { projectMarkdown, wordStats, textOf, validateRange, validateProseRange } from '../core/editing/markdown.ts'
import { sectionTarget } from '../core/editing/sections.ts'
import { MarkdownView, captureSelection } from './markdown.tsx'
import type { SelectionPayload } from '../shared/editing.ts'
import { ProposalRevision } from './proposal-revision.tsx'
import { DraftSequence } from './draft-sequence.tsx'
import { ManuscriptImport } from './manuscript-import.tsx'
import { scratchKey, readScratch, writeScratch, ScratchQueue } from './scratch-backup.ts'
import type { DraftController, PaperView } from './paper-workspace.tsx'
import type { ExportFormat } from '../shared/presentation.ts'
import { SelectionDetails, type SelectionContext } from './selection-card.tsx'
import { useCowrite } from './cowrite.tsx'
import { REWRITE_ACTIONS, SelectionMenu, renderedSelectionRect, sourceSelectionRect, sourceRangeRect, type RewriteAction } from './selection-menu.tsx'
import { OverlayHost, useOverlaySpace } from './middle-overlay.tsx'
import { RewriteCandidateView, protectedChanges, type RewriteCandidate } from './rewrite-candidate.tsx'
import { SourceCandidate } from './source-candidate.tsx'
import { trackRange, type TextRange } from './rewrite-range.ts'

type Props = { project: any; context: () => any; api: (method: string, request: any, signal?: AbortSignal) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
const buffers = new Map<string, { text: string; baseHash: string }>()
function readLocalBuffer(key: string) {
  try {
    return readScratch(window.localStorage, key, 8 * 1024 * 1024)
  } catch { /* Host temporary buffer remains available when browser storage fails. */ }
}
export function Draft({ project, context, api, refresh, run, busy, issueLocation, view = 'split', format = 'markdown', tool, visible = true, onController, onTool, onReview, onReturnEditor, onAttachSelection, captureChatInsertion }: Props & {
  issueLocation?: any; view?: PaperView; format?: ExportFormat; tool?: 'Changes' | 'History'; visible?: boolean;
  onController?: (value: DraftController) => void; onTool?: () => void; onReview?: () => void; onReturnEditor?: () => void
  onAttachSelection?: (card: SelectionContext, ask: boolean, insertion: any) => void; captureChatInsertion?: () => any
}) {
  const projectId = project.binding.projectId
  const bufferKey = scratchKey(project.binding, 'paper')
  const cached = buffers.get(bufferKey) ?? readLocalBuffer(bufferKey)
  if (cached && !buffers.has(bufferKey)) buffers.set(bufferKey, cached)
  const [text, setText] = useState(cached?.text ?? project.document.text)
  const [baseHash, setBaseHash] = useState(cached?.baseHash ?? project.document.contentHash)
  const [selection, setSelection] = useState<SelectionPayload>()
  const [selectionAnchor, setSelectionAnchor] = useState<DOMRect>(), [selectionDetail, setSelectionDetail] = useState<SelectionContext>()
  const selecting = useRef(false), selectionRequest = useRef(0)
  const [message, setMessage] = useState('')
  const [instruction, setInstruction] = useState('改善表达，保留事实、适用范围和引用。')
  const [sectionId, setSectionId] = useState('')
  const [anchorId, setAnchorId] = useState(''), [anchorClaimIds, setAnchorClaimIds] = useState<string[]>([])
  const [plan, setPlan] = useState<any>()
  const [proposal, setProposal] = useState<any>()
  const [activeRun, setActiveRun] = useState('')
  const [progress, setProgress] = useState<any>()
  const [history, setHistory] = useState<any>(), [historySequence, setHistorySequence] = useState(0), [migrationPlan, setMigrationPlan] = useState<any>()
  const [actionPlan, setActionPlan] = useState<any>()
  const [skills, setSkills] = useState<any[]>([]), [skillBindingId, setSkillBindingId] = useState('')
  const [bufferReady, setBufferReady] = useState(false), [bufferMessage, setBufferMessage] = useState('正在读取宿主暂存缓冲…'), [recoverable, setRecoverable] = useState<any>()
  const bufferHash = useRef<string | null>(null), hostDirty = useRef(false), persistenceBlocked = useRef(false)
  const persistence = useRef<ScratchQueue<{ text: string; baseHash: string; state: 'dirty' | 'cleared'; context: any }> | null>(null)
  if (!persistence.current) persistence.current = new ScratchQueue(async edit => {
    const result = await api('editor.bufferWrite', { ...edit, baseBufferHash: bufferHash.current })
    bufferHash.current = result.bufferHash; hostDirty.current = result.buffer.state === 'dirty'
    const latest = buffers.get(bufferKey)
    if (!latest || (latest.text === edit.text && latest.baseHash === edit.baseHash)) setBufferMessage(edit.state === 'dirty' ? '未提交编辑已暂存到宿主；主稿尚未改变。' : '宿主暂存缓冲已清理；主稿版本保持一致。')
  }, error => { persistenceBlocked.current = true; setBufferMessage(`暂存未完成，保留本页面和浏览器备份：${(error as Error).message}`) })
  const root = useRef<HTMLDivElement>(null), gutter = useRef<HTMLDivElement>(null)
  const sourceArea = useRef<HTMLTextAreaElement>(null)
  const middleColumn = useRef<HTMLDivElement>(null)
  useOverlaySpace(middleColumn)
  // The rewrite flow (SPEC v1.2 §12): a chosen function fills the overlay's instruction, the
  // running candidate replaces it, and neither writes to the document until the user accepts.
  const [rewrite, setRewrite] = useState<{ action: RewriteAction; instruction: string }>()
  const [candidate, setCandidate] = useState<RewriteCandidate>()
  const [undoSnapshot, setUndoSnapshot] = useState<{ start: number; before: string; after: string }>()
  const selectionOrigin = useRef<'source' | 'preview'>('source')
  const inputEdit = useRef<TextRange | undefined>(undefined)
  const rewriteRestored = useRef(false)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`${bufferKey}:rewrite`)
      if (raw) {
        const stored = JSON.parse(raw)
        setRewrite(stored.rewrite); setEditRange(stored.editRange); setUndoSnapshot(stored.undoSnapshot)
        const row: RewriteCandidate | undefined = stored.candidate
        if (row) {
          const expected = row.state === 'accepted' ? row.after : row.before
          setCandidate(row.state === 'generating' ? { ...row, state: 'stopped', note: '页面已重开，未自动重复请求；可以重新生成。' }
            : text.slice(row.start, row.start + expected.length) === expected ? row
            : { ...row, state: 'failed', note: '正文已改变，旧候选已保留供比较；请重新生成。' })
          selectionOrigin.current = row.origin ?? 'source'
        }
      }
    } catch { setMessage('局部改写备份未能恢复；正文备份保持可用。') }
    rewriteRestored.current = true
  }, [bufferKey])
  const [overlayTask, setOverlayTask] = useState(false)
  const [overlayCollapsed, setOverlayCollapsed] = useState(false)
  const [answer, setAnswer] = useState('')
  /**
   * The question a task needs answered belongs in the same place as the local instruction, so
   * the reader has one place to look and the two never stack (SPEC v1.2 §11.2). It is polled
   * here rather than passed down because the progress line and this overlay are siblings.
   */
  const [question, setQuestion] = useState<any>()
  useEffect(() => {
    let live = true
    const read = async () => {
      try {
        const result = await api('writingTask.inspect', { context: context() })
        if (live) setQuestion(result.task?.questions?.find((row: any) => row.answered === undefined))
      } catch { /* a project without a task simply has no question */ }
    }
    read()
    const timer = window.setInterval(read, 3000)
    return () => { live = false; clearInterval(timer) }
  }, [context().sessionId, project.binding.projectId])
  useEffect(() => { if (question) setOverlayTask(true) }, [question?.id])
  const answerQuestion = async (value: string) => {
    if (!question) return
    try {
      await api('writingTask.action', { context: context(), taskId: undefined, action: 'answer', questionId: question.id, answer: value })
      setAnswer(''); setQuestion(undefined); setOverlayTask(false); await refresh()
    } catch (error) { setMessage((error as Error).message) }
  }
  /** A short, honest description of what the pending instruction would act on. */
  const targetPreview = () => {
    const range = candidate ? { start: candidate.start, end: candidate.end } : editRange ?? (selection
      ? { start: selection.sourceRange.startUtf16, end: selection.sourceRange.endUtf16 } : undefined)
    if (rewrite && range) {
      const label = REWRITE_ACTIONS.find(entry => entry.action === rewrite.action)?.label ?? '改写'
      const excerpt = text.slice(range.start, range.end).replace(/\s+/g, ' ').slice(0, 60)
      return `${label} · ${excerpt}${excerpt.length >= 60 ? '…' : ''}`
    }
    if (range) return `已选中 ${range.end - range.start} 个字符；从菜单选择功能后在这里提交。`
    return '选中正文后从菜单选择功能，或在这里写修改要求。'
  }
  const [editRange, setEditRange] = useState<{ start: number; end: number }>(), [rewriteScope, setRewriteScope] = useState('selection'), [rewriteInstruction, setRewriteInstruction] = useState('')
  useEffect(() => {
    if (!rewriteRestored.current) return
    try {
      window.localStorage.setItem(`${bufferKey}:rewrite`, JSON.stringify({ rewrite, candidate, undoSnapshot, editRange }))
    } catch { setMessage('局部改写备份未完成，请保留页面直到正文保存。') }
  }, [bufferKey, rewrite, candidate, undoSnapshot, editRange])
  const liveText = useRef(text); liveText.current = text
  const rewriteController = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => rewriteController.current?.abort('unmounted'), [])
  const textHash = async (value: string) => {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
    return 'sha256:' + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  const cowrite = useCowrite({ text, baseHash, api, context, refresh, merge: async (next: string, expected: string) => {
    if (liveText.current !== expected) throw new Error('编辑内容已改变，请检查新的修改建议。')
    liveText.current = next; setText(next); remember({ text: next, baseHash }); setSelectionAnchor(undefined)
    persistence.current!.enqueue({ text: next, baseHash, state: 'dirty', context: context() }); await persistence.current!.flush()
  } })
  const [saving, setSaving] = useState(false), [cursor, setCursor] = useState(0)
  const livePreview = useMemo(() => {
    try { return { projection: projectMarkdown(text), statistics: wordStats(text), error: '' } }
    catch (error) { return { projection: undefined, statistics: undefined, error: (error as Error).message } }
  }, [text])
  useEffect(() => {
    if (!issueLocation || issueLocation.projectId !== projectId || issueLocation.documentHash !== project.document.contentHash) return
    const block = root.current?.querySelector<HTMLElement>(`[data-sf-block="${CSS.escape(issueLocation.location.blockId)}"]`)
    if (block) { block.scrollIntoView({ block: 'center' }); block.focus(); setMessage(`已定位当前正文问题 ${issueLocation.issueId}；未保存缓冲保持原样。`) }
  }, [issueLocation?.request])
  useEffect(() => {
    let live = true
    api('runs.list', { context: context() }).then(result => live && setHistory(result)).catch(error => live && setMessage(error.message))
    return () => { live = false }
  }, [project.ledger.revision, historySequence])
  const dirty = text !== project.document.text || baseHash !== project.document.contentHash
  useEffect(() => { setSelectionAnchor(undefined); setSelectionDetail(undefined); selectionRequest.current++ }, [view, tool, visible, project.document.contentHash])
  useEffect(() => () => { selectionRequest.current++ }, [])
  const projection = useMemo(() => projectMarkdown(project.document.text), [project.document.contentHash])
  useEffect(() => {
    let live = true
    api('skills.project', { context: context() }).then(result => {
      if (!live) return
      const available = result.resources.filter((row: any) => row.available && row.binding.enabledStages.includes('revision')
        && row.metadata.compatibility === 'compatible' && row.metadata.capabilities.includes('selection-transform'))
      setSkills(available); setSkillBindingId(previous => available.some((row: any) => row.binding.bindingId === previous) ? previous : '')
    }).catch(() => live && setSkills([]))
    return () => { live = false }
  }, [project.ledger.revision])
  useEffect(() => {
    if (!buffers.has(bufferKey)) { setText(project.document.text); setBaseHash(project.document.contentHash) }
    setSelection(undefined); setPlan(undefined)
  }, [project.document.contentHash])
  useEffect(() => {
    let live = true
    api('editor.bufferRead', { context: context() }).then(result => {
      if (!live) return
      bufferHash.current = result.bufferHash; hostDirty.current = result.buffer?.state === 'dirty'
      const local = buffers.get(bufferKey)
      if (hostDirty.current && result.buffer.text !== project.document.text && (!local || local.text !== result.buffer.text || local.baseHash !== result.buffer.baseHash)) setRecoverable(result.buffer)
      setBufferReady(true); setBufferMessage(cached ? '已保留本页面的未提交编辑；等待同步到宿主暂存区。' : hostDirty.current ? '宿主有未提交编辑，可先比较再恢复。' : '未提交编辑将暂存到宿主，主稿只在明确保存后改变。')
    }).catch(error => live && setBufferMessage(`暂存读取失败，当前编辑仍保留在本页面：${error.message}`))
    return () => { live = false }
  }, [bufferKey])
  useEffect(() => {
    if (!bufferReady || persistenceBlocked.current || recoverable || (!dirty && !hostDirty.current)) return
    // A host revision renders once with the previous local text before the adoption
    // effect settles. Only explicit local edits may create a dirty host buffer.
    if (dirty && !buffers.has(bufferKey)) return
    persistence.current!.enqueue({ text, baseHash, state: dirty ? 'dirty' : 'cleared', context: context() })
  }, [text, baseHash, project.document.contentHash, bufferReady, recoverable])
  const remember = (value?: { text: string; baseHash: string }) => {
    if (value) buffers.set(bufferKey, value); else buffers.delete(bufferKey)
    try { writeScratch(window.localStorage, bufferKey, value, 8 * 1024 * 1024) }
    catch { setBufferMessage('浏览器备份未完成；请等宿主暂存完成后再关闭页面。') }
  }
  useEffect(() => {
    // Only explicit edits create a buffer. A server revision renders before the
    // adoption effect settles; caching that intermediate old state would turn
    // an accepted proposal into a spurious stale manual buffer.
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [text, baseHash, project.document.contentHash])
  useEffect(() => {
    if (!activeRun) return
    let live = true
    const timer = window.setInterval(() => api('runs.inspect', { context: context(), runId: activeRun }).then(result => live && setProgress({ ...result.run, checkpoint: result.checkpoint })).catch(() => {}), 1000)
    return () => { live = false; clearInterval(timer) }
  }, [activeRun])
  const capture = () => {
    // An unsaved selection can start a candidate (SPEC v1.2 §12.1): the proposal is bound to
    // the buffer hash, so accepting it writes the buffer and the saved manuscript stays the
    // reference the range is validated against.
    try {
      if (!window.getSelection()?.toString()) { setSelectionAnchor(undefined); return }
      const payload = captureSelection(root.current!, livePreview.projection!, project.document, projectId, true)
      payload.claimIds = [...new Set((Object.values(project.ledger.claimAnchors) as any[]).filter(anchor => anchor.status === 'current' && anchor.documentId === 'paper' &&
        anchor.documentHash === project.document.contentHash && payload.blockIds.includes(anchor.blockId)).flatMap(anchor => anchor.claimIds))] as string[]
      setAnchorClaimIds(payload.claimIds); setAnchorId('')
      selectionOrigin.current = 'preview'
      setSelection(dirty || payload.blockIds.length > 1 ? undefined : payload); setEditRange({ start: payload.sourceRange.startUtf16, end: payload.sourceRange.endUtf16 })
      const range = window.getSelection()!.getRangeAt(0)
      setSelectionAnchor(renderedSelectionRect(range))
    } catch (error) { setSelection(undefined); setSelectionAnchor(undefined); setMessage((error as Error).message) }
  }
  /** Range and text of the current target, from the rendered selection or the source textarea. */
  const targetRange = () => {
    if (editRange) return { start: editRange.start, end: editRange.end, text }
    if (selection) return { start: selection.sourceRange.startUtf16, end: selection.sourceRange.endUtf16, text: text }
    return undefined
  }
  const openRewrite = (action: RewriteAction) => {
    const preset = REWRITE_ACTIONS.find(entry => entry.action === action)
    setSelectionAnchor(undefined)
    setOverlayTask(false)
    setRewrite({ action, instruction: preset?.instruction ?? '' })
    if (!preset?.instruction) requestAnimationFrame(() => document.getElementById('sf-rewrite-input')?.focus())
  }
  /**
   * The request is sent when the user submits, not when an animation ends (PRD §10.1); the
   * stop control cancels the same call rather than hiding it.
   */
  const submitRewrite = (range?: TextRange) => {
    if (rewriteController.current && !rewriteController.current.signal.aborted) return
    const target = range ?? targetRange()
    if (!target || !rewrite) { setMessage('请先选中一段正文，再选择改写功能。'); return }
    const before = text.slice(target.start, target.end)
    if (!before.trim()) { setMessage('选中的范围没有文字。'); return }
    const controller = new AbortController()
    const startedAt = Date.now()
    const requestId = `local_${crypto.randomUUID()}`
    setOverlayTask(false)
    setUndoSnapshot(undefined)
    setCandidate({ id: requestId, origin: selectionOrigin.current, action: rewrite.action, instruction: rewrite.instruction,
      start: target.start, end: target.end, before, after: '', state: 'generating', elapsedMs: 0, phase: '正在生成候选…' })
    const timer = window.setInterval(() => setCandidate(current => current && current.id === requestId && current.state === 'generating'
      ? { ...current, elapsedMs: Date.now() - startedAt } : current), 200)
    rewriteController.current = controller
    void (async () => {
      try {
        const result = await api('cowrite.propose', { context: context(), text, baseDocumentHash: baseHash,
          baseBufferHash: await textHash(text), action: rewrite.action, instruction: rewrite.instruction,
          start: target.start, end: target.end }, controller.signal)
        if (controller.signal.aborted) return
        const row = result.suggestion
        setCandidate(current => current && current.id === requestId && current.state === 'generating'
          ? { ...current, id: row.id, after: row.after, state: 'ready', elapsedMs: Date.now() - startedAt,
              protectedFactChanges: row.protectedFactChanges, citationChanges: row.citationChanges }
          : current)
      } catch (error) {
        if (controller.signal.aborted) return
        setCandidate(current => current && current.id === requestId && current.state === 'generating'
          ? { ...current, state: 'failed', note: (error as Error).message, elapsedMs: Date.now() - startedAt } : current)
      } finally {
        window.clearInterval(timer)
        if (rewriteController.current === controller) rewriteController.current = undefined
        if (!controller.signal.aborted) await cowrite.reload()
      }
    })()
  }
  const stopRewrite = () => {
    rewriteController.current?.abort('stopped')
    setCandidate(current => current ? { ...current, state: 'stopped', note: '已停止；原文未改变，未接受的建议不会写入正文。' } : current)
  }
  /** Accepting writes the edit buffer only, and remembers exactly what to restore. */
  const acceptRewrite = async () => {
    if (!candidate || candidate.state !== 'ready') return
    if (candidate.before !== text.slice(candidate.start, candidate.end)) {
      setCandidate({ ...candidate, state: 'failed', note: '目标范围在你编辑之后已经改变，请重新生成这个候选。' })
      return
    }
    const before = text.slice(0, candidate.start) + candidate.after + text.slice(candidate.end)
    await cowrite.merge(before, text)
    setUndoSnapshot({ start: candidate.start, before: candidate.before, after: candidate.after })
    await api('cowrite.decide', { context: context(), suggestionId: candidate.id, state: 'accepted' }).catch(() => undefined)
    setCandidate({ ...candidate, end: candidate.start + candidate.after.length, state: 'accepted', note: '已接受进入编辑缓冲，主稿尚未保存；可在下方撤销。' })
    await cowrite.reload()
  }
  const discardRewrite = async () => {
    if (candidate && !candidate.id.startsWith('local_')) {
      await api('cowrite.decide', { context: context(), suggestionId: candidate.id, state: 'rejected' }).catch(() => undefined)
    }
    rewriteController.current?.abort('discarded')
    setCandidate(undefined); await cowrite.reload()
  }
  const undoRewrite = async () => {
    if (!undoSnapshot) return
    const { start, before, after } = undoSnapshot
    if (text.slice(start, start + after.length) !== after) {
      setMessage('接受的段落已被修改，无法直接撤销；你的编辑已保留。')
      return
    }
    await cowrite.merge(text.slice(0, start) + before + text.slice(start + after.length), text)
    setUndoSnapshot(undefined)
    setCandidate(current => current ? { ...current, start, end: start + before.length, state: 'ready', note: '已撤销这次改写；其他人工编辑已保留。' } : current)
  }
  const prepare = (whole: boolean) => run(async () => {
    if (!whole && !selection) throw new Error('请先选择已保存的渲染正文。')
    setPlan(await api('writing.prepare', { context: context(), instruction, ...(!whole && { selection, ...(skillBindingId && { skillBindingId }) }) }))
  })
  const save = async () => {
    setSaving(true)
    try {
      await persistence.current!.flush()
      const result = await api('document.saveManual', { context: context(), text, baseHash })
      remember(); setBaseHash(result.documentHash); setMessage('正文已保存。'); await refresh()
    } finally { setSaving(false) }
  }
  useEffect(() => {
    onController?.({ dirty, canSave: dirty && !busy && !saving && baseHash === project.document.contentHash && !project.document.externalChange, save })
  }, [text, baseHash, project.document.contentHash, project.ledger.revision, busy, saving])
  const selectionAction = (action: 'add' | 'ask' | 'details') => run(async () => {
    if (!selection) return
    const request = ++selectionRequest.current
    const insertion = action !== 'details' ? captureChatInsertion?.() : undefined
    const captured = context(), result = await api('editor.selectionContext', { context: captured, selection })
    if (request !== selectionRequest.current) return
    const card = { context: captured, selection: structuredClone(selection), snapshot: result.snapshot, binding: result.binding }
    if (action === 'details') setSelectionDetail(card)
    else { onAttachSelection?.(card, action === 'ask', insertion); setMessage('已添加选文引用，由你发送。') }
    setSelectionAnchor(undefined)
  })
  const attachSelection = () => selectionAction('add')
  const selectSource = (area: HTMLTextAreaElement) => {
    const offset = (index: number) => {
      const prefix = area.value.slice(0, index)
      return project.document.lineEnding === 'crlf' ? prefix.replace(/\n/g, '\r\n').length : prefix.length
    }
    const from = offset(area.selectionStart), to = offset(area.selectionEnd)
    selectionOrigin.current = 'source'
    setCursor(from); setEditRange(from === to ? undefined : { start: from, end: to })
    if (from === to) { setSelection(undefined); setSelectionAnchor(undefined); return }
    try {
      const prose = validateProseRange(dirty ? livePreview.projection! : projection, from, to)
      if (dirty || prose.blockIds.length > 1) {
        setSelection(undefined)
        if (!selecting.current) setSelectionAnchor(sourceSelectionRect(area))
        return
      }
      const selected = validateRange(projection, from, to)
      const claimIds = [...new Set((Object.values(project.ledger.claimAnchors) as any[]).filter(anchor => anchor.status === 'current' &&
        anchor.documentHash === project.document.contentHash && anchor.blockId === selected.block.id).flatMap(anchor => anchor.claimIds))] as string[]
      setSelection({ projectId, documentId: 'paper', documentHash: project.document.contentHash, revisionId: project.document.revisionId,
        blockIds: [selected.block.id], sourceRange: { startUtf16: from, endUtf16: to }, sourceText: text.slice(from, to), renderedText: selected.renderedText,
        prefixContext: text.slice(Math.max(0, from - 200), from), suffixContext: text.slice(to, to + 200), citationKeys: selected.citationKeys,
        claimIds, scope: 'inline', capturedAt: new Date().toISOString() })
      setAnchorClaimIds(claimIds); setAnchorId('')
      if (!selecting.current) setSelectionAnchor(sourceSelectionRect(area))
    } catch (error) { setSelection(undefined); setSelectionAnchor(undefined); setMessage((error as Error).message) }
  }
  const headings = livePreview.projection?.tree.children?.filter(node => node.type === 'heading') ?? []
  const currentHeading = [...headings].reverse().find(node => (node.position?.start.offset ?? 0) <= cursor)
  const statistics = livePreview.statistics
  const candidateView = candidate && <RewriteCandidateView candidate={candidate} busy={busy}
    canAccept={candidate.before === text.slice(candidate.start, candidate.end)}
    onAccept={() => run(acceptRewrite)} onDiscard={() => run(discardRewrite)} onUndo={undoSnapshot ? () => run(undoRewrite) : undefined}
    onStop={stopRewrite} onRegenerate={() => submitRewrite({ start: candidate.start, end: candidate.end })} />
  const sourceCandidate = candidate && (view === 'edit' || view === 'split' && candidate.origin !== 'preview')
  const previewCandidate = candidate && (view === 'preview' || view === 'split' && candidate.origin === 'preview')
  const candidateBlock = livePreview.projection?.blocks.filter(block => block.node.type === 'paragraph' && block.start < (candidate?.end ?? 0)).at(-1)
  const revealCandidate = () => {
    if (sourceCandidate && sourceArea.current) {
      const area = sourceArea.current, index = text.slice(0, candidate!.end).replace(/\r\n/g, '\n').length
      const target = sourceRangeRect(area, index, index)
      area.scrollTop += target.top - area.getBoundingClientRect().top - 40
    } else if (candidateBlock) root.current?.querySelector(`[data-sf-block="${CSS.escape(candidateBlock.id)}"]`)?.scrollIntoView({ block: 'center' })
  }
  return <section className="sf-draft" aria-label="正文编辑">
    {/* The menu appears next to the selection and calls no model; the chosen function becomes
        an instruction in the bottom overlay (PRD §5.2). */}
    {(selection || editRange) && selectionAnchor && !tool && visible && <SelectionMenu anchor={selectionAnchor} busy={busy}
      onAction={openRewrite} onClose={() => setSelectionAnchor(undefined)} />}
    {selectionDetail && <SelectionDetails card={selectionDetail} onClose={() => setSelectionDetail(undefined)} onTool={onTool} />}
    <div className="sf-middle-column" ref={middleColumn} hidden={!!tool}>
    <div className="sf-editor-surface sf-editor-scroll" hidden={!!tool}>
      {cowrite.briefsView}{cowrite.generatedView}
      {/* Chapter navigation is its own entry; the fixed 选区／要求／AI 修改 bar is gone. */}
    <div className="sf-cowrite-bar">
      <details className="sf-chapter-nav"><summary>目录</summary><div>{headings.map(node => <button key={node.position!.start.offset} onClick={e => {
        const offset = node.position!.start.offset!; setCursor(offset); e.currentTarget.closest('details')?.removeAttribute('open')
        if (view === 'preview') root.current?.querySelector<HTMLElement>(`[data-sf-heading-offset="${offset}"]`)?.scrollIntoView({ block: 'start' })
        else { const area = sourceArea.current!; area.focus(); area.setSelectionRange(offset, offset); area.scrollTop = text.slice(0, offset).split(String.fromCharCode(10)).length * 24 - 40 }
      }}>{textOf(node)}</button>)}</div></details>
      <span className="sf-cowrite-hint">选中正文后出现改写菜单；局部入口只作用于选中范围，整篇讨论在右栏。</span>
    </div>
    {cowrite.message && <p className="sf-editor-notice" role="status">{cowrite.message}</p>}
      {(recoverable || baseHash !== project.document.contentHash || project.document.externalChange) && <div className="sf-editor-notice" role="status">
        {recoverable ? '有暂存编辑可恢复' : '正文版本发生变化，当前编辑已保留'}<button onClick={onTool}>查看与处理</button>
      </div>}
      <div className="sf-editor-grid" data-view={view}>
        <div className="sf-source-pane" hidden={view === 'preview'}><div className="sf-pane-caption"><span>{project.config.paths.mainDocument.split('/').at(-1)} · Markdown</span>
          <button disabled={busy || saving || !dirty || baseHash !== project.document.contentHash} onClick={() => run(save)}>{saving ? '保存中…' : '保存'}</button></div>
          <div className="sf-source-editor" data-candidate={!!sourceCandidate}><div className="sf-line-gutter" aria-hidden="true"><div ref={gutter}>{Array.from({ length: text.split(/\r\n|\r|\n/).length }, (_, index) => <div key={index}>{index + 1}</div>)}</div></div>
            <textarea ref={sourceArea} className="sf-source-input" aria-label="Markdown 手工编辑" wrap="off" spellCheck={false} disabled={busy || saving} value={text}
              onScroll={e => { setSelectionAnchor(undefined); if (gutter.current) gutter.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)` }}
              onMouseDown={() => { selecting.current = true; setSelectionAnchor(undefined) }}
              onMouseUp={e => { selecting.current = false; selectSource(e.currentTarget) }}
              onSelect={e => selectSource(e.currentTarget)}
              onBeforeInput={e => {
                const kind = (e.nativeEvent as InputEvent).inputType ?? ''
                const area = e.currentTarget
                const offset = (value: number) => project.document.lineEnding === 'crlf' ? area.value.slice(0, value).replace(/\n/g, '\r\n').length : value
                inputEdit.current = kind.startsWith('insert') || kind === 'deleteByCut' ? { start: offset(area.selectionStart), end: offset(area.selectionEnd) } : undefined
              }}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty && !busy && !saving && baseHash === project.document.contentHash) run(save) } }}
              onChange={e => {
                const edited = project.document.lineEnding === 'crlf' ? e.target.value.replace(/\r\n|\r|\n/g, '\r\n') : e.target.value
                if (candidate && candidate.state !== 'accepted') {
                  const range = trackRange(candidate, text, edited, inputEdit.current)
                  if (range) setCandidate({ ...candidate, ...range })
                  else { rewriteController.current?.abort('target-edited'); setCandidate({ ...candidate, state: 'failed', note: '选中内容已被修改，请基于新内容重新生成。' }) }
                }
                if (undoSnapshot) {
                  const range = trackRange({ start: undoSnapshot.start, end: undoSnapshot.start + undoSnapshot.after.length }, text, edited, inputEdit.current)
                  setUndoSnapshot(range ? { ...undoSnapshot, start: range.start } : undefined)
                }
                inputEdit.current = undefined; liveText.current = edited
                setText(edited); setEditRange(undefined); setSelection(undefined); setSelectionAnchor(undefined); selectionRequest.current++; setMessage('')
                if (edited === project.document.text && baseHash === project.document.contentHash) remember()
                else remember({ text: edited, baseHash })
              }} />
            {sourceCandidate && <SourceCandidate area={sourceArea} end={text.slice(0, candidate.end).replace(/\r\n/g, '\n').length} identity={candidate.id}>{candidateView}</SourceCandidate>}
          </div>
        </div>
        <div className="sf-preview-pane" hidden={view === 'edit'}><div className="sf-pane-caption"><span>论文预览</span><span>{format === 'latex' ? 'LaTeX 排版' : format === 'docx' ? 'Word 排版' : 'Markdown'} · 实时</span></div>
          <div className="sf-paper-scroll"><div className="sf-paper-page" data-format={format} ref={root} onMouseUp={capture} onKeyUp={capture}>
            {livePreview.projection ? <MarkdownView projection={livePreview.projection}
              afterBlock={(start) => previewCandidate && candidateBlock?.start === start ? candidateView : null}
              annotations={(start, end) => <>{cowrite.annotations(start, end, candidate?.id)}{!dirty && (Object.values(project.ledger.reviewIssues) as any[]).filter(issue => !issue.stale && issue.state !== 'resolved' && issue.documentHash === project.document.contentHash && issue.location?.sourceRange.startUtf16 >= start && issue.location.sourceRange.startUtf16 < end).map(issue => <button className="sf-review-marker" key={issue.id} title={issue.explanation} onClick={onReview}>{issue.severity} · {issue.title}</button>)}</>} /> : <p role="alert">{livePreview.error}</p>}
            {!!livePreview.projection?.citationOrder.length && <section className="sf-paper-references"><h3>参考文献</h3><ol>{livePreview.projection.citationOrder.map(key => {
              const source = (Object.values(project.ledger.sources) as any[]).find(row => row.citeKey === key)
              return <li key={key}>{source ? [source.authors.map((author: any) => author.literal ?? [author.given, author.family].filter(Boolean).join(' ')).join(', '), source.title, source.year, source.venue].filter(Boolean).join('. ') : `待登记引用：${key}`}</li>
            })}</ol></section>}
          </div></div>
        </div>
      </div>
      <footer className="sf-draft-status"><span role="status" title={message || bufferMessage}>{saving ? '保存中…' : dirty ? '未保存 · 编辑已在本页保留' : project.document.externalChange ? '外部正文已改变' : <><span className="sf-saved-dot">●</span>已保存</>}{message && ` · ${message}`}</span>
        <span>{statistics ? `${statistics?.chineseCharacters ?? 0} 汉字 · ${statistics?.westernWords ?? 0} 词` : '字数暂不可用'}{currentHeading && ` · ${textOf(currentHeading)}`}</span></footer>
    </div>
    {/* The overlay lives inside the middle column, so it never reaches the left workspace or the
        right pane, and the scroller gains matching room while it is open (SPEC v1.2 §11). */}
    <OverlayHost open={Boolean(rewrite) || Boolean(candidate && candidate.state !== 'accepted') || Boolean(question)}
      tabs={[{ id: 'local', label: '局部改写' }, ...(question ? [{ id: 'task', label: '当前目标的问题' }] : [])]}
      active={overlayTask && question ? 'task' : 'local'} onTab={id => setOverlayTask(id === 'task')} collapsed={overlayCollapsed}
      onCollapse={() => setOverlayCollapsed(value => !value)} label={overlayTask && question ? '当前目标的问题' : '局部改写'}>
      {overlayTask && question ? <div className="sf-overlay-question">
        <p className="sf-overlay-note" style={{ margin: '0 0 8px' }}>{question.title}</p>
        <div className="sf-overlay-row" style={{ flexWrap: 'wrap' }}>
          {question.options.map((option: string) => <button key={option} type="button" disabled={busy} onClick={() => void answerQuestion(option)}>{option}</button>)}
        </div>
        <div className="sf-overlay-row">
          <input aria-label="回答问题" placeholder="也可以补充你的要求…" value={answer} onChange={event => setAnswer(event.target.value)} />
          <button type="button" className="sf-primary" disabled={busy || !answer.trim()} onClick={() => void answerQuestion(answer)}>回答并继续</button>
        </div>
        <p className="sf-overlay-note">只对确实影响本次目标的冲突或缺失提问；其他章节的编辑不会逐节打断你。</p>
      </div> : <>
        <p className="sf-overlay-note" style={{ margin: '0 0 8px' }}>{targetPreview()}</p>
        {candidate && <button type="button" onClick={revealCandidate}>查看候选</button>}
        {candidate?.state === 'generating' && <button type="button" onClick={stopRewrite}>停止生成</button>}
        <div className="sf-overlay-row">
          <input id="sf-rewrite-input" aria-label="局部修改要求" placeholder="可选：补充要求（不填也可以提交已选择的功能）"
            value={rewrite?.instruction ?? ''} onChange={event => setRewrite(current => ({ action: current?.action ?? 'custom', instruction: event.target.value }))} />
          <button type="button" className="sf-primary" disabled={busy || !rewrite || candidate?.state === 'generating'} onClick={() => submitRewrite(candidate && candidate.state !== 'accepted' ? { start: candidate.start, end: candidate.end } : undefined)}>
            {candidate?.state === 'generating' ? '正在生成…' : '提交'}</button>
        </div>
        <p className="sf-overlay-note">仅点选功能不会调用模型；提交时请求立即发出，不等动画播完。接受前不会写入正文。</p>
      </>}
    </OverlayHost>
    </div>
    <div className="sf-draft-tools" hidden={!tool}>
    <div hidden={tool !== 'Changes'}><h3>修改建议与正文管理</h3>
    <ManuscriptImport project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} dirty={dirty || !!recoverable} />
    {baseHash !== project.document.contentHash && <p role="alert">服务端稿件版本已改变，当前未保存缓冲已保留。请复制比较后显式采用当前版本。</p>}
    <button disabled={busy || saving || !dirty || baseHash !== project.document.contentHash} onClick={() => run(save)}>保存手工稿</button>
    <button disabled={busy} onClick={() => { if ((dirty || recoverable) && !window.confirm('放弃当前未保存缓冲并采用服务端稿件？')) return; remember(); setRecoverable(undefined); setText(project.document.text); setBaseHash(project.document.contentHash); setMessage('已采用当前服务端稿件。') }}>显式采用服务端版本</button>
    <button disabled={busy || project.document.initialPlaceholder || dirty} onClick={() => run(async () => {
      await api('document.undo', { context: context(), revisionId: project.document.revisionId, baseHash: project.document.contentHash }); remember(); await refresh()
    })}>撤销当前版本为新修订</button>
    <p role="status" aria-label="编辑暂存状态">{bufferMessage}</p>
    {recoverable && <section aria-label="宿主未提交缓冲恢复"><h4>发现宿主未提交编辑</h4><p>这份缓冲不会自动写入主稿。恢复后仍需比较当前版本并显式保存；旧基础哈希会阻止覆盖新稿。</p>
      <pre>{recoverable.text.slice(0, 16000)}{recoverable.text.length > 16000 ? '\n[仅展示前16000字符；恢复会保留全文]' : ''}</pre>
      <button disabled={busy} onClick={() => { if (dirty && !window.confirm('用宿主未提交缓冲替换当前未保存编辑？')) return; setText(recoverable.text); setBaseHash(recoverable.baseHash); remember({ text: recoverable.text, baseHash: recoverable.baseHash }); setRecoverable(undefined); setBufferMessage('已恢复宿主缓冲，请核对版本后明确保存。') }}>恢复宿主未提交缓冲</button>
    </section>}
    <button disabled={busy || !persistenceBlocked.current} onClick={() => run(async () => {
      if (persistence.current!.busy) throw new Error('请先等待正在进行的暂存请求结束。')
      const result = await api('editor.bufferRead', { context: context() }); bufferHash.current = result.bufferHash; hostDirty.current = result.buffer?.state === 'dirty'
      persistence.current!.reset()
      persistenceBlocked.current = false; setBufferReady(true); setRecoverable(result.buffer?.state === 'dirty' ? result.buffer : undefined); setBufferMessage('已重读宿主缓冲，请比较保留的本页面编辑与宿主副本。')
    })}>重读冲突暂存缓冲</button>
    <p>{statistics?.chineseCharacters ?? 0} 汉字 · {statistics?.westernWords ?? 0} 西文词元。{statistics?.detail}</p>
    <nav aria-label="正文标题导航">{projection.tree.children?.filter(node => node.type === 'heading').map(node => <button key={node.position!.start.offset} onClick={() => {
      const heading = root.current?.querySelector<HTMLElement>(`[data-sf-heading-offset="${node.position!.start.offset}"]`)
      onReturnEditor?.(); window.requestAnimationFrame(() => { heading?.scrollIntoView({ block: 'nearest' }); heading?.focus() })
    }}>{textOf(node) || '无文字标题'}</button>)}</nav>
    <section aria-label="章节正文状态"><h4>大纲与已保存正文</h4><p>以下状态仅说明正文是否已保存；有正文不等于已完成研究或通过审查。</p>
      {project.ledger.outline.sections.map((section: any) => {
        let status = '尚无对应标题／正文'
        try {
          const target = sectionTarget(project.document.text, project.ledger.outline, section.id)
          if (target.mode === 'replace-body') {
            const body = project.document.text.slice(target.startUtf16, target.endUtf16)
            status = body.trim() ? /\[待补[：:]/.test(body) ? '正文已保存 · 含待补项' : '正文已保存 · 待审查' : '已有标题 · 正文尚空'
          }
        } catch (error) { status = (error as Error).message }
        return <p key={section.id}>{section.title}：{status}</p>
      })}</section>
    {selection && <section aria-label="已捕获选区"><h4>实际改写范围 [{selection.sourceRange.startUtf16}, {selection.sourceRange.endUtf16})</h4><pre>{selection.sourceText}</pre><p>引用：{selection.citationKeys.join('、') || '无'} · 段落 {selection.blockIds.join('、')} · 论点：{selection.claimIds.join('、') || '尚无当前关联'}</p></section>}
    {selection && <section aria-label="确认段落论点关联"><h4>关联整段与论点</h4><p>关联针对选区所在的完整段落；它不会修改正文或自动提升论点支持状态。</p>
      <pre>{(() => { const block = projection.blocks.find(row => row.id === selection.blockIds[0]); return block && project.document.text.slice(block.start, block.end) })()}</pre>
      <label>要重新定位的关联<select aria-label="要重新定位的关联" value={anchorId} onChange={e => {
        setAnchorId(e.target.value); setAnchorClaimIds(project.ledger.claimAnchors[e.target.value]?.claimIds ?? selection.claimIds)
      }}><option value="">创建／更新当前段落关联</option>
        {(Object.values(project.ledger.claimAnchors) as any[]).map(anchor => <option key={anchor.id} value={anchor.id}>{anchor.id} · {anchor.status}</option>)}</select></label>
      <fieldset><legend>段落关联论点</legend>{(Object.values(project.ledger.claims) as any[]).map(claim => <label key={claim.id}><input type="checkbox" checked={anchorClaimIds.includes(claim.id)} onChange={e => setAnchorClaimIds(e.target.checked ? [...anchorClaimIds, claim.id] : anchorClaimIds.filter(id => id !== claim.id))} />{claim.text}</label>)}</fieldset>
      <p>没有勾选论点时，确认会解除所选已有关联。</p>
      <button disabled={busy || dirty} onClick={() => run(async () => {
        const block = projection.blocks.find(row => row.id === selection.blockIds[0])!
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(project.document.text.slice(block.start, block.end)))
        const blockTextHash = `sha256:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`
        const currentAnchor = (Object.values(project.ledger.claimAnchors) as any[]).find(anchor => anchor.status === 'current' && anchor.documentHash === project.document.contentHash && anchor.blockId === block.id)
        await api('anchors.upsert', { context: context(), documentHash: project.document.contentHash, blockId: block.id, blockTextHash,
          ...((anchorId || currentAnchor?.id) && { anchorId: anchorId || currentAnchor.id }), claimIds: anchorClaimIds })
        setSelection(undefined); setAnchorId(''); setAnchorClaimIds([]); await refresh(); setMessage('段落论点关联已明确保存，证据与论证审查需复查。')
      })}>确认保存段落论点关联</button></section>}
    {!!Object.keys(project.ledger.claimAnchors).length && <section aria-label="正文论点定位"><h4>正文段落与论点</h4>
      {(Object.values(project.ledger.claimAnchors) as any[]).map(anchor => <p key={anchor.id}>{anchor.blockId} · {anchor.status === 'current' && anchor.documentHash === project.document.contentHash ? '当前关联' : '待重新定位'} → {anchor.claimIds.join('、')}
        <button disabled={anchor.status !== 'current' || anchor.documentHash !== project.document.contentHash} onClick={() => {
          root.current?.querySelector<HTMLElement>(`[data-sf-block="${anchor.blockId}"]`)?.scrollIntoView({ block: 'center' })
        }}>定位段落 {anchor.id}</button></p>)}</section>}
    <label>改写／生成指令<textarea aria-label="改写生成指令" value={instruction} onChange={e => setInstruction(e.target.value)} /></label>
    {!!skills.length && <label>已启用的选区 Skill<select aria-label="已启用的选区 Skill" value={skillBindingId} onChange={e => setSkillBindingId(e.target.value)}><option value="">使用修订阶段的默认启用顺序</option>
      {skills.map(row => <option key={row.binding.bindingId} value={row.binding.bindingId}>{row.metadata.displayName} · {row.binding.digest.slice(7, 19)}</option>)}</select></label>}
    <button disabled={busy || dirty || !selection} onClick={attachSelection}>附加选区到当前会话</button>
    <button disabled={busy || dirty || !selection || !instruction.trim()} onClick={() => prepare(false)}>预览选区改写计划</button>
    <label>按大纲生成章节<select aria-label="按大纲生成章节" value={sectionId} onChange={e => setSectionId(e.target.value)}><option value="">选择已确认的大纲章节</option>
      {project.ledger.outline.sections.map((section: any) => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>
    <button disabled={busy || dirty || !sectionId || project.ledger.outline.confirmation !== 'confirmed' || !instruction.trim()} onClick={() => run(async () => {
      setPlan(await api('writing.prepare', { context: context(), instruction, sectionId }))
    })}>预览本节生成计划</button>
    <DraftSequence project={project} context={context} api={api} run={run} busy={busy} dirty={dirty} onGenerationPlan={setPlan} onProposal={setProposal} />
    {plan && <section role="dialog" aria-modal="false" aria-label="模型生成确认"><h4>{plan.structuralGap ? '确认待补结构建议（不调用模型）' : '确认宿主模型调用'}</h4>
      <p>{plan.model.providerId} / {plan.model.modelId} · 输入约 {plan.inputBytes} bytes · 源码范围 [{plan.scope.startUtf16}, {plan.scope.endUtf16})</p>
      <p>调用次数与耗时仅用于统计；仅生成待审阅建议。</p>
      <p>本次固定输出上限 {plan.model.maxOutputTokens ?? 4096} token（包含提供方计入的推理输出）；额度耗尽时保留调用，不自动重试截断结果。</p>
      {plan.workflowId && <p>计入引导任务 {plan.workflowId} 的调用与耗时统计。{plan.workflowBudget?.used && `已用模型调用 ${plan.workflowBudget.used.modelCalls}；调用次数仅用于统计，不设累计上限。`}</p>}
      {plan.sectionTarget && <p>目标章节：{plan.sectionTarget.title} · {plan.sectionTarget.mode === 'insert' ? '插入新章节' : '替换本节正文并保留标题及子章节'}</p>}
      <p>本次固定 Skill：{plan.skillDigests?.map((row: any) => `${row.qualifiedId} · ${row.digest}`).join('；') || '无'}</p>
      {plan.sourceText && <pre>{plan.sourceText}</pre>}{plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => {
        const confirmedPlan = plan
        setPlan(undefined); setActiveRun(confirmedPlan.runId); setProgress(undefined)
        try { const result = await api('runs.start', { context: context(), planId: confirmedPlan.planId, planHash: confirmedPlan.planHash }); if (result.proposal) setProposal(result); if (result.paused) setMessage('运行已暂停，检查点已保存；可从历史预览恢复。'); await refresh() }
        finally { setActiveRun(''); setHistorySequence(value => value + 1) }
      })}>确认生成建议</button>
      <button disabled={busy} onClick={() => run(async () => { await api('writing.dismiss', { planId: plan.planId }); setPlan(undefined) })}>取消生成计划</button></section>}
    {activeRun && <section aria-label="当前生成运行"><p role="status">运行 {activeRun} · {progress?.status ?? '准备开始'} · 已调用模型 {progress?.usedModelCalls ?? 0} 次</p>
      {!!progress?.checkpoint?.transientRetries && <p>临时错误重试 {progress.checkpoint.transientRetries} / 2{progress.checkpoint.retryNotBefore ? `；等待到 ${new Date(progress.checkpoint.retryNotBefore).toLocaleTimeString()}` : ''}</p>}
      <button onClick={() => api('runs.pause', { context: context(), runId: activeRun }).then(() => setMessage('已请求暂停：当前调用结束后保存检查点，不再调度新工作。')).catch(e => setMessage(e.message))}>暂停当前生成</button>
      <button onClick={() => api('runs.cancel', { context: context(), runId: activeRun }).then(() => setMessage('已请求取消，等待阶段保存检查点。')).catch(e => setMessage(e.message))}>取消当前生成</button></section>}
    </div><div hidden={tool !== 'History'}><section aria-label="写作运行历史"><h4>写作运行历史</h4><button disabled={busy} onClick={() => setHistorySequence(value => value + 1)}>刷新写作运行历史</button>
      {history?.diagnostics.map((warning: string, index: number) => <p role="alert" key={index}>{warning}</p>)}
      {history?.runs.map((row: any) => <p key={row.runId}>{row.runId} · {row.status} · 已调用模型 {row.usedModelCalls} 次{row.errorCode ? ` · ${row.errorCode}` : ''}
        {row.parentRunId && <span> · 重试来源 {row.parentRunId}</span>}
        {row.inheritedArchive && <span> · 副本来源历史，只读；旧身份 {row.projectId}，不接管或重放请求。</span>}
        {!row.inheritedArchive && ['paused', 'interrupted', 'running', 'queued', 'waiting-input'].includes(row.status) && <>
          {!row.legacyStorage && !['review', 'research'].includes(row.stage) && <button disabled={busy || dirty} onClick={() => run(async () => setActionPlan(await api('runs.prepareAction', { context: context(), runId: row.runId, action: 'resume' })))}>预览恢复运行 {row.runId}</button>}
          <button disabled={busy} onClick={() => run(async () => setActionPlan(await api('runs.prepareAction', { context: context(), runId: row.runId, action: 'close' })))}>预览结束未完成运行 {row.runId}</button></>}
        {!row.inheritedArchive && !row.legacyStorage && row.planHash && !['review', 'research'].includes(row.stage) && ['failed', 'cancelled'].includes(row.status) && <button disabled={busy || dirty} onClick={() => run(async () => setActionPlan(await api('runs.prepareAction', { context: context(), runId: row.runId, action: 'retry' })))}>预览关联重试 {row.runId}</button>}
        {row.stage === 'review' && <span> · 在审查页面查看与恢复模型审查。</span>}
        {row.stage === 'research' && <span> · 在资料与研究页面查看、恢复或重试检索。</span>}
        {!row.inheritedArchive && row.legacyStorage && <button disabled={busy} onClick={() => run(async () => setMigrationPlan(await api('runs.prepareMigration', { context: context(), runId: row.runId })))}>预览迁移旧运行记录 {row.runId}</button>}</p>)}
      {history && !history.runs.length && <p>本项目暂无写作运行记录。</p>}</section>
    {actionPlan && <section role="dialog" aria-label="运行操作确认"><h4>确认{actionPlan.action === 'resume' ? '恢复' : actionPlan.action === 'retry' ? '关联重试' : '结束未完成运行'}</h4>
      <p>原运行 {actionPlan.previousRunId} · 已调用模型 {actionPlan.usedModelCalls} 次{actionPlan.action === 'retry' ? `；新运行 ${actionPlan.runId}` : ''}</p>
      {actionPlan.model && <p>{actionPlan.model.providerId} / {actionPlan.model.modelId} · 输入约 {actionPlan.inputBytes} bytes · 可随时停止</p>}
      {actionPlan.existingProposalId && <p>已有建议 {actionPlan.existingProposalId}，保留当前接受／拒绝状态。</p>}
      {actionPlan.retryNotBefore && <p>提供方重试窗口：{new Date(actionPlan.retryNotBefore).toLocaleString()} 之后才会调度新调用。</p>}
      <p>固定 Skill：{actionPlan.skillDigests?.map((row: any) => `${row.qualifiedId} · ${row.digest}`).join('；') || '无模型调用或无 Skill'}</p>
      {actionPlan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy || (dirty && actionPlan.action !== 'close')} onClick={() => run(async () => {
        const confirmed = actionPlan; setActionPlan(undefined)
        if (confirmed.action !== 'close') { setActiveRun(confirmed.runId); setProgress(undefined) }
        try { const result = await api('runs.confirmAction', { context: context(), planId: confirmed.planId, planHash: confirmed.planHash });
          if (result.proposal && (!result.proposalState || result.proposalState === 'pending')) setProposal(result)
          setMessage(result.recoveredArtifact ? '已有建议终态已恢复；没有重复生成或接受修改。' : result.paused ? '运行已暂停，检查点已保存。' : '运行操作完成。'); await refresh()
        } finally { setActiveRun(''); setHistorySequence(value => value + 1) }
      })}>确认运行操作</button>
      <button disabled={busy} onClick={() => run(async () => { await api('runs.dismissAction', { planId: actionPlan.planId }); setActionPlan(undefined) })}>取消运行操作预览</button></section>}
    {migrationPlan && <section role="dialog" aria-label="运行存储迁移确认"><h4>确认迁移旧运行存储</h4><p>{migrationPlan.runId}</p>
      {migrationPlan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => { await api('runs.migrate', { context: context(), planId: migrationPlan.planId, planHash: migrationPlan.planHash }); setMigrationPlan(undefined); setHistorySequence(value => value + 1) })}>确认迁移旧运行存储</button>
      <button disabled={busy} onClick={() => run(async () => { await api('runs.dismissMigration', { planId: migrationPlan.planId }); setMigrationPlan(undefined) })}>取消运行存储迁移</button></section>}
    </div><div hidden={tool !== 'Changes'}>{(Object.values(project.ledger.proposalStates) as any[]).filter(state => state.state === 'pending').map(state => <button key={state.proposalId} disabled={busy} onClick={() => run(async () => setProposal(await api('edits.read', { context: context(), proposalId: state.proposalId })))}>查看待审阅建议 {state.proposalId}</button>)}
    {proposal && <section aria-label="建议差异"><h4>待审阅差异 · {proposal.proposal.id}</h4><p>范围：{proposal.proposal.scope}。接受会使旧审查过期。</p>
      {proposal.proposal.edits.map((edit: any, index: number) => <div key={index}><p>源码 [{edit.startUtf16}, {edit.endUtf16})</p><b>− 原文</b><pre>{edit.expectedText}</pre><b>+ 新文</b><pre>{edit.replacementText}</pre></div>)}
      <p>引用新增：{proposal.proposal.citationChanges.added.join('、') || '无'}；删除：{proposal.proposal.citationChanges.removed.join('、') || '无'}。</p>
      {proposal.proposal.section && <div><p>章节 {proposal.proposal.section.sectionId} · 大纲版本 {proposal.proposal.section.outlineVersion}。段落映射是待核对的关联，不能证明证据支持。</p>
        {proposal.proposal.section.paragraphClaims.map((row: any) => <p key={row.paragraphIndex}>段落 {row.paragraphIndex + 1} → {row.claimIds.join('、') || '无论点关联／待补'}</p>)}
        {proposal.proposal.section.limitations.map((gap: string, i: number) => <p key={i}>缺口：{gap}</p>)}</div>}
      {proposal.proposal.protectedFactChanges.map((change: string) => <p key={change}>{change}</p>)}
      {proposal.proposal.checks.map((check: any) => <p key={check.id}>{check.status} · {check.detail}</p>)}
      <ProposalRevision key={proposal.proposal.id} image={proposal} context={context} api={api} run={run} busy={busy}
        disabled={dirty || project.document.externalChange || proposal.proposal.baseDocumentHash !== project.document.contentHash || project.ledger.proposalStates[proposal.proposal.id]?.state !== 'pending'}
        onRevised={async image => { setProposal(image); await refresh(); setMessage('编辑后的候选已校验并保存，原建议保留，主稿未改变。') }} />
      <button disabled={busy || dirty} onClick={() => run(async () => { await api('edits.apply', { context: context(), proposalId: proposal.proposal.id, proposalHash: proposal.proposalHash }); remember(); setProposal(undefined); await refresh() })}>接受此条建议</button>
      <button disabled={busy} onClick={() => run(async () => { await api('edits.reject', { context: context(), proposalId: proposal.proposal.id }); setProposal(undefined); await refresh() })}>拒绝此条建议</button></section>}
    <p role="status">{message}</p></div>
    </div>
  </section>
}
