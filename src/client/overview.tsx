import React, { useState } from 'react'
import { ProjectSkills } from './project-skills.tsx'
import { ProjectWritingProfile } from './writing-profiles.tsx'
import { GuidedWorkflow } from './workflow.tsx'
import { ProjectIdentityHistory } from './project-identity.tsx'
import { ProjectTextEditor } from './project-text-editor.tsx'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean; navigate?: (page: string) => void }
export function Overview({ project, context, api, refresh, run, busy, navigate }: Props) {
  const [description, setDescription] = useState(''), [kind, setKind] = useState('length'), [value, setValue] = useState('2000')
  const [operator, setOperator] = useState('min'), [unit, setUnit] = useState('zh-characters'), [materialId, setMaterialId] = useState('')
  const [editing, setEditing] = useState<any>(), [changeReason, setChangeReason] = useState(''), [requirementPreview, setRequirementPreview] = useState<any>(), [history, setHistory] = useState<any>()
  const [yearStart, setYearStart] = useState(''), [yearEnd, setYearEnd] = useState(''), [mixedCount, setMixedCount] = useState(false)
  const [selected, setSelected] = useState(''), [reason, setReason] = useState(''), [confirmCount, setConfirmCount] = useState(false)
  const [message, setMessage] = useState(''), [instructionDirty, setInstructionDirty] = useState(false)
  const requirements = Object.values(project.ledger.requirements) as any[], conflicts = requirements.filter(row => row.confirmation === 'conflicting')
  const requirementInput = () => {
    const numeric = ['length', 'references'].includes(kind)
    if (numeric && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error('数值约束必须是非负数字。')
    return { ...(editing && { id: editing.row.id }), kind, description: description.trim(), origin: editing?.row.origin ?? { type: 'user' },
      verificationMethod: editing?.row.verificationMethod ?? (['length', 'references', 'section', 'format'].includes(kind) ? 'deterministic' : 'manual'),
      constraint: { operator, value: numeric ? Number(value) : value, ...(numeric && { unit: kind === 'references' ? operator === 'ratio' ? 'percent' : 'items' : mixedCount ? 'words' : unit }),
        ...(kind === 'length' && mixedCount && { countingPolicyId: 'sf-body-han-plus-western-v1' }),
        ...(kind === 'references' && (yearStart || yearEnd || operator === 'ratio') && { windowStart: yearStart, windowEnd: yearEnd }) } }
  }
  const clearEdit = () => { setEditing(undefined); setDescription(''); setChangeReason(''); setYearStart(''); setYearEnd(''); setMixedCount(false); setRequirementPreview(undefined) }
  const beginEdit = (row: any) => { setEditing({ row: structuredClone(row), revision: project.ledger.revision }); setDescription(row.description); setKind(row.kind);
    setOperator(row.constraint?.operator ?? 'equals'); setValue(String(row.constraint?.value ?? '')); setUnit(row.constraint?.unit === 'words' ? 'words' : 'zh-characters');
    setYearStart(row.constraint?.windowStart ?? ''); setYearEnd(row.constraint?.windowEnd ?? ''); setMixedCount(row.constraint?.countingPolicyId === 'sf-body-han-plus-western-v1'); setChangeReason(''); setRequirementPreview(undefined) }
  return <section aria-label="项目概览"><h3>项目概览与要求确认</h3>
    <GuidedWorkflow project={project} context={context} api={api} run={run} busy={busy} navigate={navigate} />
    <ProjectIdentityHistory context={context} api={api} run={run} busy={busy} />
    <p>{project.config.project.type} · {project.config.project.language} · 要求 {requirements.length} · 已登记材料 {Object.keys(project.ledger.materials).length}</p>
    <p>资料中的要求先作为候选。老师要求与用户输入不一致时，保留双方并由你明确选择；插件不擅自采用最大值或最新值。</p>
    <label>要求资料<select aria-label="要求资料" value={materialId} onChange={e => setMaterialId(e.target.value)}><option value="">选择已解析资料</option>
      {(Object.values(project.ledger.materials) as any[]).filter(row => row.contentHash).map(row => <option key={row.id} value={row.id}>{row.projectRelativePath}</option>)}</select></label>
    <button disabled={busy || !materialId} onClick={() => run(async () => { const result = await api('requirements.extract', { context: context(), materialId }); setMessage(result.warnings.join(' ')); await refresh() })}>提取所选资料要求候选</button>
    <label>要求描述<textarea aria-label="要求描述" value={description} maxLength={4000} onChange={e => setDescription(e.target.value)} /></label>
    <label>要求类别<select aria-label="要求类别" value={kind} onChange={e => setKind(e.target.value)}>
      <option value="length">篇幅</option><option value="references">引用数量</option><option value="section">必需章节</option><option value="format">输出格式</option><option value="topic">主题</option><option value="ai-policy">AI 使用政策</option><option value="other">其他人工要求</option></select></label>
    <label>约束方式<select aria-label="约束方式" value={operator} onChange={e => setOperator(e.target.value)}><option value="min">至少</option><option value="max">至多</option><option value="equals">等于</option><option value="contains">包含</option>{kind === 'references' && <option value="ratio">近期比例至少（%）</option>}</select></label>
    <label>约束值<input aria-label="约束值" value={value} onChange={e => setValue(e.target.value)} /></label>
    {kind === 'length' && !mixedCount && <label>篇幅单位<select aria-label="篇幅单位" value={unit} onChange={e => setUnit(e.target.value)}><option value="zh-characters">汉字数</option><option value="words">西文词元数</option></select></label>}
    {kind === 'length' && <label><input type="checkbox" checked={mixedCount} onChange={e => setMixedCount(e.target.checked)} />改用汉字数 + 西文词元数之和，sf-body-han-plus-western-v1（不等同于学校 Word 字数）</label>}
    {kind === 'references' && <><label>引用年份窗口起点（可留空）<input aria-label="引用年份窗口起点" value={yearStart} onChange={e => setYearStart(e.target.value)} /></label>
      <label>引用年份窗口终点（可留空）<input aria-label="引用年份窗口终点" value={yearEnd} onChange={e => setYearEnd(e.target.value)} /></label>
      <p>数量按正文实际唯一引用计数；窗口含起止年份。近期比例的分母为全部实际唯一引用；缺失年份保持未知，不按当前年补齐。</p></>}
    {editing && <p>正在修改 {editing.row.id}，基于 ledger {editing.revision}；原来源与定位保留，保存后须重新确认。</p>}
    <label>要求修改／删除理由<textarea aria-label="要求修改删除理由" value={changeReason} onChange={e => setChangeReason(e.target.value)} maxLength={2000} /></label>
    <button disabled={busy || !description.trim() || !value.trim() || (!!editing && !changeReason.trim())} onClick={() => run(async () => {
      const request = { context: { ...context(), ...(editing && { expectedLedgerRevision: editing.revision }) }, requirement: requirementInput(), ...(editing && { changeReason }) }
      if (editing) { setRequirementPreview({ action: 'edit', request, previous: editing.row }); return }
      await api('requirements.upsert', request); clearEdit(); await refresh()
    })}>{editing ? '预览保存要求修改' : '保存用户要求候选'}</button>
    {editing && <button disabled={busy} onClick={clearEdit}>取消要求编辑</button>}
    <label><input type="checkbox" checked={confirmCount} onChange={e => setConfirmCount(e.target.checked)} />确认篇幅使用 sf-body-han-western-v1：分别统计汉字与西文词元；若该项明确选择混合口径，则按 sf-body-han-plus-western-v1 求和。排除参考文献、代码和公式；与学校 Word 统计可能不同。</label>
    {requirements.map(row => <section key={row.id} aria-label={`写作要求 ${row.id}`}><h4>{row.kind} · {row.confirmation}</h4><p>{row.description}</p>
      <p>约束：{row.constraint?.operator} {String(row.constraint?.value ?? '需人工判断')} {row.constraint?.countingPolicyId === 'sf-body-han-plus-western-v1' ? '汉字 + 西文词元合计' : row.constraint?.unit} · {row.constraint?.countingPolicyId ?? '未指定统计口径'}</p>
      {(row.constraint?.windowStart || row.constraint?.windowEnd) && <p>年份窗口：{row.constraint.windowStart}–{row.constraint.windowEnd}，含两端；比例分母为正文实际唯一引用。</p>}
      <p>来源：{row.origin.type}{row.origin.materialId && ` · ${row.origin.materialId}`}</p>{row.origin.excerpt && <blockquote>{row.origin.excerpt}</blockquote>}
      <button disabled={busy} onClick={() => beginEdit(row)}>编辑要求 {row.id}</button>
      <button disabled={busy || !changeReason.trim()} onClick={() => setRequirementPreview({ action: 'remove', request: { context: context(), requirementId: row.id, reason: changeReason }, previous: structuredClone(row) })}>预览删除要求 {row.id}</button>
      {row.confirmation === 'proposed' && <button disabled={busy || (row.kind === 'length' && !confirmCount)} onClick={() => run(async () => {
        const policy = row.kind === 'length' ? row.constraint?.countingPolicyId === 'sf-body-han-plus-western-v1' ? 'sf-body-han-plus-western-v1' : 'sf-body-han-western-v1' :
          row.kind === 'references' && (row.constraint?.windowStart || row.constraint?.windowEnd || row.constraint?.operator === 'ratio') ? row.constraint.operator === 'ratio' ? 'sf-cited-year-window-ratio-v1' : 'sf-cited-year-window-v1' : undefined
        await api('requirements.confirm', { context: context(), requirementId: row.id, ...(policy && { countingPolicyId: policy }) }); await refresh()
      })}>确认要求 {row.id}</button>}
    </section>)}
    {requirementPreview && <section role="dialog" aria-label="要求变更确认"><h4>{requirementPreview.action === 'edit' ? '保存要求修改' : '删除当前有效要求'}</h4>
      <p>原要求：{requirementPreview.previous.description} · {requirementPreview.previous.confirmation}</p>
      {requirementPreview.action === 'edit' && <p>新要求：{requirementPreview.request.requirement.description} · {JSON.stringify(requirementPreview.request.requirement.constraint)}</p>}
      <p>理由：{requirementPreview.request.changeReason ?? requirementPreview.request.reason}</p>
      <p>原要求、来源与确认状态会归档。修改项重新待确认；删除项不再作为当前插件约束，课程原规则仍须自行核对。相关审查和任务输入需更新，正文保留。</p>
      <button disabled={busy} onClick={() => run(async () => { await api(requirementPreview.action === 'edit' ? 'requirements.upsert' : 'requirements.remove', requirementPreview.request); clearEdit(); setHistory(undefined); await refresh() })}>确认要求变更</button>
      <button disabled={busy} onClick={() => setRequirementPreview(undefined)}>取消要求变更预览</button></section>}
    <button disabled={busy} onClick={() => run(async () => setHistory(await api('requirements.history', { context: context() })))}>读取要求变更历史</button>
    {history && <section aria-label="要求变更历史">{history.diagnostics.map((warning: string, i: number) => <p role="alert" key={i}>{warning}</p>)}
      {history.truncated && <p>仅显示最近 100 条历史，其余原记录保留在项目中。</p>}
      {!history.history.length && <p>尚无要求变更历史。</p>}
      {history.history.map((row: any) => <details key={row.id}><summary>{row.action} · {row.decidedAt} · {row.reason || '记录的用户操作'}</summary>
        <pre>{JSON.stringify({ previous: row.previous, requirement: row.requirement, requirements: row.requirements, selectedId: row.selectedId }, null, 2)}</pre></details>)}</section>}
    {!!conflicts.length && <section aria-label="要求冲突处理"><h4>存在要求冲突：写作阶段已阻塞</h4><p>选中一个有效要求，其余冲突项保存在不可变决定记录中；保留项仍需确认。多个独立冲突可分次处理。</p>
      <label>本次保留要求<select aria-label="本次保留要求" value={selected} onChange={e => setSelected(e.target.value)}><option value="">请选择</option>{conflicts.map(row => <option key={row.id} value={row.id}>{row.id} · {row.description}</option>)}</select></label>
      <label>冲突处理理由<textarea aria-label="冲突处理理由" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} /></label>
      <button disabled={busy || !selected || !reason.trim()} onClick={() => run(async () => {
        const chosen = conflicts.find(row => row.id === selected)
        await api('requirements.resolveConflict', { context: context(), requirementIds: conflicts.filter(row => row.kind === chosen.kind).map(row => row.id), selectedId: selected, reason }); setReason(''); setSelected(''); await refresh()
      })}>确认保留所选要求并归档冲突原文</button>
    </section>}
    <h3>项目文风与已确认记忆</h3><p>只进入当前 ScholarFlow 项目的阶段输入。保存会使相关检查需更新，其他项目保持独立。</p>
    <ProjectWritingProfile project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} dirty={instructionDirty} />
    <ProjectTextEditor project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} onDirty={setInstructionDirty} />
    <p role="status">{message}</p>
    <ProjectSkills project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} />
  </section>
}
