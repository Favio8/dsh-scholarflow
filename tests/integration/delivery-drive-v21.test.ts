import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot,mutateLedger} from '../../src/core/project/project.ts'
import {registerMaterial} from '../../src/core/materials/materials.ts'
import {parseRegisteredMaterial} from '../../src/core/materials/parse.ts'
import {parseMaterialBytes} from '../../src/host/parsers/parse.ts'
import {registerSource,confirmEvidence,upsertClaim,confirmOutline} from '../../src/core/evidence/evidence.ts'
import {creationSpec} from '../../src/shared/writing-task.ts'
import {saveWritingSpec,readWritingSpec} from '../../src/core/pipeline/writing-task-store.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
import {prepareDeliveryTask,startDeliveryTask,inspectDeliveryTask,readDeliveryTask,saveDeliveryTask} from '../../src/core/pipeline/delivery-task.ts'
import {driveDelivery,deliveryModelCall,type DeliveryServices} from '../../src/core/pipeline/delivery-drive.ts'
import {createCandidate,prepareCandidateModelReview} from '../../src/core/pipeline/candidates.ts'
import {prepareModelReview} from '../../src/core/review/model.ts'
import {semanticReviewChecks} from '../../src/shared/review.ts'
import {wordStats} from '../../src/core/editing/markdown.ts'
import {build} from 'esbuild'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const controllerFile=resolve(`.dsh-tmp/contracts/delivery-controller-${process.pid}.mjs`);await mkdir(resolve('.dsh-tmp/contracts'),{recursive:true})
await build({entryPoints:['src/host/bridge/delivery-controller.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:controllerFile,plugins:[{name:'TEST_ONLY-host-seams',setup(builder){
  builder.onLoad({filter:/[\\/]bridge[\\/]project-api\.ts$/},()=>({loader:'ts',contents:'export async function resolveStore(ctx){return {io:ctx.io}}'}))
  builder.onLoad({filter:/[\\/]executor[\\/]model\.ts$/},()=>({loader:'ts',contents:`export async function selectedModel(){return {selected:{provider:'TEST_ONLY',model:'TEST_ONLY'},session:{},contextWindow:200000,maxOutputTokens:4096}};export async function callStageModel(ctx,session,selected,call){return ctx.stageModel(call)}` }))
}}]})
const {DeliveryController}=await import(pathToFileURL(controllerFile).href)
const owner={pid:process.pid,bootInstance:'TEST_ONLY_delivery'}
async function setup(){const io=new MemoryStore({'source.txt':'TEST_ONLY original evidence supports a limited classroom argument.'});await initialize(io,await prepareInit(io,{title:'TEST_ONLY delivery',type:'course-paper',language:'en'}))
  const material=await registerMaterial(io,{relativePath:'source.txt',role:'notes',confirmExcludedFile:false},0),parsed=await parseRegisteredMaterial(io,material.material.id,material.revision,new AbortController().signal,(bytes,type)=>parseMaterialBytes(bytes,type,new AbortController().signal))
  const source=await registerSource(io,{title:'TEST_ONLY source',kind:'other',authors:[],identifiers:{},materialId:material.material.id},parsed.revision),evidence=await confirmEvidence(io,{sourceId:source.source.id,sourceContentHash:parsed.parsed.sourceContentHash,locator:parsed.parsed.blocks[0].locator,excerpt:parsed.parsed.blocks[0].text,kind:'quotation'},source.revision)
  const claim=await upsertClaim(io,{kind:'author-inference',text:'TEST_ONLY limited classroom argument',scope:'section_TEST_ONLY',evidenceLinks:[{evidenceId:evidence.evidence.id,relation:'supports',rationale:'TEST_ONLY fixture support'}],limitations:[]},evidence.revision)
  await confirmOutline(io,{version:0,title:'TEST_ONLY delivery',researchQuestion:'TEST_ONLY question',thesis:'TEST_ONLY scoped conclusion',confirmation:'draft',sections:[{id:'section_TEST_ONLY',title:'Body',purpose:'TEST_ONLY',claimIds:[claim.claim.id],missingEvidence:[]}]},claim.revision,0)
  const text='# TEST_ONLY delivery\n\n## Body\n\n'+('TEST_ONLY scoped evidence supports the classroom argument. '.repeat(30))+`[@${source.source.citeKey}]\n`
  const target=wordStats(text,{bodyOnly:true}).westernWords,spec=creationSpec.parse({title:'TEST_ONLY delivery',type:'course-paper',language:'en',format:'markdown',requirements:'TEST_ONLY explain a scoped classroom argument using selected evidence.',targetLength:target,materials:['source.txt'],sections:[{id:'section_TEST_ONLY',title:'Body',purpose:'TEST_ONLY',targetLength:target}],online:false,manuscriptDir:'manuscript'})
  await saveWritingSpec(io,spec,(await snapshot(io)).ledger.revision)
  const current=await snapshot(io);await saveManual(io,text,current.document.contentHash,current.ledger.revision)
  const context=async()=>({requestId:'TEST_ONLY',workspaceId:'TEST_ONLY_workspace',sessionId:'TEST_ONLY_session',projectId:(await snapshot(io)).ledger.projectId,expectedLedgerRevision:(await snapshot(io)).ledger.revision})
  return {io,context,text}}
