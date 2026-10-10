import { useTextPrompt } from './text-prompt.tsx'
import React, { useEffect, useRef, useState } from 'react'
import { useConfirmationFocus } from './confirmation-focus.ts'
import { creationSpec, presetSections, type CreationSpec } from '../shared/writing-task.ts'
import { allocate } from '../core/presets/allocation.ts'
import { sectionsFromPreset, selectionFromPreset } from '../core/presets/apply.ts'
import { FORMAT_LABELS, TYPE_LABELS } from './paper-workspace.tsx'
import { PresetPicker } from './preset-picker.tsx'
import { DEFAULT_TYPOGRAPHY } from '../core/export/typography.ts'

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

const splitPath = (path: string) => {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? { name: path, dir: '工作区根目录' } : { name: path.slice(cut + 1), dir: path.slice(0, cut) }
}

/**
 * The requirements candidate (PRD §3.2). Six groups, each with the source it came from; the
 * teacher-versus-preset conflict is shown rather than resolved, and the raw input is untouched
 * until the user adopts.
 */
function BriefCandidate({ candidate, stale, busy, onAdopt, onDiscard }: any) {
  const brief = candidate.brief
  const row = (label: string, value?: string, path?: string) => value
    ? <div className="sf-brief-row" key={label}><dt>{label}</dt><dd>{value}{path && brief.origins?.[path] &&
      <em className="sf-brief-origin">{ORIGIN_LABEL[brief.origins[path]] ?? brief.origins[path]}</em>}</dd></div> : null
  const length = brief.length?.value !== undefined
    ? `${brief.length.approximate ? '约 ' : ''}${brief.length.value} ${brief.length.unit === 'words' ? '词' : '字'}${brief.length.pages ? ` · 共 ${brief.length.pages} 页` : ''}${brief.length.coverPages !== undefined ? `（封面 ${brief.length.coverPages} 页＋正文 ${brief.length.bodyPages ?? '?'} 页）` : ''}`
    : undefined
  return <section className="sf-brief" aria-label="要求候选">
    <h5>要求候选 · 确认后才成为写作要求</h5>
    <dl>
      {row('写什么', [brief.task?.nature, brief.task?.subject, brief.task?.deliverable].filter(Boolean).join(' · '), 'task.nature')}
      {!!brief.coverage?.length && <div className="sf-brief-row"><dt>必须覆盖</dt><dd>{brief.coverage.map((item: any) => item.text).join('、')}</dd></div>}
      {row('篇幅', length, 'length')}
      {row('格式', [brief.format?.fileFormat, brief.format?.citationStyle, brief.format?.cover ? '需要封面' : undefined].filter(Boolean).join(' · '), 'format.fileFormat')}
      {brief.typography && row('排版', `中文 ${brief.typography.bodyFontZh}／英文 ${brief.typography.bodyFontEn} · ${brief.typography.bodySizeLabel} · ${brief.typography.lineSpacing} 倍行距`, 'typography')}
      {row('提交', [brief.submission?.when, brief.submission?.where, brief.submission?.how].filter(Boolean).join(' · '), 'submission.when')}
    </dl>
    {!!brief.submission?.needsConfirmation?.length && <p className="sf-brief-note">需要你确认：{brief.submission.needsConfirmation.join('、')}。来源没有写明，产品不推断。</p>}
    {candidate.diff?.length > 0 && <details className="sf-brief-diff"><summary>与当前输入的差异（{candidate.diff.length} 项）</summary>
      {candidate.diff.map((row: any) => <p key={row.path}><b>{row.label}</b>：{row.before ? `${row.before} → ` : ''}{row.after}</p>)}</details>}
    {candidate.conflicts?.map((conflict: any) => <div className="sf-brief-conflict" key={conflict.topic}>
      <b>需要决定：{conflict.topic}</b> {conflict.current}；候选 {conflict.candidate}{conflict.source ? `（来源 ${conflict.source}）` : ''}。
      {conflict.preferred === 'candidate' && <span>建议采用候选，因为它是作业要求的原文。</span>}
    </div>)}
    <div className="sf-brief-actions">
      {stale && <p role="status">输入已改变，候选已过期；请基于当前要求重新整理。</p>}
      <button type="button" className="sf-primary" disabled={busy || stale} onClick={() => onAdopt({ all: true })}>全部采用</button>
      {candidate.conflicts?.some((conflict: any) => conflict.topic === '篇幅') && <>
        <button type="button" disabled={busy || stale} onClick={() => onAdopt({ all: true, resolveLength: 'teacher' })}>采用老师要求并同步篇幅</button>
        <button type="button" disabled={busy || stale} onClick={() => onAdopt({ all: true, resolveLength: 'current' })}>保留当前篇幅（记录本次覆盖）</button>
      </>}
      <button type="button" disabled={busy} onClick={onDiscard}>放弃候选</button>
      <span className="sf-field-hint">原输入保留；采用后会追加一段带标签的整理记录，不会覆盖你写的文字。</span>
    </div>
  </section>
}

/** The outline candidate: what changed, which requirement each section carries, and the gaps. */
function OutlineCandidate({ candidate, stale, busy, onAdopt, onDiscard }: any) {
  return <section className="sf-outline-candidate" aria-label="大纲候选">
    <h5>大纲候选 · 与当前结构对照</h5>
    {!!candidate.changes?.length && <p className="sf-field-hint">变化：{summarizeChanges(candidate.changes)}</p>}
    <ul className="sf-coverage-list">{candidate.sections.map((section: any) => <li key={section.id}>
      <b>{section.title}</b>{section.purpose ? ` — ${section.purpose}` : ''}</li>)}</ul>
    {!!candidate.coverage?.length && <details open><summary>要求覆盖（{candidate.coverage.filter((row: any) => row.covered).length}/{candidate.coverage.length}）</summary>
      {candidate.coverage.map((row: any) => <p key={row.itemId} className={row.covered ? undefined : 'sf-gap'}>{row.covered ? '✔' : '✖'} {row.text}{!row.covered && ' · 还没有对应章节'}</p>)}</details>}
    {candidate.gaps?.map((gap: string) => <p className="sf-gap" key={gap}>缺口：{gap}</p>)}
    <div className="sf-brief-actions">
      {stale && <p role="status">要求或结构已改变，请重新生成大纲候选。</p>}
      <button type="button" className="sf-primary" disabled={busy || stale} onClick={onAdopt}>采用此大纲</button>
      <button type="button" disabled={busy} onClick={onDiscard}>放弃候选</button>
      <span className="sf-field-hint">放弃只删除候选，当前结构逐字节不变。</span>
    </div>
  </section>
}

const ORIGIN_LABEL: Record<string, string> = { teacher: '老师要求', user: '你的描述', suggestion: '模型建议', unspecified: '未说明', unread: '未读到' }
function summarizeChanges(changes: any[]) {
  const count = (kind: string) => changes.filter(change => change.kind === kind).length
  return [count('added') && `新增 ${count('added')} 节`, count('renamed') && `改名 ${count('renamed')} 节`,
    count('removed') && `删除 ${count('removed')} 节`, count('reordered') && '调整了顺序'].filter(Boolean).join(' · ')
}
const MEMBER_STATE: Record<string, string> = { pending: '待读取', reading: '读取中', ready: '已读取', failed: '未读到' }

export const REQUIREMENT_KIND_LABEL = { readable: '可读取', image: '图片', unsupported: '不可读取' } as const
/** What the parser can do with a file, decided by extension only — never a promise. */
export function requirementKind(path: string): keyof typeof REQUIREMENT_KIND_LABEL {
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(path)) return 'image'
  if (/\.(pdf|docx|md|markdown|txt|html?)$/i.test(path)) return 'readable'
  return 'unsupported'
}
function directoriesOf(files: any[]) {
  const rows = new Map<string, number>()
  for (const file of files) {
    const cut = file.relativePath.lastIndexOf('/')
    if (cut < 0) continue
    const directory = file.relativePath.slice(0, cut)
    rows.set(directory, (rows.get(directory) ?? 0) + 1)
  }
  return [...rows].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path))
}

/** Picks one requirement file or one folder; the caller decides what a folder expands to. */
function RequirementPicker({ files, disabled, scanning, onPick, onRescan, onPickExternal }: any) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'file' | 'folder'>('file'), [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const rows = mode === 'file'
    ? files.map((file: any) => ({ path: file.relativePath, size: file.size, count: 0 }))
    : directoriesOf(files)
  const matches = needle ? rows.filter((row: any) => row.path.toLowerCase().includes(needle)) : rows
  return <div className="sf-picker">
    <button type="button" className="sf-picker-toggle" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
      <span className="sf-picker-current"><em>添加要求文件或文件夹</em></span>
      <span className="sf-picker-caret" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="sf-picker-panel">
      <div className="sf-picker-search">
        <div className="sf-picker-modes" role="group" aria-label="选择方式">
          {(['file', 'folder'] as const).map(name => <button key={name} type="button" aria-pressed={mode === name}
            onClick={() => { setMode(name); setQuery('') }}>{name === 'file' ? '文件' : '文件夹'}</button>)}
        </div>
        <input autoFocus aria-label="搜索要求来源" placeholder={mode === 'file' ? '搜索文件名或路径' : '搜索文件夹'} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" disabled={scanning} onClick={onRescan}>{scanning ? '正在扫描…' : '重新扫描'}</button>
      </div>
      <div className="sf-picker-list">
        {matches.map((row: any) => { const shown = splitPath(row.path)
          return <button type="button" key={row.path} className="sf-picker-row" onClick={() => { onPick(mode, row.path); setOpen(false) }}>
            <span className="sf-picker-name">{shown.name}</span><span className="sf-picker-dir">{shown.dir}</span>
            {mode === 'file' ? <small>{REQUIREMENT_KIND_LABEL[requirementKind(row.path)]} · {Math.max(1, Math.ceil(row.size / 1024))} KB</small>
              : <small>{row.count} 个文件</small>}
          </button> })}
        {!matches.length && <p className="sf-picker-blank">{scanning ? '正在读取工作区…' : mode === 'file' ? '没有匹配的文件。' : '工作区里没有子文件夹。'}</p>}
      </div>
      <div className="sf-picker-foot"><button type="button" disabled={disabled} onClick={() => { onPickExternal(); setOpen(false) }}>从电脑其他位置选择…</button><span /><button type="button" onClick={() => setOpen(false)}>完成</button></div>
      <p className="sf-picker-note">上面的列表是当前工作区。工作区外的要求文件夹用左侧按钮：由系统对话框选择，只读取这一个文件夹，不写入、不扩大到父目录。</p>
    </div>}
  </div>
}

