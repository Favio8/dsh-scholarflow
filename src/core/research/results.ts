import { resultPrepareRequest,resultConditions,experimentStoreSchema,experimentRecordSchema,type ExperimentRecord } from '../../shared/results.ts'
import { sourceSchema,evidenceSchema, type RequestContext } from '../../shared/schema.ts'
import { parsedMaterialSchema } from '../../shared/materials.ts'
import { invariant,parseStored } from '../../shared/errors.ts'
import { digest,json,newId,type FileStore } from '../store/files.ts'
import { snapshot,mutateLedger,invalidateReviews } from '../project/project.ts'
import { materialCachePath } from '../materials/materials.ts'
import { parseResultBytes,RESULT_MAX_BYTES } from './result-parser.ts'

const EXPERIMENTS='.scholarflow/research/experiments.json'
export async function inspectResults(io:FileStore){const current=await snapshot(io),file=await io.read(EXPERIMENTS)
  const experiments=file?parseStored(experimentStoreSchema,file.text,'RESULT_VERSION_UNSUPPORTED','results.inspect'):{schemaVersion:1 as const,projectId:current.ledger.projectId,records:{} as Record<string,ExperimentRecord>}
  invariant(experiments.projectId===current.ledger.projectId,'PROJECT_ID_CONFLICT','实验记录不属于当前项目。')
  return {experiments,storeHash:file?digest(file.text):null,measurements:Object.values(current.ledger.evidence).filter(evidence=>evidence.measurement&&current.ledger.sources[evidence.sourceId]?.kind==='user-result')}
}
export async function prepareResultImport(io:FileStore,request:unknown,signal?:AbortSignal){
  const input=resultPrepareRequest.parse(request),current=await snapshot(io),material=current.ledger.materials[input.materialId]
  invariant(input.context.projectId===current.ledger.projectId&&input.context.expectedLedgerRevision===current.ledger.revision,'STALE_LEDGER_REVISION','结果映射需要当前项目与数据版本。')
  invariant(material&&current.config.materials.include.includes(material.projectRelativePath),'MATERIAL_ACCESS_DENIED','请先明确选用结果文件。')
  invariant(!Object.values(current.ledger.sources).some(source=>source.materialId===material.id&&source.kind!=='user-result'),'MEASUREMENT_ORIGIN_INVALID','该资料已登记为外部来源，不能改为作者结果。')
  const bytes=await io.readBytes(material.projectRelativePath,RESULT_MAX_BYTES,signal),sourceHash=digest(bytes),parsed=parseResultBytes(bytes,material.projectRelativePath,input.mapping.recordsPointer,signal)
  const mappingHash=digest(json(input.mapping)),resultState=await inspectResults(io),previous=input.previousExperimentId?resultState.experiments.records[input.previousExperimentId]:undefined
  invariant(!input.previousExperimentId||previous?.status==='current','EXPERIMENT_VERSION_CHANGED','待更新实验不是当前有效版本。')
  const referenced=[input.mapping.valueField,input.mapping.metricField,input.mapping.unitField,...Object.values(input.mapping.conditionFields)].filter(Boolean) as string[]
  invariant(referenced.every(field=>parsed.fields.includes(field)),'RESULT_MAPPING_INVALID','映射字段不存在于当前原文件，不能猜测。')
  invariant(!input.mapping.metricField||!input.mapping.metric,'RESULT_MAPPING_CONFLICT','指标列与固定指标不能同时指定。')
  invariant(!input.mapping.unitField||input.mapping.unit===undefined,'RESULT_MAPPING_CONFLICT','单位列与固定单位不能同时指定。')
  const rows=parsed.records.map(recordIndex=>{
    const cells=parsed.cells.filter(cell=>cell.recordIndex===recordIndex),cell=(field?:string)=>cells.find(cell=>cell.field===field)
    const value=cell(input.mapping.valueField)!,metric=String(cell(input.mapping.metricField)?.value??input.mapping.metric??''),unit=String(cell(input.mapping.unitField)?.value??input.mapping.unit??'')
    const conditions={...input.mapping.conditions};for(const [key,field] of Object.entries(input.mapping.conditionFields))
      (conditions as Record<string,string>)[key]=String(cell(field)?.value??'')
    const validated=resultConditions.safeParse(conditions),problems:string[]=[]
    if(!metric.trim())problems.push('指标名缺失')
    if(value.value===null||typeof value.value==='boolean'||!String(value.value).trim()||['NA','N/A','NaN','null','undefined','Infinity','-Infinity'].includes(String(value.value)))problems.push('原值缺失或异常')
    if(!validated.success)problems.push(...validated.error.issues.map(issue=>`实验条件未提供：${issue.path.join('.')}`))
    return {recordIndex,metric,unit,value:typeof value.value==='number'?value.value:String(value.value??''),rawValue:value.raw,locator:value.locator,
      conditions,problems,cells}
  })
  const oldEvidence=previous?.measurementEvidenceIds??[],claimIds=Object.values(current.ledger.claims).filter(claim=>claim.evidenceLinks.some(link=>oldEvidence.includes(link.evidenceId))).map(claim=>claim.id)
  const affectedBlocks=Object.values(current.ledger.claimAnchors).filter(anchor=>anchor.claimIds.some(id=>claimIds.includes(id))).map(anchor=>anchor.blockId)
  const body={schemaVersion:1,id:newId('result_import'),projectId:current.ledger.projectId,sessionId:input.context.sessionId,workspaceId:input.context.workspaceId,
    input,materialPath:material.projectRelativePath,sourceHash,mappingHash,storeHash:resultState.storeHash,configHash:current.configHash,
    previousHash:previous?digest(json(previous)):null,fields:parsed.fields,rows,
    impact:{claimIds,blockIds:affectedBlocks,figurePaths:previous?.links.figurePaths??[],summaryAndConclusionNeedRecheck:!!previous},
    limitations:['作者供给及映射确认不表示工具重新执行实验。','未提供统计方法和重复运行时，不产生标准差、显著性或置信区间。']}
  return {...body,planHash:digest(json(body))}
}
export type ResultImportPlan=Awaited<ReturnType<typeof prepareResultImport>>
export async function confirmResultImport(io:FileStore,context:RequestContext,plan:ResultImportPlan,authorConfirmed:boolean){
  const {planHash,...body}=plan
  invariant(authorConfirmed&&digest(json(body))===planHash&&context.projectId===plan.projectId&&context.sessionId===plan.sessionId&&context.workspaceId===plan.workspaceId,'INVALID_APPROVAL','作者确认、映射内容或项目绑定不符。')
  const receiptPath=`.scholarflow/research/imports/${plan.id}.json`,receipt=await io.read(receiptPath)
  if(receipt){const stored=JSON.parse(receipt.text);invariant(stored.planHash===planHash&&stored.projectId===context.projectId,'INVALID_APPROVAL','导入 token 已用于其他计划。');return {...stored,alreadyImported:true}}
  let experimentIds:string[]=[]
  const result=await mutateLedger(io,context.expectedLedgerRevision!,async(ledger,config)=>{
    invariant(digest(await io.readBytes(plan.materialPath,RESULT_MAX_BYTES))===plan.sourceHash,'STALE_MATERIAL_VERSION','原文件已变化，旧映射确认失效。')
    invariant((await snapshot(io)).configHash===plan.configHash&&config.materials.include.includes(plan.materialPath),'RESULT_INPUT_CHANGED','结果读取范围或项目配置已变化。')
    const currentFile=await io.read(EXPERIMENTS)
    invariant((currentFile?digest(currentFile.text):null)===plan.storeHash,'EXPERIMENT_VERSION_CHANGED','实验记录已有新版本，请重新查看影响。')
    const state=currentFile?parseStored(experimentStoreSchema,currentFile.text,'RESULT_VERSION_UNSUPPORTED','results.confirm'):{schemaVersion:1 as const,projectId:ledger.projectId,records:{} as Record<string,ExperimentRecord>}
    const previous=plan.input.previousExperimentId?state.records[plan.input.previousExperimentId]:undefined
    invariant(!plan.input.previousExperimentId||previous&&digest(json(previous))===plan.previousHash,'EXPERIMENT_VERSION_CHANGED','原实验版本已改变。')
    const valid=plan.rows.filter(row=>!row.problems.length)
    invariant(valid.length,'RESULT_MAPPING_INCOMPLETE','当前映射没有完整结果，请修正缺失字段后预览。')
    // Immutable old source/evidence bytes remain in the ledger; old uses are marked stale.
    const material=ledger.materials[plan.input.materialId]
    invariant(material?.projectRelativePath===plan.materialPath,'MATERIAL_ACCESS_DENIED','结果文件身份已改变。')
    for(const evidence of Object.values(ledger.evidence))if(ledger.sources[evidence.sourceId]?.materialId===material.id&&evidence.sourceContentHash!==plan.sourceHash)evidence.validation='stale'
    for(const claim of Object.values(ledger.claims))if(claim.evidenceLinks.some(link=>ledger.evidence[link.evidenceId]?.validation==='stale'||previous?.measurementEvidenceIds.includes(link.evidenceId)))claim.status='stale'
    const sourceId=newId('src')
    ledger.sources[sourceId]=sourceSchema.parse({id:sourceId,kind:'user-result',title:plan.input.title,authors:[],identifiers:{},citeKey:`sf_${sourceId.slice(4,16)}`,
      provenance:[{provider:'author-result-import',retrievedAt:new Date().toISOString()}],identity:{status:'unverified',method:'user-confirmed',reason:'作者确认结果归属与映射；未独立复现实验或认定出版身份。'},
      textAccess:'excerpt',materialId:material.id,contentHash:plan.sourceHash,publicationState:'unknown'})
    const groups=new Map<string,typeof valid>();for(const row of valid){const key=json(row.conditions);groups.set(key,[...groups.get(key)??[],row])}
    for(const rows of groups.values()){
      const experimentId=newId('experiment'),evidenceIds:string[]=[]
      for(const row of rows){const evidenceId=newId('ev');evidenceIds.push(evidenceId)
        ledger.evidence[evidenceId]=evidenceSchema.parse({id:evidenceId,sourceId,sourceContentHash:plan.sourceHash,locator:row.locator,excerpt:row.rawValue,
          interpretation:`作者确认 ${row.metric}；原值 ${row.rawValue}；${row.unit||'单位未提供'}`,kind:'user-measurement',acquisition:'parser',validation:'located',
          measurement:{metric:row.metric,value:row.value,unit:row.unit,conditions:json(row.conditions),origin:'user-supplied'}})
      }
      state.records[experimentId]=experimentRecordSchema.parse({schemaVersion:1,id:experimentId,projectId:ledger.projectId,version:previous?previous.version+1:1,previousId:previous?.id,
        status:'current',title:plan.input.title,sourceId,sourceHash:plan.sourceHash,materialId:material.id,mappingHash:plan.mappingHash,
        conditions:rows[0].conditions,measurementEvidenceIds:evidenceIds,direction:plan.input.mapping.direction,
        links:{claimIds:[],sectionIds:[],figurePaths:[]},confirmedAt:new Date().toISOString(),confirmedBy:context.sessionId})
      experimentIds.push(experimentId)
    }
    if(previous)previous.status='superseded'
    const parser={id:'sf-result-records',version:'1-csv-parse-7.0.3'},ranges=[{kind:'paragraphs' as const,from:1,to:Math.max(1,plan.rows.length)}]
    const parsed=parsedMaterialSchema.parse({schemaVersion:1,materialId:material.id,sourceContentHash:plan.sourceHash,parser,
      blocks:plan.rows.map(row=>({text:row.cells.map(cell=>`${cell.field}: ${cell.raw}`).join('\n'),locator:row.locator,kind:'table'})),
      coverage:'partial',warnings:['只读取映射记录和已列字段；未核验图像、公式或作者实验。'],unprocessedContent:[],ranges})
    Object.assign(material,{contentHash:plan.sourceHash,parseStatus:'partial',parser,parsedRanges:ranges})
    invalidateReviews(ledger,['evidence','integrity','logic','requirement'])
    const cachePath=materialCachePath(material.id,plan.sourceHash,parser,ranges),cache=await io.read(cachePath)
    invariant(!cache||cache.text===json(parsed),'RESULT_CACHE_CHANGED','解析快照已改变，未覆盖。')
    return [{path:EXPERIMENTS,before:currentFile,after:json(experimentStoreSchema.parse(state))},
      ...(!cache?[{path:cachePath,before:undefined,after:json(parsed)}]:[]),
      {path:receiptPath,before:undefined,after:json({schemaVersion:1,projectId:ledger.projectId,planHash,sourceHash:plan.sourceHash,mappingHash:plan.mappingHash,sourceId,experimentIds,
        omittedRows:plan.rows.filter(row=>row.problems.length).map(row=>({recordIndex:row.recordIndex,problems:row.problems})),impact:plan.impact,confirmedAt:new Date().toISOString(),confirmedBy:context.sessionId})}]
  })
  return {experimentIds,revision:result.revision,alreadyImported:false}
}
export function compareResults(left:{record:ExperimentRecord;value:number;unit:string;metric?:string},right:{record:ExperimentRecord;value:number;unit:string;metric?:string},decimals=2){
  invariant(Number.isFinite(left.value)&&Number.isFinite(right.value)&&Number.isInteger(decimals)&&decimals>=0&&decimals<=12,'RESULT_VALUE_INVALID','比较需要有限真实数值和明确舍入位数。')
  const keys=['task','dataset','split','protocol','settings'] as const
  const differences=keys.filter(key=>left.record.conditions[key]!==right.record.conditions[key])
  if(left.unit!==right.unit)differences.push('unit' as typeof keys[number])
  if(left.metric!==right.metric)differences.push('metric' as typeof keys[number])
  if(differences.length)return {comparability:'incomparable' as const,differences}
  if(!left.metric||!right.metric||!left.unit||left.record.direction==='unspecified'||right.record.direction!==left.record.direction)return {comparability:'needs-check' as const,differences:['metric, unit or direction missing']}
  const delta=right.value-left.value,round=(value:number)=>Number(value.toFixed(decimals))
  return {comparability:'comparable' as const,absoluteChange:round(delta),changeUnit:left.unit==='%'?'percentage-points':left.unit,
    relativePercent:left.value===0?undefined:round(delta/left.value*100),improved:left.record.direction==='higher'?delta>0:delta<0,
    rounding:{method:'decimal-toFixed',decimals},inputs:{left:left.value,right:right.value},statistics:'not-provided' as const}
}
