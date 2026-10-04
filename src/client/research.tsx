import React, { useState } from 'react'
import { OnlineResearch } from './online-research.tsx'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function Research({ project, context, api, refresh, run, busy }: Props) {
  const [files, setFiles] = useState<any[]>([])
  const [directory, setDirectory] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const [selected, setSelected] = useState('')
  const [role, setRole] = useState('paper')
  const [materialId, setMaterialId] = useState('')
  const [parsed, setParsed] = useState<any>()
  const [blockIndex, setBlockIndex] = useState(0)
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceAuthors, setSourceAuthors] = useState('')
  const [sourceDoi, setSourceDoi] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [claimText, setClaimText] = useState('')
  const [scope, setScope] = useState('')
  const [evidenceId, setEvidenceId] = useState('')
  const [relation, setRelation] = useState('background')
  const [rationale, setRationale] = useState('')
  const [limitations, setLimitations] = useState('')
  const materials = Object.values(project.ledger.materials) as any[]
  const sources = Object.values(project.ledger.sources) as any[]
  const evidence = Object.values(project.ledger.evidence) as any[]
  const block = parsed?.blocks[blockIndex]
  const scan = (offset = 0) => run(async () => {
    const result = await api('materials.scan', { context: context(), ...(directory && { directory }), cursor: offset, limit: 50 })
    setFiles(result.files); setCursor(result.nextCursor); setSelected('')
  })
  const load = (id: string) => run(async () => { setMaterialId(id); setParsed(undefined); setBlockIndex(0); setParsed(await api('materials.read', { context: context(), materialId: id })) })
  const locate = (locator: any) => locator.kind === 'text' ? `第 ${locator.lineStart}–${locator.lineEnd} 行` : locator.kind === 'pdf' ? `物理页 ${locator.pageNumber}` : `段落 ${locator.paragraphIndex}`
  return <section aria-label="资料与证据"><h3>资料、来源与证据</h3>
    <p>文件清单只读取路径、类型与大小。确认登记后逐份解析；资料文字作为研究数据，不构成插件操作指令。</p>
    <label>资料目录（相对工作区，留空为根目录）<input aria-label="资料目录" value={directory} onChange={e => setDirectory(e.target.value)} /></label>
    <button disabled={busy} onClick={() => scan()}>列出可选资料</button>
    {cursor !== null && <button disabled={busy} onClick={() => scan(cursor)}>下一页资料</button>}
    {!!files.length && <><label>选择本地资料<select aria-label="选择本地资料" disabled={busy} value={selected} onChange={e => setSelected(e.target.value)}><option value="">请选择</option>
      {files.filter(file => file.type === 'file').map(file => <option key={file.relativePath} value={file.relativePath}>{file.relativePath} ({file.sizeBytes} bytes)</option>)}</select></label>
      {files.filter(file => file.type === 'directory').map(file => <button key={file.relativePath} disabled={busy} onClick={() => { setDirectory(file.relativePath); setFiles([]); setCursor(null) }}>{file.relativePath}/</button>)}
      <label>资料角色<select aria-label="资料角色" disabled={busy} value={role} onChange={e => setRole(e.target.value)}><option value="paper">论文</option><option value="assignment">作业要求</option><option value="rubric">评分标准</option><option value="notes">笔记</option><option value="data">结果数据</option><option value="code">代码（不执行）</option><option value="other">其他</option></select></label>
      <button disabled={busy || !selected} onClick={() => run(async () => { const result = await api('materials.register', { context: context(), relativePath: selected, role }); setMaterialId(result.material.id); setParsed(undefined); await refresh() })}>确认登记所选资料</button></>}
    <label>已登记资料<select aria-label="已登记资料" value={materialId} onChange={e => { setMaterialId(e.target.value); setParsed(undefined); setBlockIndex(0) }}><option value="">请选择</option>
      {materials.map(material => <option key={material.id} value={material.id}>{material.projectRelativePath} · {material.parseStatus}</option>)}</select></label>
    <label>解析范围（PDF 物理页；TXT/MD 行或 DOCX 段落；留空使用默认范围）<input aria-label="解析起点" type="number" min="1" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} /> – <input aria-label="解析终点" type="number" min="1" value={rangeTo} onChange={e => setRangeTo(e.target.value)} /></label>
    <button disabled={busy || !materialId} onClick={() => run(async () => {
      if (!!rangeFrom !== !!rangeTo) throw new Error('请同时填写解析起点和终点。')
      const material = project.ledger.materials[materialId]
      const result = await api('materials.parse', { context: context(), materialId, ...(rangeFrom && { range: { kind: material.mediaType === 'application/pdf' ? 'pages' : 'paragraphs', from: Number(rangeFrom), to: Number(rangeTo) } }) })
      setParsed(result.parsed); setBlockIndex(0); await refresh()
    })}>解析所选资料</button>
    <button disabled={busy || !materialId} onClick={() => load(materialId)}>查看已解析内容</button>
    {parsed && <><p role="status">{parsed.coverage === 'complete' ? '所列范围已解析' : '部分解析'} · {parsed.blocks.length} 个文本单元</p>
      {parsed.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}
      {!!parsed.unprocessedContent.length && <p>未核验内容：{parsed.unprocessedContent.join('、')}</p>}
      <label>原文定位<select aria-label="原文定位" value={blockIndex} onChange={e => setBlockIndex(Number(e.target.value))}>{parsed.blocks.map((block: any, i: number) => <option key={i} value={i}>{locate(block.locator)}</option>)}</select></label>
      {block && <blockquote aria-label="定位原文"><pre>{block.text}</pre></blockquote>}
    </>}
    <h4>来源元数据</h4><p>登记来源不会自动证明出版身份或论点支持关系。作者与 DOI 均来自你的输入，未做独立核验。</p>
    <label>来源标题<input aria-label="来源标题" value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} /></label>
    <label>作者（每行一位）<textarea aria-label="来源作者" value={sourceAuthors} onChange={e => setSourceAuthors(e.target.value)} /></label>
    <label>DOI（可留空）<input aria-label="来源 DOI" value={sourceDoi} onChange={e => setSourceDoi(e.target.value)} /></label>
    <button disabled={busy || !sourceTitle.trim() || !parsed?.blocks.length} onClick={() => run(async () => {
      const result = await api('sources.register', { context: context(), source: { title: sourceTitle.trim(), kind: 'paper', authors: sourceAuthors.split('\n').filter(name => name.trim()).map(name => ({ literal: name.trim() })), identifiers: sourceDoi ? { doi: sourceDoi } : {}, materialId } })
      setSourceId(result.source.id); await refresh()
    })}>登记该资料的来源</button>
    <label>来源<select aria-label="来源" value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">请选择</option>{sources.map(source => <option key={source.id} value={source.id}>{source.title} · {source.identity.status} · [@{source.citeKey}]</option>)}</select></label>
    <OnlineResearch project={project} sourceId={sourceId} context={context} api={api} refresh={refresh} run={run} busy={busy} />
    <button disabled={busy || !block || !sourceId || project.ledger.sources[sourceId]?.materialId !== materialId} onClick={() => run(async () => {
      const result = await api('evidence.confirm', { context: context(), sourceId, sourceContentHash: parsed.sourceContentHash, locator: block.locator, excerpt: block.text, kind: 'quotation' })
      setEvidenceId(result.evidence.id); await refresh()
    })}>确认当前定位原文为证据</button>
    <h4>建立论点及支持范围</h4>
    <label>论点<textarea aria-label="论点" value={claimText} onChange={e => setClaimText(e.target.value)} /></label>
    <label>适用范围<input aria-label="论点适用范围" value={scope} onChange={e => setScope(e.target.value)} /></label>
    <label>关联证据<select aria-label="关联证据" value={evidenceId} onChange={e => setEvidenceId(e.target.value)}><option value="">请选择</option>{evidence.map(item => <option key={item.id} value={item.id}>{item.excerpt.slice(0, 70)} · {item.validation}</option>)}</select></label>
    <label>证据关系<select aria-label="证据关系" value={relation} onChange={e => setRelation(e.target.value)}><option value="background">背景</option><option value="supports">支持</option><option value="partial">部分支持</option><option value="contradicts">相反证据</option></select></label>
    <label>关系理由与限定条件<textarea aria-label="证据关系理由" value={rationale} onChange={e => setRationale(e.target.value)} /></label>
    <label>局限（每行一条）<textarea aria-label="论点局限" value={limitations} onChange={e => setLimitations(e.target.value)} /></label>
    <button disabled={busy || !claimText.trim() || !scope.trim() || !evidenceId} onClick={() => run(async () => {
      await api('claims.upsert', { context: context(), claim: { text: claimText, kind: 'external-fact', scope, evidenceLinks: [{ evidenceId, relation, rationale }], limitations: limitations.split('\n').filter(Boolean) } }); setClaimText(''); await refresh()
    })}>确认保存论点</button>
    <ul>{(Object.values(project.ledger.claims) as any[]).map(claim => <li key={claim.id}>{claim.text} · {claim.scope} · {claim.status}</li>)}</ul>
  </section>
}