// Local drafts predate the requirement-source and allocation fields, and later ones predate
// the v1.2 typography, cover and override fields. Restore those additions once, without
// validating unfinished input as a submitted creation request (SPEC v1.2 §19).
export function restoreCreationDraft(spec: CreationSpec): CreationSpec {
  const { assignmentPath, ...draft } = spec
  // A draft saved by an older build carries sources without the fields added since; the schema
  // defaults only apply when the spec is parsed, which happens at creation, not when it is
  // restored for editing. Missing members here made the first render throw.
  const requirementSources = (spec.requirementSources ?? (assignmentPath ? [{
    resourceId: 'req_legacy_assignment', origin: 'workspace' as const, kind: 'file' as const,
    path: assignmentPath, members: [], role: 'assignment' as const, state: 'selected' as const,
  }] : [])).map(source => ({ ...source, members: source.members ?? [] }))
  return { ...draft, requirementSources,
    countingPolicy: spec.countingPolicy ?? { scope: 'body', includeAbstract: false, algorithmVersion: 1 },
    sections: spec.sections.map(section => ({ ...section, allocationMode: section.allocationMode ?? 'manual' })),
    overrides: spec.overrides ?? [],
    typography: spec.typography ?? DEFAULT_TYPOGRAPHY,
    cover: spec.cover ?? { enabled: false, title: spec.title ?? '', fields: [], date: '' },
  }
}

