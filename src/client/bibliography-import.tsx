import React,{useEffect,useRef,useState} from 'react'

export function BibliographyImport({api,context,refresh,run,busy}:any){
  const [text,setText]=useState(''),[format,setFormat]=useState('bibtex'),[plan,setPlan]=useState<any>(),[selected,setSelected]=useState<number[]>([])
  const [reasons,setReasons]=useState<Record<number,string>>({}),[message,setMessage]=useState('')
  const pending=useRef<string|undefined>(undefined);pending.current=plan?.id
  useEffect(()=>()=>{if(pending.current)void api('sources.dismissBibliography',{planId:pending.current}).catch(()=>{})},[])
  return <section aria-label="导入书目"><h4>导入 BibTeX / RIS</h4>
    <label>书目格式<select aria-label="书目格式" value={format} disabled={busy||!!plan} onChange={e=>setFormat(e.target.value)}><option value="bibtex">BibTeX</option><option value="ris">RIS</option></select></label>
    {!plan&&<><label>书目文件<input aria-label="书目文件" type="file" accept=".bib,.ris,.txt" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void run(async()=>{if(file.size>2*1024*1024)throw new Error('书目文件最多 2 MiB。');setText(await file.text());if(file.name.toLowerCase().endsWith('.ris'))setFormat('ris')})}}/></label>
      <label>书目内容<textarea aria-label="书目内容" rows={7} value={text} maxLength={2*1024*1024} onChange={e=>setText(e.target.value)}/></label>
      <button disabled={busy||!text.trim()} onClick={()=>run(async()=>{const row=await api('sources.prepareBibliography',{context:context(),text,format});setPlan(row);setSelected(row.candidates.filter((candidate:any)=>!candidate.matches.length).map((candidate:any)=>candidate.index));setMessage('')})}>解析并预览书目</button></>}
    {plan&&<section role="dialog" aria-label="书目导入确认"><p>选择要登记的元数据。重复 DOI 沿用原引用键；标题相似可填写理由分别保留。</p>
      {plan.candidates.map((row:any)=><div className="sf-reference-row" key={row.index}><label className="sf-check"><input type="checkbox" disabled={busy||row.exactDuplicate} checked={selected.includes(row.index)} onChange={e=>setSelected(e.target.checked?[...selected,row.index]:selected.filter(index=>index!==row.index))}/><span>{row.source.title} · {row.source.year??'未提供年份'}</span></label>
        <p>{row.source.authors.map((author:any)=>author.literal).join(', ')} · {row.source.identifiers.doi??row.source.identifiers.url??'未提供标识'}</p>
        {row.matches.map((match:any)=><p key={match.sourceId}>疑似重复：{match.title} · {match.citeKey??match.sourceId}{row.exactDuplicate?' · 同一 DOI':''}</p>)}
        {row.matches.length>0&&!row.exactDuplicate&&selected.includes(row.index)&&<label>分别保留的理由<input aria-label={`保留书目 ${row.index+1} 的理由`} value={reasons[row.index]??''} maxLength={4000} onChange={e=>setReasons({...reasons,[row.index]:e.target.value})}/></label>}
      </div>)}
      <button className="sf-primary" disabled={busy||!selected.length||selected.some(index=>plan.candidates[index].matches.length&&!reasons[index]?.trim())} onClick={()=>run(async()=>{const row=await api('sources.confirmBibliography',{context:context(),planId:plan.id,planHash:plan.planHash,selected:selected.map(index=>({index,reason:reasons[index]??''}))});setPlan(undefined);setText('');setMessage(`已登记 ${row.sources.length} 个来源；身份仍待核验，尚未创建定位证据。`);await refresh()})}>确认登记所选书目</button><button disabled={busy} onClick={()=>run(async()=>{await api('sources.dismissBibliography',{planId:plan.id});setPlan(undefined)})}>取消书目导入</button>
    </section>}{message&&<p role="status">{message}</p>}
  </section>
}
