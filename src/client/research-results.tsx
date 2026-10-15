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
      {record.status==='current'&&<ResultLinks key={record.id+':'+project.ledger.revision} {...{record,state,project,api,context,run,busy,refresh}}/>}
    </details>)}
    {state&&<ResearchInputs key={state.materialRoles?.confirmedAt??'unconfirmed'} {...{state,project,api,context,run,busy,refresh}}/>}
    <ResultComparison {...{state,project,api,context,run,busy,refresh}}/>
    <details className="sf-detail" open={!!previous}><summary>{previous?'预览结果更新':'导入结果表'}</summary>
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
          <select aria-label={`${key}字段`} value={mapping.conditionFields[key]??''} onChange={e=>{const fields={...mapping.conditionFields},conditions={...mapping.conditions};if(e.target.value){fields[key]=e.target.value;delete conditions[key]}else delete fields[key];update({conditionFields:fields,conditions})}}><option value="">使用填写的条件</option>{file.fields.map((field:string)=><option key={field} value={field}>{field}</option>)}</select></div>)}
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
function ResearchInputs({state,project,api,context,run,busy,refresh}:any){
  const selected=(Object.values(project.ledger.materials) as any[]).filter(material=>project.config.materials.include.includes(material.projectRelativePath)),[roles,setRoles]=useState<Record<string,string>>(Object.fromEntries((state.materialRoles?.roles??[]).map((row:any)=>[row.path,row.role])))
  return <details className="sf-detail"><summary>方法、设置、结果与文献用途</summary><p>明确哪些材料属于作者已有研究；外部文献不能转为作者结果。调整用途后须按当前输入重新预览任务，旧候选仍保留。</p>
    {selected.map(material=><label key={material.id}>{material.projectRelativePath}<select value={roles[material.projectRelativePath]??'literature'} onChange={e=>setRoles({...roles,[material.projectRelativePath]:e.target.value})}><option value="method">作者方法与实现说明</option><option value="results">作者结果与运行记录</option><option value="settings">作者实验设置</option><option value="figure">作者已有图像</option><option value="literature">外部相关工作</option></select></label>)}
    <button disabled={busy} onClick={()=>run(async()=>{await api('results.confirmInputs',{context:context(),roles:selected.map(material=>({path:material.projectRelativePath,role:roles[material.projectRelativePath]??'literature'})),authorConfirmed:true});await refresh()})}>确认资料用途与作者归属</button>
  </details>
}