export function CreationWizard({ scope, api, context, onCreated, workspaceTitle, defaults }: any) {
  const textPrompt = useTextPrompt()
  const key = `scholarflow:creation:${scope}`
  const initial: CreationSpec = { title: '', type: defaults?.defaultProjectType ?? 'course-paper', language: defaults?.language === 'en' ? 'en' : 'zh-CN',
    format: 'docx', requirements: '', requirementSources: [], materials: [], online: false, targetLength: 4000,
    countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 }, supplementalParts: [],
    sections: presetSections(defaults?.defaultProjectType ?? 'course-paper', 4000), manuscriptDir: 'manuscript',
    overrides: [], typography: DEFAULT_TYPOGRAPHY,
    cover: { enabled: false, title: '', fields: [], date: '' } }
  const [saved] = useState(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } })
  const [spec, setSpec] = useState<CreationSpec>(() => saved?.spec ? restoreCreationDraft(saved.spec) : initial), [step, setStep] = useState(saved?.step ?? 0)
  // The direction the user actually moved in, so going back does not look like going forward.
  const [direction, setDirection] = useState<1 | -1>(1)
  const goToStep = (next: number) => { setDirection(next >= step ? 1 : -1); setStep(next) }
  const [files, setFiles] = useState<any[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false)
  const [scanning, setScanning] = useState(false), [truncated, setTruncated] = useState(false)
  const [materialQuery, setMaterialQuery] = useState('')
  const [presetOpen, setPresetOpen] = useState(false)
  const [issues, setIssues] = useState<string[]>([])
  const [narrow, setNarrow] = useState(false)
  const root = useRef<HTMLElement>(null)
  useConfirmationFocus(root)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const sync = () => setNarrow(query.matches)
    sync(); query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  // Per image source: 未识别 / 识别中 / 待确认（candidate）/ 已确认, plus 失败 and 不支持
  // (PRD §3.3). `text` holds the candidate while it is being edited and after it is adopted.
  const [recognition, setRecognition] = useState<Record<string, { state: 'idle' | 'running' | 'candidate' | 'confirmed' | 'failed' | 'unsupported'; text?: string; note?: string; model?: string }>>({})
  const update = (change: Partial<CreationSpec>) => { setIssues([]); setSpec(previous => ({ ...previous, ...change })) }
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ spec, step })) } catch { setError('创建信息暂未保存，请保留当前页面。') } }, [spec, step, key])
  const loadFiles = async (selectAll: boolean) => {
    setScanning(true)
    try {
      const result = await api('creation.materials', { context: context() })
      setFiles(result.files); setTruncated(Boolean(result.truncated))
      if (selectAll) update({ materials: result.files.filter((file: any) => file.supported).map((file: any) => file.relativePath) })
    } catch (failure) { setError((failure as Error).message) } finally { setScanning(false) }
  }
  useEffect(() => { void loadFiles(false) }, [key])
  // A restored draft may name external handles the host no longer holds (a new session, a
  // lapsed grant). Ask which are still live and mark the rest for reconnection, so the
  // wizard never implies a source will be read when it will not be (SPEC v1.1 §7.2).
  useEffect(() => {
    const handles = spec.requirementSources.filter(source => source.origin === 'external' && source.handle).map(source => source.handle!)
    if (!handles.length) return
    let live = true
    api('sources.externalStatus', { handles }).then((value: any) => {
      if (!live) return
      const alive = new Set(value.live ?? [])
      update({ requirementSources: spec.requirementSources.map(source => source.origin === 'external' && source.handle && !alive.has(source.handle)
        ? { ...source, state: 'disconnected' as const } : source) })
    }).catch(() => undefined)
    return () => { live = false }
  }, [key])
  // A fresh wizard opens on the type's default built-in preset (design 02 §6); an
  // existing draft keeps whatever the user had, and a missing library falls back to the
  // offline structure without saying anything wrong.
  useEffect(() => {
    if (saved) return
    let live = true
    api('presets.list', {}).then((value: any) => {
      const first = (value.byType?.[spec.type] ?? []).find((preset: any) => preset.source === 'builtin' && preset.order !== null)
      if (live && first) update({ sections: sectionsFromPreset(first, spec.language, spec.targetLength), preset: selectionFromPreset(first) })
    }).catch(() => undefined)
    return () => { live = false }
  }, [key])
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (error) { if ((error as Error).name !== 'AbortError') setError((error as Error).message) } finally { setBusy(false) } }
  // Requirement sources stand on their own: they are never merged into the materials
  // list, and extraction reads them under their own authorisation (SPEC v1.1 §7).
  const readySpec = () => ({ ...spec, title: spec.title.trim() || spec.requirements.trim().split('\n')[0].slice(0, 60) })
  /**
   * 整理要求 is one action that reads every member and then structures what was read
   * (PRD §3.1). The read is a job, so the button reports the real phase within a second and
   * stays stoppable; the structuring step never sees unconfirmed reference material.
   */
  const readRef = useRef<{ readId?: string; timer?: number; startedAt?: number; opId: string }>({ opId: '' })
  const [read, setRead] = useState<any>()
  const [brief, setBrief] = useState<any>()
  const readController = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => readController.current?.abort(), [])
  const [elapsed, setElapsed] = useState(0)
  const stopReading = () => {
    readController.current?.abort()
    const { readId, timer } = readRef.current
    window.clearInterval(timer); setElapsed(0)
    if (readId) void api('creation.stopRead', { readId }).then(setRead).catch(() => undefined)
    readRef.current = { opId: '' }
    setOperator('stopped')
  }
  const [operator, setOperator] = useState<'idle' | 'reading' | 'structuring' | 'stopped' | 'done'>('idle')
  const organize = () => act(async () => {
    const current = readySpec()
    const controller = new AbortController(); readController.current = controller
    const opId = `op_${Date.now()}`
    readRef.current = { opId, startedAt: Date.now() }
    setElapsed(0); setBrief(undefined); setOperator('reading'); setError('')
    const { readId } = await api('creation.readRequirements', { context: context(), spec: creationSpec.parse(current) }, controller.signal)
    if (controller.signal.aborted || readRef.current.opId !== opId) { void api('creation.stopRead', { readId }); return }
    readRef.current.readId = readId
    const startedAt = readRef.current.startedAt!
    readRef.current.timer = window.setInterval(async () => {
      const live = readRef.current
      if (live.opId !== opId) return
      setElapsed(Date.now() - startedAt)
      try {
        const status = await api('creation.readStatus', { readId })
        // A late answer from a stopped or superseded action never reaches a field (PRD §4.1).
        if (readRef.current.opId !== opId) return
        setRead(status)
      } catch { /* a finished job reports its final state on the next poll */ }
    }, 400)
    // Polling ends when the job settles; the result is the same object the last poll saw.
    const settled = await waitForRead(readId, opId)
    window.clearInterval(readRef.current.timer); setElapsed(Date.now() - startedAt)
    if (readRef.current.opId !== opId) return
    setRead(settled)
    if (!settled || !settled.members.some((member: any) => member.state === 'ready')) {
      // Nothing read is a stated outcome, not a silent success (SPEC v1.2 §5.4).
      setOperator('done')
      setIssues([settled?.state === 'stopped' ? '已停止；已读到的成员保留，未读到的成员需要处理后才能成为已确认要求。'
        : '这次没有读到任何要求文字。可以在失败的文件旁粘贴文字、换一个文件，或直接填写写作要求。'])
      return
    }
    setOperator('structuring')
    const structureTimer = window.setInterval(() => setElapsed(Date.now() - startedAt), 400)
    try {
      const result = await api('creation.structure', { context: context(), spec: creationSpec.parse(current), readId, presetLength: spec.targetLength }, controller.signal)
      if (readRef.current.opId !== opId) return
      setBrief({ ...result.candidate, inputSpecJson: JSON.stringify(current) }); setOperator('done')
    } catch (error) { if (controller.signal.aborted) return; setOperator('done'); throw error }
    finally { window.clearInterval(structureTimer) }
  })
  const waitForRead = async (readId: string, opId: string, timeoutMs = 15 * 60 * 1000) => {
    const deadline = Date.now() + timeoutMs
    let last: any
    while (Date.now() < deadline) {
      if (readRef.current.opId !== opId) return last
      try { last = await api('creation.readStatus', { readId }) } catch { /* keep polling */ }
      if (last && last.state !== 'reading') return last
      await new Promise(resolve => window.setTimeout(resolve, 700))
    }
    return last
  }
  const adoptBrief = (mode: { all?: boolean; resolveLength?: 'teacher' | 'current' }) => act(async () => {
    const result = await api('candidates.adopt', { context: context(), candidateId: brief.candidateId, spec: creationSpec.parse(readySpec()), ...mode })
    const next = creationSpec.parse(result.spec)
    // The adopted text stays editable in the requirement field; nothing overwrites the user's own words.
    setSpec(previous => ({ ...previous, requirements: next.requirements, targetLength: next.targetLength,
      brief: next.brief, typography: next.typography, cover: next.cover, overrides: next.overrides }))
    setBrief(undefined); setOperator('done')
    setIssues(['已采用要求候选；原输入保留在写作要求中，可以继续编辑。'])
  })
  const discardBrief = () => act(async () => {
    if (brief) await api('candidates.discard', { context: context(), candidateId: brief.candidateId })
    setBrief(undefined); setIssues(['已放弃候选；写作要求保持原样。'])
  })
  /** A single member can be retried without repeating the members that already read. */
  const retryMember = (member: string) => act(async () => {
    const { readId } = readRef.current
    if (!readId) return
    const result = await api('creation.retryMember', { context: context(), spec: creationSpec.parse(readySpec()), readId, member })
    setRead(result.read)
  })
  // The old single-shot suggest stays available for the chapter-only path in step 3.
  const outlineController = useRef<AbortController | undefined>(undefined)
  const [outlineRunning, setOutlineRunning] = useState(false), [outlineElapsed, setOutlineElapsed] = useState(0)
  useEffect(() => () => outlineController.current?.abort(), [])
  const stopOutline = () => {
    outlineController.current?.abort(); setOutlineRunning(false)
    setIssues(['已停止生成大纲；原结构保持，重新生成需再次点击。'])
  }
  const suggestStructure = () => act(async () => {
    const current = creationSpec.parse(readySpec())
    const controller = new AbortController(); outlineController.current = controller
    const startedAt = Date.now(); setOutlineRunning(true); setOutlineElapsed(0)
    const timer = window.setInterval(() => setOutlineElapsed(Date.now() - startedAt), 400)
    try {
      const result = await api('outline.suggest', { context: context(), spec: current }, controller.signal)
      if (!controller.signal.aborted) setOutline({ ...result.candidate, inputSpecJson: JSON.stringify(readySpec()) })
    } finally { window.clearInterval(timer); if (outlineController.current === controller) setOutlineRunning(false) }
  })
  const [outline, setOutline] = useState<any>()
  const adoptOutline = () => act(async () => {
    const result = await api('candidates.adopt', { context: context(), candidateId: outline.candidateId, spec: creationSpec.parse(readySpec()), all: true })
    const next = creationSpec.parse(result.spec)
    setHistory(rows => [...rows.slice(-9), spec.sections])
    setSpec(previous => ({ ...previous, sections: outline.sections, preset: previous.preset ? { ...previous.preset, modified: true } : previous.preset }))
    setOutline(undefined); setIssues(['已采用大纲候选，可以继续编辑章节。'])
    void next
  })
  const clearDraft = () => {
    if (!window.confirm('清除本次填写的草稿？论文项目不会被创建，已有项目不受影响。')) return
    try { localStorage.removeItem(key) } catch { /* storage may be unavailable */ }
    setHistory([]); setIssues([]); setRecognition({}); setStep(0)
    setSpec({ ...initial, sections: presetSections(spec.type, initial.targetLength) })
  }
  const newSourceId = () => `req_${crypto.randomUUID().replaceAll('-', '')}`
  const addSource = (kind: 'file' | 'folder', path: string) => update({ requirementSources: [...spec.requirementSources,
    { resourceId: newSourceId(), origin: 'workspace' as const, kind, path, role: 'assignment' as const, state: 'selected' as const,
      members: kind === 'folder' ? files.filter((file: any) => file.relativePath.startsWith(path + '/')).map((file: any) => ({ name: file.relativePath, size: file.size })) : [] }] })
  const removeSource = (resourceId: string) => update({ requirementSources: spec.requirementSources.filter(source => source.resourceId !== resourceId) })
  const removeMember = (resourceId: string, name: string) => update({ requirementSources: spec.requirementSources.map(source =>
    source.resourceId === resourceId ? { ...source, members: source.members.filter(member => member.name !== name) } : source) })
  // An external folder is chosen in the OS dialog, so the host owns the pick and returns an
  // opaque handle plus the members it found; the wizard never learns where the folder is.
  const addExternalSource = () => act(async () => {
    const result = await api('sources.pickExternal', {})
    if (result.cancelled) return
    const dropped = (result.members as any[]).filter(member => requirementKind(member.name) === 'unsupported')
    update({ requirementSources: [...spec.requirementSources,
      { resourceId: result.resourceId, origin: 'external' as const, kind: 'folder' as const, handle: result.handle,
        role: 'assignment' as const, state: 'connected' as const,
        members: (result.members as any[]).filter(member => requirementKind(member.name) !== 'unsupported').map(member => ({ name: member.name, size: member.size })) }] })
    const notes = [...(result.diagnostics as string[])]
    if (dropped.length) notes.push(`已跳过 ${dropped.length} 个当前格式无法读取的文件。`)
    if (result.truncated) notes.push('文件夹内容较多，只列出了前 200 个文件。')
    if (notes.length) setRecognition(previous => ({ ...previous, [result.resourceId]: { state: 'note' as const, note: notes.join(' ') } }))
  })
  // Recognition is user-triggered and produces a candidate, never a silent edit (PRD §3.3).
  // The capability check runs first and costs nothing, so an unsupported model is stated in
  // its own words instead of surfacing as a failed call.
  const identify = (resourceId: string) => act(async () => {
    setRecognition(previous => ({ ...previous, [resourceId]: { state: 'running' as const } }))
    try {
      const capability = await api('creation.imageCapability', { context: context() })
      if (capability.imageInput !== true) {
        setRecognition(previous => ({ ...previous, [resourceId]: { state: 'unsupported' as const,
          note: capability.imageInput === false
            ? `当前模型（${capability.model}）不接受图片输入。把截图里的要求粘贴到写作要求即可，来源登记会保留。`
            : `宿主没有返回 ${capability.model} 的图片输入能力，因此不发送图片。可以手动粘贴文字，或换成支持图片的模型。` } }))
        return
      }
      const result = await api('creation.recognizeImage', { context: context(), spec: creationSpec.parse(readySpec()), resourceId })
      setRecognition(previous => ({ ...previous, [resourceId]: { state: 'candidate' as const, text: result.text, model: result.model } }))
    } catch (error) {
      const message = (error as Error).message
      setRecognition(previous => ({ ...previous, [resourceId]: { state: 'failed' as const, note: message } }))
    }
  })
  const editCandidate = (resourceId: string, text: string) => setRecognition(previous =>
    ({ ...previous, [resourceId]: { ...previous[resourceId], text } }))
  // Confirming appends to the requirements; it never replaces what the user already wrote, and
  // re-recognising only ever replaces this image's own candidate.
  const confirmCandidate = (resourceId: string) => {
    const candidate = recognition[resourceId]
    if (!candidate?.text?.trim()) return
    const added = [spec.requirements.trim(), candidate.text.trim()].filter(Boolean).join('\n')
    if (added.length > 12000) { setError('写作要求已达 12000 字上限，请先精简再采用识别结果。'); return }
    setError('')
    update({ requirements: added })
    setRecognition(previous => ({ ...previous, [resourceId]: { state: 'confirmed' as const, text: candidate.text } }))
  }
  /** Pasting the text of a file that could not be read is a user action, not a parser guess. */
  const pasteMemberText = async (member: string) => {
    const text = await textPrompt.ask(`粘贴 ${member} 的真实要求文字`, '', true)
    if (!text?.trim()) return
    update({ requirements: [spec.requirements.trim(), text.trim()].filter(Boolean).join(String.fromCharCode(10)).slice(0, 12000) })
    setRead((current: any) => current ? { ...current, members: current.members.map((row: any) => row.name === member
      ? { ...row, state: 'ready', chars: text.trim().length, note: '由你粘贴文字；已加入写作要求。', noteKind: undefined } : row) } : current)
    setIssues([`已把 ${member} 的文字加入写作要求；它不再算作未读要求。`])
  }
  const removeNamedMember = (resourceId: string, name: string) => {
    removeMember(resourceId, name)
    setRead((current: any) => current ? { ...current, members: current.members.filter((row: any) => row.name !== name) } : current)
  }
  const requirementRows = spec.requirementSources.map(source => {
    const external = source.origin === 'external'
    const shown = external ? { name: '电脑其他位置的要求文件夹', dir: `${source.members.length} 个文件` } : splitPath(source.path ?? '')
    const kind = source.kind === 'folder' ? 'folder' : requirementKind(source.path ?? '')
    const status = recognition[source.resourceId]
    const needsReconnect = external && source.state !== 'connected'
    // Each member reports its own outcome; a folder is never summarised as one file.
    const members = (read?.members ?? []).filter((row: any) => source.origin === 'external' ? true
      : source.kind === 'folder' ? source.members.some((member: any) => member.name === row.name) : row.name === source.path)
    return <li key={source.resourceId} className="sf-source-row">
      <span className="sf-source-badge" data-kind={external ? 'external' : kind}>{external ? '外部' : source.kind === 'folder' ? '文件夹' : REQUIREMENT_KIND_LABEL[kind as keyof typeof REQUIREMENT_KIND_LABEL]}</span>
      <span className="sf-source-name">{shown.name}<small>{shown.dir}</small></span>
      {needsReconnect && <button type="button" className="sf-source-action" disabled={busy} onClick={addExternalSource}>重新连接</button>}
      {!external && kind === 'image' && <button type="button" className="sf-source-action" disabled={busy} onClick={() => identify(source.resourceId)}>
        {status?.state === 'running' ? '识别中…' : status?.state === 'confirmed' || status?.state === 'candidate' ? '重新识别' : '识别文字'}</button>}
      <button type="button" className="sf-source-action" onClick={() => removeSource(source.resourceId)}>移除</button>
      {source.kind === 'folder' && <ul className="sf-source-members">{source.members.map(member => <li key={member.name}>
        <span>{member.name}</span><button type="button" aria-label={`移除 ${member.name}`} onClick={() => removeMember(source.resourceId, member.name)}>×</button></li>)}</ul>}
      {needsReconnect && <p className="sf-source-note" role="status">读取授权已过期，需要重新选择这个文件夹；已经确认的要求文字不受影响。</p>}
      {status?.state === 'candidate' && <div className="sf-candidate">
        <span className="sf-field-label">识别候选 · 确认后才成为要求</span>
        <textarea aria-label="识别候选文字" rows={3} value={status.text ?? ''} onChange={event => editCandidate(source.resourceId, event.target.value)} />
        <div className="sf-candidate-actions">
          <button type="button" className="sf-primary" disabled={busy || !status.text?.trim()} onClick={() => confirmCandidate(source.resourceId)}>采用到写作要求</button>
          <button type="button" disabled={busy} onClick={() => setRecognition(previous => { const next = { ...previous }; delete next[source.resourceId]; return next })}>放弃</button>
          <span className="sf-field-hint">来自 {status.model}</span>
        </div></div>}
      {status?.state === 'confirmed' && <p className="sf-source-note" role="status">已采用的识别文字已在写作要求中，可以继续编辑；重新识别只替换本次候选。</p>}
      {status?.note && <p className="sf-source-note" role="status">{status.note}</p>}
      {!!members.length && <ul className="sf-member-reads">{members.map((row: any) => <li key={row.name} data-state={row.state}>
        <span className="sf-member-name">{row.name}</span>
        <span className="sf-member-state">{MEMBER_STATE[row.state] ?? row.state}{row.chars ? ` · ${row.chars} 字` : ''}</span>
        {!!row.note && <span className="sf-member-note">{row.note}</span>}
        {row.state === 'failed' && <span className="sf-member-actions">
          <button type="button" className="sf-source-action" disabled={busy} onClick={() => retryMember(row.name)}>重新读取</button>
          <button type="button" className="sf-source-action" onClick={() => pasteMemberText(row.name)}>粘贴文字</button>
          <button type="button" className="sf-source-action" onClick={() => removeNamedMember(source.resourceId, row.name)}>移除</button>
        </span>}
      </li>)}</ul>}
    </li> })
  const readable = files.filter((file: any) => file.supported)
  const attachments = files.filter((file: any) => !file.supported && requirementKind(file.relativePath) === 'image')
  const materialNeedle = materialQuery.trim().toLowerCase()
  const visibleFiles = materialNeedle ? files.filter((file: any) => file.relativePath.toLowerCase().includes(materialNeedle)) : files
  // A subsection moves inside its own chapter: swapping it past the chapter boundary would
  // leave it pointing at a parent that is no longer above it, so the move is refused.
  const sameParent = (left: CreationSpec['sections'][number], right: CreationSpec['sections'][number]) =>
    (left.parentId ?? null) === (right.parentId ?? null)
  const moveSection = (index: number, direction: number) => {
    const sections = [...spec.sections], target = index + direction
    if (target < 0 || target >= sections.length) return
    if (!sameParent(sections[index]!, sections[target]!)) return
    ;[sections[index], sections[target]] = [sections[target], sections[index]]; editSections(sections)
  }
  // Removing a chapter takes its subsections with it; otherwise they would point at a
  // parent that no longer exists.
  const withoutSection = (id: string) => spec.sections.filter(row => row.id !== id && row.parentId !== id)
  const addSubsection = (parentId: string) => editSections([...spec.sections,
    { id: `section_${crypto.randomUUID().replaceAll('-', '')}`, title: '新子节', purpose: '', targetLength: 500,
      allocationMode: 'auto', parentId, kind: 'body' }])
  // Applying is atomic: the type (when the preset belongs to another one) and the
  // structure change together, after the caller confirmed once (design 02 §7).
  const applyPreset = (preset: any, switching: boolean, kept?: string[]) => {
    const supplementalParts = (preset.supplementalParts ?? []).filter((part: any) => !kept || kept.includes(part.kind))
    update({ ...(switching ? { type: preset.paperType } : {}), supplementalParts,
      sections: sectionsFromPreset(preset, spec.language, spec.targetLength, { supplementalKinds: kept }),
      preset: selectionFromPreset(preset) })
    setPresetOpen(false)
  }
  const sectionKey = (id: string) => ('k-' + id.toLowerCase().replace(/[^a-z0-9-]/g, '-')).slice(0, 64)
  // Saving stores the structure only: shares are derived on the host, so the paper's
  // absolute lengths and title never enter the global library. Parent keys carry the
  // nesting across, so a saved paper keeps its subsections.
  const structureForPreset = () => ({ title: spec.title.trim() || '未命名结构', summary: '按当前论文结构保存', paperType: spec.type,
    sections: spec.sections.map(section => ({ key: sectionKey(section.id), title: section.title,
      focus: section.purpose.trim() || '（尚未填写写作重点）', targetLength: section.targetLength,
      ...(section.parentId ? { parentKey: sectionKey(section.parentId) } : {}) })),
    supplementalParts: spec.supplementalParts,
    ...(spec.preset?.source === 'builtin' ? { derivedFrom: spec.preset.id } : {}) })
  const allocationPlan = allocate(spec.sections.map(section => ({ id: section.id, targetLength: section.targetLength,
    allocationMode: section.allocationMode ?? 'manual', ...(section.allocationWeight === undefined ? {} : { allocationWeight: section.allocationWeight }) })),
    spec.targetLength, { abstractLength: 200, includeAbstract: spec.countingPolicy.includeAbstract })
  const reallocate = () => update({ sections: allocationPlan.sections.map(row => ({ ...spec.sections.find(section => section.id === row.id)!, targetLength: row.targetLength })) })
  // Editing a chapter is a structural edit: it marks the paper as derived from the preset
  // rather than equal to it, and keeps a short history so undo costs no model call.
  const [history, setHistory] = useState<CreationSpec['sections'][]>([])
  const editSections = (next: CreationSpec['sections']) => {
    setHistory(rows => [...rows.slice(-9), spec.sections])
    update({ sections: next, ...(spec.preset ? { preset: { ...spec.preset, modified: true } } : {}) })
  }
  const undoStructure = () => { const previous = history.at(-1); if (!previous) return
    setHistory(rows => rows.slice(0, -1)); update({ sections: previous }) }
  // What this run may actually read, shown in full before creation (design 02 §8).
  const approvedPaths = [...new Set([...spec.materials, ...spec.requirementSources.flatMap(source =>
    source.kind === 'folder' ? source.members.map(member => member.name) : source.path ? [source.path] : [])])]
  const capabilityGaps = [
    '引用样式只支持顺序编号，作者—年份尚未实现',
    ...(spec.requirementSources.some(source => requirementKind(source.path ?? '') === 'image' && recognition[source.resourceId]?.state !== 'confirmed'
      && !(read?.members ?? []).some((member: any) => member.name === source.path && member.state === 'ready'))
      ? ['图片文字需先识别并确认，或手动补充'] : []),
    ...(spec.requirementSources.some(source => source.origin === 'external' && source.state !== 'connected') ? ['外部来源需要重新连接后才能再次读取'] : []),
  ]
  return <>{textPrompt.dialog}<div className="sf-wizard-scroll"><section ref={root} className="sf-wizard" aria-label="创建论文向导">
    <header><span className="sf-wizard-eyebrow">{workspaceTitle}</span><h2>开始一篇论文</h2><p>确定要求与资料，我们一起完成初稿。</p>
      <button className="sf-wizard-clear" disabled={busy} onClick={clearDraft}>清除草稿</button></header>
    <p className="sf-wizard-step-compact" aria-current="step">第 {step + 1} 步 / 共 3 步 · {["写作要求", "资料范围", "行文结构"][step]}</p>
    <nav className="sf-wizard-steps" aria-label="创建步骤">{['写作要求', '资料范围', '行文结构'].map((title, index) => <button key={title} disabled={busy || index > step} data-done={index < step ? 'true' : undefined} aria-current={step === index ? 'step' : undefined}
      onClick={() => goToStep(index)}><span>{index + 1}</span>{title}</button>)}</nav>
    <div className="sf-wizard-page" key={step} data-direction={direction === 1 ? 'forward' : 'back'}>
      {step === 0 && <>
        <label>论文标题<input id="sf-field-title" placeholder="可以先留空，由写作要求生成" value={spec.title} maxLength={300} onChange={e => update({ title: e.target.value })} /></label>
        <div className="sf-wizard-row"><label>论文类型<select value={spec.type} onChange={e => { const type = e.target.value as CreationSpec['type']
          if (type === spec.type) return
          // Switching the type replaces the structure, so an edited one asks first and can
          // still be undone (design 02 §3). The old preset reference no longer applies.
          const edited = history.length > 0 || spec.preset?.modified === true
          if (edited && !window.confirm(`切换为「${TYPE_LABELS[type]}」会按该类型的预设替换当前 ${spec.sections.length} 章结构，可用「撤销结构编辑」还原。继续？`)) return
          setHistory(rows => [...rows.slice(-9), spec.sections])
          update({ type, sections: presetSections(type, spec.targetLength), preset: undefined }) }}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>语言<select value={spec.language} onChange={e => update({ language: e.target.value as CreationSpec['language'] })}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
          <label>提交格式<select value={spec.format} onChange={e => update({ format: e.target.value as CreationSpec['format'] })}>{Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <div className="sf-field"><span className="sf-field-label">引用样式</span>
          <p className="sf-choice-current">顺序编号 [1]</p>
          <p className="sf-field-hint">当前只支持这一种样式。作者—年份、学校或期刊的引用标准尚未实现，可以写进下面的写作要求作为要求记录，不会被当成已支持。</p></div>
        <label>写作要求<textarea id="sf-field-requirements" rows={6} placeholder="例如：机器学习课程论文，约4000字，结合课件和笔记讨论实际应用，需要参考文献。也可以粘贴老师的要求。" value={spec.requirements} maxLength={12000} onChange={e => update({ requirements: e.target.value })} /></label>
        <div className="sf-field"><span className="sf-field-label">写作要求来源</span>
          <div className="sf-assignment-row">
            <RequirementPicker files={files} disabled={busy} scanning={scanning} onPick={addSource} onPickExternal={addExternalSource} onRescan={() => loadFiles(false)} />
            {operator === 'reading' || operator === 'structuring'
              ? <button className="sf-assignment-extract" onClick={stopReading}>停止</button>
              : <button className="sf-assignment-extract" disabled={busy || (!spec.requirements.trim() && !spec.requirementSources.length)} onClick={organize}>整理要求</button>}
          </div>
          {/* One action, real phases, live elapsed time, and a stop that keeps what was read. */}
          {(operator === 'reading' || operator === 'structuring') && <div className="sf-long-op" role="status" aria-live="polite">
            <span className="sf-long-op-dot" aria-hidden="true" />
            <strong>{operator === 'reading' ? (read?.phase || '正在读取要求来源…') : '整理已读要求'}</strong>
            <span className="sf-long-op-count">{read ? `${read.done} / ${read.total} 个成员` : '准备中'}</span>
            <span className="sf-long-op-elapsed">已用 {formatElapsed(elapsed)}</span>
            <span className="sf-long-op-hint">{operator === 'reading' ? '等待模型响应期间不显示推算的剩余时间。' : '只使用本次真正读到的文字。'}</span>
          </div>}
          <p className="sf-field-hint">要求来源规定这篇论文该怎么写；第二步的论文参考材料提供写作所需的资料。两者独立选择，互不要求对方包含自己。文件保持原样，只在整理或写作时读取。</p>
          {brief && <BriefCandidate candidate={brief} stale={brief.inputSpecJson !== JSON.stringify(readySpec())} busy={busy} onAdopt={adoptBrief} onDiscard={discardBrief} />}
          {spec.requirementSources.length
            ? <ul className="sf-source-list">{requirementRows}</ul>
            : <p className="sf-field-hint">还没有添加要求来源。也可以直接填写写作要求后继续。</p>}
          {truncated && <p className="sf-field-hint">工作区文件较多，只列出前 500 个，把要求文件放进更具体的文件夹可以缩小范围。</p>}
        </div>
      </>}
      {step === 1 && <>
        <h3>选择论文使用的资料</h3>
        <p className="sf-muted">这里是写作所需的参考材料，原文件保持原样。要求来源已在第一步单独选择，清空材料不会移除它们。</p>
        <div className="sf-material-toolbar">
          <input aria-label="搜索资料" placeholder="搜索资料" value={materialQuery} onChange={event => setMaterialQuery(event.target.value)} />
          <span className="sf-material-count">已选 {spec.materials.length} · 可解析 {readable.length} · 仅附件 {attachments.length}</span>
          <button type="button" disabled={busy || !readable.length} onClick={() => update({ materials: readable.map((file: any) => file.relativePath) })}>全选可解析</button>
          <button type="button" disabled={busy || !spec.materials.length} onClick={() => update({ materials: [] })}>清空</button>
        </div>
        <div className="sf-material-checklist">{visibleFiles.map(file => { const kind = requirementKind(file.relativePath)
          const alsoRequired = spec.requirementSources.some(source => source.path === file.relativePath || source.members.some(member => member.name === file.relativePath))
          const reason = kind === 'image' ? '仅附件，尚未解析' : '当前格式暂不支持'
          return <label key={file.relativePath} className={file.supported ? undefined : 'sf-material-disabled'}>
            <input type="checkbox" checked={spec.materials.includes(file.relativePath)} disabled={busy || !file.supported}
              onChange={e => update({ materials: e.target.checked ? [...spec.materials, file.relativePath] : spec.materials.filter(path => path !== file.relativePath) })} />
            <span>{file.relativePath}{alsoRequired && <em className="sf-material-tag">也用作要求来源</em>}</span>
            <small>{file.supported ? `${Math.max(1, Math.ceil(file.size / 1024))} KB` : reason}</small></label> })}
          {!visibleFiles.length && <p className="sf-picker-blank">{files.length ? '没有匹配的文件。' : '工作区中还没有文件，可以开启联网补充，或先继续确定结构。'}</p>}
        </div>
        <label className="sf-online-choice"><input type="checkbox" checked={spec.online} onChange={e => update({ online: e.target.checked })} /><span><strong>联网补充文献</strong><small>检索相关文献，获取公开可读取的全文。</small></span></label>
      </>}
      {step === 2 && <>
        <div className="sf-structure-caption">
          <label>目标篇幅<span className="sf-length-input"><input type="number" min={200} max={60000} aria-label="目标篇幅" value={spec.targetLength} onChange={e => update({ targetLength: Number(e.target.value) })} /><span>{spec.language === 'en' ? '词' : '汉字'}</span></span></label>
          <label className="sf-online-choice" style={{ margin: 0 }}><input type="checkbox" checked={spec.countingPolicy.includeAbstract}
            onChange={e => update({ countingPolicy: { ...spec.countingPolicy, includeAbstract: e.target.checked } })} /><span><strong>摘要计入</strong><small>默认不计入正文目标</small></span></label>
          <div className="sf-structure-actions">
            <button disabled={busy || !spec.preset} onClick={() => setPresetOpen(true)}>更换预设</button>
            <button disabled={busy || allocationPlan.minimumShortfall} onClick={reallocate}>重新分配</button>
            {outlineRunning ? <button onClick={stopOutline}>停止生成大纲</button> : <button disabled={busy} onClick={suggestStructure}>AI 完善结构</button>}
          </div>
        </div>
        {outlineRunning && <div className="sf-long-op" role="status" aria-live="polite"><span className="sf-long-op-dot" aria-hidden="true" />
          <strong>生成大纲候选</strong><span>已用 {formatElapsed(outlineElapsed)}</span><span>原结构保持，完成后由你确认采用。</span></div>}
        {outline && <OutlineCandidate candidate={outline} stale={outline.inputSpecJson !== JSON.stringify(readySpec())} busy={busy} onAdopt={adoptOutline}
          onDiscard={() => act(async () => { await api('candidates.discard', { context: context(), candidateId: outline.candidateId }); setOutline(undefined) })} />}
        <p className="sf-field-hint">当前预设：{spec.preset ? `${spec.preset.id}（${spec.preset.source === 'builtin' ? '内置' : '我的'}${spec.preset.modified ? ' · 已修改' : ''}）` : '尚未选择'}
          ，计划合计 {allocationPlan.total} / {spec.targetLength}。手工章节保持原值，其余按建议比例分配；比例只是起点，任何一项都可以改。</p>
        {allocationPlan.notes.map(note => <p className="sf-field-hint" key={note} role="status">{note}</p>)}
        <div className="sf-structure-list">{spec.sections.map((section, index) => <div className="sf-structure-section" key={section.id}
          style={section.parentId ? { marginLeft: 20, borderLeft: '2px solid var(--sf-accent, #3f68d8)', paddingLeft: 10 } : undefined}>
          <span className="sf-section-index">{section.parentId ? '·' : index + 1}</span>
          <div className="sf-section-text">
            <input id={`sf-section-title-${index}`} className="sf-section-title" aria-label={`第${index + 1}章标题`} placeholder="章节标题" value={section.title} onChange={e => editSections(spec.sections.map(row => row.id === section.id ? { ...row, title: e.target.value } : row))} />
            <input className="sf-section-purpose" aria-label={`第${index + 1}章写作内容`} placeholder="本节写什么（可选）" value={section.purpose} onChange={e => editSections(spec.sections.map(row => row.id === section.id ? { ...row, purpose: e.target.value } : row))} />
          </div>
          <div className="sf-section-length"><input aria-label={`第${index + 1}章篇幅`} type="number" min={50} value={section.targetLength}
            onChange={e => editSections(spec.sections.map(row => row.id === section.id ? { ...row, targetLength: Number(e.target.value), allocationMode: 'manual' } : row))} />
            <span>{spec.language === 'en' ? '词' : '字'} · {section.allocationMode === 'auto' ? '自动' : '手工'}
              {section.kind !== 'body' ? ` · ${section.kind === 'front' ? '前置' : '后置'}` : ''}</span></div>
          <div className="sf-section-actions">
            {!section.parentId && <button aria-label="添加子节" title="添加子节" onClick={() => addSubsection(section.id)}>＋</button>}
            <button aria-label="上移章节" disabled={index === 0 || !sameParent(section, spec.sections[index - 1]!)} onClick={() => moveSection(index, -1)}>↑</button>
            <button aria-label="下移章节" disabled={index === spec.sections.length - 1 || !sameParent(section, spec.sections[index + 1]!)} onClick={() => moveSection(index, 1)}>↓</button>
            <button aria-label="删除章节" disabled={withoutSection(section.id).length === 0} onClick={() => editSections(withoutSection(section.id))}>×</button></div>
        </div>)}</div>
        <div className="sf-structure-actions" style={{ marginTop: 14 }}>
          <button onClick={() => editSections([...spec.sections, { id: `section_${crypto.randomUUID().replaceAll('-', '')}`, title: '新章节', purpose: '', targetLength: 500, allocationMode: 'auto', kind: 'body' }])}>+ 添加章节</button>
          <button disabled={busy || !history.length} onClick={undoStructure}>撤销结构编辑</button>
          <button disabled={busy || !spec.sections.every(section => section.title.trim())} onClick={() => act(async () => {
            const name = await textPrompt.ask('预设名称', spec.title.trim() || '我的结构'); if (!name?.trim()) return
            await api('presets.save', { ...structureForPreset(), title: name.trim() }) })}>保存为我的预设</button>
          {spec.preset?.source === 'user' && <button disabled={busy} onClick={() => act(async () => {
            if (!window.confirm('用当前结构更新这个预设？已有论文不受影响。')) return
            await api('presets.update', { ...structureForPreset(), id: spec.preset!.id, expectedVersion: spec.preset!.version }) })}>更新此预设</button>}
        </div>
        {/* A short summary next to the create button, expandable for the full scope. The large
            pre-creation confirmation block is gone: nothing here is asked twice. */}
        {spec.cover?.enabled && <fieldset className="sf-cover-fields"><legend>封面</legend>
          <label>封面标题<input value={spec.cover.title} onChange={event => update({ cover: { ...spec.cover!, title: event.target.value } })} /></label>
          {spec.cover.fields.map((field, index) => <label key={index}>{field.label}<input value={field.value} onChange={event => update({ cover: {
            ...spec.cover!, fields: spec.cover!.fields.map((row, at) => at === index ? { ...row, value: event.target.value } : row) } })} /></label>)}
          <small>仅用于封面，不作为正文生成资料。</small>
        </fieldset>}
        <section className="sf-create-summary" aria-label="创建摘要">
          <div className="sf-create-line">
            <strong>{FORMAT_LABELS[spec.format]} · {spec.language === 'en' ? `约 ${spec.targetLength} 词` : `约 ${spec.targetLength} 字`}
              {spec.brief?.length?.pages ? ` · A4 共 ${spec.brief.length.pages} 页` : ''}</strong>
            <span>要求来源 {spec.requirementSources.length} · 参考材料 {spec.materials.length} · 输出 {spec.manuscriptDir}/ ·
              模型由当前会话决定 · 联网{spec.online ? '开启' : '关闭'}</span>
          </div>
          <details><summary>查看实际读取与写入范围、排版与能力缺口</summary>
            <p>将读取：{approvedPaths.length ? approvedPaths.join('、') : '（没有选中任何文件）'}</p>
            <p>将写入：{spec.manuscriptDir}/ 与 .scholarflow/；已有同名文件时在提交前提示，不会覆盖。</p>
            <p>排版：中文 {spec.typography?.bodyFontZh ?? '宋体'}／英文 {spec.typography?.bodyFontEn ?? 'Times New Roman'} ·
              {spec.typography?.bodySizeLabel ?? '小四'} · {spec.typography?.lineSpacing ?? 1.2} 倍行距
              {spec.cover?.enabled ? ` · 封面 ${spec.brief?.length?.coverPages ?? 1} 页` : ' · 无封面'}。
              导出成功不等于排版合格：页数要在 Word 或等效查看环境中核对。</p>
            <p>能力缺口：{capabilityGaps.join('；')}。这些会作为要求保留，不会被当作已满足。</p>
            {!!spec.overrides.length && <p>你选择覆盖过的要求：{spec.overrides.map(row => `${row.field}（要求 ${row.requirementValue} → 采用 ${row.chosenValue}）`).join('；')}。</p>}
            <p>模型调用次数与耗时只作为统计展示，不再限制本次任务。</p>
          </details>
        </section>
        {conflict && <label>论文输出目录<input value={spec.manuscriptDir} onChange={e => update({ manuscriptDir: e.target.value })} /><small>此处已有文件，请选择新的输出目录。</small></label>}
      </>}
    </div>
    {error && <p className="sf-wizard-error" role="alert">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}
    {issues.length > 0 && <ul className="sf-wizard-issues" role="alert">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <footer className="sf-wizard-footer">{step > 0 && <button disabled={busy} onClick={() => goToStep(step - 1)}>← 上一步</button>}<span />
      {step < 2 ? <button className="sf-primary" disabled={busy} onClick={() => {
        // The control stays reachable: a greyed-out button tells the user nothing
        // (design 02 §9). Clicking reports what is missing and focuses the first field.
        if (step === 0 && !spec.requirements.trim() && !spec.requirementSources.length) {
          setIssues(['请填写写作要求，或添加至少一个要求来源。'])
          document.getElementById('sf-field-requirements')?.focus(); return
        }
        goToStep(step + 1) }}>下一步 →</button>
        : <button className="sf-primary" disabled={busy} onClick={() => {
          const empty = spec.sections.findIndex(section => !section.title.trim() || section.targetLength < 50)
          const blockers = [
            ...(spec.title.trim() ? [] : ['创建前必须填写论文题目（在第一步填写）。']),
            ...(empty < 0 ? [] : [`第 ${empty + 1} 章还没有标题，或篇幅低于 50。`]),
            ...(allocationPlan.minimumShortfall ? ['自动章节连最低篇幅都达不到，请提高目标篇幅或调整手工篇幅。'] : []),
          ]
          if (blockers.length) { setIssues(blockers)
            document.getElementById(empty >= 0 ? `sf-section-title-${empty}` : 'sf-field-title')?.focus(); return }
          void act(async () => {
            const value = creationSpec.parse(readySpec())
            try { const plan = await api('creation.prepare', { context: context(), spec: value }); await api('creation.start', { context: context(), planId: plan.planId, planHash: plan.planHash }) }
            catch (error) { if ((error as Error).message.includes('OUTPUT_PATH_CONFLICT')) setConflict(true); throw error }
            try { localStorage.removeItem(key) } catch {}
            await onCreated()
          }) }}>{busy ? '正在创建…' : '创建论文并开始撰写'}</button>}
    </footer>
    <PresetPicker open={presetOpen} language={spec.language} paperType={spec.type} applied={spec.preset} structure={structureForPreset}
      api={api} run={act} busy={busy} onClose={() => setPresetOpen(false)} onUse={applyPreset} />
  </section></div></>
}

export const WIZARD_CSS = `/* Colours and density come from src/client/theme/tokens.ts, which keys the dark palette off
   body[data-ds-dark-theme] so an explicitly dark workbench gets it too, not just a dark system
   preference. Every text token clears WCAG AA on the surface its rule paints; verified by
   scripts/audit-appearance.mjs. */
.sf-wizard-scroll{overflow:auto;flex:1;background:var(--dsw-alias-bg-layer-1,var(--sf-surface-2));padding:var(--sf-space-6) var(--sf-space-5)}
.sf-wizard{max-width:760px;margin:0 auto;padding:var(--sf-space-6);background:var(--dsw-alias-bg-base,var(--sf-surface));border:1px solid var(--sf-border);border-radius:var(--sf-radius-xl);box-shadow:var(--sf-shadow-2);font-size:var(--sf-font-lg)}
.sf-wizard h2{font-size:var(--sf-font-2xl);margin:var(--sf-space-2) 0}
.sf-wizard h3{font-size:var(--sf-font-xl);margin:0}
.sf-wizard p,.sf-muted{color:var(--dsw-alias-label-secondary,var(--sf-muted));line-height:var(--sf-leading-body)}
.sf-wizard-eyebrow{font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard label,.sf-wizard .sf-assignment-field{display:flex;flex-direction:column;gap:var(--sf-space-2);font-size:var(--sf-font-md);margin:var(--sf-space-4) 0 0}
.sf-wizard button{font:inherit;font-size:var(--sf-font-md);height:var(--sf-space-6);padding:0 var(--sf-space-3);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:var(--sf-surface);color:var(--sf-text);cursor:pointer}
.sf-wizard input:not([type=checkbox]),.sf-wizard select{box-sizing:border-box;font-family:inherit;height:var(--sf-space-7);width:100%;padding:0 var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;color:inherit}
.sf-wizard textarea{font-family:inherit;font-size:var(--sf-font-lg);line-height:var(--sf-leading-prose)}
.sf-field-hint{margin:var(--sf-space-2) 0 0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard-steps{display:flex;gap:var(--sf-space-5);padding:var(--sf-space-5) 0;border-bottom:1px solid var(--sf-border);margin-bottom:var(--sf-space-5)}
.sf-wizard-steps button{border:0!important;padding:0!important;height:auto;display:flex;align-items:center;gap:var(--sf-space-2);background:transparent;color:var(--sf-muted)!important}
.sf-wizard .sf-wizard-steps button:disabled{opacity:1;color:var(--sf-text-faint)!important}
.sf-wizard-steps span{position:relative;display:grid;place-items:center;width:var(--sf-space-6);height:var(--sf-space-6);border-radius:50%;background:var(--sf-fill)}
.sf-wizard-steps [aria-current=step]{color:var(--sf-accent-text)!important}
.sf-wizard-steps [aria-current=step] span{background:var(--sf-accent);color:var(--sf-on-accent)}
.sf-wizard-steps [data-done=true] span{background:var(--sf-ok);color:transparent}
.sf-wizard-steps [data-done=true] span::after{content:'✓';position:absolute;inset:0;display:grid;place-items:center;color:var(--sf-surface)}
.sf-wizard-page[data-direction=forward]{animation:sf-step-forward var(--sf-dur-base,220ms) var(--sf-ease-out,ease-out)}
.sf-wizard-page[data-direction=back]{animation:sf-step-back var(--sf-dur-base,220ms) var(--sf-ease-out,ease-out)}
.sf-wizard-row{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:var(--sf-space-4)}
.sf-wizard .sf-assignment-row{display:flex;align-items:flex-end;gap:var(--sf-space-3)}
.sf-wizard .sf-assignment-row>.sf-assignment-field{flex:1 1 auto;min-width:0}
.sf-wizard .sf-assignment-row>.sf-assignment-extract{flex:none;height:var(--sf-space-7)}
.sf-wizard .sf-picker{position:relative}
.sf-wizard .sf-picker-toggle{display:flex;align-items:center;gap:var(--sf-space-2);width:100%;height:var(--sf-space-7);padding:0 var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;color:inherit;text-align:left;cursor:pointer}
.sf-wizard .sf-picker-current{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;line-height:var(--sf-leading-tight)}
.sf-wizard .sf-picker-current strong{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-current small{font-size:var(--sf-font-xs);color:var(--dsw-alias-label-secondary,var(--sf-text-faint));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-current em{font-style:normal;color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-picker-caret{flex:none;color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-picker-panel{margin-top:var(--sf-space-2);border:1px solid var(--sf-border);border-radius:var(--sf-radius-lg);background:var(--dsw-alias-bg-base,var(--sf-surface));box-shadow:var(--sf-shadow-3);overflow:hidden}
.sf-wizard .sf-picker-search{display:flex;align-items:center;gap:var(--sf-space-2);padding:var(--sf-space-2);border-bottom:1px solid var(--sf-border)}
.sf-wizard .sf-picker .sf-picker-search>input{flex:1 1 auto;min-width:0;width:auto;height:var(--sf-space-6)}
.sf-wizard .sf-picker-search>button{flex:none;height:var(--sf-space-6)}
.sf-wizard .sf-picker-list{max-height:230px;overflow:auto}
.sf-wizard .sf-picker-row{display:flex;align-items:center;gap:var(--sf-space-2);width:100%;padding:var(--sf-space-2) var(--sf-space-3);border:0!important;border-bottom:1px solid var(--sf-border-soft)!important;border-radius:0!important;background:transparent;color:inherit;text-align:left;cursor:pointer}
.sf-wizard .sf-picker-row:hover{background:var(--sf-fill)}
.sf-wizard .sf-picker-selected{background:var(--sf-accent-soft)}
.sf-wizard .sf-picker-name{flex:none;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-dir{flex:1 1 auto;min-width:0;font-size:var(--sf-font-xs);color:var(--dsw-alias-label-secondary,var(--sf-text-faint));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-row small{flex:none;color:var(--dsw-alias-label-secondary,var(--sf-text-faint));font-size:var(--sf-font-xs)}
.sf-wizard .sf-picker-blank{margin:0;padding:var(--sf-space-4) var(--sf-space-3);font-size:var(--sf-font-sm)}
.sf-wizard .sf-picker-foot{display:flex;align-items:center;gap:var(--sf-space-2);padding:var(--sf-space-2);border-top:1px solid var(--sf-border)}
.sf-wizard .sf-picker-foot>span{flex:1}
.sf-wizard .sf-picker-foot>button{height:var(--sf-space-6)}
.sf-wizard .sf-structure-caption{display:flex;align-items:flex-end;gap:var(--sf-space-3)}
.sf-wizard .sf-structure-caption>label{flex:none}
.sf-wizard .sf-structure-caption .sf-length-input{display:flex;align-items:center;gap:var(--sf-space-2)}
.sf-wizard .sf-structure-caption .sf-length-input>input{width:112px;text-align:right}
.sf-wizard .sf-structure-caption .sf-length-input>span{flex:none;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-structure-actions{margin-left:auto;display:flex;gap:var(--sf-space-2)}
.sf-wizard .sf-structure-actions>button{height:var(--sf-space-6)}
.sf-wizard .sf-structure-list{margin-top:var(--sf-space-4)}
.sf-wizard .sf-structure-section{display:flex;align-items:center;gap:var(--sf-space-3);padding:var(--sf-space-4) 0;border-bottom:1px solid var(--sf-border)}
.sf-wizard .sf-structure-section>.sf-section-index{flex:0 0 18px;text-align:center;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-structure-section>.sf-section-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:var(--sf-space-hair)}
.sf-wizard .sf-structure-section .sf-section-text>input{width:100%}
.sf-wizard .sf-structure-section .sf-section-text>.sf-section-purpose{height:var(--sf-space-5);border:0!important;border-radius:0;padding:0;font-size:var(--sf-font-sm);background:transparent}
.sf-wizard .sf-structure-section>.sf-section-length{flex:none;display:flex;align-items:center;gap:var(--sf-space-2)}
.sf-wizard .sf-structure-section .sf-section-length>input{width:74px;text-align:right}
.sf-wizard .sf-structure-section .sf-section-length>span{flex:none;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-structure-section>.sf-section-actions{flex:none;display:flex;gap:var(--sf-space-hair);align-items:center}
.sf-wizard .sf-section-actions button{padding:var(--sf-space-1) var(--sf-space-2)!important;border:0!important}
.sf-wizard .sf-structure-add{margin-top:var(--sf-space-4)}
.sf-material-checklist{max-height:290px;overflow:auto;border:1px solid var(--sf-border);border-radius:var(--sf-radius-lg)}
.sf-material-checklist label{display:flex;flex-direction:row;align-items:center;margin:0!important;padding:var(--sf-space-2) var(--sf-space-3);border-bottom:1px solid var(--sf-border-soft)}
.sf-material-checklist span{flex:1;overflow-wrap:anywhere}
.sf-material-checklist small{color:var(--dsw-alias-label-secondary,var(--sf-text-faint));flex:none}
.sf-material-tag{margin-left:var(--sf-space-2);padding:0 var(--sf-space-2);border-radius:var(--sf-radius-pill);background:var(--sf-accent-soft);color:var(--sf-accent-text);font-size:var(--sf-font-xs);font-style:normal}
/* Requirement sources, format choice and the merged material list (Phase 3). */
.sf-wizard .sf-field{display:flex;flex-direction:column;gap:var(--sf-space-2);margin:var(--sf-space-4) 0 0}
.sf-wizard .sf-field-label{font-size:var(--sf-font-sm);font-weight:500;color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-choice-current{margin:0;height:var(--sf-space-7);display:flex;align-items:center;padding:0 var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:var(--sf-fill);color:inherit;font-size:var(--sf-font-lg)}
.sf-wizard .sf-source-list{list-style:none;margin:0;padding:0;border:1px solid var(--sf-border);border-radius:var(--sf-radius-lg);overflow:hidden}
.sf-wizard .sf-source-row{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap;padding:var(--sf-space-2) var(--sf-space-3);border-bottom:1px solid var(--sf-border-soft)}
.sf-wizard .sf-source-row:last-child{border-bottom:0}
.sf-wizard .sf-source-badge{flex:none;padding:0 var(--sf-space-2);border-radius:var(--sf-radius-pill);background:var(--sf-fill-strong);font-size:var(--sf-font-xs);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-source-badge[data-kind=image]{background:var(--sf-warn-soft);color:var(--sf-warn-text)}
.sf-wizard .sf-source-badge[data-kind=unsupported]{background:var(--sf-danger-soft);color:var(--sf-danger)}
.sf-wizard .sf-source-badge[data-kind=external]{background:var(--sf-accent-soft-strong);color:var(--sf-accent-text)}
.sf-wizard .sf-source-name{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;font-size:var(--sf-font-md);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-source-name small{font-size:var(--sf-font-xs);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-source-action{flex:none;height:var(--sf-space-6);padding:0 var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;color:inherit;font:inherit;font-size:var(--sf-font-sm);cursor:pointer}
.sf-wizard .sf-source-members{flex:1 1 100%;list-style:none;margin:var(--sf-space-hair) 0 0;padding:0 0 0 var(--sf-space-3);font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-source-members li{display:flex;align-items:center;gap:var(--sf-space-2);padding:var(--sf-space-hair) 0}
.sf-wizard .sf-source-members button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:var(--sf-font-md);line-height:1;padding:0 var(--sf-space-1)}
.sf-wizard .sf-source-note{flex:1 1 100%;margin:var(--sf-space-1) 0 0;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-candidate{flex:1 1 100%;display:flex;flex-direction:column;gap:var(--sf-space-2);margin-top:var(--sf-space-2);padding:var(--sf-space-3);border:1px solid var(--sf-accent-border);border-radius:var(--sf-radius-lg);background:var(--sf-accent-soft)}
.sf-wizard .sf-candidate textarea{width:100%;min-height:64px;font-size:var(--sf-font-md);line-height:var(--sf-leading-body)}
.sf-wizard .sf-candidate-actions{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap}
.sf-wizard .sf-candidate-actions>button{height:var(--sf-space-6)}
.sf-wizard .sf-candidate-actions>.sf-field-hint{flex:1;margin:0;min-width:120px}
.sf-wizard .sf-material-toolbar{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap;margin:var(--sf-space-3) 0}
.sf-wizard .sf-material-toolbar>input{flex:1 1 180px;min-width:0;height:var(--sf-space-6)}
.sf-wizard .sf-material-toolbar>button{height:var(--sf-space-6);flex:none}
.sf-wizard .sf-material-count{flex:none;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-material-checklist label.sf-material-disabled{opacity:var(--sf-disabled-opacity)}
.sf-wizard .sf-picker-modes{display:flex;flex:none;gap:var(--sf-space-hair)}
.sf-wizard .sf-picker-modes button{height:var(--sf-space-6);padding:0 var(--sf-space-2);border:1px solid var(--sf-border-strong);background:transparent;color:inherit;font:inherit;font-size:var(--sf-font-sm);cursor:pointer}
.sf-wizard .sf-picker-modes button[aria-pressed=true]{background:var(--sf-accent-soft);border-color:var(--sf-accent);color:var(--sf-accent-text)}
.sf-wizard .sf-picker-note{margin:0;padding:var(--sf-space-2) var(--sf-space-3);border-top:1px solid var(--sf-border);font-size:var(--sf-font-xs);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
/* Creation confirmation, merged into step 3 rather than a fourth step (design 02 §8). */
.sf-wizard .sf-long-op{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap;margin-top:var(--sf-space-2);padding:var(--sf-space-2) var(--sf-space-3);border:1px solid var(--sf-border);border-radius:var(--sf-radius-lg);background:var(--sf-fill);font-size:var(--sf-font-sm)}
.sf-wizard .sf-long-op-dot{width:var(--sf-space-2);height:var(--sf-space-2);border-radius:50%;background:var(--sf-accent);animation:sf-op-pulse 1.4s infinite;flex:none}
.sf-wizard .sf-long-op strong{font-weight:500}
.sf-wizard .sf-long-op-count,.sf-wizard .sf-long-op-elapsed{color:var(--dsw-alias-label-secondary,var(--sf-muted));font-variant-numeric:tabular-nums}
.sf-wizard .sf-long-op-hint{flex:1 1 100%;color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
@keyframes sf-op-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.sf-wizard .sf-long-op-dot{animation:none}}
.sf-wizard .sf-member-reads{flex:1 1 100%;list-style:none;margin:var(--sf-space-2) 0 0;padding:0 0 0 var(--sf-space-3);font-size:var(--sf-font-sm)}
.sf-wizard .sf-member-reads li{display:flex;align-items:baseline;gap:var(--sf-space-2);flex-wrap:wrap;padding:var(--sf-space-1) 0;border-bottom:1px solid var(--sf-border-soft)}
.sf-wizard .sf-member-reads li:last-child{border-bottom:0}
.sf-wizard .sf-member-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-member-state{flex:none;padding:0 var(--sf-space-2);border-radius:var(--sf-radius-pill);background:var(--sf-fill-strong);color:var(--dsw-alias-label-secondary,var(--sf-muted));font-size:var(--sf-font-xs)}
.sf-wizard .sf-member-reads li[data-state=ready] .sf-member-state{background:var(--sf-ok-soft);color:var(--sf-ok)}
.sf-wizard .sf-member-reads li[data-state=failed] .sf-member-state{background:var(--sf-danger-soft);color:var(--sf-danger)}
.sf-wizard .sf-member-reads li[data-state=reading] .sf-member-state{background:var(--sf-accent-soft-strong);color:var(--sf-accent-text)}
.sf-wizard .sf-member-note{flex:1 1 100%;color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-member-actions{display:flex;gap:var(--sf-space-2);flex:none}
.sf-wizard .sf-brief,.sf-wizard .sf-outline-candidate{margin-top:var(--sf-space-3);padding:var(--sf-space-3) var(--sf-space-4);border:1px solid var(--sf-accent-border);border-radius:var(--sf-radius-xl);background:var(--sf-accent-soft)}
.sf-wizard .sf-brief h5,.sf-wizard .sf-outline-candidate h5{margin:0 0 var(--sf-space-2);font-size:var(--sf-font-sm)}
.sf-wizard .sf-brief dl{margin:0;display:flex;flex-direction:column;gap:var(--sf-space-2)}
.sf-wizard .sf-brief .sf-brief-row{display:flex;gap:var(--sf-space-2);align-items:flex-start}
.sf-wizard .sf-brief dt{flex:0 0 76px;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-brief dd{flex:1 1 auto;min-width:0;margin:0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body)}
.sf-wizard .sf-brief-origin{margin-left:var(--sf-space-2);font-style:normal;font-size:var(--sf-font-xs);padding:0 var(--sf-space-2);border-radius:var(--sf-radius-pill);background:var(--sf-fill-strong);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-brief-note,.sf-wizard .sf-brief-diff p{margin:var(--sf-space-2) 0 0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-brief-diff summary,.sf-wizard .sf-outline-candidate summary{cursor:pointer;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-brief-conflict{margin-top:var(--sf-space-2);padding:var(--sf-space-2) var(--sf-space-3);border:1px solid var(--sf-warn-border);border-radius:var(--sf-radius-lg);background:var(--sf-warn-soft);font-size:var(--sf-font-sm);line-height:var(--sf-leading-body)}
.sf-wizard .sf-brief-actions{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap;margin-top:var(--sf-space-2)}
.sf-wizard .sf-brief-actions>button{height:var(--sf-space-6)}
.sf-wizard .sf-coverage-list{margin:var(--sf-space-2) 0;padding-left:18px;font-size:var(--sf-font-sm);line-height:var(--sf-leading-prose)}
.sf-wizard .sf-outline-candidate>details p,.sf-wizard .sf-gap{margin:var(--sf-space-2) 0 0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body)}
.sf-wizard .sf-gap{color:var(--sf-warn-text)}
.sf-wizard .sf-create-summary{margin-top:var(--sf-space-4);padding:var(--sf-space-3) var(--sf-space-4);border:1px solid var(--sf-border);border-radius:var(--sf-radius-lg);background:var(--sf-fill)}
.sf-wizard .sf-create-line{display:flex;align-items:baseline;gap:var(--sf-space-3);flex-wrap:wrap}
.sf-wizard .sf-create-line strong{font-size:var(--sf-font-sm)}
.sf-wizard .sf-create-line>span{flex:1 1 240px;min-width:0;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-create-summary details{margin-top:var(--sf-space-2)}
.sf-wizard .sf-create-summary p{margin:var(--sf-space-2) 0 0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-confirm{display:none}
.sf-wizard .sf-confirm h4{margin:0 0 var(--sf-space-2);font-size:var(--sf-font-md);font-weight:600}
.sf-wizard .sf-confirm dl{margin:0;display:flex;flex-direction:column;gap:var(--sf-space-2)}
.sf-wizard .sf-confirm dl>div{display:flex;gap:var(--sf-space-3);align-items:flex-start}
.sf-wizard .sf-confirm dt{flex:0 0 88px;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-confirm dd{flex:1 1 auto;min-width:0;margin:0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body)}
.sf-wizard .sf-confirm details{margin-top:var(--sf-space-1)}
.sf-wizard .sf-confirm summary{cursor:pointer;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-confirm ul{margin:var(--sf-space-2) 0 0;padding-left:18px;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-confirm p{margin:var(--sf-space-2) 0 0;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-text-faint))}
.sf-wizard .sf-wizard-issues{list-style:none;margin:var(--sf-space-4) 0 0;padding:var(--sf-space-3) var(--sf-space-4);border:1px solid var(--sf-danger-border);border-radius:var(--sf-radius-lg);background:var(--sf-danger-soft);color:var(--sf-danger);font-size:var(--sf-font-sm);line-height:var(--sf-leading-prose)}
.sf-wizard .sf-wizard-issues li+li{margin-top:var(--sf-space-1)}
.sf-wizard .sf-wizard-step-compact{display:none;margin:var(--sf-space-4) 0 0;font-size:var(--sf-font-md);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-wizard-clear{float:right;margin-left:var(--sf-space-3);height:var(--sf-space-6);padding:0 var(--sf-space-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;color:var(--dsw-alias-label-secondary,var(--sf-muted));font:inherit;font-size:var(--sf-font-sm);cursor:pointer}
.sf-online-choice{flex-direction:row!important;align-items:center;padding:var(--sf-space-4);border-radius:var(--sf-radius-lg);background:var(--sf-accent-soft);margin-top:var(--sf-space-4)!important}
.sf-online-choice span{display:flex;flex-direction:column;gap:var(--sf-space-1)}
.sf-online-choice small{color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-wizard .sf-structure-caption .sf-online-choice{height:var(--sf-space-7);box-sizing:border-box;padding:0 var(--sf-space-3);margin-top:0!important}
.sf-wizard .sf-section-actions>button{width:var(--sf-space-6);padding:0}
.sf-wizard-summary{padding:var(--sf-space-4);background:var(--sf-fill);border-radius:var(--sf-radius-lg);font-size:var(--sf-font-sm)}
.sf-wizard-footer{display:flex;align-items:center;gap:var(--sf-space-3);padding-top:var(--sf-space-5)}
.sf-wizard-footer>span{flex:1}
.sf-wizard-footer .sf-primary{height:var(--sf-space-7);padding:0 var(--sf-space-5);font-size:var(--sf-font-lg)}
.sf-primary{background:var(--sf-accent)!important;border-color:var(--sf-accent)!important;color:var(--sf-on-accent)!important}
.sf-wizard-error{color:var(--sf-danger)!important}
.sf-wizard button{cursor:pointer}
.sf-wizard button:disabled{opacity:var(--sf-disabled-opacity);cursor:default}
@keyframes sf-step-forward{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:translateX(0)}}
@keyframes sf-step-back{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
@media(prefers-reduced-motion:reduce){.sf-wizard-page[data-direction]{animation:none}}
@media(max-width:720px){.sf-wizard{padding:var(--sf-space-5)}.sf-wizard-row{grid-template-columns:1fr}.sf-wizard-steps{gap:var(--sf-space-3)}.sf-wizard .sf-structure-caption{flex-wrap:wrap}.sf-wizard .sf-structure-actions{margin-left:0}
.sf-wizard .sf-material-checklist{max-height:none}
.sf-wizard .sf-structure-list{max-height:none}
/* At 200% zoom the CSS viewport halves and this is the touch case design 05 §9 sets a 44px
   floor for, so selects and text inputs join the buttons. */
.sf-wizard button,.sf-wizard select,.sf-wizard input:not([type=checkbox]),.sf-wizard textarea{min-height:44px}
.sf-wizard .sf-wizard-steps{display:none}
.sf-wizard .sf-wizard-step-compact{display:block}
.sf-wizard .sf-structure-section{flex-wrap:wrap}
.sf-wizard .sf-structure-section>.sf-section-text{flex:1 1 100%}}
`
