import {researchMaterialRolesSchema,researchMaterialRolesRequest} from '../../shared/results.ts'
import {snapshot,mutateLedger,invalidateReviews} from '../project/project.ts'
import {digest,json,newId,type FileStore} from '../store/files.ts'
import {invariant,parseStored} from '../../shared/errors.ts'
import {parseResultBytes,RESULT_MAX_BYTES} from './result-parser.ts'
import type {ParsedBody} from '../../shared/materials.ts'
export const RESEARCH_ROLES='.scholarflow/research/material-roles.json'
export async function researchMaterialRoles(io:FileStore){const current=await snapshot(io),file=await io.read(RESEARCH_ROLES),value=file?parseStored(researchMaterialRolesSchema,file.text,'RESEARCH_INPUTS_INVALID','research.inputs'):undefined
  invariant(!value||value.projectId===current.ledger.projectId,'PROJECT_ID_CONFLICT','研究资料用途不属于当前项目。');return value}
export async function confirmResearchMaterialRoles(io:FileStore,request:unknown){
  const input=researchMaterialRolesRequest.parse(request)
  return mutateLedger(io,input.context.expectedLedgerRevision!,async(ledger,config)=>{
    invariant(ledger.projectId===input.context.projectId&&new Set(input.roles.map(row=>row.path)).size===input.roles.length,'RESEARCH_INPUTS_INVALID','研究资料用途需要当前项目及唯一文件映射。')
    for(const row of input.roles){const material=Object.values(ledger.materials).find(material=>material.projectRelativePath===row.path)
      invariant(material&&config.materials.include.includes(row.path),'MATERIAL_ACCESS_DENIED','资料用途仅限明确选用的文件。')
      if(row.role==='figure')invariant(/\.(png|jpe?g)$/iu.test(row.path),'IMAGE_FORMAT_UNSUPPORTED','当前作者图像支持 PNG/JPEG。')
      if(['method','settings','results'].includes(row.role))invariant(!Object.values(ledger.sources).some(source=>source.materialId===material.id&&source.kind!=='user-result'),'MEASUREMENT_ORIGIN_INVALID','已登记外部来源不能转换成作者研究输入。')
    }
    const previous=await io.read(RESEARCH_ROLES),value=researchMaterialRolesSchema.parse({schemaVersion:1,projectId:ledger.projectId,roles:input.roles,confirmedBy:input.context.sessionId,confirmedAt:new Date().toISOString()})
    invalidateReviews(ledger,['evidence','integrity','logic']);return [{path:RESEARCH_ROLES,before:previous,after:json(value)},{path:`.scholarflow/research/input-history/${newId('inputs')}.json`,before:undefined,after:json({previous:previous?.text,confirmed:value})}]
  })
}
/** Read JSON as inert original text, with duplicate-key/depth validation; never executes configuration. */
export function parseResearchConfig(bytes:Uint8Array,path:string,signal?:AbortSignal):ParsedBody{
  invariant(bytes.length<=RESULT_MAX_BYTES,'RESULT_FILE_TOO_LARGE','配置说明超过 2 MiB，请明确缩小文件范围。');parseResultBytes(bytes,path,'',signal)
  return {parser:{id:'sf-inert-json-config',version:'1'},blocks:[{text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),kind:'paragraph',locator:{kind:'data',relativePath:path,rowRange:'pointer:',metric:'configuration'}}],coverage:'complete',warnings:['仅读取 JSON 原始文字，未执行配置、训练代码或验证作者运行环境。'],unprocessedContent:[],ranges:[{kind:'paragraphs',from:1,to:1}]}
}