function ResultLinks({record,state,project,api,context,run,busy,refresh}:any){
  const association=state.associations?.records[record.id]
  const [claims,setClaims]=useState<string[]>(record.links.claimIds),[sections,setSections]=useState<string[]>(record.links.sectionIds),[figures,setFigures]=useState<any[]>(association?.figures??[]),[table,setTable]=useState<any>()
  const toggle=(values:string[],id:string)=>values.includes(id)?values.filter(value=>value!==id):[...values,id]
  const claimChoices=Object.values(project.ledger.claims).filter((claim:any)=>claim.evidenceLinks.some((link:any)=>record.measurementEvidenceIds.includes(link.evidenceId))) as any[],images=Object.values(project.ledger.materials).filter((material:any)=>/\.(png|jpe?g)$/iu.test(material.projectRelativePath)&&project.config.materials.include.includes(material.projectRelativePath)) as any[]
  return <details className="sf-detail"><summary>关联贡献、章节与图表</summary>
    {!claimChoices.length&&<p>请先在资料的论点维护中把贡献与实际测量建立支持或部分支持关系。</p>}
    {claimChoices.map(claim=><label key={claim.id}><input type="checkbox" checked={claims.includes(claim.id)} onChange={()=>setClaims(toggle(claims,claim.id))}/>{claim.text}</label>)}
    {project.ledger.outline.sections.map((section:any)=><label key={section.id}><input type="checkbox" checked={sections.includes(section.id)} onChange={()=>setSections(toggle(sections,section.id))}/>{section.title}</label>)}
    {images.map(image=>{const selected=figures.find(figure=>figure.path===image.projectRelativePath);return <div key={image.id}><label><input type="checkbox" checked={!!selected} onChange={()=>setFigures(selected?figures.filter(figure=>figure.path!==image.projectRelativePath):[...figures,{path:image.projectRelativePath,description:'',evidenceIds:record.measurementEvidenceIds}])}/>{image.projectRelativePath}</label>
      {selected&&<label>作者图像说明<textarea value={selected.description} onChange={e=>setFigures(figures.map(figure=>figure===selected?{...figure,description:e.target.value}:figure))}/></label>}
    </div>})}
    <p>图像关联保存实际资源版本、作者说明和本实验测量；软件不宣称已核验曲线或图内全部数值。</p>
    <button disabled={busy||figures.some(figure=>!figure.description.trim())} onClick={()=>run(async()=>{await api('results.associate',{context:context(),experimentId:record.id,storeHash:state.storeHash,claimIds:claims,sectionIds:sections,figures:figures.map(({path,description,evidenceIds})=>({path,description,evidenceIds}))});await refresh()})}>保存结果关联</button>
    <button disabled={busy} onClick={()=>run(async()=>setTable(await api('results.table',{context:context(),experimentId:record.id})))}>从确认记录生成指标表</button>
    {table&&<><p>{table.scope} · {table.conditions.dataset} / {table.conditions.split} / {table.conditions.method}</p><textarea aria-label="确认记录指标表" readOnly value={table.markdown} onFocus={e=>e.target.select()}/><p>复制到正文后保留实验条件；改动显示数值须先更新来源记录。</p></>}
  </details>
}
function ResultComparison({state,project,api,context,run,busy,refresh}:any){
  const [left,setLeft]=useState(''),[right,setRight]=useState(''),[conversion,setConversion]=useState('none'),[decimals,setDecimals]=useState(2),[plan,setPlan]=useState<any>()
  const currentIds=new Set((Object.values(state?.experiments.records??{}) as any[]).filter(record=>record.status==='current').flatMap(record=>record.measurementEvidenceIds)),choices=(Object.values(project.ledger.evidence) as any[]).filter(evidence=>currentIds.has(evidence.id)&&evidence.validation==='located')
  return <details className="sf-detail"><summary>比较已确认结果</summary>{[['基线结果',left,setLeft],['本方法结果',right,setRight]].map(([label,value,set]:any)=><label key={label}>{label}<select value={value} onChange={e=>{set(e.target.value);setPlan(undefined)}}><option value="">选择作者测量</option>{choices.map(evidence=><option key={evidence.id} value={evidence.id}>{evidence.measurement.metric}：{evidence.measurement.value} {evidence.measurement.unit} · {evidence.measurement.conditions}</option>)}</select></label>)}
    <label>本方法值换算<select value={conversion} onChange={e=>{setConversion(e.target.value);setPlan(undefined)}}><option value="none">保留原单位</option><option value="seconds-to-ms">s → ms</option><option value="ms-to-seconds">ms → s</option><option value="fraction-to-percent">fraction → %</option><option value="percent-to-fraction">% → fraction</option></select></label>
    <label>小数位<input type="number" min="0" max="12" value={decimals} onChange={e=>{setDecimals(Number(e.target.value));setPlan(undefined)}}/></label>
    <button disabled={busy||!left||!right||left===right} onClick={()=>run(async()=>setPlan(await api('results.compare',{context:context(),leftEvidenceId:left,rightEvidenceId:right,decimals,conversion})))}>预览实际比较</button>
    {plan&&<section aria-label="结果比较预览">{plan.comparison.comparability==='comparable'?<><p>绝对变化：{plan.comparison.absoluteChange} {plan.comparison.changeUnit==='percentage-points'?'个百分点':plan.comparison.changeUnit}；相对变化：{plan.comparison.relativePercent===undefined?'基线为零，无法计算':plan.comparison.relativePercent+'%'}；指标方向：{plan.comparison.improved?'改善':'未改善'}。</p><p>舍入：decimal-toFixed，小数 {plan.comparison.rounding.decimals} 位。未提供重复运行或统计依据，不生成标准差、显著性或置信区间。</p><button disabled={busy} onClick={()=>run(async()=>{await api('results.confirmComparison',{context:context(),planId:plan.id,planHash:plan.planHash});setPlan(undefined);await refresh()})}>确认比较依据</button></>:<p>不能确认可比结论：{plan.comparison.differences.join('、')}。跨数据集、划分或协议的记录分别保留。</p>}</section>}
  </details>
}
