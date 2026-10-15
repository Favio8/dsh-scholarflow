import { deliveryTaskSchema,deliveryPrepareRequest,candidateCheckSchema,type DeliveryTask } from '../../shared/delivery-task.ts'
import { runSnapshotSchema,runStateSchema,type RunState } from '../../shared/runs.ts'
import { invariant,parseStored } from '../../shared/errors.ts'
import { digest,json,newId,type FileStore } from '../store/files.ts'
import { snapshot } from '../project/project.ts'
import { readWritingSpec,readWritingTask,ownedRequirementsHash } from './writing-task-store.ts'
import { readApproval } from './spec-compat.ts'
import { commit,inspectRecovery,type Mutation } from '../store/transactions.ts'
import { inputFile,runFile } from './run-store.ts'
import { reviewInput,inspectReview } from '../review/review.ts'
import { semanticReviewChecks } from '../../shared/review.ts'
import { deliveryReadiness } from './readiness.ts'
import type { RequestContext } from '../../shared/schema.ts'
import { assertWritingAllowed } from './writing-context.ts'
import { writingReadPaths } from '../../shared/writing-task.ts'
import { researchGoalProfileSchema } from '../../shared/results.ts'
import {inspectArtifactReview} from '../export/artifact-review.ts'
import {readCandidate,candidateView} from './candidates.ts'

