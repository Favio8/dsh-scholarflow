import React, { useState } from 'react'

type Props = { selected: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>;
  run: (fn: () => Promise<unknown>) => void; busy: boolean }
const CAPABILITIES = [['draft-section', '章节写作'], ['selection-transform', '选区修改'], ['review', '审查'], ['research', '研究'], ['planning', '规划']] as const
const STAGES = [['requirements', '要求'], ['research', '研究'], ['outline', '大纲'], ['drafting', '写作'], ['review', '审查'], ['revision', '修订'], ['delivery', '交付']] as const
export function ProjectSkillCopy({ selected, context, api, refresh, run, busy }: Props) {
  const [source, setSource] = useState<any>(), [instructions, setInstructions] = useState(''), [reason, setReason] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([]), [stages, setStages] = useState<string[]>([]), [plan, setPlan] = useState<any>()
  const load = () => run(async () => {
    const result = await api('skills.readVersion', { context: context(), selection: { qualifiedId: selected.metadata.qualifiedId, digest: selected.digest, scope: selected.scope } })
    setSource(result); setInstructions(result.instructions); setCapabilities(result.metadata.capabilities); setStages(result.metadata.suggestedStages); setReason(''); setPlan(undefined)
  })
  const toggle = (rows: string[], value: string, checked: boolean) => checked ? [...rows, value] : rows.filter(row => row !== value)
  return <section aria-label="项目 Skill 副本与定制">
    <button disabled={busy || !selected || !!plan} onClick={load}>读取所选 Skill 并定制项目副本</button>
    {source && <fieldset disabled={busy || !!plan}><legend>项目副本 · {source.metadata.displayName}</legend>
      <p>{source.selection.qualifiedId} · {source.selection.digest}</p>
      <p>保存为本项目的新版本，并保留完整静态资源。修改前后的版本都可独立绑定；已启动运行保持其原有快照。</p>
      <label>项目 Skill 说明<textarea aria-label="项目 Skill 说明" rows={12} value={instructions} onChange={e => {
        const crlf = source.instructions.includes('\r\n') && !source.instructions.replaceAll('\r\n', '').includes('\n')
        setInstructions(crlf ? e.target.value.replace(/\r\n|\r|\n/g, '\r\n') : e.target.value)
      }} /></label>
      <p>保留 SKILL.md 开头的 name 与 description。脚本、命令和网络回调不会获得执行权限。</p>
      <fieldset><legend>声明能力</legend>{CAPABILITIES.map(([value, label]) => <label key={value}><input type="checkbox" checked={capabilities.includes(value)} onChange={e => setCapabilities(toggle(capabilities, value, e.target.checked))} />{label}</label>)}</fieldset>
      <fieldset><legend>建议启用阶段</legend>{STAGES.map(([value, label]) => <label key={value}><input type="checkbox" checked={stages.includes(value)} onChange={e => setStages(toggle(stages, value, e.target.checked))} />{label}</label>)}</fieldset>
      <label>项目 Skill 定制说明<textarea aria-label="项目 Skill 定制说明" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <p>{source.files.length} 个源文件 · {source.files.reduce((sum: number, file: any) => sum + file.sizeBytes, 0)} 字节</p>
      <button disabled={!reason.trim() || !capabilities.length || !stages.length} onClick={() => run(async () => setPlan(await api('skills.prepareProjectCopy', {
        context: context(), selection: source.selection, instructions, options: { capabilities, suggestedStages: stages }, reason }))) }>预览项目 Skill 副本</button>
      <button onClick={() => setSource(undefined)}>关闭项目 Skill 定制</button>
    </fieldset>}
    {plan && <section role="dialog" aria-modal="false" aria-label="项目 Skill 副本确认"><h4>确认完整副本与定制说明</h4>
      <p>{plan.qualifiedId} · {plan.digest}</p><p>{plan.reason}</p>
      <details><summary>原始 Skill 说明</summary><pre>{plan.previousInstructions}</pre></details>
      <details open><summary>项目副本说明</summary><pre>{plan.instructions}</pre></details>
      <p>声明能力：{plan.metadata.capabilities.join('、')} · 建议阶段：{plan.metadata.suggestedStages.join('、')}</p>
      <ul>{plan.files.map((file: any) => <li key={file.relativePath}>{file.relativePath} · {file.sizeBytes} 字节 · {file.hash}</li>)}</ul>
      {plan.metadata.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => { await api('skills.applyProjectCopy', { context: context(), planId: plan.planId, planHash: plan.planHash });
        setPlan(undefined); setSource(undefined); await refresh() })}>确认创建项目 Skill 副本</button>
      <button disabled={busy} onClick={() => run(async () => { await api('skills.dismiss', { planId: plan.planId }); setPlan(undefined) })}>取消项目 Skill 副本</button>
    </section>}
  </section>
}
