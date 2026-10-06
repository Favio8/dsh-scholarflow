import React, { useEffect, useState } from 'react'
import { creationSpec, presetSections, type CreationSpec } from '../shared/writing-task.ts'
import { allocate } from '../core/presets/allocation.ts'
import { sectionsFromPreset, selectionFromPreset } from '../core/presets/apply.ts'
import { FORMAT_LABELS, TYPE_LABELS } from './paper-workspace.tsx'
import { PresetPicker } from './preset-picker.tsx'

const splitPath = (path: string) => {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? { name: path, dir: '工作区根目录' } : { name: path.slice(cut + 1), dir: path.slice(0, cut) }
}

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
function RequirementPicker({ files, disabled, scanning, onPick, onRescan }: any) {
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
      <div className="sf-picker-foot"><span /><button type="button" onClick={() => setOpen(false)}>完成</button></div>
      <p className="sf-picker-note">工作区外的文件需要宿主选择器，尚未通过验证，因此这里只列当前工作区。</p>
    </div>}
  </div>
}

export function CreationWizard({ scope, api, context, onCreated, workspaceTitle, defaults }: any) {
  const key = `scholarflow:creation:${scope}`
  const initial: CreationSpec = { title: '', type: defaults?.defaultProjectType ?? 'course-paper', language: defaults?.language === 'en' ? 'en' : 'zh-CN',
    format: 'docx', requirements: '', requirementSources: [], materials: [], online: false, targetLength: 4000,
    countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 },
    sections: presetSections(defaults?.defaultProjectType ?? 'course-paper', 4000), manuscriptDir: 'manuscript' }
  const [saved] = useState(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } })
  const [spec, setSpec] = useState<CreationSpec>(saved?.spec ?? initial), [step, setStep] = useState(saved?.step ?? 0)
  const [files, setFiles] = useState<any[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false)
  const [scanning, setScanning] = useState(false), [truncated, setTruncated] = useState(false)
  const [materialQuery, setMaterialQuery] = useState('')
  const [presetOpen, setPresetOpen] = useState(false)
  const [issues, setIssues] = useState<string[]>([])
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const sync = () => setNarrow(query.matches)
    sync(); query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  const [recognition, setRecognition] = useState<Record<string, { state: 'idle' | 'running' | 'pending' | 'confirmed' | 'unavailable'; text?: string; note?: string }>>({})
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
  useEffect(() => { void loadFiles(!saved) }, [key])
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
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (error) { setError((error as Error).message) } finally { setBusy(false) } }
  // Requirement sources stand on their own: they are never merged into the materials
  // list, and extraction reads them under their own authorisation (SPEC v1.1 §7).
  const readySpec = () => ({ ...spec, title: spec.title.trim() || spec.requirements.trim().split('\n')[0].slice(0, 60) })
  const suggest = async (structure: boolean) => {
    const result = await api('creation.suggest', { context: context(), spec: { ...readySpec(), title: readySpec().title || '待确定论文题目', requirements: spec.requirements.trim() || '根据所选要求来源提取写作要求。' } })
    update({ title: spec.title.trim() || result.title, ...(structure ? { sections: result.sections } : { requirements: result.requirements }) })
  }
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
  // Recognition is a model call, so it stays user-triggered and reports why it cannot run
  // yet instead of failing silently (SPEC v1.1 §2 V4 is still unverified).
  const identify = (resourceId: string) => setRecognition(previous => ({ ...previous, [resourceId]: { state: 'unavailable' as const,
    note: '图片识别需要模型具备图片输入能力，尚未通过验证。可以先把截图中的要求粘贴到写作要求里，来源登记会保留。' } }))
  const requirementRows = spec.requirementSources.map(source => {
    const shown = splitPath(source.path ?? ''), kind = source.kind === 'folder' ? 'folder' : requirementKind(source.path ?? '')
    const status = recognition[source.resourceId]
    return <li key={source.resourceId} className="sf-source-row">
      <span className="sf-source-badge" data-kind={kind}>{source.kind === 'folder' ? '文件夹' : REQUIREMENT_KIND_LABEL[kind as keyof typeof REQUIREMENT_KIND_LABEL]}</span>
      <span className="sf-source-name">{shown.name}<small>{shown.dir}</small></span>
      {kind === 'image' && <button type="button" className="sf-source-action" disabled={busy} onClick={() => identify(source.resourceId)}>{status?.state === 'confirmed' ? '重新识别' : '识别文字'}</button>}
      <button type="button" className="sf-source-action" onClick={() => removeSource(source.resourceId)}>移除</button>
      {source.kind === 'folder' && <ul className="sf-source-members">{source.members.map(member => <li key={member.name}>
        <span>{member.name}</span><button type="button" aria-label={`移除 ${member.name}`} onClick={() => removeMember(source.resourceId, member.name)}>×</button></li>)}</ul>}
      {status?.note && <p className="sf-source-note" role="status">{status.note}</p>}
    </li> })
  const readable = files.filter((file: any) => file.supported)
  const attachments = files.filter((file: any) => !file.supported && requirementKind(file.relativePath) === 'image')
  const materialNeedle = materialQuery.trim().toLowerCase()
  const visibleFiles = materialNeedle ? files.filter((file: any) => file.relativePath.toLowerCase().includes(materialNeedle)) : files
  const moveSection = (index: number, direction: number) => {
    const sections = [...spec.sections], target = index + direction
    if (target < 0 || target >= sections.length) return
    ;[sections[index], sections[target]] = [sections[target], sections[index]]; editSections(sections)
  }
  // Applying is atomic: the type (when the preset belongs to another one) and the
  // structure change together, after the caller confirmed once (design 02 §7).
  const applyPreset = (preset: any, switching: boolean) => {
    update({ ...(switching ? { type: preset.paperType } : {}), sections: sectionsFromPreset(preset, spec.language, spec.targetLength),
      preset: selectionFromPreset(preset) })
    setPresetOpen(false)
  }
  const sectionKey = (id: string) => ('k-' + id.toLowerCase().replace(/[^a-z0-9-]/g, '-')).slice(0, 64)
  // Saving stores the structure only: shares are derived on the host, so the paper's
  // absolute lengths and title never enter the global library.
  const structureForPreset = () => ({ title: spec.title.trim() || '未命名结构', summary: '按当前论文结构保存', paperType: spec.type,
    sections: spec.sections.map(section => ({ key: sectionKey(section.id), title: section.title,
      focus: section.purpose.trim() || '（尚未填写写作重点）', targetLength: section.targetLength })),
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
    '排版要求（字体、行距、页数、封面）暂未支持',
    ...(spec.requirementSources.some(source => requirementKind(source.path ?? '') === 'image') ? ['图片文字识别尚未验证，需要手动补充'] : []),
    ...(spec.requirementSources.some(source => source.origin === 'external') ? ['工作区外来源的读取尚未验证'] : []),
  ]
  return <div className="sf-wizard-scroll"><section className="sf-wizard" aria-label="创建论文向导">
    <header><span className="sf-wizard-eyebrow">{workspaceTitle}</span><h2>开始一篇论文</h2><p>确定要求与资料，我们一起完成初稿。</p>
      <button className="sf-wizard-clear" disabled={busy} onClick={clearDraft}>清除草稿</button></header>
    <p className="sf-wizard-step-compact" aria-current="step">第 {step + 1} 步 / 共 3 步 · {["写作要求", "资料范围", "行文结构"][step]}</p>
    <nav className="sf-wizard-steps" aria-label="创建步骤">{['写作要求', '资料范围', '行文结构'].map((title, index) => <button key={title} disabled={busy || index > step} aria-current={step === index ? 'step' : undefined}
      onClick={() => setStep(index)}><span>{index + 1}</span>{title}</button>)}</nav>
    <div className="sf-wizard-page" key={step}>
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
            <RequirementPicker files={files} disabled={busy} scanning={scanning} onPick={addSource} onRescan={() => loadFiles(false)} />
            <button className="sf-assignment-extract" disabled={busy || (!spec.requirements.trim() && !spec.requirementSources.length)} onClick={() => act(() => suggest(false))}>整理要求</button>
          </div>
          <p className="sf-field-hint">要求来源规定这篇论文该怎么写；第二步的论文参考材料提供写作所需的资料。两者独立选择，互不要求对方包含自己。文件保持原样，只在整理或写作时读取。</p>
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
            <button disabled={busy} onClick={() => act(() => suggest(true))}>AI 完善结构</button>
          </div>
        </div>
        <p className="sf-field-hint">当前预设：{spec.preset ? `${spec.preset.id}（${spec.preset.source === 'builtin' ? '内置' : '我的'}${spec.preset.modified ? ' · 已修改' : ''}）` : '尚未选择'}
          ，计划合计 {allocationPlan.total} / {spec.targetLength}。手工章节保持原值，其余按建议比例分配；比例只是起点，任何一项都可以改。</p>
        {allocationPlan.notes.map(note => <p className="sf-field-hint" key={note} role="status">{note}</p>)}
        <div className="sf-structure-list">{spec.sections.map((section, index) => <div className="sf-structure-section" key={section.id}>
          <span className="sf-section-index">{index + 1}</span>
          <div className="sf-section-text">
            <input id={`sf-section-title-${index}`} className="sf-section-title" aria-label={`第${index + 1}章标题`} placeholder="章节标题" value={section.title} onChange={e => editSections(spec.sections.map(row => row.id === section.id ? { ...row, title: e.target.value } : row))} />
            <input className="sf-section-purpose" aria-label={`第${index + 1}章写作内容`} placeholder="本节写什么（可选）" value={section.purpose} onChange={e => editSections(spec.sections.map(row => row.id === section.id ? { ...row, purpose: e.target.value } : row))} />
          </div>
          <div className="sf-section-length"><input aria-label={`第${index + 1}章篇幅`} type="number" min={50} value={section.targetLength}
            onChange={e => editSections(spec.sections.map(row => row.id === section.id ? { ...row, targetLength: Number(e.target.value), allocationMode: 'manual' } : row))} />
            <span>{spec.language === 'en' ? '词' : '字'} · {section.allocationMode === 'auto' ? '自动' : '手工'}</span></div>
          <div className="sf-section-actions"><button aria-label="上移章节" disabled={index === 0} onClick={() => moveSection(index, -1)}>↑</button><button aria-label="下移章节" disabled={index === spec.sections.length - 1} onClick={() => moveSection(index, 1)}>↓</button><button aria-label="删除章节" disabled={spec.sections.length === 1} onClick={() => editSections(spec.sections.filter(row => row.id !== section.id))}>×</button></div>
        </div>)}</div>
        <div className="sf-structure-actions" style={{ marginTop: 14 }}>
          <button onClick={() => editSections([...spec.sections, { id: `section_${crypto.randomUUID().replaceAll('-', '')}`, title: '新章节', purpose: '', targetLength: 500, allocationMode: 'auto' }])}>+ 添加章节</button>
          <button disabled={busy || !history.length} onClick={undoStructure}>撤销结构编辑</button>
          <button disabled={busy || !spec.sections.every(section => section.title.trim())} onClick={() => act(async () => {
            const name = window.prompt('预设名称', spec.title.trim() || '我的结构'); if (!name?.trim()) return
            await api('presets.save', { ...structureForPreset(), title: name.trim() }) })}>保存为我的预设</button>
          {spec.preset?.source === 'user' && <button disabled={busy} onClick={() => act(async () => {
            if (!window.confirm('用当前结构更新这个预设？已有论文不受影响。')) return
            await api('presets.update', { ...structureForPreset(), id: spec.preset!.id, expectedVersion: spec.preset!.version }) })}>更新此预设</button>}
        </div>
        <section className="sf-confirm" aria-label="创建前确认">
          <h4>创建前确认</h4>
          <dl>
            <div><dt>论文与结构</dt><dd>{spec.title.trim() || '（创建前必须填写题目）'} · {TYPE_LABELS[spec.type]} · {spec.language === 'en' ? 'English' : '中文'} ·
              {spec.targetLength} {spec.language === 'en' ? '词' : '汉字'}（正文{spec.countingPolicy.includeAbstract ? '含摘要' : '不含摘要'}） ·
              {spec.sections.length} 章 · 计划合计 {allocationPlan.total} · 预设 {spec.preset ? `${spec.preset.id}${spec.preset.modified ? '（已修改）' : ''}` : '未选择'}</dd></div>
            <div><dt>资料</dt><dd>要求来源 {spec.requirementSources.length} · 参考材料 {spec.materials.length}
              <details><summary>查看实际授权集合（{approvedPaths.length} 项）</summary>
                <ul>{approvedPaths.map(path => <li key={path}>{path}</li>)}</ul>
                {spec.requirementSources.some(source => source.origin === 'external') && <p>外部来源按句柄记录，不写入项目相对路径。</p>}</details></dd></div>
            <div><dt>输出</dt><dd>将新增 {spec.manuscriptDir}/ 与 .scholarflow/；已有同名文件时会在提交前提示，不会覆盖。</dd></div>
            <div><dt>外部处理</dt><dd>模型：当前会话在输入框中选择的模型 · 联网：{spec.online ? '开启（Crossref 核验元数据，必要时取公开全文）' : '关闭'}。
              本地保存不等于本地模型：联网与模型调用都会把选定范围发送出去。</dd></div>
            <div><dt>预算</dt><dd>模型调用上限 {defaults?.maxModelCalls ?? '按插件设置'}（来自插件设置，可在「ScholarFlow 设置」中修改）；检索次数与时限按项目默认。</dd></div>
            <div><dt>文风与能力</dt><dd>使用项目默认的写作 Profile 与已启用 Skill；可在项目概览中查看与调整生效项。</dd></div>
            <div><dt>能力缺口</dt><dd>{capabilityGaps.join('；')}。这些会作为要求保留，不会被当作已满足。</dd></div>
          </dl>
        </section>
        {conflict && <label>论文输出目录<input value={spec.manuscriptDir} onChange={e => update({ manuscriptDir: e.target.value })} /><small>此处已有文件，请选择新的输出目录。</small></label>}
      </>}
    </div>
    {error && <p className="sf-wizard-error" role="alert">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}
    {issues.length > 0 && <ul className="sf-wizard-issues" role="alert">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <footer className="sf-wizard-footer">{step > 0 && <button disabled={busy} onClick={() => setStep(step - 1)}>← 上一步</button>}<span />
      {step < 2 ? <button className="sf-primary" disabled={busy} onClick={() => {
        // The control stays reachable: a greyed-out button tells the user nothing
        // (design 02 §9). Clicking reports what is missing and focuses the first field.
        if (step === 0 && !spec.requirements.trim() && !spec.requirementSources.length) {
          setIssues(['请填写写作要求，或添加至少一个要求来源。'])
          document.getElementById('sf-field-requirements')?.focus(); return
        }
        if (step === 1 && spec.sections.every(row => !row.purpose)) act(async () => { setStep(2); await suggest(true) }); else setStep(step + 1) }}>下一步 →</button>
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
  </section></div>
}

export const WIZARD_CSS = `.sf-wizard-scroll{overflow:auto;flex:1;background:var(--dsw-alias-bg-layer-1,#fafbfc);padding:36px 24px}
.sf-wizard{max-width:760px;margin:0 auto;padding:30px 36px;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8882;border-radius:16px;box-shadow:0 8px 32px #00000005;font-size:14px}
.sf-wizard h2{font-size:24px;margin:8px 0}
.sf-wizard h3{font-size:16px;margin:0}
.sf-wizard p,.sf-muted{color:var(--dsw-alias-label-secondary,#727780);line-height:1.65}
.sf-wizard-eyebrow{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}
.sf-wizard label,.sf-wizard .sf-assignment-field{display:flex;flex-direction:column;gap:8px;font-size:13px;margin:16px 0 0}
.sf-wizard input:not([type=checkbox]),.sf-wizard select{height:40px;width:100%;padding:0 10px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit}
.sf-wizard textarea{font-size:14px;line-height:1.7}
.sf-field-hint{margin:6px 0 0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard-steps{display:flex;gap:20px;padding:22px 0;border-bottom:1px solid #8882;margin-bottom:20px}
.sf-wizard-steps button{border:0!important;padding:0!important;display:flex;align-items:center;gap:8px;color:#858a92!important}
.sf-wizard-steps span{display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#8881}
.sf-wizard-steps [aria-current=step]{color:#4475e7!important}
.sf-wizard-steps [aria-current=step] span{background:#4475e7;color:#fff}
.sf-wizard-page{animation:sf-wizard-enter .22s ease-out}
.sf-wizard-row{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px}
.sf-wizard .sf-assignment-row{display:flex;align-items:flex-end;gap:12px}
.sf-wizard .sf-assignment-row>.sf-assignment-field{flex:1 1 auto;min-width:0}
.sf-wizard .sf-assignment-row>.sf-assignment-extract{flex:none;height:40px}
.sf-wizard .sf-picker{position:relative}
.sf-wizard .sf-picker-toggle{display:flex;align-items:center;gap:10px;width:100%;height:40px;padding:0 10px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit;text-align:left;cursor:pointer}
.sf-wizard .sf-picker-current{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;line-height:1.3}
.sf-wizard .sf-picker-current strong{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-current small{font-size:11px;color:var(--dsw-alias-label-secondary,#8b9099);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-current em{font-style:normal;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard .sf-picker-caret{flex:none;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard .sf-picker-panel{margin-top:6px;border:1px solid #8882;border-radius:9px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 10px 28px #00000012;overflow:hidden}
.sf-wizard .sf-picker-search{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #8882}
.sf-wizard .sf-picker .sf-picker-search>input{flex:1 1 auto;min-width:0;width:auto;height:32px}
.sf-wizard .sf-picker-search>button{flex:none;height:32px}
.sf-wizard .sf-picker-list{max-height:230px;overflow:auto}
.sf-wizard .sf-picker-row{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:0!important;border-bottom:1px solid #8881!important;border-radius:0!important;background:transparent;color:inherit;text-align:left;cursor:pointer}
.sf-wizard .sf-picker-row:hover{background:#8881}
.sf-wizard .sf-picker-selected{background:#4475e714}
.sf-wizard .sf-picker-name{flex:none;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-dir{flex:1 1 auto;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-secondary,#8b9099);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-picker-row small{flex:none;color:var(--dsw-alias-label-secondary,#9aa0a8);font-size:11px}
.sf-wizard .sf-picker-blank{margin:0;padding:16px 12px;font-size:12px}
.sf-wizard .sf-picker-foot{display:flex;align-items:center;gap:8px;padding:10px;border-top:1px solid #8882}
.sf-wizard .sf-picker-foot>span{flex:1}
.sf-wizard .sf-picker-foot>button{height:32px}
.sf-wizard .sf-structure-caption{display:flex;align-items:flex-end;gap:12px}
.sf-wizard .sf-structure-caption>label{flex:none}
.sf-wizard .sf-structure-caption .sf-length-input{display:flex;align-items:center;gap:8px}
.sf-wizard .sf-structure-caption .sf-length-input>input{width:112px;text-align:right}
.sf-wizard .sf-structure-caption .sf-length-input>span{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard .sf-structure-actions{margin-left:auto;display:flex;gap:8px}
.sf-wizard .sf-structure-actions>button{height:36px}
.sf-wizard .sf-structure-list{margin-top:16px}
.sf-wizard .sf-structure-section{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid #8882}
.sf-wizard .sf-structure-section>.sf-section-index{flex:0 0 18px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.sf-wizard .sf-structure-section>.sf-section-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.sf-wizard .sf-structure-section .sf-section-text>input{width:100%}
.sf-wizard .sf-structure-section .sf-section-text>.sf-section-purpose{height:24px;border:0!important;border-radius:0;padding:0;font-size:12px;background:transparent}
.sf-wizard .sf-structure-section>.sf-section-length{flex:none;display:flex;align-items:center;gap:6px}
.sf-wizard .sf-structure-section .sf-section-length>input{width:74px;text-align:right}
.sf-wizard .sf-structure-section .sf-section-length>span{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.sf-wizard .sf-structure-section>.sf-section-actions{flex:none;display:flex;gap:2px;align-items:center}
.sf-wizard .sf-section-actions button{padding:4px 7px!important;border:0!important}
.sf-wizard .sf-structure-add{margin-top:14px}
.sf-material-checklist{max-height:290px;overflow:auto;border:1px solid #8882;border-radius:9px}
.sf-material-checklist label{display:flex;flex-direction:row;align-items:center;margin:0!important;padding:10px 12px;border-bottom:1px solid #8881}
.sf-material-checklist span{flex:1;overflow-wrap:anywhere}
.sf-material-checklist small{color:var(--dsw-alias-label-secondary,#999);flex:none}
.sf-material-tag{margin-left:8px;padding:1px 6px;border-radius:999px;background:#4475e714;color:#4475e7;font-size:11px;font-style:normal}
/* Requirement sources, format choice and the merged material list (Phase 3). */
.sf-wizard .sf-field{display:flex;flex-direction:column;gap:8px;margin:16px 0 0}
.sf-wizard .sf-field-label{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-secondary,#727780)}
.sf-wizard .sf-choice-current{margin:0;height:40px;display:flex;align-items:center;padding:0 10px;border:1px solid #8884;border-radius:7px;background:#8881;color:inherit;font-size:14px}
.sf-wizard .sf-source-list{list-style:none;margin:0;padding:0;border:1px solid #8882;border-radius:9px;overflow:hidden}
.sf-wizard .sf-source-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 12px;border-bottom:1px solid #8881}
.sf-wizard .sf-source-row:last-child{border-bottom:0}
.sf-wizard .sf-source-badge{flex:none;padding:1px 7px;border-radius:999px;background:#8882;font-size:11px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-wizard .sf-source-badge[data-kind=image]{background:#e8a33d22;color:#a5701f}
.sf-wizard .sf-source-badge[data-kind=unsupported]{background:#d4515122;color:#b04a4a}
.sf-wizard .sf-source-name{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-wizard .sf-source-name small{font-size:11px;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard .sf-source-action{flex:none;height:28px;padding:0 9px;border:1px solid #8884;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.sf-wizard .sf-source-members{flex:1 1 100%;list-style:none;margin:2px 0 0;padding:0 0 0 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-wizard .sf-source-members li{display:flex;align-items:center;gap:8px;padding:2px 0}
.sf-wizard .sf-source-members button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0 4px}
.sf-wizard .sf-source-note{flex:1 1 100%;margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard .sf-material-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}
.sf-wizard .sf-material-toolbar>input{flex:1 1 180px;min-width:0;height:34px}
.sf-wizard .sf-material-toolbar>button{height:34px;flex:none}
.sf-wizard .sf-material-count{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-wizard .sf-material-checklist label.sf-material-disabled{opacity:.6}
.sf-wizard .sf-picker-modes{display:flex;flex:none;gap:2px}
.sf-wizard .sf-picker-modes button{height:32px;padding:0 10px;border:1px solid #8884;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.sf-wizard .sf-picker-modes button[aria-pressed=true]{background:#4475e714;border-color:#4475e7;color:#4475e7}
.sf-wizard .sf-picker-note{margin:0;padding:8px 12px;border-top:1px solid #8882;font-size:11.5px;color:var(--dsw-alias-label-secondary,#8b9099)}
/* Creation confirmation, merged into step 3 rather than a fourth step (design 02 §8). */
.sf-wizard .sf-confirm{margin-top:22px;padding:16px 18px;border:1px solid #8882;border-radius:10px;background:#8881}
.sf-wizard .sf-confirm h4{margin:0 0 10px;font-size:13px;font-weight:600}
.sf-wizard .sf-confirm dl{margin:0;display:flex;flex-direction:column;gap:10px}
.sf-wizard .sf-confirm dl>div{display:flex;gap:12px;align-items:flex-start}
.sf-wizard .sf-confirm dt{flex:0 0 88px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-wizard .sf-confirm dd{flex:1 1 auto;min-width:0;margin:0;font-size:12.5px;line-height:1.6}
.sf-wizard .sf-confirm details{margin-top:4px}
.sf-wizard .sf-confirm summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard .sf-confirm ul{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-wizard .sf-confirm p{margin:6px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary,#8b9099)}
.sf-wizard .sf-wizard-issues{list-style:none;margin:14px 0 0;padding:10px 14px;border:1px solid #d4515155;border-radius:9px;background:#d451510f;color:#b04a4a;font-size:12.5px;line-height:1.7}
.sf-wizard .sf-wizard-issues li+li{margin-top:4px}
.sf-wizard .sf-wizard-step-compact{display:none;margin:16px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-wizard .sf-wizard-clear{margin-left:auto;height:30px;padding:0 10px;border:1px solid #8884;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#727780);font:inherit;font-size:12px;cursor:pointer}
.sf-online-choice{flex-direction:row!important;align-items:center;padding:15px;border-radius:9px;background:#4475e708;margin-top:18px!important}
.sf-online-choice span{display:flex;flex-direction:column;gap:4px}
.sf-online-choice small{color:var(--dsw-alias-label-secondary,#888)}
.sf-wizard-summary{padding:14px;background:#88805;border-radius:8px;font-size:12px}
.sf-wizard-footer{display:flex;align-items:center;gap:12px;padding-top:22px}
.sf-wizard-footer>span{flex:1}
.sf-primary{background:#4778e8!important;border-color:#4778e8!important;color:white!important}
.sf-wizard-error{color:#d45151!important}
.sf-wizard button{cursor:pointer}
.sf-wizard button:disabled{opacity:.45;cursor:default}
@keyframes sf-wizard-enter{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:translateX(0)}}
@media(prefers-reduced-motion:reduce){.sf-wizard-page{animation:none}}
@media(max-width:720px){.sf-wizard{padding:20px}.sf-wizard-row{grid-template-columns:1fr}.sf-wizard-steps{gap:12px}.sf-wizard .sf-structure-caption{flex-wrap:wrap}.sf-wizard .sf-structure-actions{margin-left:0}
.sf-wizard .sf-material-checklist{max-height:none}
.sf-wizard .sf-structure-list{max-height:none}
.sf-wizard button{min-height:44px}
.sf-wizard .sf-wizard-steps{display:none}
.sf-wizard .sf-wizard-step-compact{display:block}
.sf-wizard .sf-structure-section{flex-wrap:wrap}
.sf-wizard .sf-structure-section>.sf-section-text{flex:1 1 100%}}
`
