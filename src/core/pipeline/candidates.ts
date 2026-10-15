import { candidateSnapshotSchema, candidateCheckSchema, type CandidateSnapshot } from '../../shared/delivery-task.ts'
import type { RequestContext } from '../../shared/schema.ts'
import { invariant, parseStored } from '../../shared/errors.ts'
import { digest,json,newId,type FileStore } from '../store/files.ts'
import { snapshot,mutateLedger,LEDGER_PATH } from '../project/project.ts'
import { reviewInput,evaluateReview,storeReview } from '../review/review.ts'
import { prepareModelReview,buildModelReviewReport,type ModelReviewPlan } from '../review/model.ts'
import type { ModelReviewOutput } from '../../shared/review.ts'
import { projectMarkdown,validateRange } from '../editing/markdown.ts'
import { bibliography } from '../export/bibliography.ts'
import { saveManual,applyEdits } from '../editing/proposals.ts'
import type { EditProposal } from '../../shared/editing.ts'
import { rebaseFormatting } from '../editing/formatting.ts'
import type { SkillReader } from '../skills/bindings.ts'
import { readEditorBuffer } from '../editing/buffer.ts'
import { readRun,readRunInput } from './run-store.ts'

const root=(taskId:string)=>`.scholarflow/task-delivery/${candidateSnapshotSchema.shape.taskId.parse(taskId)}`
const pathOf=(taskId:string,candidateId:string)=>`${root(taskId)}/candidates/${candidateSnapshotSchema.shape.id.parse(candidateId)}.json`
export async function readCandidate(io:FileStore,taskId:string,candidateId:string,context:RequestContext,expectedHash?:string){
  const file=await io.read(pathOf(taskId,candidateId));invariant(file,'CANDIDATE_NOT_FOUND','候选快照不存在。')
  const candidate=parseStored(candidateSnapshotSchema,file.text,'CANDIDATE_INVALID','candidate.inspect'),current=await snapshot(io)
  invariant(candidate.taskId===taskId&&candidate.id===candidateId&&candidate.projectId===current.ledger.projectId&&candidate.projectId===context.projectId&&candidate.sessionId===context.sessionId,'PROJECT_ID_CONFLICT','候选不属于当前项目、任务或会话。')
  invariant(candidate.textHash===digest(candidate.text)&&(!expectedHash||digest(file.text)===expectedHash),'CANDIDATE_CHANGED','候选字节已改变，请重新查看。')
  return {candidate,candidateHash:digest(file.text)}
}

