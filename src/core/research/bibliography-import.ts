import {Cite} from '@citation-js/core'
import '@citation-js/plugin-bibtex'
import '@citation-js/plugin-ris'
import {z} from 'zod'
import {sourceInput} from '../../shared/research.ts'
import {sourceSchema,id,hash,type Source} from '../../shared/schema.ts'
import {snapshot,mutateLedger,invalidateReviews} from '../project/project.ts'
import {digest,json,newId,type FileStore} from '../store/files.ts'
import {sourceMatches} from './source-matching.ts'
import {invariant} from '../../shared/errors.ts'
import {doi} from '../../shared/online-research.ts'

export const bibliographyImportInput=z.object({text:z.string().trim().min(1).max(2*1024*1024),format:z.enum(['bibtex','ris'])}).strict()
const importPlanSchema=z.object({id,projectId:id,configHash:hash,ledgerHash:hash,ledgerRevision:z.number().int().nonnegative(),input:bibliographyImportInput,
  candidates:z.array(z.object({index:z.number().int().nonnegative(),source:sourceInput,matches:z.array(z.unknown()).max(1000),exactDuplicate:z.boolean()}).strict()).max(500),planHash:hash}).strict()
type Input=z.infer<typeof sourceInput>
const sameDoi=(input:Input,source:Source)=>!!input.identifiers.doi&&input.identifiers.doi===source.identifiers.doi?.trim().toLowerCase()
function importedSource(input:Input,sourceId:string,format:string):Source{return sourceSchema.parse({...input,id:sourceId,citeKey:`sf_${sourceId.slice(4)}`,
  provenance:[{provider:`user-${format}-import`,retrievedAt:new Date().toISOString()}],identity:{status:'unverified',method:'none',reason:'导入用户提供的书目元数据，尚未独立核验。'},textAccess:'metadata',publicationState:'unknown'})}
export async function prepareBibliographyImport(io:FileStore,request:unknown){
  const input=bibliographyImportInput.parse(request),current=await snapshot(io)
  invariant(input.format==='bibtex'?/^\s*@/u.test(input.text):/^\s*TY\s+-/u.test(input.text),'BIBLIOGRAPHY_FORMAT_INVALID','内容与选择的 BibTeX/RIS 格式不符。')
  const parsed=new Cite(input.text).data
  invariant(parsed.length>0&&parsed.length<=500,'BIBLIOGRAPHY_TOO_LARGE','请一次导入 1–500 条书目。')
  const seen:Record<string,Source>={...current.ledger.sources}
  const candidates=parsed.map((item:any,index:number)=>{
    invariant(item.title,'BIBLIOGRAPHY_METADATA_MISSING',`第 ${index+1} 条书目没有题名，请补充后再导入。`)
    const year=item.issued?.['date-parts']?.[0]?.[0]
    const source=sourceInput.parse({title:item.title,authors:(item.author??[]).map((author:any)=>({literal:author.literal??[author.given,author.family].filter(Boolean).join(' '),...(author.family&&{family:author.family}),...(author.given&&{given:author.given})})),
      ...(year&&{year:Number(year)}),...(item['container-title']&&{venue:item['container-title']}),kind:item.type==='book'?'book':item.type==='dataset'?'dataset':item.type==='webpage'?'web':'paper',
      identifiers:{...(item.DOI&&{doi:doi.parse(item.DOI)}),...(item.URL&&{url:item.URL})},
      bibliography:Object.fromEntries([['volume',item.volume],['issue',item.issue],['pages',item.page],['publisher',item.publisher],['publisherPlace',item['publisher-place']],['edition',item.edition]].filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))})
    const matches=sourceMatches(source,seen),exact=Object.values(seen).filter(row=>sameDoi(source,row)).map(row=>({sourceId:row.id,title:row.title,citeKey:row.citeKey,kind:'same-doi'}))
    const candidate={index,source,matches:[...exact,...matches.filter(match=>!exact.some(row=>row.sourceId===match.sourceId))],exactDuplicate:exact.length>0}
    seen[`candidate_${index}`]=importedSource(source,`src_candidate_${index}`,input.format)
    // Keep the candidate's index visible in duplicate matches, rather than pretending it is an installed source.
    seen[`candidate_${index}`].id=`candidate_${index}`
    return candidate
  })
  const plan={id:newId('bibimport'),projectId:current.ledger.projectId,configHash:current.configHash,ledgerHash:current.ledgerHash,ledgerRevision:current.ledger.revision,input,candidates}
  return {...plan,planHash:digest(json(plan))}
}
export type BibliographyImportPlan=Awaited<ReturnType<typeof prepareBibliographyImport>>
export async function confirmBibliographyImport(io:FileStore,plan:BibliographyImportPlan,selected:Array<{index:number;reason:string}>,sessionId:string){
  importPlanSchema.parse(plan)
  const {planHash,...body}=plan;invariant(digest(json(body))===planHash,'INVALID_APPROVAL','书目导入预览已改变。')
  invariant(selected.length>0&&new Set(selected.map(row=>row.index)).size===selected.length,'BIBLIOGRAPHY_SELECTION_REQUIRED','请明确选择要登记的书目。')
  const sources:Source[]=[]
  const result=await mutateLedger(io,plan.ledgerRevision,async ledger=>{
    const current=await snapshot(io);invariant(current.ledgerHash===plan.ledgerHash&&current.configHash===plan.configHash&&ledger.projectId===plan.projectId,'STALE_LEDGER_REVISION','书目预览后项目发生变化，请重新核对。')
    for(const decision of selected){
      const candidate=plan.candidates.find(row=>row.index===decision.index);invariant(candidate,'BIBLIOGRAPHY_SELECTION_REQUIRED','书目候选不存在。')
      invariant(!Object.values(ledger.sources).some(row=>sameDoi(candidate.source,row)),'SOURCE_ALREADY_REGISTERED','同一 DOI 已登记，请取消重复条目并沿用原引用键。')
      const matches=sourceMatches(candidate.source,ledger.sources)
      invariant(!matches.length||decision.reason.trim().length>0,'SOURCE_DUPLICATE_REVIEW_REQUIRED','疑似重复书目需填写分别保留的理由。')
      const source=importedSource(candidate.source,newId('src'),plan.input.format);ledger.sources[source.id]=source;sources.push(source)
    }
    invalidateReviews(ledger,['citation','evidence'])
    return [{path:`.scholarflow/research/imports/${plan.id}.json`,before:undefined,after:json({schemaVersion:1,projectId:plan.projectId,sessionId,plan,selected,sourceIds:sources.map(row=>row.id),confirmedAt:new Date().toISOString()})}]
  })
  return {sources,revision:result.revision}
}