test('AT-190/195/198: explicit course task checks the actual candidate and prepares same-snapshot files without replaying a first draft',async()=>{
  const {io,context,text}=await setup(),plan=await prepareDeliveryTask(io,{context:await context(),goal:'course-delivery',allowStructure:false},{providerId:'TEST_ONLY',modelId:'TEST_ONLY'}),task=await startDeliveryTask(io,await context(),plan,owner)
  let calls=0,firstDraftWaits=0
  const services:DeliveryServices={owner,signal:new AbortController().signal,context:await context(),waitForWriting:async()=>{firstDraftWaits++;return undefined},validateModel:async()=>{},model:async call=>{calls++;const c=call.context as any,block=c.blocks.find((block:any)=>block.sourceText.includes('scoped evidence'));return JSON.stringify({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY controlled scope passed against actual body'})),findings:[],rechecks:[],limitations:['TEST_ONLY controlled model; no live quality claim'],requirementAssessments:c.requirements.filter((r:any)=>r.verificationMethod==='model-assisted').map((r:any)=>({requirementId:r.id,status:'pass',detail:'TEST_ONLY actual paragraph addresses this requirement',quotes:[{blockId:block.id,quote:block.sourceText}]}))})}}
  const ended=await driveDelivery(io,task,services)
  assert.equal(ended.phase,'finished',ended.message);assert.equal(calls,1);assert.equal(firstDraftWaits,0);assert.equal((await snapshot(io)).document.text,text)
  const delivery=(await snapshot(io)).ledger.deliveries[ended.deliveryId!];assert.equal(delivery.documentHash,(await snapshot(io)).document.contentHash)
  assert.equal(ended.calls.length,1)
  assert.notEqual((await inspectDeliveryTask(io,await context())).readiness?.state,'ready','unverified source identity and required format stay explicit')
})
test('AT-192: changed selected bytes invalidate preparation without touching the manuscript',async()=>{
  const {io,context,text}=await setup(),plan=await prepareDeliveryTask(io,{context:await context(),goal:'course-delivery'},{providerId:'TEST_ONLY',modelId:'TEST_ONLY'})
  io.externalEdit('source.txt','TEST_ONLY changed source')
  await assert.rejects(startDeliveryTask(io,await context(),plan,owner),{code:'STALE_MATERIAL_VERSION'})
  assert.equal((await snapshot(io)).document.text,text)
})

test('AT-197/207: completed calls are reused only for the exact review subject, and another session cannot take over a live task',async()=>{
  const {io,context,text}=await setup(),task=await startDeliveryTask(io,await context(),await prepareDeliveryTask(io,{context:await context(),goal:'course-delivery'},{providerId:'TEST_ONLY',modelId:'TEST_ONLY'}),owner)
  const candidate=await createCandidate(io,await context(),{taskId:task.id,text,scope:'document',reason:'TEST_ONLY same text, different immutable review subject'}),model={providerId:'TEST_ONLY',modelId:'TEST_ONLY'}
  const candidatePlan=await prepareCandidateModelReview(io,await context(),task.id,candidate.candidate.id,candidate.candidateHash,model),mainPlan=await prepareModelReview(io,{context:await context(),assessmentScope:'cross-section'},model)
  let calls=0;const services:DeliveryServices={owner,signal:new AbortController().signal,context:await context(),waitForWriting:async()=>undefined,validateModel:async()=>{},model:async()=>String(++calls)}
  const call={system:'TEST_ONLY scope check',instruction:'TEST_ONLY same instruction',context:{manuscript:text}}
  assert.equal(await deliveryModelCall(io,task,services,candidatePlan,call),'1');assert.equal(await deliveryModelCall(io,task,services,mainPlan,call),'2')
  const retry=await prepareModelReview(io,{context:await context(),assessmentScope:'cross-section'},model);assert.equal(await deliveryModelCall(io,task,services,retry,call),'2');assert.equal(calls,2);assert.equal(retry.snapshot.runId,mainPlan.snapshot.runId)
  const other={...await context(),sessionId:'TEST_ONLY_other'},writes=io.writes
  assert.equal(await readDeliveryTask(io,other),undefined);await assert.rejects(readDeliveryTask(io,other,task.id),{code:'PROJECT_ID_CONFLICT'});assert.equal(io.writes,writes)
  const next=await prepareDeliveryTask(io,{context:other,goal:'course-delivery'},model);await assert.rejects(startDeliveryTask(io,other,next,owner),{code:'DELIVERY_ALREADY_RUNNING'})
  task.status='cancelled';await saveDeliveryTask(io,task,owner)
  const controller=new DeliveryController({io,effect:()=>{}},{},'TEST_ONLY');await assert.rejects(controller.action({context:await context(),taskId:task.id,action:'resume',expectedTaskRevision:task.revision},new AbortController().signal),{code:'DELIVERY_TASK_TERMINAL'})
  const started=await startDeliveryTask(io,other,next,owner);assert.equal(started.sessionId,other.sessionId);assert.equal((await readDeliveryTask(io,await context(),task.id))!.task.status,'cancelled')
})
test('AT-207: stopping the actual child preserves unknown billing and resumes from the candidate stage without replaying a completed first draft',async()=>{
  const {io,context,text}=await setup(),plan=await prepareDeliveryTask(io,{context:await context(),goal:'course-delivery'},{providerId:'TEST_ONLY',modelId:'TEST_ONLY'}),task=await startDeliveryTask(io,await context(),plan,owner),controller=new AbortController()
  let entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve)
  const running=driveDelivery(io,task,{owner,context:await context(),signal:controller.signal,waitForWriting:async()=>undefined,validateModel:async()=>{},model:async call=>{entered();return new Promise((resolve,reject)=>call.signal.addEventListener('abort',()=>reject(Error('TEST_ONLY actual child aborted')),{once:true}))}})
  await ready;controller.abort('pause');const paused=await running
  assert.equal(paused.status,'paused');assert.equal(paused.calls[0].status,'unknown');assert.equal((await snapshot(io)).document.text,text)
  const reopened=(await readDeliveryTask(io,await context(),task.id))!.task
  let waits=0,calls=0
  const resumed=await driveDelivery(io,reopened,{owner,context:await context(),signal:new AbortController().signal,waitForWriting:async()=>{waits++;return undefined},validateModel:async()=>{},model:async call=>{calls++;const c=call.context as any,block=c.blocks.find((row:any)=>row.sourceText.includes('scoped evidence'));return JSON.stringify({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY resumed check uses the unchanged actual subject'})),findings:[],rechecks:[],limitations:['TEST_ONLY no live quality claim'],requirementAssessments:c.requirements.filter((r:any)=>r.verificationMethod==='model-assisted').map((r:any)=>({requirementId:r.id,status:'pass',detail:'TEST_ONLY actual paragraph still supports this requirement',quotes:[{blockId:block.id,quote:block.sourceText}]}))})}})
  assert.equal(resumed.phase,'finished',resumed.message);assert.equal(waits,0);assert.equal(calls,1);assert.equal(resumed.calls.length,2);assert.equal(resumed.calls[0].status,'unknown');assert.notEqual(resumed.calls[0].runId,resumed.calls[1].runId)
})
test('AT-193/195: explicit word bounds override the default tolerance and ordinary length repair proceeds as an immutable candidate',async()=>{
  const {io,context,text}=await setup(),desired=text.replace('[@','Additional scoped evidence remains limited to the declared classroom setting. [@'),target=wordStats(desired,{bodyOnly:true}).westernWords,spec=(await readWritingSpec(io))!
  await saveWritingSpec(io,{...spec,targetLength:target,brief:{...spec.brief!,length:{unit:'words',approximate:false,min:target,max:target},task:{},coverage:[],format:{},submission:{needsConfirmation:[]},origins:{},decisions:[],readIds:[]}},(await context()).expectedLedgerRevision)
  const requirements=(await snapshot(io)).ledger.requirements;assert.equal(requirements.writing_length.constraint?.value,target);assert.equal(requirements.writing_length_max.constraint?.value,target)
  const plan=await prepareDeliveryTask(io,{context:await context(),goal:'course-delivery'},{providerId:'TEST_ONLY',modelId:'TEST_ONLY'}),task=await startDeliveryTask(io,await context(),plan,owner)
  const result=await driveDelivery(io,task,{owner,context:await context(),signal:new AbortController().signal,waitForWriting:async()=>undefined,validateModel:async()=>{},model:async call=>{const c=call.context as any;if(!c.blocks)return JSON.stringify({replacementText:desired,limitations:['TEST_ONLY controlled length correction']});const block=c.blocks.find((row:any)=>row.sourceText.includes('scoped evidence'));return JSON.stringify({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY actual text review with explicit word bounds'})),findings:[],rechecks:[],limitations:['TEST_ONLY controlled pipeline'],requirementAssessments:c.requirements.filter((r:any)=>r.verificationMethod==='model-assisted').map((r:any)=>({requirementId:r.id,status:'pass',detail:'TEST_ONLY scoped paragraph satisfies this content requirement',quotes:[{blockId:block.id,quote:block.sourceText}]}))})}})
  assert.equal(result.phase,'awaiting-adoption',result.message);assert.equal(result.calls.length,3);assert.equal((await snapshot(io)).document.text,text)
  const history=await io.list('.scholarflow/writing/requirement-history');assert(history.length>0)
})
test('AT-192/196: unauthorized heading changes are previewed; allow and keep decisions are recorded before final one-shot adoption',async()=>{
  for(const choice of ['allow-structure','keep-structure']){
    const {io,context,text}=await setup(),plan=await prepareDeliveryTask(io,{context:await context(),goal:'course-delivery',allowStructure:false},{providerId:'TEST_ONLY',modelId:'TEST_ONLY',maxOutputTokens:4096}),task=await startDeliveryTask(io,await context(),plan,owner)
    let calls=0
    const model=async(call:any)=>{calls++;const c=call.context
      if(!c.blocks)return JSON.stringify(call.instruction.includes('作者已拒绝')?{replacementText:c.manuscript.replace('scoped evidence','repaired scope'),limitations:['TEST_ONLY keep author structure']}:{replacementText:c.manuscript.replace('## Body','## Revised analysis'),outlineSections:[{id:'section_TEST_ONLY',title:'Revised analysis'}],limitations:['TEST_ONLY proposed heading adjustment']})
      const block=c.blocks.find((row:any)=>row.sourceText.includes('classroom argument')),bad=c.outline.sections[0].title==='Body'&&!c.manuscript.includes('repaired scope')
      return JSON.stringify({checks:semanticReviewChecks.map(id=>({id,status:bad&&id==='argument_assessment'?'fail':'pass',detail:'TEST_ONLY actual structured candidate inspection'})),findings:bad?[{assessmentId:'argument_assessment',category:'structure',severity:'B1',title:'TEST_ONLY candidate needs a clearer explanation',explanation:'TEST_ONLY actual paragraph requires a controlled revision',suggestedFix:'TEST_ONLY improve explanation while preserving scope',blockId:block.id,quote:block.sourceText,claimIds:[],evidenceIds:[],requirementIds:[]}]:[],rechecks:[],limitations:['TEST_ONLY controlled pipeline, not live quality'],requirementAssessments:c.requirements.filter((r:any)=>r.verificationMethod==='model-assisted').map((r:any)=>({requirementId:r.id,status:'pass',detail:'TEST_ONLY actual paragraph addresses the declared classroom task',quotes:[{blockId:block.id,quote:block.sourceText}]}))})}
    const pending=await driveDelivery(io,task,{owner,context:await context(),signal:new AbortController().signal,waitForWriting:async()=>undefined,validateModel:async()=>{},model})
    assert.equal(pending.phase,'inputs',pending.message);assert.equal(pending.pendingStructure,true);assert.equal(calls,2);assert.equal((await snapshot(io)).document.text,text);assert.equal((await snapshot(io)).ledger.outline.sections[0].title,'Body')
    const controller=new DeliveryController({io,effect:()=>{},stageModel:model},{waitForDelivery:async()=>undefined},'TEST_ONLY'),peer='TEST_ONLY_operator',signal=new AbortController().signal
    await assert.rejects(controller.prepareAdoption({context:await context(),taskId:task.id,candidateId:pending.candidateId,candidateHash:pending.candidateHash,checkId:pending.checkId},peer,signal),{code:'DELIVERY_CANDIDATE_CHANGED'})
    await controller.action({context:await context(),taskId:task.id,action:choice,expectedTaskRevision:pending.revision},signal)
    const wait=async(phase:string)=>{const end=Date.now()+5000;let latest;while(Date.now()<end){const row=await readDeliveryTask(io,await context(),task.id);latest=row?.task;if(row?.task.phase===phase)return row.task;if(row?.task.status==='failed'||row?.task.status==='paused')assert.fail(JSON.stringify({choice,phase,status:row.task.status,message:row.task.message,calls:row.task.calls,structureChoice:row.task.structureChoice}));await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('TEST_ONLY task phase timeout '+JSON.stringify({choice,task:latest}))}
    const final=await wait('awaiting-adoption');assert.equal(final.pendingStructure,false);assert.equal((await snapshot(io)).document.text,text)
    const preview=await controller.prepareAdoption({context:await context(),taskId:task.id,candidateId:final.candidateId,candidateHash:final.candidateHash,checkId:final.checkId},peer,signal)
    await controller.adopt({context:await context(),taskId:task.id,candidateId:final.candidateId,candidateHash:final.candidateHash,planId:preview.planId,planHash:preview.planHash,bufferHash:(await snapshot(io)).document.contentHash},peer,signal);await wait('finished')
    const current=await snapshot(io);assert.equal(current.ledger.outline.sections[0].title,choice==='allow-structure'?'Revised analysis':'Body');assert.equal((await io.list(`.scholarflow/task-delivery/${task.id}/decisions`)).length,1)
    assert(current.document.text.includes(choice==='allow-structure'?'## Revised analysis':'repaired scope'))
    assert.equal(calls,choice==='allow-structure'?3:4,'a new user constraint cannot reuse the old generation instruction or redo a completed identical review')
  }
})
