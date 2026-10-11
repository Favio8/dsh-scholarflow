import React, { useEffect, useState } from 'react'
import { MarkdownView } from './markdown.tsx'
import { projectMarkdown } from '../core/editing/markdown.ts'
import {diffSegments} from './rewrite-candidate.tsx'

export function PaperVersions({ project, api, context, refresh }: any) {
  const [versions, setVersions] = useState<any[]>([]), [selected, setSelected] = useState<any>(), [error, setError] = useState('')
  const [compare,setCompare]=useState<any>(),[plan,setPlan]=useState<any>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const act=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work()}catch(err){setError((err as Error).message)}finally{setBusy(false)}}
  const read=(revisionId:string)=>api('document.versions',{context:context(),revisionId})
  useEffect(() => { let live = true
    api('document.versions', { context: context() }).then((result: any) => live && setVersions(result.versions)).catch((error: Error) => live && setError(error.message))
    return () => { live = false }
  }, [project.document.contentHash,project.document.revisionId])
  return <section className="sf-materials-panel"><h2>版本记录</h2><p className="sf-muted">比较任意两个保存版本；恢复会创建新修订，保留全部历史。</p>
    {message&&<p role="status">{message}</p>}
    {versions.map((row, index) => <div className="sf-reference-row" key={row.revisionId}><button disabled={busy} onClick={()=>act(async()=>{
      setSelected(await read(row.revisionId));setCompare(undefined);setPlan(undefined)
    })}>版本 {versions.length - index}{row.revisionId === project.document.revisionId && ' · 当前版本'}</button><span> {new Date(row.createdAt).toLocaleString()} · {row.origin === 'user-manual' ? '编辑保存' : row.origin?.startsWith('version-restore:') ? '恢复历史版本' : row.origin?.startsWith('prop_') ? '接受 AI 建议' : '稿件快照'}</span></div>)}
    {selected && <section className="sf-material-excerpt"><header><strong>版本预览</strong><button onClick={() => {setSelected(undefined);setPlan(undefined)}}>关闭</button></header>
      <label>与版本比较 <select aria-label="与版本比较" value={compare?.revision.revisionId??''} onChange={e=>{const value=e.target.value;void act(async()=>setCompare(value?await read(value):undefined))}}><option value="">选择另一版本</option>{versions.filter(row=>row.revisionId!==selected.revision.revisionId).map(row=><option key={row.revisionId} value={row.revisionId}>{new Date(row.createdAt).toLocaleString()}</option>)}</select></label>
      {compare?<div className="sf-change"><h4>对照版本与所选版本</h4><pre className="sf-change-diff">{diffSegments(compare.text,selected.text).map((row,index)=>row.kind==='add'?<ins key={index}>{row.text}</ins>:row.kind==='remove'?<del key={index}>{row.text}</del>:<React.Fragment key={index}>{row.text}</React.Fragment>)}</pre><details><summary>查看两个版本原文</summary><h4>对照版本</h4><pre>{compare.text}</pre><h4>所选版本</h4><pre>{selected.text}</pre></details><p>{compare.text===selected.text?'正文相同':'正文存在差异；恢复采用所选版本正文。'}</p></div>:<MarkdownView projection={projectMarkdown(selected.text)}/>}
      <button disabled={busy||selected.revision.revisionId===project.document.revisionId} onClick={()=>act(async()=>setPlan(await api('document.restoreVersion',{context:context(),revisionId:selected.revision.revisionId})))}>预览恢复此版本</button>
    </section>}
    {plan&&<section role="dialog" aria-label="恢复历史版本确认"><h4>恢复为新修订</h4><p>当前正文将由此版本正文替换。恢复前的版本仍保留；审查结果需重新生成。</p>
      <details><summary>当前正文</summary><pre>{plan.currentText}</pre></details><details open><summary>恢复后的正文</summary><pre>{plan.text}</pre></details>
      <button className="sf-primary" disabled={busy} onClick={()=>act(async()=>{await api('document.restoreVersion',{context:context(),revisionId:plan.revisionId,planHash:plan.planHash});setPlan(undefined);setSelected(undefined);setMessage('已恢复为新修订，原版本仍在历史中。');await refresh()})}>确认恢复为新修订</button><button disabled={busy} onClick={()=>setPlan(undefined)}>取消恢复</button>
    </section>}
    {error && <p role="alert">{error}</p>}
  </section>
}