/** An explicit immutable review subject, never an export or a writable manuscript. */
export async function candidateView(io:FileStore,candidate:CandidateSnapshot):Promise<FileStore>{
  const current=await snapshot(io),ledger=structuredClone(current.ledger)
  ledger.documents.paper={...ledger.documents.paper,currentHash:candidate.textHash,revisionId:candidate.id,initialPlaceholder:false,formatting:candidate.formatting}
  ledger.claimAnchors=structuredClone(candidate.anchors);ledger.reviewIssues={}
  const overlays=new Map([[current.config.paths.mainDocument,candidate.text],[LEDGER_PATH,json(ledger)]])
  return {read:async path=>path==='.scholarflow/reviews/current.json'?undefined:overlays.has(path)?{text:overlays.get(path)!,version:digest(overlays.get(path)!)}:io.read(path),
    readBytes:io.readBytes.bind(io),stat:io.stat.bind(io),list:io.list.bind(io),lock:async fn=>fn(),
    write:async()=>{throw new Error('Candidate review subjects are read-only')}}
}
async function verifyBasis(io:FileStore,candidate:CandidateSnapshot){
  const current=await reviewInput(io)
  invariant(!current.current.document.externalChange&&current.current.document.contentHash===candidate.baseDocumentHash&&current.current.document.revisionId===candidate.baseRevisionId,'STALE_DOCUMENT_VERSION','主稿已变化，旧候选保留；请重新建立基准。')
  const subject=await reviewInput(await candidateView(io,candidate))
  invariant(subject.contextDependencyHash===candidate.environmentHash,'CANDIDATE_DEPENDENCIES_CHANGED','材料、结果、要求、排版或固定资源发生变化，请重新核对。')
  return subject
}
export async function createCandidate(io:FileStore,context:RequestContext,input:{taskId:string;text?:string;edits?:EditProposal['edits'];parentCandidateId?:string;reason:string;scope:'document'|'paragraphs';paragraphClaims?:Array<{blockId:string;claimIds:string[]}>}){
  const current=await snapshot(io)
  invariant(context.projectId===current.ledger.projectId&&context.expectedLedgerRevision===current.ledger.revision&&!current.document.externalChange,'STALE_DOCUMENT_VERSION','候选需要当前项目和已保存基准。')
  const parent=input.parentCandidateId?(await readCandidate(io,input.taskId,input.parentCandidateId,context)).candidate:undefined
  if(parent)await verifyBasis(io,parent)
  invariant(!(input.text!==undefined&&input.edits),'CANDIDATE_SCOPE_INVALID','全文与段落操作不能混用。')
  const before=parent?.text??current.document.text,text=input.edits?applyEdits(before,input.edits):input.text
  if(input.scope==='paragraphs'){
    invariant(input.edits?.length,'CANDIDATE_SCOPE_INVALID','段落候选须包含明确的段落操作。')
    const original=projectMarkdown(before)
    for(const edit of input.edits){
      invariant(original.blocks.some(block=>block.node.type==='paragraph'&&block.editable&&block.start===edit.startUtf16&&block.end===edit.endUtf16),'CANDIDATE_SCOPE_INVALID','段落操作必须指向实际普通段落，结构或表格变更请使用明确的全稿候选。')
      validateRange(original,edit.startUtf16,edit.endUtf16,'paragraph')
    }
  }
  invariant(text!==undefined&&text.trim(),'CANDIDATE_EMPTY','候选没有实际正文。');bibliography(text,current.ledger)
  const id=newId('candidate'),textHash=digest(text),anchors:CandidateSnapshot['anchors']={}
  const projection=projectMarkdown(text)
  for(const mapping of input.paragraphClaims??[]){
    const block=projection.blocks.find(row=>row.id===mapping.blockId)
    invariant(block&&mapping.claimIds.length&&mapping.claimIds.every(claim=>current.ledger.claims[claim]),'CANDIDATE_ANCHOR_INVALID','候选段落关联须属于实际 AST 和当前论点。')
    const anchorId=newId('anchor');anchors[anchorId]={id:anchorId,documentId:'paper',documentHash:textHash,blockId:block.id,blockTextHash:digest(text.slice(block.start,block.end)),claimIds:mapping.claimIds,status:'current'}
  }
  // Untouched unique blocks retain their established claim links; changed blocks need explicit mappings.
  for(const old of Object.values(parent?.anchors??current.ledger.claimAnchors)){
    const blocks=projection.blocks.filter(block=>digest(text.slice(block.start,block.end))===old.blockTextHash)
    if(old.status==='current'&&blocks.length===1&&!Object.values(anchors).some(anchor=>anchor.blockId===blocks[0].id))
      anchors[old.id]={...old,documentHash:textHash,blockId:blocks[0].id}
  }
  const candidate=candidateSnapshotSchema.parse({schemaVersion:1,id,taskId:input.taskId,projectId:current.ledger.projectId,sessionId:context.sessionId,
    baseDocumentHash:parent?.baseDocumentHash??current.document.contentHash,baseRevisionId:parent?.baseRevisionId??current.document.revisionId,
    text,textHash,environmentHash:digest('pending'),parentCandidateId:parent?.id,scope:input.scope,reason:input.reason,createdAt:new Date().toISOString(),anchors,
    formatting:current.ledger.documents.paper.formatting&&rebaseFormatting(current.ledger.documents.paper.formatting,current.document.text,text)})
  candidate.environmentHash=(await reviewInput(await candidateView(io,candidate))).contextDependencyHash
  const saved=await mutateLedger(io,current.ledger.revision,async()=>{await verifyBasis(io,candidate);return [{path:pathOf(input.taskId,id),before:undefined,after:json(candidate)}]})
  return {candidate,candidateHash:digest(json(candidate)),revision:saved.revision}
}
export async function checkCandidate(io:FileStore,context:RequestContext,taskId:string,candidateId:string,candidateHash:string,semantic?:{plan:ModelReviewPlan;output:ModelReviewOutput}){
  const {candidate}=await readCandidate(io,taskId,candidateId,context,candidateHash),subject=await verifyBasis(io,candidate)
  if(semantic){const run=await readRun(io,semantic.plan.snapshot.runId,candidate.projectId),input=await readRunInput(io,run.run.runId,candidate.projectId)
    invariant(run.run.sessionId===candidate.sessionId&&run.run.usedModelCalls>0&&run.run.planHash===semantic.plan.contentHash&&input.snapshot.documentHash===candidate.textHash&&input.snapshot.sessionId===candidate.sessionId&&json(input.snapshot)===json(semantic.plan.snapshot),'CANDIDATE_CALL_UNVERIFIED','候选语义检查须关联实际调用与冻结输入，不能使用另一主体或自报完成。')}
  const report=semantic?buildModelReviewReport(semantic.plan,semantic.output).report:evaluateReview(subject)
  invariant(report.documentHash===candidate.textHash&&report.revisionId===candidate.id&&report.dependencyHash===subject.dependencyHash,'CANDIDATE_CHECK_MISMATCH','检查不是针对当前实际候选及依赖。')
  const check=candidateCheckSchema.parse({schemaVersion:1,id:newId('check'),subject:'candidate',taskId,projectId:candidate.projectId,sessionId:context.sessionId,
    candidateId,candidateHash,textHash:candidate.textHash,environmentHash:subject.contextDependencyHash,evaluatorVersion:'sf-candidate-v1',report,
    modelPlanHash:semantic?.plan.contentHash,createdAt:new Date().toISOString()})
  const current=await snapshot(io),saved=await mutateLedger(io,current.ledger.revision,async()=>{await verifyBasis(io,candidate);return [{path:`${root(taskId)}/candidates/${check.id}.json`,before:undefined,after:json(check)}]})
  return {check,checkHash:digest(json(check)),revision:saved.revision}
}
export async function prepareCandidateModelReview(io:FileStore,context:RequestContext,taskId:string,candidateId:string,candidateHash:string,model:Parameters<typeof prepareModelReview>[2],skills?:SkillReader){
  const {candidate}=await readCandidate(io,taskId,candidateId,context,candidateHash);await verifyBasis(io,candidate)
  return prepareModelReview(await candidateView(io,candidate),{context,assessmentScope:'cross-section'},model,skills)
}
export async function prepareCandidateAdoption(io:FileStore,context:RequestContext,taskId:string,candidateId:string,candidateHash:string,checkId?:string){
  const {candidate}=await readCandidate(io,taskId,candidateId,context,candidateHash);await verifyBasis(io,candidate)
  let checkHash:string|undefined
  if(checkId){const file=await io.read(`${root(taskId)}/candidates/${candidateCheckSchema.shape.id.parse(checkId)}.json`);invariant(file,'CANDIDATE_CHECK_MISSING','候选检查不存在。')
    const check=parseStored(candidateCheckSchema,file.text,'CANDIDATE_CHECK_INVALID','candidate.adopt')
    invariant(check.candidateId===candidateId&&check.candidateHash===candidateHash&&check.environmentHash===candidate.environmentHash,'CANDIDATE_CHECK_MISMATCH','检查来自另一个候选或输入版本。');checkHash=digest(file.text)}
  const body={id:newId('adoption'),projectId:candidate.projectId,sessionId:context.sessionId,workspaceId:context.workspaceId,taskId,candidateId,candidateHash,
    baseDocumentHash:candidate.baseDocumentHash,baseRevisionId:candidate.baseRevisionId,textHash:candidate.textHash,environmentHash:candidate.environmentHash,checkId,checkHash}
  return {...body,planHash:digest(json(body)),before:(await snapshot(io)).document.text,after:candidate.text}
}
export type CandidateAdoptionPlan=Awaited<ReturnType<typeof prepareCandidateAdoption>>
export async function adoptCandidate(io:FileStore,context:RequestContext,plan:CandidateAdoptionPlan,bufferHash:string){
  const {planHash,before:_before,after:_after,...body}=plan
  invariant(digest(json(body))===planHash&&digest(plan.before)===plan.baseDocumentHash&&digest(plan.after)===plan.textHash&&plan.projectId===context.projectId&&plan.sessionId===context.sessionId&&plan.workspaceId===context.workspaceId,'INVALID_APPROVAL','采用预览身份或内容已改变。')
  const receiptPath=`${root(plan.taskId)}/adoptions/${plan.id}.json`,receipt=await io.read(receiptPath)
  if(receipt){const result=JSON.parse(receipt.text);invariant(result.planHash===planHash,'INVALID_APPROVAL','采用 token 已用于其他计划。');return {...result,alreadyApplied:true}}
  invariant(bufferHash===plan.baseDocumentHash,'DIRTY_EDITOR_BUFFER','有未保存正文，请先保存并重建候选基准。')
  const {candidate}=await readCandidate(io,plan.taskId,plan.candidateId,context,plan.candidateHash)
  const result=await saveManual(io,candidate.text,plan.baseDocumentHash,context.expectedLedgerRevision!,{origin:'candidate-adoption',
    verify:async()=>{await verifyBasis(io,candidate)
      const directory='.scholarflow/drafts/editor-buffers'
      if(await io.stat(directory))for(const entry of await io.list(directory)){
        if(entry.type!=='file'||!entry.path.endsWith('.json'))continue
        const sessionId=entry.path.split('/').at(-1)!.slice(0,-5),{buffer}=await readEditorBuffer(io,sessionId)
        invariant(!buffer||buffer.state!=='dirty'||digest(buffer.text)===candidate.baseDocumentHash,'DIRTY_EDITOR_BUFFER','项目仍有未保存人工编辑，请先保存或处理该缓冲。')
      }
    },finalize:(ledger,change)=>{ledger.claimAnchors=Object.fromEntries(Object.entries(candidate.anchors).map(([key,anchor])=>[key,{...anchor,documentHash:change.documentHash}]))},
    extra:change=>[{path:receiptPath,before:undefined,after:json({schemaVersion:1,projectId:plan.projectId,planHash,candidateId:candidate.id,candidateHash:plan.candidateHash,...change,adoptedAt:new Date().toISOString()})}]})
  return {...result,alreadyApplied:false}
}
export async function recheckAdoptedCandidate(io:FileStore,context:RequestContext,plan:CandidateAdoptionPlan){
  const input=await reviewInput(io),report=evaluateReview(input)
  invariant(input.current.document.contentHash===plan.textHash,'REVIEW_INPUT_CHANGED','实际保存稿不同，不能继承候选检查。')
  let inherited=false
  if(plan.checkId&&plan.checkHash){
    const file=await io.read(`${root(plan.taskId)}/candidates/${plan.checkId}.json`)
    if(file&&digest(file.text)===plan.checkHash){const checked=parseStored(candidateCheckSchema,file.text,'CANDIDATE_CHECK_INVALID','candidate.recheck')
      const candidate=(await readCandidate(io,plan.taskId,plan.candidateId,context,plan.candidateHash)).candidate
      if(checked.textHash===input.current.document.contentHash&&checked.environmentHash===input.contextDependencyHash&&digest(json(candidate.anchors))===digest(json(input.current.ledger.claimAnchors))&&checked.report.modelRunId){
        const semantic=checked.report.checks.filter(check=>check.method==='model-assisted')
        report.checks=report.checks.map(check=>semantic.find(row=>row.id===check.id)??check)
        report.issues=report.issues.filter(issue=>!semantic.some(check=>check.status==='pass'&&issue.id===`issue_${digest(check.id).slice(7,31)}`))
        report.issues.push(...checked.report.issues.filter(issue=>issue.checkMethod==='model-assisted').map(issue=>({...issue,reviewId:report.id,documentHash:report.documentHash})))
        report.modelRunId=checked.report.modelRunId;inherited=true
      }
    }
  }
  const record={schemaVersion:1,subject:'manuscript',candidateId:plan.candidateId,candidateHash:plan.candidateHash,documentHash:report.documentHash,revisionId:report.revisionId,
    candidateCheckId:plan.checkId,semanticInherited:inherited,needsSemanticCheck:!inherited,createdAt:new Date().toISOString()}
  const saved=await storeReview(io,report,input.current.ledger.revision,[],[{path:`${root(plan.taskId)}/rechecks/${report.id}.json`,before:undefined,after:json(record)}])
  return {...saved,semanticInherited:inherited,needsSemanticCheck:!inherited}
}