export const deliveryRoot=(id:string)=>`.scholarflow/task-delivery/${deliveryTaskSchema.shape.id.parse(id)}`
export const deliveryTaskPath=(id:string)=>`${deliveryRoot(id)}/task.json`
const CURRENT='.scholarflow/task-delivery/current.json'
export async function readDeliveryTask(io:FileStore,context:RequestContext,taskId?:string){
  const explicit=!!taskId
  const current=await snapshot(io),pointer=await io.read(CURRENT)
  if(!taskId&&!pointer)return undefined
  const ref=pointer?JSON.parse(pointer.text):undefined;taskId??=ref?.taskId
  invariant(taskId,'DELIVERY_TASK_INVALID','交付任务索引不完整。')
  const file=await io.read(deliveryTaskPath(taskId));invariant(file,'DELIVERY_TASK_MISSING','交付任务缺失，未重建或重放。')
  const task=parseStored(deliveryTaskSchema,file.text,'DELIVERY_TASK_VERSION_UNSUPPORTED','deliveryTask.inspect')
  invariant(task.projectId===current.ledger.projectId&&context.projectId===task.projectId,'PROJECT_ID_CONFLICT','交付任务不属于当前项目。')
  if(!explicit&&(task.sessionId!==context.sessionId||task.workspaceId!==context.workspaceId))return undefined
  invariant(task.id===taskId&&task.projectId===current.ledger.projectId&&context.projectId===task.projectId&&task.sessionId===context.sessionId&&task.workspaceId===context.workspaceId,'PROJECT_ID_CONFLICT','交付任务不属于当前项目、工作区或会话。')
  const calls=`${deliveryRoot(task.id)}/calls`
  if(await io.stat(calls))for(const entry of await io.list(calls))if(entry.type==='file'&&entry.path.endsWith('.json')&&!entry.path.endsWith('-plan.json')){
    const receipt=JSON.parse((await io.read(entry.path))!.text),runId=deliveryTaskSchema.shape.runId.parse(receipt.runId),planFile=await io.read(`${calls}/${runId}-plan.json`)
    invariant(receipt.projectId===task.projectId&&planFile,'DELIVERY_CALL_CHANGED','子调用回执缺少同项目冻结计划。')
    const plan=JSON.parse(planFile.text),{contentHash,...body}=plan
    invariant(receipt.planHash===contentHash&&digest(json(body))===contentHash&&plan.snapshot.runId===runId&&plan.snapshot.sessionId===task.sessionId,'DELIVERY_CALL_CHANGED','子调用计划与回执身份不符。')
    const status=receipt.status==='pending'?'unknown':receipt.status
    invariant(['unknown','succeeded','failed'].includes(status),'DELIVERY_CALL_CHANGED','子调用状态不支持。')
    const row={runId,planHash:contentHash,stage:plan.snapshot.stage==='research'?'research' as const:plan.snapshot.stage==='review'?'review' as const:'revision' as const,status}
    const existing=task.calls.find(call=>call.runId===runId);if(existing){invariant(existing.planHash===contentHash,'DELIVERY_CALL_CHANGED','已登记子调用不能更换冻结输入。');Object.assign(existing,row)}else task.calls.push(row)
  }
  return {task,file}
}
export async function prepareDeliveryTask(io:FileStore,request:unknown,model:DeliveryTask['model']){
  const input=deliveryPrepareRequest.parse(request),current=await snapshot(io),spec=await readWritingSpec(io),writing=await readWritingTask(io)
  invariant(current.ledger.projectId===input.context.projectId&&current.ledger.revision===input.context.expectedLedgerRevision,'STALE_LEDGER_REVISION','计划需要当前项目与版本。')
  assertWritingAllowed(current);invariant(spec,'WRITING_SPEC_MISSING','请先确认本次写作要求。')
  invariant(!current.document.externalChange,'STALE_DOCUMENT_VERSION','请先保存或明确采用外部主稿。')
  const materialHashes:Record<string,string>={},resourceHashes:Record<string,string>={}
  for(const path of writingReadPaths(spec))materialHashes[path]=digest(await io.readBytes(path,50*1024*1024))
  for(const path of [current.config.writing.projectProfile,'.scholarflow/profiles/review.md','.scholarflow/resources.lock.json','.scholarflow/context/approvals.json','.scholarflow/research/material-roles.json']){
    const file=await io.read(path);resourceHashes[path]=digest(file?.text??'')
  }
  const required=['body_nonempty','pending_markers','outline_confirmed',...current.ledger.outline.sections.map(section=>`section_${section.id}`),
    ...Object.values(current.ledger.requirements).filter(req=>req.confirmation==='confirmed'&&!['deadline','ai-policy'].includes(req.kind)).map(req=>`requirement_${req.id}`),
    ...semanticReviewChecks.filter(id=>id!=='style_assessment'),...(input.goal==='research-results'&&input.researchKind!=='theoretical'?['own_result_links','own_result_numbers','own_result_units','own_research_results']:[])]
  const body={schemaVersion:1 as const,id:newId('delivery_task'),projectId:current.ledger.projectId,sessionId:input.context.sessionId,workspaceId:input.context.workspaceId,
    goal:input.goal,researchKind:input.researchKind,allowStructure:input.allowStructure,online:spec.online,model,materialHashes,resourceHashes,specHash:ownedRequirementsHash(spec),sourceSelectionHash:digest(json(readApproval(spec))),documentHash:current.document.contentHash,
    writingTaskId:writing?.id,requiredCheckIds:required,configHash:current.configHash,ledgerHash:current.ledgerHash,createdAt:new Date().toISOString()}
  return {...body,planHash:digest(json(body)),scope:'根据当前要求与材料连续准备检查与候选；最终由用户一次采用。交付文件写入现有已确认输出目录。'}
}
export type DeliveryTaskPlan=Awaited<ReturnType<typeof prepareDeliveryTask>>
export async function startDeliveryTask(io:FileStore,context:RequestContext,plan:DeliveryTaskPlan,owner:RunState['owner']){
  const {planHash,scope:_scope,...body}=plan;invariant(digest(json(body))===planHash&&context.projectId===plan.projectId&&context.sessionId===plan.sessionId&&context.workspaceId===plan.workspaceId,'INVALID_APPROVAL','交付计划身份或范围已变化。')
  return io.lock(async()=>{
    const current=await snapshot(io)
    invariant(current.configHash===plan.configHash&&current.ledgerHash===plan.ledgerHash&&current.document.contentHash===plan.documentHash,'DELIVERY_INPUT_CHANGED','任务预览后项目、保存稿或已确认范围已变化，请重新预览。')
    invariant(!current.document.externalChange&&(await inspectRecovery(io,current.config.paths.manuscriptDir)).pending.length===0,'RECOVERY_REQUIRED','请先处理稿件变化或未完成事务。')
    const spec=await readWritingSpec(io);invariant(spec&&ownedRequirementsHash(spec)===plan.specHash,'DELIVERY_INPUT_CHANGED','本次要求已变化，需重新预览。')
    for(const [path,hash] of Object.entries(plan.materialHashes))invariant(digest(await io.readBytes(path,50*1024*1024))===hash,'STALE_MATERIAL_VERSION','所选材料版本已改变，旧计划不再有效。')
    const old=await io.read(CURRENT)
    if(old){const ref=JSON.parse(old.text),file=await io.read(deliveryTaskPath(ref.taskId));invariant(file,'DELIVERY_TASK_MISSING','原任务索引缺失，请先恢复。');const existing=parseStored(deliveryTaskSchema,file.text,'DELIVERY_TASK_INVALID','deliveryTask.start');invariant(ref.projectId===plan.projectId&&existing.projectId===plan.projectId,'PROJECT_ID_CONFLICT','原任务不属于当前项目。');invariant(['succeeded','completed-with-issues','failed','cancelled'].includes(existing.status),'DELIVERY_ALREADY_RUNNING','当前项目有尚未结束的交付任务，请回到原会话继续或停止它。')}
    const writing=await readWritingTask(io)
    invariant(!writing||!['queued','running'].includes(writing.status)||current.document.initialPlaceholder&&writing.id===plan.writingTaskId,'WRITING_ALREADY_RUNNING','已有首稿任务正在写入，请等待其完成或暂停后再建立交付基准。')
    for(const [path,hash] of Object.entries(plan.resourceHashes)){const file=await io.read(path);invariant(digest(file?.text??'')===hash,'DELIVERY_RESOURCE_CHANGED','固定资源已改变，请重新预览。')}
    const time=new Date().toISOString(),runId=newId('run'),task=deliveryTaskSchema.parse({schemaVersion:1,id:plan.id,projectId:plan.projectId,sessionId:plan.sessionId,workspaceId:plan.workspaceId,runId,
      goal:plan.goal,researchKind:plan.researchKind,allowStructure:plan.allowStructure,online:plan.online,model:plan.model,materialHashes:plan.materialHashes,resourceHashes:plan.resourceHashes,specHash:plan.specHash,sourceSelectionHash:plan.sourceSelectionHash,
      requiredCheckIds:plan.requiredCheckIds,advisoryCheckIds:[],missingMaterials:[],writingTaskId:plan.writingTaskId,revision:0,phase:plan.goal==='course-delivery'&&!current.document.initialPlaceholder?'candidate-check':'first-draft',status:'queued',approvalHash:planHash,
      queries:[],calls:[],message:'正在准备本次连续交付任务。',createdAt:time,updatedAt:time})
    const state=runStateSchema.parse({schemaVersion:1,runId,projectId:plan.projectId,sessionId:plan.sessionId,status:'queued',usedModelCalls:0,startedAt:time,updatedAt:time,owner,planHash,stage:'drafting'})
    const profile=await io.read(current.config.writing.projectProfile),input=runSnapshotSchema.parse({schemaVersion:1,runId,projectId:plan.projectId,sessionId:plan.sessionId,stage:'drafting',
      configHash:current.configHash,ledgerRevision:current.ledger.revision,documentHash:current.document.contentHash,outlineVersion:current.ledger.outline.version,
      materialHashes:Object.fromEntries(Object.values(current.ledger.materials).filter(material=>plan.materialHashes[material.projectRelativePath]).map(material=>[material.id,plan.materialHashes[material.projectRelativePath]])),
      sourceHashes:Object.fromEntries(Object.values(current.ledger.sources).filter(source=>source.contentHash).map(source=>[source.id,source.contentHash])),profileHash:digest(profile?.text??''),skillDigests:[],
      modelDescriptor:plan.model,budget:current.config.workflow.budget,networkScope:plan.online?'approved-providers':'local-only',createdAt:time})
    await commit(io,[{path:deliveryTaskPath(task.id),before:undefined,after:json(task)},{path:`${deliveryRoot(task.id)}/approved-plan.json`,before:undefined,after:json(plan)},
      {path:runFile(runId),before:undefined,after:json(state)},{path:inputFile(runId),before:undefined,after:json(input)},
      {path:'.scholarflow/research/goal-profile.json',before:await io.read('.scholarflow/research/goal-profile.json'),after:json({schemaVersion:1,projectId:plan.projectId,taskId:task.id,goal:plan.goal,researchKind:plan.researchKind,confirmedAt:time})},
      {path:CURRENT,before:old,after:json({schemaVersion:1,projectId:plan.projectId,taskId:task.id})}])
    return task
  })
}
export async function verifyDeliveryInputs(io:FileStore,task:DeliveryTask){
  const current=await snapshot(io),spec=await readWritingSpec(io)
  invariant(spec&&ownedRequirementsHash(spec)===task.specHash,'DELIVERY_INPUT_CHANGED','要求或结构已改变，请保留已产生结果并重新核对。')
  invariant(spec.online===task.online,'NETWORK_APPROVAL_CHANGED','联网范围已改变，请重新确认连续任务计划。')
  invariant(digest(json(readApproval(spec)))===task.sourceSelectionHash,'MATERIAL_APPROVAL_CHANGED','选用的来源范围已改变，请重新确认。')
  for(const [path,hash] of Object.entries(task.materialHashes))invariant(writingReadPaths(spec).includes(path)&&digest(await io.readBytes(path,50*1024*1024))===hash,'STALE_MATERIAL_VERSION','当前材料范围或字节已改变。')
  for(const [path,hash] of Object.entries(task.resourceHashes)){const file=await io.read(path);invariant(digest(file?.text??'')===hash,'DELIVERY_RESOURCE_CHANGED','模型固定资源或研究资料用途已改变，不能沿用旧任务授权。')}
  const profile=await io.read('.scholarflow/research/goal-profile.json')
  invariant(profile,'RESEARCH_GOAL_INVALID','任务研究类型记录缺失。')
  const goal=researchGoalProfileSchema.parse(JSON.parse(profile.text))
  invariant(goal.projectId===task.projectId&&goal.taskId===task.id&&goal.goal===task.goal&&goal.researchKind===task.researchKind,'DELIVERY_INPUT_CHANGED','本次研究类型或任务目标已变化，需重新确认。')
  assertWritingAllowed(current);return {current,spec}
}
export async function saveDeliveryTask(io:FileStore,task:DeliveryTask,owner:RunState['owner'],extra:Mutation[]=[]){
  return io.lock(async()=>{const path=deliveryTaskPath(task.id),previous=await io.read(path);invariant(previous,'DELIVERY_TASK_MISSING','任务快照缺失。')
    const old=parseStored(deliveryTaskSchema,previous.text,'DELIVERY_TASK_INVALID','deliveryTask.checkpoint')
    invariant(old.revision===task.revision,'DELIVERY_TASK_CHANGED','任务有新的操作，不覆盖迟到状态。')
    task.revision++;task.updatedAt=new Date().toISOString();const text=json(deliveryTaskSchema.parse(task)),run=await io.read(runFile(task.runId))
    const state=runStateSchema.parse({schemaVersion:1,runId:task.runId,projectId:task.projectId,sessionId:task.sessionId,status:task.status,usedModelCalls:0,
      startedAt:task.createdAt,updatedAt:task.updatedAt,planHash:task.approvalHash,checkpointHash:digest(text),stage:task.phase==='export'?'delivery':task.phase==='revision'?'revision':'review',owner})
    await commit(io,[{path,before:previous,after:text},{path:runFile(task.runId),before:run,after:json(state)},...extra]);return task
  })
}
export async function inspectDeliveryTask(io:FileStore,context:RequestContext,taskId?:string){
  const row=await readDeliveryTask(io,context,taskId);if(!row)return {task:undefined}
  const task=row.task,input=await reviewInput(io),review=await inspectReview(io,input),delivery=task.deliveryId?input.current.ledger.deliveries[task.deliveryId]:undefined
  let inputProblem:{code:string;message:string}|undefined,candidateReview:{report:ReturnType<typeof candidateCheckSchema.parse>['report'];stale:boolean}|undefined
  try{await verifyDeliveryInputs(io,task)}catch(error){const code=(error as {code?:string}).code;inputProblem={code:code&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)?code:'DELIVERY_INPUT_CHANGED',message:'本次要求、材料版本或固定范围已变化，请按当前输入重新预览任务；原稿与候选保留。'}}
  if(task.researchInputHash&&task.researchKind!=='theoretical'){
    const own=Object.values(input.current.ledger.evidence).filter(row=>row.kind==='user-measurement'&&row.validation==='located'&&row.measurement?.origin==='user-supplied'&&input.current.ledger.sources[row.sourceId]?.kind==='user-result'&&input.materialHashes[input.current.ledger.sources[row.sourceId].materialId!]===row.sourceContentHash),hash=digest(json({measurements:own,experiments:Object.values(input.results.experiments?.records??{}).filter(record=>record.status==='current')}))
    if(hash!==task.researchInputHash)inputProblem={code:'RESEARCH_INPUT_CHANGED',message:'作者结果或配置已有新版本，请预览当前输入后继续；旧结果、原稿与候选保留。'}
  }
  if(task.candidateId&&task.checkId){const file=await io.read(`${deliveryRoot(task.id)}/candidates/${task.checkId}.json`)
    if(file){const check=parseStored(candidateCheckSchema,file.text,'CANDIDATE_CHECK_INVALID','deliveryTask.inspect'),candidate=(await readCandidate(io,task.id,task.candidateId,context,task.candidateHash)).candidate,subject=await reviewInput(await candidateView(io,candidate))
      if(check.candidateId===candidate.id)candidateReview={report:check.report,stale:!task.checkHash||digest(file.text)!==task.checkHash||check.candidateHash!==task.candidateHash||check.report.dependencyHash!==subject.dependencyHash||!task.adoptionDecided&&candidate.baseDocumentHash!==input.current.document.contentHash}}
  }
  let artifacts:Awaited<ReturnType<typeof inspectArtifactReview>>|undefined,artifactError:string|undefined
  if(delivery)try{artifacts=await inspectArtifactReview(io,delivery.id)}catch{artifactError='交付文件缺失、字节已改变或无法实际回读；请重新准备文件。'}
  const report=review.report&&structuredClone(review.report)
  const format=artifacts?.checks.find(check=>check.id==='delivery_format')
  if(report&&format)report.checks=report.checks.map(check=>check.id==='requirement_writing_format'?{...check,status:format.status,method:'deterministic',detail:format.detail}:check)
  const readiness=deliveryReadiness({goal:task.goal,documentHash:input.current.document.contentHash,revisionId:input.current.document.revisionId,placeholder:input.current.document.initialPlaceholder,
    reviewStale:review.stale,report,requiredCheckIds:task.requiredCheckIds,advisoryCheckIds:task.advisoryCheckIds,missingMaterials:task.missingMaterials,
    pendingCandidate:task.phase==='awaiting-adoption'&&!task.adoptionDecided,adoptionDecided:task.adoptionDecided,
    delivery:delivery&&{documentHash:delivery.documentHash,revisionId:delivery.revisionId,valid:!!artifacts},requiredFormatChecks:artifactError?[{id:'artifact_integrity',status:'fail',detail:artifactError}]:artifacts?.checks??[]})
  return {task,readiness:inputProblem?{state:'needs-check' as const,reasons:[inputProblem.message]}:readiness,candidateReview,inputProblem,artifacts,ledgerRevision:input.current.ledger.revision,documentHash:input.current.document.contentHash}
}
