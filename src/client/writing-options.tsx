import React,{useEffect,useRef,useState} from 'react'

const builtinLabels:Record<string,string>={'evidence-grounded-writing':'基于证据写作','selection-preserving-revision':'选区改写','literature-synthesis':'文献综合','research-results-integrity':'研究结果核验'}

/** Project choices live beside the writing brief; library administration stays in settings. */
export function WritingOptions({project,api,context,refresh}:any){
  const [data,setData]=useState<any>(),[profiles,setProfiles]=useState<any[]>([]),[profile,setProfile]=useState<any>()
  const [selected,setSelected]=useState(''),[selections,setSelections]=useState<any[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const edited=useRef(false)
  useEffect(()=>{let live=true
    Promise.all([api('profiles.project',{context:context()}),api('profiles.library',{}),api('skills.project',{context:context()})]).then(([current,library,skills])=>{if(live){setProfile(current);setProfiles(library.profiles);setData(skills);if(!edited.current)setSelections(skills.resources.map((row:any)=>({qualifiedId:row.binding.qualifiedId,digest:row.binding.digest,enabledStages:row.binding.enabledStages,scope:row.binding.scope})))}}).catch(error=>live&&setMessage(error.message))
    return()=>{live=false}
  },[project.ledger.revision])
  const act=async(work:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await work()}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}}
  const versions:any[]=data?.installed.versions??[],ids=[...new Set(versions.map(row=>row.metadata.qualifiedId))]
  const choices=ids.map(id=>versions.find(row=>row.metadata.qualifiedId===id&&selections.some(selection=>selection.qualifiedId===id&&selection.digest===row.digest))??versions.find(row=>row.metadata.qualifiedId===id))
  return <section className="sf-writing-options" aria-label="文风与写作模板"><div className="sf-form">
    <div className="sf-field"><span className="sf-field-label">文风模板</span><div className="sf-field-control"><select aria-label="文风模板" value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}><option value="">{profile?.source?.profile.displayName??'保持当前文风'}</option>{profiles.map((row,index)=><option key={row.id+row.sourceDigest} value={String(index)}>{row.displayName}</option>)}</select>
      <button disabled={busy||selected===''} onClick={()=>act(async()=>{const row=profiles[Number(selected)],captured=context(),plan=await api('profiles.prepareCopy',{context:captured,id:row.id,sourceDigest:row.sourceDigest});await api('profiles.copyToProject',{context:captured,planId:plan.planId,planHash:plan.planHash});setSelected('');await refresh();setMessage('文风已应用。')})}>应用文风</button></div></div>
    <div className="sf-field sf-choice-field"><span className="sf-field-label">写作模板</span><div className="sf-field-control sf-choice-list">{choices.map(version=>{const id=version.metadata.qualifiedId,label=version.scope==='builtin'?builtinLabels[version.metadata.displayName]??version.metadata.displayName:version.metadata.displayName;return <label className="sf-check" key={id}><input type="checkbox" checked={selections.some(row=>row.qualifiedId===id)} disabled={busy} onChange={event=>{edited.current=true;setSelections(event.target.checked?[...selections,{qualifiedId:id,digest:version.digest,enabledStages:version.metadata.suggestedStages,scope:version.scope}]:selections.filter(row=>row.qualifiedId!==id))}}/><span>{label}</span></label>})}
      {!choices.length&&<p className="sf-muted">可在插件设置中添加写作模板。</p>}
      {edited.current&&<button disabled={busy} onClick={()=>act(async()=>{const captured=context(),plan=await api('skills.prepareBindings',{context:captured,selections});await api('skills.applyBindings',{context:captured,planId:plan.planId,planHash:plan.planHash});edited.current=false;await refresh();setMessage('写作模板已应用。')})}>应用写作模板</button>}</div></div>
  </div>{message&&<p role="status">{message}</p>}</section>
}
