import {z} from 'zod'
import {newId,digest,json,type FileStore} from '../../core/store/files.ts'
import {snapshot} from '../../core/project/project.ts'
import {prepareDeliveryTask,startDeliveryTask,inspectDeliveryTask,readDeliveryTask,saveDeliveryTask,verifyDeliveryInputs,deliveryRoot,type DeliveryTaskPlan} from '../../core/pipeline/delivery-task.ts'
import {driveDelivery,deliveryModelCall,deliveryJSON,type DeliveryServices} from '../../core/pipeline/delivery-drive.ts'
import {deliveryPrepareRequest,deliveryActionRequest,candidateRefRequest,candidateAdoptRequest,deliveryWritingOutputSchema,type DeliveryTask} from '../../shared/delivery-task.ts'
import {runStartRequest} from '../../shared/runs.ts'
import {requestContext,id,type RequestContext} from '../../shared/schema.ts'
import {invariant} from '../../shared/errors.ts'
import {resolveStore} from './project-api.ts'
import {selectedModel,callStageModel} from '../executor/model.ts'
import {readPrivateSkill} from '../skills/reader.ts'
import type {WritingController} from './writing-controller.ts'
import {readWritingTask} from '../../core/pipeline/writing-task-store.ts'
import {locateEvidence,prepareWritingOutline} from '../../core/pipeline/writing-task.ts'
import {prepareCandidateAdoption,adoptCandidate,recheckAdoptedCandidate,readCandidate,prepareCandidateModelReview,createCandidate,candidateView,committedCandidateAdoption,type CandidateAdoptionPlan} from '../../core/pipeline/candidates.ts'
import {reviewInput} from '../../core/review/review.ts'
import {protectedChanges} from '../../core/editing/proposals.ts'
import {runSnapshotSchema} from '../../shared/runs.ts'
import {writingContext} from '../../core/pipeline/writing-context.ts'
import {resolveStageSkills} from '../../core/skills/bindings.ts'
import {parseRegisteredMaterial} from '../../core/materials/parse.ts'
import {parseMaterialBytes} from '../parsers/parse.ts'
import {prepareGeneration,generationSystem,validateModelReplacement,modelOutputSchema} from '../../core/pipeline/generation.ts'
import {projectMarkdown,textOf} from '../../core/editing/markdown.ts'
import {documentHeadings} from '../../core/editing/sections.ts'
import {inspectResults} from '../../core/research/results.ts'
import {researchMaterialRoles,parseResearchConfig} from '../../core/research/research-inputs.ts'
import type {ReviewReport} from '../../shared/review.ts'
type Host=any

