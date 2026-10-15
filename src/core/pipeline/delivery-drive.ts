import {deliveryWritingOutputSchema,type DeliveryTask} from '../../shared/delivery-task.ts'
import {runStateSchema,type RunState,type RunSnapshot} from '../../shared/runs.ts'
import type {RequestContext} from '../../shared/schema.ts'
import {modelReviewOutputSchema,type ReviewReport} from '../../shared/review.ts'
import {digest,json,newId,type FileStore} from '../store/files.ts'
import {snapshot} from '../project/project.ts'
import {invariant,ScholarError} from '../../shared/errors.ts'
import {readCandidate,createCandidate,checkCandidate,prepareCandidateModelReview,prepareCandidateAdoption,recheckAdoptedCandidate,candidateView,committedCandidateAdoption} from './candidates.ts'
import {verifyDeliveryInputs,saveDeliveryTask,deliveryRoot} from './delivery-task.ts'
import {prepareDelivery,createDelivery,readDelivery} from '../export/delivery.ts'
import {prepareGeneration,validateModelReplacement,modelOutputSchema,generationSystem,type ModelCall} from './generation.ts'
import {modelReviewSystem,prepareModelReview,publishModelReview,validateModelReview} from '../review/model.ts'
import {projectMarkdown,textOf,walk} from '../editing/markdown.ts'
import {commit} from '../store/transactions.ts'
import {reviewInput} from '../review/review.ts'
import {documentHeadings} from '../editing/sections.ts'
import {runFile,inputFile} from './run-store.ts'
import type {SkillReader} from '../skills/bindings.ts'
import type {WritingTask} from '../../shared/writing-task.ts'

export type DeliveryServices={owner:RunState['owner'];signal:AbortSignal;context:RequestContext;skills?:SkillReader;
  waitForWriting:(task:DeliveryTask)=>Promise<WritingTask|undefined>;model:(call:ModelCall)=>Promise<string>;
  searchGaps?:(task:DeliveryTask,report:ReviewReport)=>Promise<boolean>;prepareResearch?:(task:DeliveryTask)=>Promise<boolean>;validateModel:()=>Promise<void>}
const progressHash=(report:ReviewReport)=>digest(json({checks:report.checks.filter(check=>check.status!=='pass').map(check=>({id:check.id,status:check.status,actual:check.id.startsWith('requirement_writing_length')?report.statistics:undefined})).sort((a,b)=>a.id.localeCompare(b.id)),
  issues:report.issues.filter(issue=>issue.state!=='resolved').map(issue=>({severity:issue.severity,category:issue.category,quote:issue.location?.quote?.replace(/\s+/gu,' '),requirements:issue.requirementIds})).sort((a,b)=>json(a).localeCompare(json(b)))}))

