import React, {useEffect, useState} from 'react'
import type {SkillManifest} from '../shared/skills.ts'

const capabilities = [['draft-section','章节写作'],['selection-transform','选区改写'],['review','审查'],['research','研究'],['planning','规划']]
const stages = [['requirements','要求'],['research','研究'],['outline','大纲'],['drafting','写作'],['review','审查'],['revision','修订'],['delivery','交付']]
export function SkillAuthor({api, source, onClose, onInstalled}: {api: (method:string,input:any)=>Promise<any>;source?:SkillManifest;onClose:()=>void;onInstalled:()=>Promise<void>}) {
  const [name,setName]=useState(source?.metadata.displayName??''),[description,setDescription]=useState(source?.metadata.description??'')
  const [instructions,setInstructions]=useState(''),[uses,setUses]=useState(source?.metadata.capabilities??['draft-section','selection-transform'])
  const [enabled,setEnabled]=useState(source?.metadata.suggestedStages??['drafting','revision']),[plan,setPlan]=useState<any>()
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let live=true; if(source) api('skills.readLibraryVersion',{qualifiedId:source.metadata.qualifiedId,digest:source.digest}).then(row=>{
    if(!live)return;const lines=row.instructions.replace(/^\uFEFF/u,'').split(/\r?\n/u)
    setInstructions(lines.slice(lines.indexOf('---',1)+1).join('\n').trim())
  }).catch(err=>live&&setError(err.message));return()=>{live=false}},[])
  const act=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work()}catch(err){setError((err as Error).message)}finally{setBusy(false)}}
  const close=()=>act(async()=>{if(plan)await api('skills.dismiss',{planId:plan.planId});onClose()})
  const selection=(values:string[],value:string,checked:boolean)=>checked?[...values,value]:values.filter(row=>row!==value)
  return <section className="sf-group" aria-label="创作写作 Skill"><header><h4>{source?.origin.kind==='user'?'编辑 Skill · 保存新版本':source?'从此版本创作 Skill':'新建写作 Skill'}</h4></header>
    {error&&<p className="sf-error" role="alert">{error}</p>}
    {!plan?<><div className="sf-form">
      <label className="sf-field"><span className="sf-field-label">Skill 名称</span><span className="sf-field-control"><input aria-label="Skill 名称" value={name} maxLength={64} onChange={e=>setName(e.target.value)}/></span></label>
      <label className="sf-field"><span className="sf-field-label">用途说明</span><span className="sf-field-control"><input aria-label="Skill 用途说明" value={description} maxLength={1024} onChange={e=>setDescription(e.target.value)}/></span></label>
      <label className="sf-field"><span className="sf-field-label">执行说明</span><span className="sf-field-control"><textarea aria-label="Skill 执行说明" rows={12} value={instructions} maxLength={60000} onChange={e=>setInstructions(e.target.value)} placeholder="描述适用任务、写作步骤、输出要求与检查要点"/></span></label>
    </div>
    <fieldset><legend>用途</legend>{capabilities.map(([value,label])=><label className="sf-check" key={value}><input type="checkbox" checked={uses.includes(value as any)} onChange={e=>setUses(selection(uses,value,e.target.checked) as any)}/><span>{label}</span></label>)}</fieldset>
    <fieldset><legend>建议启用阶段</legend>{stages.map(([value,label])=><label className="sf-check" key={value}><input type="checkbox" checked={enabled.includes(value as any)} onChange={e=>setEnabled(selection(enabled,value,e.target.checked) as any)}/><span>{label}</span></label>)}</fieldset>
    <button className="sf-primary" disabled={busy||!name.trim()||!description.trim()||!instructions.trim()||!uses.length||!enabled.length} onClick={()=>act(async()=>setPlan(await api('skills.prepareAuthor',{
      name,description,instructions,capabilities:uses,suggestedStages:enabled,...(source&&{derivedFrom:{qualifiedId:source.metadata.qualifiedId,digest:source.digest}}),
      ...(source?.origin.kind==='user'&&{qualifiedId:source.metadata.qualifiedId})
    })))}>预览保存</button></>:<section role="dialog" aria-label="Skill 创作确认"><h4>{plan.manifest.metadata.displayName}</h4><p>{plan.manifest.metadata.description}</p>
      {plan.previousInstructions&&<details><summary>原版本说明</summary><pre>{plan.previousInstructions}</pre></details>}
      <details open><summary>新版本 SKILL.md</summary><pre>{plan.instructions}</pre></details>
      <p>固定摘要：{plan.manifest.digest}</p>{plan.risks.map((risk:string)=><p key={risk}>{risk}</p>)}
      <button className="sf-primary" disabled={busy} onClick={()=>act(async()=>{await api('skills.install',{planId:plan.planId,planHash:plan.planHash});setPlan(undefined);await onInstalled();onClose()})}>确认保存到私有库</button>
      <button disabled={busy} onClick={()=>act(async()=>{await api('skills.dismiss',{planId:plan.planId});setPlan(undefined)})}>返回编辑</button>
    </section>}
    <button disabled={busy} onClick={close}>取消创作</button><p className="sf-muted">保存后，在「项目 Skill」选择此固定版本和启用阶段。</p>
  </section>
}
