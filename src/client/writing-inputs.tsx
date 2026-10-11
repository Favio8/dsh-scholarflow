import React,{useEffect,useRef,useState} from 'react'

export function WritingInputs({project,spec,update,baseSpecHash,onSaved,api,context,refresh}:any){
  const [files,setFiles]=useState<any[]>([]),[path,setPath]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [read,setRead]=useState<any>(),[candidate,setCandidate]=useState<any>()
  const [imageCandidate,setImageCandidate]=useState<any>()
  const readId=useRef<string|undefined>(undefined),stopped=useRef(false)
  const materialBase=useRef([...project.config.materials.include]),materialEdited=useRef(false)
  useEffect(()=>{if(!materialEdited.current){materialBase.current=[...project.config.materials.include];update({materials:[...project.config.materials.include]})}},[JSON.stringify(project.config.materials.include)])
  const act=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await work()}catch(err){setError((err as Error).message)}finally{setBusy(false)}}
  useEffect(()=>{let live=true;const handles=spec.requirementSources.filter((source:any)=>source.origin==='external').map((source:any)=>source.handle)
    if(handles.length)api('sources.externalStatus',{handles}).then((row:any)=>{if(live){const alive=new Set(row.live);update({requirementSources:spec.requirementSources.map((source:any)=>source.origin==='external'&&!alive.has(source.handle)?{...source,state:'disconnected'}:source)})}}).catch((err:Error)=>live&&setError(err.message))
    return()=>{live=false;stopped.current=true;if(readId.current)void api('creation.stopRead',{readId:readId.current}).catch(()=>{})}
  },[])
  const external=(replace?:string)=>act(async()=>{const row=await api('sources.pickExternal',{});if(row.cancelled)return
    const source={resourceId:replace??row.resourceId,origin:'external',kind:'folder',handle:row.handle,role:'assignment',state:'connected',members:row.members.map((member:any)=>({name:member.name,size:member.size}))}
    update({requirementSources:replace?spec.requirementSources.map((old:any)=>old.resourceId===replace?source:old):[...spec.requirementSources,source]})
  })
  const selected=project.config.materials.include as string[]
  const materials=files.length?files:[...new Set([...spec.materials,...selected])].map(relativePath=>({relativePath,supported:true}))
  const folders=[...new Set(files.flatMap(file=>{const parts=file.relativePath.split('/');return parts.slice(0,-1).map((_:string,index:number)=>parts.slice(0,index+1).join('/'))}))] as string[]
  return <details className="sf-detail" aria-label="写作来源与联网"><summary>要求来源、参考资料与联网</summary>
    {error&&<p role="alert" className="sf-error">{error}</p>}{message&&<p role="status">{message}</p>}
    <button disabled={busy} onClick={()=>act(async()=>{const row=await api('creation.materials',{context:context()});setFiles(row.files);if(row.truncated)setMessage('已列出前 500 个文件，请按目录补充资料。')})}>列出项目文件</button>
    <label>添加要求文件<select aria-label="添加要求文件" value={path} onChange={e=>setPath(e.target.value)}><option value="">选择文件或文件夹</option>{folders.map(folder=><option key={'folder:'+folder} value={'folder:'+folder}>文件夹 · {folder}</option>)}{files.map(file=><option key={file.relativePath} value={file.relativePath}>{file.relativePath}</option>)}</select></label>
    <button disabled={busy||!path||spec.requirementSources.some((source:any)=>source.path===path.replace(/^folder:/u,''))} onClick={()=>{const folder=path.startsWith('folder:'),sourcePath=folder?path.slice(7):path;update({requirementSources:[...spec.requirementSources,{resourceId:`req_${crypto.randomUUID().replaceAll('-','')}`,origin:'workspace',kind:folder?'folder':'file',path:sourcePath,role:'assignment',state:'selected',members:folder?files.filter(file=>file.relativePath.startsWith(sourcePath+'/')).map(file=>({name:file.relativePath,size:file.size})):[]}]});setPath('')}}>添加为要求来源</button>
    <button disabled={busy} onClick={()=>external()}>添加外部要求文件夹</button>
    {spec.requirementSources.map((source:any)=><div className="sf-reference-row" key={source.resourceId}><strong>{source.path??`外部文件夹 · ${source.members.length} 个文件`}</strong><p>{source.state==='disconnected'?'授权已失效，需重新连接':source.origin==='external'?'已连接':'项目文件'}</p>
      {source.origin==='external'&&<button disabled={busy} onClick={()=>external(source.resourceId)}>重新连接此来源</button>}
      {source.kind==='file'&&/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(source.path??source.members[0]?.name??'')&&<button disabled={busy} onClick={()=>act(async()=>{const capability=await api('creation.imageCapability',{context:context()});if(capability.imageInput!==true)throw new Error(capability.imageInput===false?'当前模型不接受图片，请选择支持图片的模型，或粘贴图片中的要求文字。':'宿主未返回图片输入能力，请粘贴图片中的要求文字。');setImageCandidate(await api('creation.recognizeImage',{context:context(),spec,resourceId:source.resourceId}))})}>识别图片要求</button>}
      <button disabled={busy} onClick={()=>update({requirementSources:spec.requirementSources.filter((row:any)=>row.resourceId!==source.resourceId)})}>移除要求来源</button>
      {source.members.map((member:any)=><label className="sf-check" key={member.name}><input type="checkbox" checked onChange={()=>update({requirementSources:spec.requirementSources.map((row:any)=>row.resourceId===source.resourceId?{...row,members:row.members.filter((item:any)=>item.name!==member.name)}:row)})}/><span>{member.name}</span></label>)}
    </div>)}
    {imageCandidate&&<section role="dialog" aria-label="补充图片要求候选"><h4>图片转写候选 · {imageCandidate.name}</h4><textarea aria-label="图片要求候选文字" rows={6} maxLength={12000} value={imageCandidate.text} onChange={e=>setImageCandidate({...imageCandidate,text:e.target.value})}/><button disabled={busy||!imageCandidate.text.trim()} onClick={()=>act(async()=>{const requirements=[spec.requirements.trim(),imageCandidate.text.trim()].filter(Boolean).join('\n');if(requirements.length>12000)throw new Error('要求超过 12000 字，请编辑候选后采用。');update({requirements});setImageCandidate(undefined);setMessage('已采用图片文字，请核对后保存要求。')})}>采用图片要求文字</button><button disabled={busy} onClick={()=>setImageCandidate(undefined)}>放弃图片转写候选</button></section>}
    <h4>参考资料</h4>{materials.filter(file=>file.supported).map(file=><label className="sf-check" key={file.relativePath}><input type="checkbox" checked={spec.materials.includes(file.relativePath)} onChange={e=>{materialEdited.current=true;update({materials:e.target.checked?[...spec.materials,file.relativePath]:spec.materials.filter((name:string)=>name!==file.relativePath)})}}/><span>{file.relativePath}</span></label>)}
    <label className="sf-check"><input type="checkbox" checked={spec.online} onChange={e=>update({online:e.target.checked})}/><span>允许后续写作联网补充资料</span></label>
    <p className="sf-muted">联网检索还需在 ScholarFlow 设置中启用网络。</p>
    <button className="sf-primary" disabled={busy||!baseSpecHash} onClick={()=>act(async()=>{const row=await api('writingTask.inputs',{context:context(),baseSpecHash,baseMaterials:materialBase.current,materials:spec.materials,requirementSources:spec.requirementSources,online:spec.online});materialEdited.current=false;materialBase.current=[...row.spec.materials];onSaved(row);await refresh();setMessage('已保存写作来源与联网选项。')})}>保存来源与联网选项</button>
    <button disabled={busy||!spec.requirementSources.length||spec.requirementSources.some((source:any)=>source.state==='disconnected')} onClick={()=>act(async()=>{
      stopped.current=false;const current=JSON.parse(JSON.stringify(spec)),row=await api('creation.readRequirements',{context:context(),spec:current});readId.current=row.readId
      let result:any
      do{result=await api('creation.readStatus',{readId:row.readId});setRead(result);if(result.state==='reading')await new Promise(resolve=>setTimeout(resolve,700))}while(result.state==='reading'&&!stopped.current)
      if(stopped.current)return
      const structured=await api('creation.structure',{context:context(),spec:current,readId:row.readId,presetLength:current.targetLength});setCandidate({...structured.candidate,inputSpec:current})
    })}>读取并整理补充要求</button>
    {busy&&readId.current&&<button onClick={()=>{stopped.current=true;void api('creation.stopRead',{readId:readId.current}).catch((err:Error)=>setError(err.message))}}>停止读取</button>}
    {read&&<p role="status">{read.phase} · {read.done}/{read.total}{read.members.filter((member:any)=>member.state==='failed').map((member:any)=>` · ${member.name}：${member.note}`).join('')}</p>}
    {candidate&&<section role="dialog" aria-label="补充要求候选"><h4>要求变化预览</h4><pre>{JSON.stringify(candidate.diff,null,2)}</pre>{candidate.conflicts.map((conflict:any,index:number)=><p key={index}>{JSON.stringify(conflict)}</p>)}
      <button disabled={busy||JSON.stringify(spec)!==JSON.stringify(candidate.inputSpec)} onClick={()=>act(async()=>{const row=await api('candidates.adopt',{context:context(),candidateId:candidate.candidateId,spec:candidate.inputSpec,all:true});update(row.spec);setCandidate(undefined);setMessage('已采用候选，请核对后点击「保存要求」。')})}>采用补充要求候选</button>
      <button disabled={busy} onClick={()=>act(async()=>{await api('candidates.discard',{context:context(),candidateId:candidate.candidateId});setCandidate(undefined)})}>放弃补充要求候选</button>
    </section>}
  </details>
}