export class DeliveryController{
  private plans=new Map<string,{plan:DeliveryTaskPlan;peer:string;expires:number}>()
  private adoptions=new Map<string,{plan:CandidateAdoptionPlan;peer:string;expires:number}>()
  private active=new Map<string,{task:DeliveryTask;controller:AbortController;context:RequestContext;promise?:Promise<DeliveryTask>}>()
  private failures=new Map<string,string>()
  private ctx:Host
  private writing:WritingController
  private bootInstance:string
  constructor(ctx:Host,writing:WritingController,bootInstance:string){this.ctx=ctx;this.writing=writing;this.bootInstance=bootInstance;ctx.effect(()=>()=>{for(const run of this.active.values())run.controller.abort();this.plans.clear();this.adoptions.clear()},'scholarflow: stop delivery coordination')}
  private descriptor(model:Awaited<ReturnType<typeof selectedModel>>){return {providerId:model.selected.provider,modelId:model.selected.model,reasoningEffort:model.selected.reasoningEffort,maxOutputTokens:model.maxOutputTokens}}
  private async validateResources(io:FileStore){for(const stage of ['drafting','review'] as const)await resolveStageSkills(io,stage,binding=>readPrivateSkill(binding,io))}
  async prepare(request:unknown,peer:string,signal:AbortSignal){const input=deliveryPrepareRequest.parse(request),{io}=await resolveStore(this.ctx,input.context,signal),model=await selectedModel(this.ctx,input.context.sessionId,signal)
    for(const [key,row] of this.plans)if(row.expires<Date.now())this.plans.delete(key);invariant(this.plans.size<8,'TOO_MANY_PENDING_PLANS','请先处理已有交付计划。')
    const plan=await prepareDeliveryTask(io,input,this.descriptor(model));this.plans.set(plan.id,{plan,peer,expires:Date.now()+600000});return {planId:plan.id,planHash:plan.planHash,goal:plan.goal,model:plan.model,scope:plan.scope,allowStructure:plan.allowStructure,online:plan.online}}
  async start(request:unknown,peer:string,signal:AbortSignal,defer=false){const input=runStartRequest.parse(request),row=this.plans.get(input.planId)
    invariant(row&&row.peer===peer&&row.expires>Date.now()&&row.plan.planHash===input.planHash,'INVALID_APPROVAL','请重新预览交付任务。')
    const {io}=await resolveStore(this.ctx,input.context,signal),model=await selectedModel(this.ctx,input.context.sessionId,signal)
    invariant(json(this.descriptor(model))===json(row.plan.model),'MODEL_SELECTION_CHANGED','当前宿主模型已改变，请重新预览。')
    const task=await startDeliveryTask(io,input.context,row.plan,{pid:process.pid,bootInstance:this.bootInstance});this.plans.delete(input.planId);const activate=()=>this.launch(io,input.context,task);if(!defer)activate();return {task,...(defer&&{activate})}
  }
  async inspect(request:unknown,signal:AbortSignal){const input=z.object({context:requestContext,taskId:id.optional()}).strict().parse(request),{io}=await resolveStore(this.ctx,input.context,signal);let result=io.observe?await io.observe(()=>inspectDeliveryTask(io,input.context,input.taskId)):await inspectDeliveryTask(io,input.context,input.taskId)
    if(result.task)try{await this.validateResources(io)}catch{return {...result,readiness:{state:'needs-check',reasons:['实际固定 Skill 资源不可用或字节已改变，请重新核对。']}}}
    if(result.task&&['running','queued'].includes(result.task.status)&&!this.active.has(result.task.id))result=io.observe?await io.observe(()=>inspectDeliveryTask(io,input.context,input.taskId)):await inspectDeliveryTask(io,input.context,input.taskId)
    if(result.task?.phase==='awaiting-adoption'&&result.task.candidateId&&!this.active.has(result.task.id)&&await committedCandidateAdoption(io,input.context,result.task.id,result.task.candidateId))return {...result,recovery:'adoption-committed',readiness:{state:'needs-check',reasons:['采用已提交，后续复查与交付记录尚待恢复。']},task:{...result.task,adoptionDecided:true,phase:'recheck',status:'interrupted',message:'采用已保存，回执后的复查尚未完成；继续会复查实际主稿，不会重复采用。'}}
    if(result.task&&this.failures.has(result.task.id)&&!this.active.has(result.task.id))return {...result,task:{...result.task,status:'interrupted',message:`后台运行状态未能完整保存（${this.failures.get(result.task.id)}），请先检查恢复记录，再继续。`}}
    if(result.task&&['running','queued'].includes(result.task.status)&&!this.active.has(result.task.id))return {...result,task:{...result.task,status:'interrupted',message:'宿主执行已中断，进度保留；请明确继续。'}}
    return result}
  private launch(io:FileStore,context:RequestContext,task:DeliveryTask){
    invariant(!this.active.has(task.id),'DELIVERY_ALREADY_RUNNING','交付任务已经运行。')
    this.failures.delete(task.id)
    const controller=new AbortController(),entry={task,controller,context,promise:undefined as Promise<DeliveryTask>|undefined};this.active.set(task.id,entry)
    const services:DeliveryServices={owner:{pid:process.pid,bootInstance:this.bootInstance},signal:controller.signal,context,
      skills:binding=>readPrivateSkill(binding,io),waitForWriting:task=>this.writing.waitForDelivery(context,task.writingTaskId,controller.signal),
      validateModel:async()=>{const live=await selectedModel(this.ctx,context.sessionId,controller.signal);invariant(json(this.descriptor(live))===json(task.model),'MODEL_SELECTION_CHANGED','宿主模型改变，当前任务暂停并保留成果。')},
      model:async call=>{const model=await selectedModel(this.ctx,context.sessionId,call.signal);invariant(Math.ceil(Buffer.byteLength(json(call.context))/3)+(call.maxTokens??4096)+2000<=model.contextWindow,'CONTEXT_WINDOW_EXCEEDED','当前主体超过模型上下文范围；未假装读取完整正文。');return callStageModel(this.ctx,model.session,model.selected,call)}}
    services.searchGaps=(task,report)=>this.searchGaps(io,context,task,report,services)
    services.prepareResearch=task=>this.prepareResearch(io,context,task,services)
    entry.promise=driveDelivery(io,task,services).catch(async error=>{const code=error?.code;this.failures.set(task.id,typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)?code:'CHECKPOINT_UNAVAILABLE');if(this.failures.size>50)this.failures.delete(this.failures.keys().next().value!);return readDeliveryTask(io,context,task.id).then(row=>row?.task??task,()=>task)}).finally(()=>this.active.delete(task.id))
  }
  private async stagePlan(io:FileStore,context:RequestContext,task:DeliveryTask,system:string,data:Record<string,unknown>){
    const input=await reviewInput(io),writing=await writingContext(io,input.current,'drafting',binding=>readPrivateSkill(binding,io))
    const body={id:newId('research_stage'),snapshot:runSnapshotSchema.parse({schemaVersion:1,runId:newId('run'),projectId:task.projectId,sessionId:task.sessionId,stage:'research',
      configHash:input.current.configHash,ledgerRevision:input.current.ledger.revision,documentHash:input.current.document.contentHash,outlineVersion:input.current.ledger.outline.version,
      materialHashes:Object.fromEntries(Object.entries(input.materialHashes).filter(([,hash])=>hash.startsWith('sha256:'))),sourceHashes:Object.fromEntries(Object.values(input.current.ledger.sources).filter(row=>row.contentHash).map(row=>[row.id,row.contentHash])),
      profileHash:writing.profileHash,skillDigests:writing.skillDigests,resourceLockHash:writing.resourceLockHash,modelDescriptor:task.model,budget:input.current.config.workflow.budget,networkScope:'local-only',createdAt:new Date().toISOString()}),
      system,context:{...data,writing:writing.projectProfile,academicSkills:writing.academicSkills,approvedMemory:writing.approvedMemory},environmentHash:input.contextDependencyHash}
    return {...body,contentHash:digest(json(body))}
  }
  private async prepareResearch(io:FileStore,context:RequestContext,task:DeliveryTask,services:DeliveryServices){
    const current=await reviewInput(io),state=await inspectResults(io),own=Object.values(current.current.ledger.evidence).filter(row=>row.kind==='user-measurement'&&row.validation==='located'&&row.measurement?.origin==='user-supplied'&&current.current.ledger.sources[row.sourceId]?.kind==='user-result'&&current.current.ledger.sources[row.sourceId]?.materialId&&current.materialHashes[current.current.ledger.sources[row.sourceId].materialId!]===row.sourceContentHash)
    if(!own.length&&task.researchKind!=='theoretical')return false
    const inputHash=digest(json({measurements:own,experiments:Object.values(state.experiments.records).filter(record=>record.status==='current')}))
    if(task.researchDraftPrepared&&task.candidateId&&task.researchInputHash===inputHash)return true
    invariant(!task.researchInputHash||task.researchInputHash===inputHash,'RESEARCH_INPUT_CHANGED','作者结果或配置版本已更新，旧候选保留；请预览新任务基准。')
    const writing=await readWritingTask(io,task.writingTaskId);invariant(writing,'WRITING_SPEC_MISSING','结果成稿需要原确认的要求和结构。')
    const stageModel=async(system:string,data:unknown)=>{const plan=await this.stagePlan(io,context,task,system,data as Record<string,unknown>);return deliveryModelCall(io,task,services,plan,{system,instruction:'根据作者已完成研究及实际证据组织初稿，未完成工作保持局部待补。',context:plan.context,maxTokens:task.model.maxOutputTokens})}
    if(!task.researchPrepared){
      const roles=await researchMaterialRoles(io)
      for(const material of Object.values((await snapshot(io)).ledger.materials))if(writing.spec.materials.includes(material.projectRelativePath)&&!['ready','partial'].includes(material.parseStatus)){
        const role=roles?.roles.find(row=>row.path===material.projectRelativePath)?.role
        if(/\.json$/iu.test(material.projectRelativePath)&&['method','settings'].includes(role??''))await parseRegisteredMaterial(io,material.id,(await snapshot(io)).ledger.revision,services.signal,async bytes=>parseResearchConfig(bytes,material.projectRelativePath,services.signal))
        else if(!/\.(csv|json|png|jpe?g)$/iu.test(material.projectRelativePath))await parseRegisteredMaterial(io,material.id,(await snapshot(io)).ledger.revision,services.signal,(bytes,type)=>parseMaterialBytes(bytes,type,services.signal))
      }
      await locateEvidence(io,writing,stageModel,services.signal,()=>services.signal.aborted)
      const basis=await snapshot(io)
      if(basis.document.initialPlaceholder||!basis.ledger.outline.sections.length||!basis.ledger.outline.sections.some(section=>section.claimIds.length)){const prepared=await prepareWritingOutline(io,writing,stageModel,{strictEvidencePlanning:true});invariant(prepared,'RESEARCH_PLAN_INCOMPLETE','现有事实清单仍有必须决定的问题。')}
      task.researchPrepared=true;task.researchInputHash=inputHash;await saveDeliveryTask(io,task,services.owner)
    }
    if(!task.candidateId){const base=await createCandidate(io,{...context,expectedLedgerRevision:(await snapshot(io)).ledger.revision},{taskId:task.id,text:(await snapshot(io)).document.text,scope:'document',reason:'保留已有主稿与确认结构，作为结果成稿候选的不可变基准。'});task.candidateId=base.candidate.id;task.candidateHash=base.candidateHash;await saveDeliveryTask(io,task,services.owner)}
    const latest=await snapshot(io),plan=await prepareGeneration(io,{context:{...context,expectedLedgerRevision:latest.ledger.revision},instruction:'根据已有研究事实、设置和实际测量形成完整科研初稿。先组织方法与设置、真实结果和讨论，再总结引言、摘要；保留指定章节、已有人工内容和未完成部分。已有论点的事实版本需更新时返回 claimUpdates，保留原 ID 并使用当前有效证据；旧数字不得作为新事实。外部论断真实引用；作者结果通过内部论点及实验支持，不把原始日志伪装成论文。额外返回 paragraphClaims，paragraphIndex 按源顺序逐一映射正文全部 paragraph 及 table 节点（包括列表段落）的零起始编号和实际 claimIds；无关联时为空数组。'},task.model,services.skills,{allowInternalResults:true,includeSourceContext:true,includeOutlineMapping:true})
    const data={...plan.context,deliveryStructureContract:true,experiments:Object.values(state.experiments.records).filter(record=>record.status==='current'),researchFacts:{measurementEvidenceIds:own.map(row=>row.id),missing:'没有提供的实验、重复运行或消融不宣称已完成。'}}
    const {contentHash:_old,...unsigned}=plan,frozen={...unsigned,context:data,contentHash:digest(json({...unsigned,context:data}))}
    const output=await deliveryJSON(io,task,services,frozen,{system:generationSystem(frozen),instruction:frozen.input.instruction,context:data,maxTokens:task.model.maxOutputTokens},value=>{const output=deliveryWritingOutputSchema.parse(value);validateModelReplacement(frozen,output.replacementText);const titles=documentHeadings(output.replacementText).map(node=>node.title);invariant(output.outlineSections||latest.ledger.outline.sections.every(section=>titles.includes(section.title.normalize('NFC').trim().replace(/\s+/gu,' '))),'STRUCTURE_MAPPING_REQUIRED','调整标题时须明确映射全部原章节 ID。');return output})
    const paragraphs=projectMarkdown(output.replacementText).blocks.filter(block=>block.node.type==='paragraph'||block.node.type==='table'),mappings=output.paragraphClaims
    invariant(mappings&&mappings.length===paragraphs.length&&new Set(mappings.map(row=>row.paragraphIndex)).size===paragraphs.length&&mappings.every(row=>row.paragraphIndex<paragraphs.length),'RESULT_PARAGRAPH_MAPPING_REQUIRED','科研正文须逐段保留实际结果／贡献依据映射。')
    const created=await createCandidate(io,{...context,expectedLedgerRevision:(await snapshot(io)).ledger.revision},{taskId:task.id,parentCandidateId:task.candidateId,text:output.replacementText,reason:'按作者真实结果与现有研究事实形成初稿候选，相关论点更新在最终采用前保持候选状态。',scope:'document',outlineSections:output.outlineSections,claimUpdates:output.claimUpdates,paragraphClaims:mappings.filter(row=>row.claimIds.length).map(row=>({blockId:paragraphs[row.paragraphIndex].id,claimIds:row.claimIds}))})
    const headings=(text:string)=>documentHeadings(text).map(({title,depth})=>({title,depth}))
    task.pendingStructure=!task.allowStructure&&json(headings(latest.document.text))!==json(headings(output.replacementText));task.researchDraftPrepared=true;task.candidateId=created.candidate.id;task.candidateHash=created.candidateHash;await saveDeliveryTask(io,task,services.owner);return true
  }
  private async searchGaps(io:FileStore,context:RequestContext,task:DeliveryTask,report:ReviewReport,services:DeliveryServices){
    const gaps=report.checks.filter(check=>check.status!=='pass'&&check.id!=='own_research_results'&&(task.requiredCheckIds.includes(check.id)||['evidence_','claim_','identity_'].some(prefix=>check.id.startsWith(prefix))))
    if(!gaps.length)return false
    const writing=await readWritingTask(io,task.writingTaskId);invariant(writing,'FIRST_DRAFT_REQUIRED','没有对应原始写作任务，不能扩大网络范围。')
    const current=await snapshot(io),input={...context,expectedLedgerRevision:current.ledger.revision},check=await prepareCandidateModelReview(io,input,task.id,task.candidateId!,task.candidateHash!,task.model,services.skills)
    const body={...check,id:newId('query_plan'),snapshot:{...check.snapshot,runId:newId('run'),stage:'research' as const},context:{gaps,sources:check.context.sources,question:current.ledger.outline.researchQuestion,evidence:check.context.evidence,previousQueries:task.queries.map(row=>({gapIds:row.gapIds,query:row.query,outcome:row.outcome}))}}
    const {contentHash:_old,...unsigned}=body,plan={...unsigned,contentHash:digest(json(unsigned))}
    const pending=task.queries.filter(row=>row.outcome==='pending')
    const raw=pending.length?undefined:await deliveryModelCall(io,task,services,plan,{system:'只返回 JSON {"queries":[{"gapIds":["给定检查ID"],"query":"针对实际缺口的检索式"}]}。每批至多三条；不编造文献，不请求作者未完成的实验，不扩大网络提供方。',instruction:'为当前实际证据缺口提出新检索式。',context:plan.context,maxTokens:Math.min(task.model.maxOutputTokens??4096,4096)})
    const output=pending.length?{queries:pending.map(row=>({gapIds:row.gapIds,query:row.query}))}:z.object({queries:z.array(z.object({gapIds:z.array(id).min(1),query:z.string().trim().min(1).max(2000)}).strict()).max(3)}).strict().parse(JSON.parse(raw!))
    const evidenceHash=async()=>{const input=await reviewInput(io);return digest(json(Object.values(input.current.ledger.evidence).filter(row=>row.validation==='located'&&input.current.ledger.sources[row.sourceId]?.materialId&&input.materialHashes[input.current.ledger.sources[row.sourceId].materialId!]===row.sourceContentHash).map(row=>({hash:row.sourceContentHash,excerpt:row.excerpt,locator:row.locator})).sort((a,b)=>a.excerpt.localeCompare(b.excerpt))))}
    let progress=false
    for(const query of output.queries){const unfinished=pending.find(row=>row.query===query.query&&json(row.gapIds)===json(query.gapIds))
      invariant(unfinished||query.gapIds.every(id=>gaps.some(gap=>gap.id===id)),'RESEARCH_GAP_INVALID','检索式引用了范围外缺口。');const before=unfinished?.evidenceBefore??await evidenceHash(),key=unfinished?.key??digest(json({query:query.query.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim(),provider:'openalex',gapIds:[...query.gapIds].sort(),evidence:before}))
      if(!unfinished&&task.queries.some(row=>row.key===key))continue
      const attempt=unfinished??{key,gapIds:query.gapIds,query:query.query,evidenceBefore:before,outcome:'pending' as const};if(!unfinished){task.queries.push(attempt);await saveDeliveryTask(io,task,services.owner)}
      try{await this.writing.searchForDelivery(io,writing,query.query,services.signal);writing.evidenceMaterialIndex=0;writing.evidenceBlockIndex=0
        await locateEvidence(io,writing,async(system,data)=>{
          const {contentHash:_hash,...parts}=check,unit={...parts,id:newId('evidence_plan'),snapshot:{...parts.snapshot,runId:newId('run'),stage:'research' as const},context:data as Record<string,unknown>};let plan={...unit,contentHash:digest(json(unit))}
          for(const call of [...task.calls].reverse().filter(row=>row.stage==='research'&&row.status==='succeeded')){
            const file=await io.read(`${deliveryRoot(task.id)}/calls/${call.runId}-plan.json`);if(!file)continue
            const saved=JSON.parse(file.text),{contentHash,...body}=saved
            if(String(saved.id).startsWith('evidence_plan_')&&json(saved.context)===json(data)&&json(saved.snapshot.modelDescriptor)===json(plan.snapshot.modelDescriptor)&&saved.snapshot.profileHash===plan.snapshot.profileHash&&json(saved.snapshot.skillDigests)===json(plan.snapshot.skillDigests)&&saved.snapshot.resourceLockHash===plan.snapshot.resourceLockHash){invariant(contentHash===call.planHash&&digest(json(body))===contentHash,'DELIVERY_CALL_CHANGED','已完成证据读取计划已改变。');plan=saved;break}
          }
          return deliveryModelCall(io,task,services,plan,{system,instruction:'整理本批实际定位证据，不宣称全文或全部图表已读。',context:plan.context,maxTokens:task.model.maxOutputTokens})},services.signal,()=>services.signal.aborted)
        const after=await evidenceHash();Object.assign(attempt,{evidenceAfter:after,outcome:after!==before?'progress':'no-progress'});progress||=after!==before
      }catch(error){services.signal.throwIfAborted();const code=(error as {code?:string}).code
        if(code&&['DELIVERY_INPUT_CHANGED','STALE_MATERIAL_VERSION','MATERIAL_APPROVAL_CHANGED','NETWORK_APPROVAL_CHANGED','DELIVERY_RESOURCE_CHANGED'].includes(code))throw error
        Object.assign(attempt,{outcome:'unavailable',failureCode:code&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)?code:'SEARCH_UNAVAILABLE'})}
      await saveDeliveryTask(io,task,services.owner)
    }
    const old=(await readCandidate(io,task.id,task.candidateId!,context,task.candidateHash)).candidate
    const currentInput=await reviewInput(io)
    if(currentInput.current.ledger.revision!==current.ledger.revision){const refreshed=await createCandidate(io,{...context,expectedLedgerRevision:currentInput.current.ledger.revision},{taskId:task.id,parentCandidateId:old.id,text:old.text,refreshDependencies:true,reason:'同一网络授权内补充材料后重新冻结候选，旧检查不继承。',scope:'document'});task.candidateId=refreshed.candidate.id;task.candidateHash=refreshed.candidateHash;task.checkId=undefined;await saveDeliveryTask(io,task,services.owner)}
    return progress
  }
  async action(request:unknown,signal:AbortSignal){const input=deliveryActionRequest.parse(request),{io}=await resolveStore(this.ctx,input.context,signal),row=await readDeliveryTask(io,input.context,input.taskId)
    invariant(row,'DELIVERY_TASK_MISSING','当前任务不存在。')
    const active=this.active.get(input.taskId)
    if(active&&(input.action==='pause'||input.action==='cancel')){active.controller.abort(input.action)
      if(active.task.writingTaskId&&active.task.phase==='first-draft'&&active.task.goal!=='research-results')await this.writing.action({context:input.context,taskId:active.task.writingTaskId,action:input.action==='cancel'?'cancel':'pause'},new AbortController().signal)
      await active.promise;const latest=await readDeliveryTask(io,input.context,input.taskId);if(input.action==='cancel'&&latest){latest.task.status='cancelled';await saveDeliveryTask(io,latest.task,{pid:process.pid,bootInstance:this.bootInstance})}return this.inspect({context:input.context,taskId:input.taskId},signal)}
    invariant(row.task.revision===input.expectedTaskRevision,'DELIVERY_TASK_CHANGED','当前任务有新的进度，请重新读取。')
    invariant(!active,'DELIVERY_ALREADY_RUNNING','任务仍在运行。')
    const task=row.task
    if(['resume','recheck','allow-structure','keep-structure'].includes(input.action)){
      const unknown=task.calls.filter(call=>['pending','unknown'].includes(call.status)&&!task.acknowledgedUnknownCalls[call.runId])
      invariant(!unknown.length||input.acknowledgeUnknownCall,'DELIVERY_CALL_UNKNOWN','存在回执不明的模型请求，请明确选择是否重新发送；已确认的旧请求不重复询问。')
      if(unknown.length){for(const call of unknown)task.acknowledgedUnknownCalls[call.runId]=new Date().toISOString();await saveDeliveryTask(io,task,{pid:process.pid,bootInstance:this.bootInstance})}
    }
    if(input.action==='recheck'){
      invariant(task.candidateId&&!task.adoptionDecided&&!task.pendingStructure,'DELIVERY_CANDIDATE_CHANGED','请选择尚未采用且范围已确认的当前候选。');await verifyDeliveryInputs(io,task)
      const old=(await readCandidate(io,task.id,task.candidateId,input.context,task.candidateHash)).candidate,subject=await reviewInput(await candidateView(io,old))
      if(subject.contextDependencyHash!==old.environmentHash){const refreshed=await createCandidate(io,{...input.context,expectedLedgerRevision:(await snapshot(io)).ledger.revision},{taskId:task.id,parentCandidateId:old.id,text:old.text,scope:'document',refreshDependencies:true,reason:'用户明确请求按当前范围重新核对已有候选，原稿与旧检查保留。'});task.candidateId=refreshed.candidate.id;task.candidateHash=refreshed.candidateHash}
      task.checkId=undefined;task.checkHash=undefined;task.phase='candidate-check';task.status='queued';task.stalls=0;task.bestFactDebt=undefined;task.progressHistory=[];task.lastProgressHash=undefined;await saveDeliveryTask(io,task,{pid:process.pid,bootInstance:this.bootInstance});this.launch(io,input.context,task);return {task}
    }
    if(input.action==='allow-structure'||input.action==='keep-structure'){
      invariant(task.pendingStructure&&task.candidateId&&task.candidateHash,'STRUCTURE_APPROVAL_INVALID','当前没有待决定的结构候选。');await verifyDeliveryInputs(io,task)
      const proposedRecord=await readCandidate(io,task.id,task.candidateId,input.context,task.candidateHash),proposed=proposedRecord.candidate,current=await snapshot(io)
      invariant(current.document.contentHash===proposed.baseDocumentHash&&current.document.revisionId===proposed.baseRevisionId,'STALE_DOCUMENT_VERSION','保存稿已变化，请重新建立候选基准。')
      const decision={candidateId:proposed.id,decision:input.action==='allow-structure'?'allow' as const:'keep' as const,at:new Date().toISOString()}
      if(decision.decision==='allow')task.allowStructure=true
      else{invariant(proposed.parentCandidateId,'STRUCTURE_APPROVAL_INVALID','首次结果成稿请调整要求后重新准备，不能猜测回退结构。');const parent=await readCandidate(io,task.id,proposed.parentCandidateId,input.context);task.candidateId=parent.candidate.id;task.candidateHash=parent.candidateHash}
      task.pendingStructure=false;task.structureChoice=decision;task.phase='candidate-check';task.stalls=0;task.bestFactDebt=undefined;task.progressHistory=[];task.lastProgressHash=undefined;task.status='queued'
      await saveDeliveryTask(io,task,{pid:process.pid,bootInstance:this.bootInstance},[{path:`${deliveryRoot(task.id)}/decisions/${newId('structure')}.json`,before:undefined,after:json({schemaVersion:1,projectId:task.projectId,sessionId:input.context.sessionId,taskId:task.id,originalApprovalHash:task.approvalHash,candidateHash:proposedRecord.candidateHash,decision})}]);this.launch(io,input.context,task);return {task}
    }
    if(input.action==='resume'){
      invariant(!['succeeded','completed-with-issues','cancelled'].includes(task.status),'DELIVERY_TASK_TERMINAL','本任务已经结束，请预览新任务；不会把历史结果重新标为运行中。')
      if(task.writingTaskId&&task.phase==='first-draft'&&task.goal!=='research-results'){const writing=await readWritingTask(io,task.writingTaskId);if(writing&&writing.status!=='completed')await this.writing.action({context:input.context,taskId:writing.id,action:'resume'},signal)}
      this.launch(io,input.context,task);return {task}}
    task.status=input.action==='cancel'?'cancelled':'paused';if(input.action==='keep-original'){invariant(task.phase==='awaiting-adoption','DELIVERY_DECISION_INVALID','只可在最终修改预览阶段保留原稿。');task.adoptionDecided=true;task.keptOriginal=true;task.phase='recheck';task.message='已保留当前主稿；将检查实际原稿并准备同快照文件。'}await saveDeliveryTask(io,task,{pid:process.pid,bootInstance:this.bootInstance});if(input.action==='keep-original')this.launch(io,input.context,task);return {task}
  }
  async prepareAdoption(request:unknown,peer:string,signal:AbortSignal){const input=candidateRefRequest.extend({checkId:id.optional()}).strict().parse(request),{io}=await resolveStore(this.ctx,input.context,signal)
    const task=await readDeliveryTask(io,input.context,input.taskId)
    invariant(task&&task.task.phase==='awaiting-adoption'&&!task.task.pendingStructure&&task.task.candidateId===input.candidateId&&task.task.candidateHash===input.candidateHash&&task.task.checkId&&task.task.checkId===input.checkId&&task.task.checkHash,'DELIVERY_CANDIDATE_CHANGED','只可采用本次已经核对且授权范围有效的最终候选。')
    await this.validateResources(io)
    for(const [key,row]of this.adoptions)if(row.expires<Date.now())this.adoptions.delete(key)
    invariant(this.adoptions.size<16,'TOO_MANY_PENDING_PLANS','请先处理已有采用预览。')
    const plan=await prepareCandidateAdoption(io,input.context,input.taskId,input.candidateId,input.candidateHash,input.checkId);invariant(plan.checkHash===task.task.checkHash,'CANDIDATE_CHECK_MISMATCH','候选核对记录已改变，请重新检查。');this.adoptions.set(plan.id,{plan,peer,expires:Date.now()+600000});return {...plan,planId:plan.id}}
  async adopt(request:unknown,peer:string,signal:AbortSignal){const input=candidateAdoptRequest.parse(request),{io}=await resolveStore(this.ctx,input.context,signal),pending=this.adoptions.get(input.planId)
    const committed=!pending?await committedCandidateAdoption(io,input.context,input.taskId,input.candidateId,input.planId):undefined
    const row=pending??(committed&&{plan:committed.plan,peer,expires:Infinity})
    invariant(row&&row.peer===peer&&row.expires>Date.now()&&row.plan.planHash===input.planHash&&row.plan.taskId===input.taskId&&row.plan.candidateId===input.candidateId&&row.plan.candidateHash===input.candidateHash,'INVALID_APPROVAL','请重新查看最终修改。')
    const before=await readDeliveryTask(io,input.context,input.taskId)
    if(!committed)await this.validateResources(io)
    invariant(before&&!before.task.pendingStructure&&(before.task.phase==='awaiting-adoption'||before.task.adoptionDecided)&&before.task.candidateId===row.plan.candidateId&&before.task.candidateHash===row.plan.candidateHash&&(!this.active.has(input.taskId)||before.task.adoptionDecided),'DELIVERY_CANDIDATE_CHANGED','当前任务候选已改变、范围待确认或仍在运行，请重新查看。')
    const accepted=await adoptCandidate(io,input.context,row.plan,input.bufferHash),taskRow=await readDeliveryTask(io,input.context,input.taskId)
    if(accepted.alreadyApplied&&before.task.adoptionDecided){return {...accepted,recheck:'recorded'}}
    invariant(taskRow,'DELIVERY_TASK_MISSING','采用已保存，但任务索引缺失。');const task=taskRow.task;task.adoptionDecided=true;task.phase='recheck';task.adoptionPlanId=row.plan.id;await saveDeliveryTask(io,task,{pid:process.pid,bootInstance:this.bootInstance})
    try{const checked=await recheckAdoptedCandidate(io,{...input.context,expectedLedgerRevision:(await snapshot(io)).ledger.revision},row.plan);task.phase=checked.needsSemanticCheck?'recheck':'export';await saveDeliveryTask(io,task,{pid:process.pid,bootInstance:this.bootInstance});this.launch(io,input.context,task);return {...accepted,recheck:checked.needsSemanticCheck?'needs-semantic-check':'completed'}}
    catch{return {...accepted,recheck:'needs-attention'}}
  }
  async revise(request:unknown,signal:AbortSignal){const input=candidateRefRequest.extend({text:z.string().min(1).max(2*1024*1024),reason:z.string().trim().min(10).max(4000)}).strict().parse(request),{io}=await resolveStore(this.ctx,input.context,signal),row=await readDeliveryTask(io,input.context,input.taskId)
    invariant(row&&!this.active.has(input.taskId)&&!row.task.adoptionDecided&&!row.task.pendingStructure&&row.task.candidateId===input.candidateId&&row.task.candidateHash===input.candidateHash,'DELIVERY_CANDIDATE_CHANGED','请先读取尚未采用且未运行中的当前候选。');await verifyDeliveryInputs(io,row.task)
    const old=(await readCandidate(io,input.taskId,input.candidateId,input.context,input.candidateHash)).candidate,headings=(text:string)=>documentHeadings(text).map(({title,depth})=>({title,depth}))
    invariant(json(headings(old.text))===json(headings(input.text)),'CANDIDATE_OUTLINE_INVALID','此入口保留当前章节；结构变化请先明确新的结构映射。')
    const blocks=(text:string)=>projectMarkdown(text).blocks.filter(block=>block.node.type==='paragraph'||block.node.type==='table'),before=blocks(old.text),after=blocks(input.text)
    invariant(before.length===after.length,'CANDIDATE_ANCHOR_INVALID','段落或表格数量变化时需要明确重新关联，不能猜测沿用位置。')
    const created=await createCandidate(io,input.context,{taskId:input.taskId,parentCandidateId:old.id,refreshDependencies:true,text:input.text,scope:'document',reason:input.reason,paragraphClaims:after.flatMap((block,index)=>{const ids=[...new Set(Object.values(old.anchors).filter(anchor=>anchor.blockId===before[index].id).flatMap(anchor=>anchor.claimIds))];return ids.length?[{blockId:block.id,claimIds:ids}]:[]})}),task=row.task
    task.candidateId=created.candidate.id;task.candidateHash=created.candidateHash;task.checkId=undefined;task.checkHash=undefined;task.phase='candidate-check';task.status='queued';task.stalls=0;task.bestFactDebt=undefined;task.progressHistory=[];task.lastProgressHash=undefined;task.message='人工修订已保留为新候选，正在按实际文本重新核对；主稿保持原样。';await saveDeliveryTask(io,task,{pid:process.pid,bootInstance:this.bootInstance});this.launch(io,input.context,task);return created
  }
  async candidate(request:unknown,signal:AbortSignal){const input=candidateRefRequest.parse(request),{io}=await resolveStore(this.ctx,input.context,signal),value=await readCandidate(io,input.taskId,input.candidateId,input.context,input.candidateHash),current=await snapshot(io);return {...value,factChanges:protectedChanges(current.document.text,value.candidate.text),claimChanges:Object.entries(value.candidate.claimUpdates??{}).map(([id,after])=>({id,before:current.ledger.claims[id]?.text,after:after.text}))}}
}