export function OutlineEditor({ project, context, api, refresh, run, busy }: Props) {
  const [question, setQuestion] = useState(project.ledger.outline.researchQuestion)
  const [thesis, setThesis] = useState(project.ledger.outline.thesis)
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [claimIds, setClaimIds] = useState<string[]>([])
  return <section aria-label="论文大纲"><h3>论文大纲 · {project.ledger.outline.confirmation === 'confirmed' ? '已确认' : '待确认'}</h3>
    <label>研究问题<input aria-label="研究问题" value={question} onChange={e => setQuestion(e.target.value)} /></label>
    <label>中心论点<input aria-label="中心论点" value={thesis} onChange={e => setThesis(e.target.value)} /></label>
    <label>章节标题<input aria-label="章节标题" value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label>章节目的<textarea aria-label="章节目的" value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
    <fieldset><legend>本章节使用的论点</legend>{(Object.values(project.ledger.claims) as any[]).map(claim => <label key={claim.id}><input type="checkbox" checked={claimIds.includes(claim.id)} onChange={e => setClaimIds(e.target.checked ? [...claimIds, claim.id] : claimIds.filter(id => id !== claim.id))} />{claim.text} · {claim.status}</label>)}</fieldset>
    <button disabled={busy || !question.trim() || !thesis.trim() || !title.trim() || !claimIds.length} onClick={() => run(async () => {
      const outline = project.ledger.outline
      await api('outline.confirm', { context: context(), expectedOutlineVersion: outline.version, outline: { ...outline, researchQuestion: question, thesis,
        sections: [...outline.sections, { id: `sec_${crypto.randomUUID()}`, title, purpose, claimIds, missingEvidence: [] }] } })
      setTitle(''); setPurpose(''); setClaimIds([]); await refresh()
    })}>确认大纲并添加章节</button>
    <ol>{project.ledger.outline.sections.map((section: any) => <li key={section.id}><b>{section.title}</b><p>{section.purpose}</p><p>{section.claimIds.map((id: string) => project.ledger.claims[id]?.text).join('；')}</p></li>)}</ol>
  </section>
}
