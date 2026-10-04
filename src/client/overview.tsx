import React, { useState } from 'react'
import { projectTextPaths } from '../shared/requirements.ts'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function Overview({ project, context, api, refresh, run, busy }: Props) {
  const [description, setDescription] = useState(''), [kind, setKind] = useState('length'), [value, setValue] = useState('2000')
  const [operator, setOperator] = useState('min'), [unit, setUnit] = useState('zh-characters'), [materialId, setMaterialId] = useState('')
  const [selected, setSelected] = useState(''), [reason, setReason] = useState(''), [confirmCount, setConfirmCount] = useState(false)
  const [path, setPath] = useState<(typeof projectTextPaths)[number]>(projectTextPaths[0]), [file, setFile] = useState<any>(), [text, setText] = useState(''), [message, setMessage] = useState('')
  const requirements = Object.values(project.ledger.requirements) as any[], conflicts = requirements.filter(row => row.confirmation === 'conflicting')
  return <section aria-label="项目概览"><h3>项目概览与要求确认</h3>
    <p>{project.config.project.type} · {project.config.project.language} · 要求 {requirements.length} · 已登记材料 {Object.keys(project.ledger.materials).length}</p>
    <p>资料中的要求先作为候选。老师要求与用户输入不一致时，保留双方并由你明确选择；插件不擅自采用最大值或最新值。</p>
    <label>要求资料<select aria-label="要求资料" value={materialId} onChange={e => setMaterialId(e.target.value)}><option value="">选择已解析资料</option>
      {(Object.values(project.ledger.materials) as any[]).filter(row => row.contentHash).map(row => <option key={row.id} value={row.id}>{row.projectRelativePath}</option>)}</select></label>
    <button disabled={busy || !materialId} onClick={() => run(async () => { const result = await api('requirements.extract', { context: context(), materialId }); setMessage(result.warnings.join(' ')); await refresh() })}>提取所选资料要求候选</button>
    <label>要求描述<textarea aria-label="要求描述" value={description} maxLength={4000} onChange={e => setDescription(e.target.value)} /></label>
    <label>要求类别<select aria-label="要求类别" value={kind} onChange={e => setKind(e.target.value)}>
      <option value="length">篇幅</option><option value="references">引用数量</option><option value="section">必需章节</option><option value="format">输出格式</option><option value="topic">主题</option><option value="ai-policy">AI 使用政策</option><option value="other">其他人工要求</option></select></label>
    <label>约束方式<select aria-label="约束方式" value={operator} onChange={e => setOperator(e.target.value)}><option value="min">至少</option><option value="max">至多</option><option value="equals">等于</option><option value="contains">包含</option></select></label>
    <label>约束值<input aria-label="约束值" value={value} onChange={e => setValue(e.target.value)} /></label>
    {kind === 'length' && <label>篇幅单位<select aria-label="篇幅单位" value={unit} onChange={e => setUnit(e.target.value)}><option value="zh-characters">汉字数</option><option value="words">西文词元数</option></select></label>}
    <button disabled={busy || !description.trim() || !value.trim()} onClick={() => run(async () => {
      const numeric = ['length', 'references'].includes(kind)
      if (numeric && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error('数值约束必须是非负数字。')
      await api('requirements.upsert', { context: context(), requirement: { kind, description: description.trim(), origin: { type: 'user' }, verificationMethod: ['length', 'references', 'section', 'format'].includes(kind) ? 'deterministic' : 'manual',
        constraint: { operator, value: numeric ? Number(value) : value, ...(numeric && { unit: kind === 'references' ? 'items' : unit }) } } }); setDescription(''); await refresh()
    })}>保存用户要求候选</button>
    <label><input type="checkbox" checked={confirmCount} onChange={e => setConfirmCount(e.target.checked)} />确认篇幅使用 sf-body-han-western-v1：分别统计汉字与西文词元，排除参考文献、代码和公式；与学校 Word 统计可能不同。</label>
    {requirements.map(row => <section key={row.id} aria-label={`写作要求 ${row.id}`}><h4>{row.kind} · {row.confirmation}</h4><p>{row.description}</p>
      <p>约束：{row.constraint?.operator} {String(row.constraint?.value ?? '需人工判断')} {row.constraint?.unit} · {row.constraint?.countingPolicyId ?? '未指定统计口径'}</p>
      <p>来源：{row.origin.type}{row.origin.materialId && ` · ${row.origin.materialId}`}</p>{row.origin.excerpt && <blockquote>{row.origin.excerpt}</blockquote>}
      {row.confirmation === 'proposed' && <button disabled={busy || (row.kind === 'length' && !confirmCount)} onClick={() => run(async () => {
        await api('requirements.confirm', { context: context(), requirementId: row.id, ...(row.kind === 'length' && { countingPolicyId: 'sf-body-han-western-v1' }) }); await refresh()
      })}>确认要求 {row.id}</button>}
    </section>)}
    {!!conflicts.length && <section aria-label="要求冲突处理"><h4>存在要求冲突：写作阶段已阻塞</h4><p>选中一个有效要求，其余冲突项保存在不可变决定记录中；保留项仍需确认。多个独立冲突可分次处理。</p>
      <label>本次保留要求<select aria-label="本次保留要求" value={selected} onChange={e => setSelected(e.target.value)}><option value="">请选择</option>{conflicts.map(row => <option key={row.id} value={row.id}>{row.id} · {row.description}</option>)}</select></label>
      <label>冲突处理理由<textarea aria-label="冲突处理理由" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} /></label>
      <button disabled={busy || !selected || !reason.trim()} onClick={() => run(async () => {
        const chosen = conflicts.find(row => row.id === selected)
        await api('requirements.resolveConflict', { context: context(), requirementIds: conflicts.filter(row => row.kind === chosen.kind).map(row => row.id), selectedId: selected, reason }); setReason(''); setSelected(''); await refresh()
      })}>确认保留所选要求并归档冲突原文</button>
    </section>}
    <h3>项目文风与已确认记忆</h3><p>只进入当前 ScholarFlow 项目的阶段输入。保存会使相关检查需更新，其他项目保持独立。</p>
    <label>项目指令文件<select aria-label="项目指令文件" disabled={busy || (!!file && text !== file.text)} value={path} onChange={e => { setPath(e.target.value as typeof path); setFile(undefined); setText('') }}>
      {projectTextPaths.map(path => <option key={path} value={path}>{path}</option>)}</select></label>
    <button disabled={busy || (!!file && text !== file.text)} onClick={() => run(async () => { const result = await api('project.readText', { context: context(), path }); setFile(result); setText(result.text) })}>读取所选项目指令</button>
    {file && <><label>项目指令内容<textarea aria-label="项目指令内容" rows={8} disabled={busy} value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={busy || text === file.text} onClick={() => run(async () => { await api('project.saveText', { context: context(), path: file.path, text, baseHash: file.contentHash }); setFile(undefined); setMessage('项目指令已保存；相关检查需更新。'); await refresh() })}>确认保存项目指令</button>
      <button disabled={busy} onClick={() => { if (text !== file.text && !window.confirm('放弃这份未保存的项目指令编辑？')) return; setFile(undefined); setText('') }}>关闭项目指令编辑</button></>}
    <p role="status">{message}</p>
  </section>
}
