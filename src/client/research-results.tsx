import React,{useEffect,useState} from 'react'
import type {ResultMapping} from '../shared/results.ts'
const labels={task:'任务',dataset:'数据集',split:'评测划分',method:'方法',baseline:'基线',settings:'实验设置',protocol:'评测协议',run:'运行记录',seed:'随机种子'}
export function ResearchResults({project,api,context,run,busy,refresh}:any){
  const [state,setState]=useState<any>(),[materialId,setMaterialId]=useState(''),[title,setTitle]=useState(''),[file,setFile]=useState<any>(),[plan,setPlan]=useState<any>(),[previous,setPrevious]=useState(''),[pointer,setPointer]=useState(''),[error,setError]=useState('')
  const [mapping,setMapping]=useState<ResultMapping>({recordsPointer:'',valueField:'',metric:'',unit:'',conditions:{},conditionFields:{},direction:'unspecified'})
  const materials=(Object.values(project.ledger.materials) as any[]).filter(row=>/\.(csv|json|txt|md)$/iu.test(row.projectRelativePath)&&project.config.materials.include.includes(row.projectRelativePath))
  useEffect(()=>{let live=true;api('results.inspect',{context:context()}).then((value:any)=>{if(live){setState(value);setError('')}}).catch((e:Error)=>live&&setError(e.message));return()=>{live=false}},[project.ledger.revision,project.binding.projectId])
  const update=(next:Partial<ResultMapping>)=>{setMapping({...mapping,...next});setPlan(undefined)}
  const records=Object.values(state?.experiments.records??{}) as any[]
  return <section aria-label="研究结果"><h3>研究结果</h3>{error&&<p role="alert">{error}</p>}
    {records.map(record=><details key={record.id} className="sf-detail"><summary>{record.title} · {record.conditions.method} · 版本 {record.version}{record.status==='superseded'?'（历史）':''}</summary>
      <p>{record.conditions.dataset} · {record.conditions.split} · {record.conditions.protocol}</p>
      {record.measurementEvidenceIds.map((id:string)=>{const evidence=project.ledger.evidence[id];return <p key={id}>{evidence?.measurement?.metric}：{evidence?.measurement?.value} {evidence?.measurement?.unit} · {evidence?.validation==='located'?'已定位作者供给':'需重核'} · {evidence?.locator.rowRange}</p>})}
      {record.status==='current'&&<button disabled={busy} onClick={()=>{setPrevious(record.id);setMaterialId(record.materialId);setTitle(record.title);setFile(undefined);setPlan(undefined)}}>更新结果与配置</button>}
    </details>)}
    <details className="sf-detail"><summary>{previous?'预览结果更新':'导入结果表'}</summary>
      <label>结果资料<select aria-label="结果资料" value={materialId} onChange={e=>{setMaterialId(e.target.value);setFile(undefined);setPlan(undefined);setPrevious('')}}><option value="">选择已登记资料</option>{materials.map(row=><option key={row.id} value={row.id}>{row.projectRelativePath}</option>)}</select></label>
      <label>实验名称<input aria-label="实验名称" value={title} onChange={e=>{setTitle(e.target.value);setPlan(undefined)}}/></label>
      <label>JSON 记录位置<input aria-label="JSON 记录位置" placeholder="数组在根目录时留空" value={pointer} onChange={e=>{setPointer(e.target.value);setFile(undefined);setPlan(undefined)}}/></label>
      <button disabled={busy||!materialId} onClick={()=>run(async()=>{setPlan(undefined);setFile(await api('results.inspectFile',{context:context(),materialId,recordsPointer:pointer}))})}>读取字段与原值</button>
      {file&&<><p>{file.recordCount} 条记录 · {file.readScope}</p><pre>{file.cells.map((cell:any)=>`${cell.recordIndex+1} ${cell.field}: ${cell.raw} (${cell.locator.rowRange})`).join('\n')}</pre>
        {(['valueField','metricField','unitField'] as const).map(key=><label key={key}>{({valueField:'数值字段',metricField:'指标字段',unitField:'单位字段'})[key]}<select aria-label={key} value={mapping[key]??''} onChange={e=>update({[key]:e.target.value||undefined,...(key==='metricField'?{metric:undefined}:key==='unitField'?{unit:undefined}:{})})}><option value="">选择字段或填写固定值</option>{file.fields.map((field:string)=><option key={field} value={field}>{field}</option>)}</select></label>)}
        {!mapping.metricField&&<label>指标名<input value={mapping.metric??''} onChange={e=>update({metric:e.target.value})}/></label>}
        {!mapping.unitField&&<label>单位<input value={mapping.unit??''} onChange={e=>update({unit:e.target.value})}/></label>}
        <label>指标方向<select value={mapping.direction} onChange={e=>update({direction:e.target.value as ResultMapping['direction']})}><option value="unspecified">未提供</option><option value="higher">越高越好</option><option value="lower">越低越好</option></select></label>
        {(Object.keys(labels) as Array<keyof typeof labels>).map(key=><div key={key}><label>{labels[key]}<input value={mapping.conditions[key]??''} disabled={!!mapping.conditionFields[key]} onChange={e=>update({conditions:{...mapping.conditions,[key]:e.target.value}})}/></label>
          <select aria-label={`${key}字段`} value={mapping.conditionFields[key]??''} onChange={e=>{const fields={...mapping.conditionFields};if(e.target.value)fields[key]=e.target.value;else delete fields[key];update({conditionFields:fields})}}><option value="">使用填写的条件</option>{file.fields.map((field:string)=><option key={field} value={field}>{field}</option>)}</select></div>)}
        <button disabled={busy||!title.trim()||!mapping.valueField} onClick={()=>run(async()=>{const preview=await api(previous?'results.prepareUpdate':'results.prepareImport',{context:context(),materialId,title,mapping:{...mapping,recordsPointer:pointer},...(previous&&{previousExperimentId:previous})});setPlan(preview)})}>预览映射与影响</button>
      </>}
      {plan&&<section aria-label="结果映射预览"><p>{plan.rows.filter((row:any)=>!row.problems.length).length} 条可导入，{plan.rows.filter((row:any)=>row.problems.length).length} 条有缺项。</p>
        <table><thead><tr><th>指标与原值</th><th>原位置</th><th>条件／缺项</th></tr></thead><tbody>{plan.rows.map((row:any)=><tr key={row.recordIndex}><td>{row.metric}：{row.rawValue} {row.unit}</td><td>{row.locator.rowRange}</td><td>{row.problems.length?row.problems.join('；'):`${row.conditions.dataset} / ${row.conditions.split} / ${row.conditions.method} / ${row.conditions.settings}`}</td></tr>)}</tbody></table>
        {previous&&<p>影响 {plan.impact.claimIds.length} 个论点、{plan.impact.blockIds.length} 个段落；摘要与结论需要复查。当前人工正文保留。</p>}
        <p>确认这些记录属于我的研究，当前映射与原材料一致。工具未重新执行实验。</p>
        <button disabled={busy||!plan.rows.some((row:any)=>!row.problems.length)} onClick={()=>run(async()=>{await api(previous?'results.confirmUpdate':'results.confirmImport',{context:context(),planId:plan.id,planHash:plan.planHash,authorConfirmed:true});setPlan(undefined);setPrevious('');await refresh()})}>确认导入作者结果</button>
        <button disabled={busy} onClick={()=>run(async()=>{await api('results.dismissImport',{planId:plan.id});setPlan(undefined)})}>保留原记录</button>
      </section>}
    </details>
  </section>
}
