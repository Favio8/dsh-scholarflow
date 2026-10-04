import React, { useEffect, useRef, useState } from 'react'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
const STAGES = [['requirements', '要求'], ['research', '研究'], ['outline', '大纲'], ['drafting', '写作'], ['review', '审查'], ['revision', '修订'], ['delivery', '交付']] as const
type Selection = { qualifiedId: string; digest: string; enabledStages: string[]; scope: 'library' | 'builtin' | 'project' }
export function ProjectSkills({ project, context, api, refresh, run, busy }: Props) {
  const [data, setData] = useState<any>(), [selections, setSelections] = useState<Selection[]>([]), [selectedVersion, setSelectedVersion] = useState('')
  const [plan, setPlan] = useState<any>(), [error, setError] = useState(''), [stage, setStage] = useState('drafting')
  const [refreshSequence, setRefreshSequence] = useState(0)
  const edited = useRef(false)
  useEffect(() => {
    let live = true
    api('skills.project', { context: context() }).then(result => {
      if (!live) return
      setData(result); setError('')
      if (!edited.current) { setSelections(result.resources.map((row: any) => ({ qualifiedId: row.binding.qualifiedId, digest: row.binding.digest, enabledStages: row.binding.enabledStages, scope: row.binding.scope }))); setStage(result.stage.stage) }
    }).catch(error => live && setError(error.message))
    return () => { live = false }
  }, [project.ledger.revision, refreshSequence])
  const change = (rows: Selection[]) => { edited.current = true; setSelections(rows); setPlan(undefined) }
  const versions = data?.installed.versions ?? []
  return <section aria-label="项目固定 Skill"><h3>本项目的 Academic Skills</h3>
    <p>安装库在设置中管理；这里确认具体版本、阶段及优先顺序。第一项优先，真实性与权限硬规则始终优先。</p>
    <p>项目资源放在 .scholarflow/skills/namespace/id/。保留原始 SKILL.md，另用 scholarflow.json 声明 schemaVersion: 1、capabilities、suggestedStages。读取原始资源不执行脚本；修改后必须明确绑定新摘要。</p>
    {error && <p role="alert" className="sf-error">{error}</p>}
    <button disabled={busy} onClick={() => setRefreshSequence(value => value + 1)}>刷新固定 Skill 资源清单</button>
    {data?.resources.filter((row: any) => !row.available).map((row: any) => <p role="alert" key={row.binding.bindingId}>{row.binding.qualifiedId}：{row.warning}</p>)}
    {data?.installed.diagnostics?.map((warning: string, index: number) => <p role="status" key={index}>{warning}</p>)}
    {data?.legacyMigration && <p>当前为旧资源锁格式。确认绑定时会先归档完整原配置与资源锁，再明确迁移。</p>}
    <label>选择已安装固定版本<select aria-label="选择已安装固定 Skill 版本" value={selectedVersion} onChange={e => setSelectedVersion(e.target.value)}><option value="">请选择</option>
      {versions.map((version: any, index: number) => <option key={`${version.metadata.qualifiedId}:${version.digest}`} value={String(index)}>{version.metadata.displayName} · {version.metadata.qualifiedId} · {version.digest.slice(7, 19)} · {version.metadata.compatibility}</option>)}
    </select></label>
    <button disabled={busy || selectedVersion === ''} onClick={() => {
      const version = versions[Number(selectedVersion)]
      if (!version || selections.some(row => row.qualifiedId === version.metadata.qualifiedId)) { setError('同一 Skill 已有绑定；请在该项中明确选择新的固定版本。'); return }
      change([...selections, { qualifiedId: version.metadata.qualifiedId, digest: version.digest, enabledStages: version.metadata.suggestedStages, scope: version.scope }])
    }}>加入待确认启用清单</button>
    {selections.map((selection, index) => <fieldset key={selection.qualifiedId}><legend>优先顺序 {index + 1} · {selection.qualifiedId}</legend>
      <label>固定版本<select aria-label={`固定 Skill 版本 ${selection.qualifiedId}`} value={selection.digest} onChange={e => change(selections.map((row, position) => position === index ? { ...row, digest: e.target.value } : row))}>
        {versions.filter((version: any) => version.metadata.qualifiedId === selection.qualifiedId).map((version: any) => <option key={version.digest} value={version.digest}>{version.digest} · {version.metadata.compatibility}</option>)}
        {!versions.some((version: any) => version.metadata.qualifiedId === selection.qualifiedId && version.digest === selection.digest) && <option value={selection.digest}>{selection.digest} · 固定资源不可用</option>}
      </select></label>
      {STAGES.map(([value, label]) => <label key={value}><input type="checkbox" checked={selection.enabledStages.includes(value)} onChange={e => change(selections.map((row, position) => position === index ? { ...row,
        enabledStages: e.target.checked ? [...row.enabledStages, value] : row.enabledStages.filter(stage => stage !== value) } : row))} />{label}</label>)}
      <button disabled={busy || index === 0} onClick={() => { const rows = [...selections]; [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; change(rows) }}>提高优先顺序</button>
      <button disabled={busy} onClick={() => change(selections.filter((_, position) => position !== index))}>从待确认清单禁用</button>
    </fieldset>)}
    <button disabled={busy || selections.some(row => !row.enabledStages.length)} onClick={() => run(async () => setPlan(await api('skills.prepareBindings', { context: context(), selections })))}>预览本项目 Skill 绑定</button>
    {plan && <section role="dialog" aria-modal="false" aria-label="项目 Skill 绑定确认"><h4>确认本项目固定版本与阶段</h4>
      {plan.bindings.length ? <ol>{plan.bindings.map((binding: any) => <li key={binding.bindingId}>{binding.qualifiedId}<p>{binding.digest} · {binding.enabledStages.join('、')}</p></li>)}</ol> : <p>本次将禁用全部项目 Skill。</p>}
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => { await api('skills.applyBindings', { context: context(), planId: plan.planId, planHash: plan.planHash }); edited.current = false; setPlan(undefined); await refresh() })}>确认项目 Skill 绑定{plan.legacyMigration ? '并迁移旧资源锁' : ''}</button>
      <button disabled={busy} onClick={() => run(async () => { await api('skills.dismiss', { planId: plan.planId }); setPlan(undefined) })}>取消项目 Skill 绑定</button>
    </section>}
    <label>会话工具的 Skill 调用阶段<select aria-label="Skill 调用阶段" value={stage} onChange={e => setStage(e.target.value)}>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <button disabled={busy || !data || stage === data.stage.stage} onClick={() => run(async () => { await api('skills.selectStage', { context: context(), stage }); await refresh() })}>确认 Skill 调用阶段</button>
    <p>会话工具只列出这个项目与调用阶段的启用项。正文生成固定使用写作阶段，选区改写固定使用修订阶段；既有聊天历史不会被删除。</p>
  </section>
}