export async function deliveryModelCall(io:FileStore,task:DeliveryTask,services:DeliveryServices,plan:{snapshot:RunSnapshot;contentHash:string;dependencyHash?:string},call:Omit<ModelCall,'signal'|'runId'>){
  services.signal.throwIfAborted();await services.validateModel();await verifyDeliveryInputs(io,task)
  const {runId:_run,createdAt:_time,ledgerRevision:_revision,...dependencies}=plan.snapshot,
    requestHash=digest(json({dependencies,reviewDependencyHash:plan.snapshot.stage==='review'?plan.dependencyHash??null:null,system:call.system,instruction:call.instruction,context:call.context,maxTokens:call.maxTokens??null,repair:call.repair??null}))
  // A completed response survives a crash between receipt persistence and the next stage checkpoint.
  // Restore the original frozen plan too, so subsequent checks reference its actual Run identity.
  for(const completed of [...task.calls].reverse().filter(row=>row.status==='succeeded')){
    const file=await io.read(`${deliveryRoot(task.id)}/calls/${completed.runId}.json`);if(!file)continue
    const receipt=JSON.parse(file.text);if(receipt.requestHash!==requestHash||receipt.status!=='succeeded')continue
    const saved=await io.read(`${deliveryRoot(task.id)}/calls/${completed.runId}-plan.json`);invariant(saved,'DELIVERY_CALL_CHANGED','已完成调用缺少冻结计划。')
    const frozen=JSON.parse(saved.text),{contentHash,...body}=frozen
    invariant(contentHash===completed.planHash&&receipt.planHash===contentHash&&digest(json(body))===contentHash,'DELIVERY_CALL_CHANGED','已完成调用与冻结计划不符。')
    Object.assign(plan,frozen);return receipt.output as string
  }
  const runId=plan.snapshot.runId,path=`${deliveryRoot(task.id)}/calls/${runId}.json`,previous=await io.read(path)
  if(previous){const record=JSON.parse(previous.text);invariant(record.planHash===plan.contentHash,'DELIVERY_CALL_CHANGED','调用身份用于其他输入。');if(record.status==='succeeded')return record.output as string;invariant(false,'DELIVERY_CALL_UNKNOWN','上一请求回执不明，请显式决定是否重试。')}
  const run=runStateSchema.parse({schemaVersion:1,runId,projectId:task.projectId,sessionId:task.sessionId,status:'running',usedModelCalls:1,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),owner:services.owner,planHash:plan.contentHash,parentRunId:task.runId,stage:plan.snapshot.stage})
  await io.lock(async()=>commit(io,[{path:runFile(runId),before:undefined,after:json(run)},{path:inputFile(runId),before:undefined,after:json(plan.snapshot)},
    {path:`${deliveryRoot(task.id)}/calls/${runId}-plan.json`,before:undefined,after:json(plan)},
    {path,before:undefined,after:json({schemaVersion:1,runId,projectId:task.projectId,planHash:plan.contentHash,requestHash,status:'pending',createdAt:run.startedAt})}]))
  task.calls.push({runId,planHash:plan.contentHash,stage:plan.snapshot.stage==='research'?'research':plan.snapshot.stage==='review'?'review':'revision',status:'pending'});await saveDeliveryTask(io,task,services.owner)
  try{const output=await services.model({...call,runId,signal:services.signal});services.signal.throwIfAborted()
    await io.lock(async()=>{const image=await io.read(path),state=await io.read(runFile(runId));run.status='succeeded';run.updatedAt=new Date().toISOString();await commit(io,[{path,before:image,after:json({schemaVersion:1,runId,projectId:task.projectId,planHash:plan.contentHash,requestHash,status:'succeeded',output,completedAt:run.updatedAt})},{path:runFile(runId),before:state,after:json(run)}])})
    task.calls.at(-1)!.status='succeeded';await saveDeliveryTask(io,task,services.owner);return output
  }catch(error){task.calls.at(-1)!.status=services.signal.aborted?'unknown':'failed'
    await io.lock(async()=>{const image=await io.read(path),state=await io.read(runFile(runId));run.status=services.signal.aborted?'interrupted':'failed';run.updatedAt=new Date().toISOString();await commit(io,[{path,before:image,after:json({schemaVersion:1,runId,projectId:task.projectId,planHash:plan.contentHash,requestHash,status:services.signal.aborted?'unknown':'failed',completedAt:run.updatedAt})},{path:runFile(runId),before:state,after:json(run)}])})
    await saveDeliveryTask(io,task,services.owner);throw error}
}
/** Two format attempts per response contract, separate from unbounded substantive review progress. */
export async function deliveryJSON<T>(io:FileStore,task:DeliveryTask,services:DeliveryServices,plan:{snapshot:RunSnapshot;contentHash:string},call:Omit<ModelCall,'signal'|'runId'>,validate:(value:unknown)=>T):Promise<T>{
  let repair:string|undefined
  for(let attempt=0;attempt<2;attempt++){
    if(attempt){const {contentHash:_hash,...body}=plan,updated={...body,snapshot:{...body.snapshot,runId:newId('run'),createdAt:new Date().toISOString()}};Object.assign(plan,{...updated,contentHash:digest(json(updated))})}
    const raw=await deliveryModelCall(io,task,services,plan,{...call,...(repair&&{repair})})
    try{return validate(JSON.parse(raw))}catch(error){services.signal.throwIfAborted();if(attempt)throw error
      const code=error instanceof ScholarError?error.code:error instanceof SyntaxError?'JSON_SYNTAX':'OUTPUT_SCHEMA'
      repair=`上一输出未满足 ${code} 合同。请对照同一上下文重新返回完整严格 JSON，保留真实事实、引用和定位；不把无法核对项改为通过。没有 Markdown 围栏或额外键。`}
  }
  throw new ScholarError('MODEL_OUTPUT_INVALID','输出未满足阶段合同，未采用结果。')
}
export async function driveDelivery(io:FileStore,task:DeliveryTask,services:DeliveryServices){
  const context=async()=>({...services.context,projectId:task.projectId,expectedLedgerRevision:(await snapshot(io)).ledger.revision})
  const recoverPlan=async<T extends {snapshot:RunSnapshot;contentHash:string}>(stage:'review'|'revision',textHash:string):Promise<T|undefined>=>{
    const call=[...task.calls].reverse().find(row=>row.stage===stage&&row.status==='succeeded');if(!call)return undefined
    const file=await io.read(`${deliveryRoot(task.id)}/calls/${call.runId}-plan.json`);if(!file)return undefined
    const saved=JSON.parse(file.text),{contentHash,...body}=saved
    invariant(contentHash===call.planHash&&digest(json(body))===contentHash,'DELIVERY_CALL_CHANGED','已完成调用的冻结计划被修改。')
    return saved.snapshot.documentHash===textHash?saved:undefined
  }
  try{
    task.status='running';await saveDeliveryTask(io,task,services.owner)
    if(task.pendingStructure){task.status='waiting-input';task.phase='inputs';task.message='结构调整候选已保留，请集中确认本次调整范围后继续核对。';await saveDeliveryTask(io,task,services.owner);return task}
    if(task.phase==='awaiting-adoption'&&task.candidateId){const committed=await committedCandidateAdoption(io,await context(),task.id,task.candidateId)
      if(committed){task.adoptionDecided=true;task.adoptionPlanId=committed.plan.id;task.phase='recheck';await saveDeliveryTask(io,task,services.owner)}
      else {task.status='waiting-input';task.message='最终候选尚待集中审阅与采用。';await saveDeliveryTask(io,task,services.owner);return task}}
    if(task.phase==='first-draft'){
      task.message='正在按已确认大纲准备初稿。';await saveDeliveryTask(io,task,services.owner)
      if(task.goal==='research-results'&&services.prepareResearch){const prepared=await services.prepareResearch(task);if(!prepared){task.status='waiting-input';task.missingMaterials=['请在资料页确认作者已有结果、实验设置与字段映射。'];task.message=task.missingMaterials[0];await saveDeliveryTask(io,task,services.owner);return task}task.missingMaterials=[];if(task.pendingStructure){task.phase='inputs';task.status='waiting-input';task.message='已有结果候选包含结构调整，请集中确认范围后继续核对。';await saveDeliveryTask(io,task,services.owner);return task}}
      else{const writing=await services.waitForWriting(task);services.signal.throwIfAborted();invariant(!writing||writing.status==='completed','FIRST_DRAFT_NOT_COMPLETED','首稿尚未完成，部分成果保留；请处理原任务。')}
      const current=await snapshot(io);invariant(!current.document.initialPlaceholder,'FIRST_DRAFT_REQUIRED','尚无实际初稿。')
      task.requiredCheckIds=[...new Set([...task.requiredCheckIds,...current.ledger.outline.sections.map(section=>`section_${section.id}`),...Object.values(current.ledger.requirements).filter(req=>req.confirmation==='confirmed'&&!['deadline','ai-policy'].includes(req.kind)).map(req=>`requirement_${req.id}`)])]
      task.phase='candidate-check';await saveDeliveryTask(io,task,services.owner)
    }
    if(task.phase==='evidence'&&task.queries.some(row=>row.outcome==='pending')&&task.candidateId){
      await verifyDeliveryInputs(io,task)
      const old=(await readCandidate(io,task.id,task.candidateId,await context(),task.candidateHash)).candidate,
        current=await reviewInput(await candidateView(io,old))
      if(current.contextDependencyHash!==old.environmentHash){const refreshed=await createCandidate(io,await context(),{taskId:task.id,parentCandidateId:old.id,text:old.text,scope:'document',refreshDependencies:true,reason:'恢复同一授权检索阶段，按已落地材料重新冻结候选；原主稿与历史检查保留。'});task.candidateId=refreshed.candidate.id;task.candidateHash=refreshed.candidateHash;await saveDeliveryTask(io,task,services.owner)}
    }
    if(['candidate-check','revision','evidence'].includes(task.phase))while(true){
      services.signal.throwIfAborted();await verifyDeliveryInputs(io,task)
      if(!task.candidateId){const current=await snapshot(io),created=await createCandidate(io,await context(),{taskId:task.id,text:current.document.text,reason:'以已保存主稿建立不可变检查主体。',scope:'document'});task.candidateId=created.candidate.id;task.candidateHash=created.candidateHash;await saveDeliveryTask(io,task,services.owner)}
      const candidate=(await readCandidate(io,task.id,task.candidateId,await context(),task.candidateHash)).candidate
      task.phase='candidate-check';task.message='正在检查实际候选正文。';await saveDeliveryTask(io,task,services.owner)
      const fresh=await prepareCandidateModelReview(io,await context(),task.id,candidate.id,task.candidateHash!,task.model,services.skills)
      const recovered=await recoverPlan<typeof fresh>('review',candidate.textHash),plan=recovered&&recovered.dependencyHash===fresh.dependencyHash?recovered:fresh
      const output=await deliveryJSON(io,task,services,plan,{system:modelReviewSystem(plan),instruction:'检查当前候选及实际证据；位置只属于本候选。',context:plan.context,maxTokens:task.model.maxOutputTokens},value=>validateModelReview(plan,value)),checked=await checkCandidate(io,await context(),task.id,candidate.id,task.candidateHash!,{plan,output})
      task.checkId=checked.check.id;task.checkHash=checked.checkHash
      const report=checked.check.report,signature=progressHash(report),requirements=(await snapshot(io)).ledger.requirements
      const deferredFormat=(id:string)=>id.startsWith('requirement_')&&requirements[id.slice('requirement_'.length)]?.kind==='format'
      const validOwn=task.goal==='research-results'&&report.checks.some(check=>check.id==='own_result_links'&&check.status==='pass')&&report.checks.some(check=>check.id==='own_result_numbers'&&check.status==='pass')&&report.checks.some(check=>check.id==='own_result_units'&&check.status==='pass')
      const authorPendingId=`issue_${digest('own_research_results').slice(7,31)}`,pendingMarkerId=`issue_${digest('pending_markers').slice(7,31)}`
      const allowedPartial=validOwn&&report.checks.some(check=>check.id==='summary_body_consistency'&&check.status==='pass')
      const required=report.checks.filter(check=>task.requiredCheckIds.includes(check.id)&&check.status!=='pass'&&!deferredFormat(check.id)&&!(allowedPartial&&check.id==='pending_markers')&&!(validOwn&&check.id==='own_research_results')),
        b0=report.issues.some(issue=>issue.severity==='B0'&&issue.state!=='resolved'&&!(validOwn&&issue.id===authorPendingId)&&!(allowedPartial&&issue.id===pendingMarkerId))
      task.advisoryCheckIds=report.checks.filter(check=>!task.requiredCheckIds.includes(check.id)&&!['cite_','identity_','evidence_','claim_'].some(prefix=>check.id.startsWith(prefix))).map(check=>check.id)
      task.stalls=signature===task.lastProgressHash||task.progressHistory.includes(signature)?task.stalls+1:0;task.lastProgressHash=signature;task.progressHistory=[...task.progressHistory,signature].slice(-16);await saveDeliveryTask(io,task,services.owner)
      const sectionIssues=new Set(report.checks.filter(check=>check.status==='fail'&&check.id.startsWith('section_')).map(check=>`issue_${digest(check.id).slice(7,31)}`))
      const semanticFailures=new Set(report.checks.filter(check=>check.status==='fail'&&check.method==='model-assisted'&&task.requiredCheckIds.includes(check.id)).map(check=>`issue_${digest(check.id).slice(7,31)}`))
      const actionable=report.issues.filter(issue=>issue.state!=='resolved'&&issue.category!=='style'&&(issue.location||sectionIssues.has(issue.id)||semanticFailures.has(issue.id)||issue.requirementIds.some(id=>requirements[id]?.kind==='length')))
      if(!required.length&&!b0){
        if(allowedPartial&&report.checks.some(check=>check.id==='pending_markers'&&check.status==='fail')){const gaps:string[]=[];walk(projectMarkdown(candidate.text).tree,node=>{if(node.type==='text'&&/\[待补[：:]/u.test(node.value??''))gaps.push(node.value!)});task.missingMaterials=gaps.length?gaps:['科研初稿保留明确的未完成研究部分。']}
        if(candidate.text===(await snapshot(io)).document.text&&!(validOwn&&report.checks.some(check=>check.id==='own_research_results'&&check.status!=='pass'))){const adoption=await prepareCandidateAdoption(io,await context(),task.id,candidate.id,task.candidateHash!,task.checkId);await recheckAdoptedCandidate(io,await context(),adoption);task.adoptionDecided=true;task.phase='export';break}
        task.phase='awaiting-adoption';task.status='waiting-input';task.message='修改已准备好，可以集中查看并一次采用。';await saveDeliveryTask(io,task,services.owner);return task
      }
      if(task.stalls>=2){task.status='paused';task.message='连续工作未改善必需检查，候选已保留；请调整依据或处理缺口。';await saveDeliveryTask(io,task,services.owner);return task}
      if(report.checks.some(check=>check.id==='own_research_results'&&check.status==='fail')){task.missingMaterials=['缺少当前项目已确认的真实研究结果。'];task.status='waiting-input';task.message=task.missingMaterials[0];await saveDeliveryTask(io,task,services.owner);return task}
      const evidenceGap=report.checks.some(check=>check.status!=='pass'&&['evidence_','claim_','identity_'].some(prefix=>check.id.startsWith(prefix)))
      if(!actionable.length||evidenceGap&&task.online){task.phase='evidence';task.message='正在根据缺口补充依据。';await saveDeliveryTask(io,task,services.owner)
        if(task.online&&services.searchGaps&&await services.searchGaps(task,report)){task.checkId=undefined;await saveDeliveryTask(io,task,services.owner);continue}
        task.status='waiting-input';task.message='必需条件仍待核对，依据和候选已保留。';await saveDeliveryTask(io,task,services.owner);return task}
      task.phase='revision';task.message='正在根据候选检查准备修订。';await saveDeliveryTask(io,task,services.owner)
      const freshGeneration=await prepareGeneration(await candidateView(io,candidate),{context:await context(),instruction:'修正实际候选问题并返回完整正文；保留其他内容、数字、引用、人工编辑和限定。若调整原章节标题或顺序，额外返回 outlineSections:[{id,title}]，按新文稿顺序一一映射全部原章节 ID，保留所有原论点和必需覆盖，不删除章节来制造达标。'+(task.structureChoice?.decision==='keep'?'作者已拒绝前一结构调整，本次须保持原有标题与顺序；拒绝记录 '+json(task.structureChoice):'')+(task.goal==='research-results'?'必须返回 paragraphClaims，paragraphIndex 按源顺序逐一映射全部实际 paragraph 及 table 节点（包括列表段落）的零起始编号和实际 claimIds；没有关联则空数组。':'')+'\n'+json(actionable)},task.model,services.skills,{allowInternalResults:task.goal==='research-results',includeOutlineMapping:true})
      const savedGeneration=await recoverPlan<typeof freshGeneration>('revision',candidate.textHash),generation=savedGeneration&&savedGeneration.input.instruction===freshGeneration.input.instruction&&json(savedGeneration.context)===json(freshGeneration.context)?savedGeneration:freshGeneration
      const generated=await deliveryJSON(io,task,services,generation,{system:generationSystem(generation),instruction:generation.input.instruction,context:generation.context,maxTokens:task.model.maxOutputTokens},value=>{const output=deliveryWritingOutputSchema.parse(value);validateModelReplacement(generation,output.replacementText);const titles=documentHeadings(output.replacementText).map(node=>node.title),outline=candidate.outline??(generation.context.outline as any);invariant(output.outlineSections||outline.sections.every((section:any)=>titles.includes(section.title.normalize('NFC').trim().replace(/\s+/gu,' '))),'STRUCTURE_MAPPING_REQUIRED','调整标题时须提供全部原章节 ID 与实际新标题的明确映射。');return output})
      const headings=(text:string)=>documentHeadings(text).map(({title,depth})=>({title,depth})),structureChanged=json(headings(candidate.text))!==json(headings(generated.replacementText))
      const paragraphs=projectMarkdown(generated.replacementText).blocks.filter(block=>block.node.type==='paragraph'||task.goal==='research-results'&&block.node.type==='table')
      if(task.goal==='research-results')invariant(generated.paragraphClaims?.length===paragraphs.length&&new Set(generated.paragraphClaims.map(row=>row.paragraphIndex)).size===paragraphs.length&&generated.paragraphClaims.every(row=>row.paragraphIndex<paragraphs.length),'RESULT_PARAGRAPH_MAPPING_REQUIRED','科研修订须逐段保留内部依据映射。')
      const revised=await createCandidate(io,await context(),{taskId:task.id,parentCandidateId:candidate.id,text:generated.replacementText,reason:'基于本候选检查准备下一版本；原章节与论点覆盖保留。',scope:'document',outlineSections:generated.outlineSections,claimUpdates:generated.claimUpdates,paragraphClaims:generated.paragraphClaims?.filter(row=>row.claimIds.length).map(row=>({blockId:paragraphs[row.paragraphIndex].id,claimIds:row.claimIds}))})
      task.candidateId=revised.candidate.id;task.candidateHash=revised.candidateHash
      if(structureChanged&&!task.allowStructure){task.pendingStructure=true;task.phase='inputs';task.status='waiting-input';task.message='结构调整候选已准备；请集中确认是否允许，再继续核对。';await saveDeliveryTask(io,task,services.owner);return task}
      await saveDeliveryTask(io,task,services.owner)
    }
    if(task.phase==='recheck'){
      const file=task.adoptionPlanId&&await io.read(`${deliveryRoot(task.id)}/adoptions/${task.adoptionPlanId}-plan.json`)
      invariant(file||task.keptOriginal,'ADOPTION_RECHECK_REQUIRED','采用已保存，复查计划尚未取得；不会再次采用。')
      const recheck=file?await recheckAdoptedCandidate(io,await context(),JSON.parse(file.text)):{needsSemanticCheck:true}
      if(recheck.needsSemanticCheck){const plan=await prepareModelReview(io,{context:await context(),assessmentScope:'cross-section'},task.model,services.skills),
        output=await deliveryJSON(io,task,services,plan,{system:modelReviewSystem(plan),instruction:'检查实际已经保存的主稿及其当前依赖。',context:plan.context,maxTokens:task.model.maxOutputTokens},value=>validateModelReview(plan,value))
        await publishModelReview(io,plan,output)
      }
      task.phase='export';await saveDeliveryTask(io,task,services.owner)
    }
    if(task.phase==='export'){
      const {spec}=await verifyDeliveryInputs(io,task),current=await snapshot(io),reviewId=JSON.parse((await io.read('.scholarflow/reviews/current.json'))?.text??'{}').reviewId,
        existing=Object.values(current.ledger.deliveries).find(delivery=>delivery.documentHash===current.document.contentHash&&delivery.revisionId===current.document.revisionId&&delivery.reviewId===reviewId&&delivery.files.some(file=>file.relativePath===`paper.${spec.format==='docx'?'docx':spec.format==='latex'?'tex':'md'}`))
      if(existing){await readDelivery(io,existing.id);task.deliveryId=existing.id}else{const plan=await prepareDelivery(io,spec.format),created=await createDelivery(io,plan,plan.reviewedAllowed?'reviewed-draft':'working-draft',plan.ledgerRevision);task.deliveryId=created.manifest.id}
      task.phase='finished';task.status='completed-with-issues';task.message='同快照文件已准备，要求与待核对项分别记录。';await saveDeliveryTask(io,task,services.owner)
    }
    return task
  }catch(error){task.status=services.signal.aborted?'paused':error instanceof ScholarError&&['DELIVERY_CALL_UNKNOWN','DELIVERY_INPUT_CHANGED','STALE_MATERIAL_VERSION','DELIVERY_RESOURCE_CHANGED','STRUCTURE_APPROVAL_REQUIRED'].includes(error.code)?'waiting-input':'failed';
    task.message=error instanceof ScholarError?error.message:services.signal.aborted?'任务已暂停，已完成产物保留。':'任务未完成，进度和调用记录保留。';await saveDeliveryTask(io,task,services.owner);return task}
}
