import {sourceMetadataRequest} from '../../shared/research.ts'
import {sourceSchema} from '../../shared/schema.ts'
import {doi} from '../../shared/online-research.ts'
import {snapshot,mutateLedger,invalidateReviews} from '../project/project.ts'
import {readParsed} from '../materials/materials.ts'
import {digest,json,newId,type FileStore} from '../store/files.ts'
import {invariant} from '../../shared/errors.ts'
const key=(text:string)=>text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase()
async function verifyText(io:FileStore,current:Awaited<ReturnType<typeof snapshot>>,source:ReturnType<typeof sourceSchema.parse>,metadata:ReturnType<typeof sourceMetadataRequest.parse>['metadata']){
  if(!source.materialId)return
  const material=current.ledger.materials[source.materialId];invariant(material&&source.contentHash&&digest(await io.readBytes(material.projectRelativePath,50*1024*1024))===source.contentHash,'STALE_MATERIAL_VERSION','原文件已变化，请先重新读取。')
  const parsed=await readParsed(io,material.id),front=key(parsed.blocks.map(row=>row.text).join('\n').slice(0,6000))
  invariant(parsed.sourceContentHash===source.contentHash&&front.includes(key(metadata.title))&&metadata.authors.every(author=>front.includes(key(author.literal))),'SOURCE_METADATA_NOT_IN_TEXT','题名或作者未对应当前文件开头的实际文字，请先核对文件和出版信息。')
}
export async function prepareSourceMetadata(io:FileStore,request:unknown){
  const input=sourceMetadataRequest.parse(request),current=await snapshot(io),source=current.ledger.sources[input.sourceId]
  invariant(input.context.projectId===current.ledger.projectId&&input.context.expectedLedgerRevision===current.ledger.revision,'STALE_LEDGER_REVISION','出版信息预览需要当前项目与版本。')
  invariant(source&&source.kind!=='user-result','SOURCE_KIND_INVALID','出版信息补正只适用于外部参考来源，不能转换作者实验归属。')
  if(input.metadata.identifiers.doi)input.metadata.identifiers.doi=doi.parse(input.metadata.identifiers.doi)
  const grouped=source.bibliographySourceId||Object.values(current.ledger.sources).some(row=>row.bibliographySourceId===source.id)
  const identity=(row:typeof source|typeof input.metadata)=>json({title:key(row.title),authors:row.authors.map(author=>key(author.literal)).sort(),year:row.year,doi:row.identifiers.doi??null})
  invariant(!grouped||identity(source)===identity(input.metadata),'SOURCE_BIBLIOGRAPHY_GROUPED','该来源已关联统一书目；请先核对并解除相关书目关联再修改出版身份，避免导出指向另一篇作品。')
  await verifyText(io,current,source,input.metadata)
  const body={id:newId('source_metadata'),input,before:source,configHash:current.configHash,ledgerHash:current.ledgerHash};return {...body,planHash:digest(json(body))}
}
export type SourceMetadataPlan=Awaited<ReturnType<typeof prepareSourceMetadata>>
export async function confirmSourceMetadata(io:FileStore,context:SourceMetadataPlan['input']['context'],plan:SourceMetadataPlan){
  const {planHash,...body}=plan
  invariant(digest(json(body))===planHash&&context.projectId===plan.input.context.projectId&&context.sessionId===plan.input.context.sessionId&&context.workspaceId===plan.input.context.workspaceId,'INVALID_APPROVAL','出版信息确认不属于同一项目或会话。')
  const current=await snapshot(io);invariant(current.configHash===plan.configHash&&current.ledgerHash===plan.ledgerHash,'STALE_SOURCE_VERSION','预览后项目已变化，请重新核对出版信息。')
  return mutateLedger(io,plan.input.context.expectedLedgerRevision!,async ledger=>{await verifyText(io,current,plan.before,plan.input.metadata)
    ledger.sources[plan.before.id]=sourceSchema.parse({...plan.before,...plan.input.metadata,identity:{status:'unverified',method:'user-confirmed',reason:'用户核对并补正出版信息；尚未执行独立身份查询。'},provenance:[...plan.before.provenance,{provider:'operator-metadata-correction',retrievedAt:new Date().toISOString()}]})
    invalidateReviews(ledger,['citation','evidence','logic']);return [{path:`.scholarflow/research/source-metadata-history/${plan.id}.json`,before:undefined,after:json({schemaVersion:1,projectId:ledger.projectId,before:plan.before,after:ledger.sources[plan.before.id],reason:plan.input.reason,confirmedBy:context.sessionId,confirmedAt:new Date().toISOString()})}]
  })
}
