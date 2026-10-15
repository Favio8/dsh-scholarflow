import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize,prepareInit,snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { writeEditorBuffer } from '../../src/core/editing/buffer.ts'
import { createCandidate,checkCandidate,prepareCandidateAdoption,adoptCandidate,recheckAdoptedCandidate,prepareCandidateModelReview,committedCandidateAdoption } from '../../src/core/pipeline/candidates.ts'
import { runReview } from '../../src/core/review/review.ts'
import { semanticReviewChecks,modelReviewOutputSchema } from '../../src/shared/review.ts'
import { digest,json } from '../../src/core/store/files.ts'
import { runFile,inputFile } from '../../src/core/pipeline/run-store.ts'
import {confirmOutline} from '../../src/core/evidence/evidence.ts'
const taskId='delivery_TEST_ONLY'
async function setup(){const io=new MemoryStore();await initialize(io,await prepareInit(io,{title:'TEST_ONLY candidates',type:'course-paper'}));let current=await snapshot(io)
  await saveManual(io,'# TEST_ONLY\n\n## Body\n\nOriginal paragraph.\n',current.document.contentHash,0)
  const context=async()=>{current=await snapshot(io);return {requestId:'TEST_ONLY',sessionId:'TEST_ONLY_session',workspaceId:'TEST_ONLY_workspace',projectId:current.ledger.projectId,expectedLedgerRevision:current.ledger.revision}}
  return {io,context}}
test('AT-196: two immutable revisions are checked at their actual positions, adopted once, rechecked, and preserve the original',async()=>{
  const {io,context}=await setup(),original=(await snapshot(io)).document.text
  const mainReview=await runReview(io,(await context()).expectedLedgerRevision)
  const first=await createCandidate(io,await context(),{taskId,text:original.replace('Original paragraph.','First candidate paragraph.'),reason:'TEST_ONLY first revision',scope:'document'})
  const firstCheck=await checkCandidate(io,await context(),taskId,first.candidate.id,first.candidateHash)
  assert.equal(firstCheck.check.report.documentHash,first.candidate.textHash)
  const second=await createCandidate(io,await context(),{taskId,parentCandidateId:first.candidate.id,text:first.candidate.text.replace('First candidate paragraph.','Final candidate paragraph.'),reason:'TEST_ONLY second revision',scope:'document'})
  const modelPlan=await prepareCandidateModelReview(io,await context(),taskId,second.candidate.id,second.candidateHash,{providerId:'TEST_ONLY',modelId:'TEST_ONLY'})
  assert.equal(modelPlan.context.manuscript,second.candidate.text)
  // An explicit controlled TEST_ONLY call record. This is not a live model quality claim.
  await io.write(runFile(modelPlan.snapshot.runId),json({schemaVersion:1,runId:modelPlan.snapshot.runId,projectId:modelPlan.snapshot.projectId,sessionId:modelPlan.snapshot.sessionId,status:'succeeded',usedModelCalls:1,startedAt:'TEST_ONLY',updatedAt:'TEST_ONLY',planHash:modelPlan.contentHash,stage:'review',owner:{pid:process.pid,bootInstance:'TEST_ONLY'}}),undefined)
  await io.write(inputFile(modelPlan.snapshot.runId),json(modelPlan.snapshot),undefined)
  const output=modelReviewOutputSchema.parse({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY controlled semantic evidence'})),findings:[],rechecks:[],limitations:['TEST_ONLY controlled model, not live quality']})
  await io.write(`.scholarflow/task-delivery/${taskId}/calls/${modelPlan.snapshot.runId}-plan.json`,json(modelPlan),undefined)
  await io.write(`.scholarflow/task-delivery/${taskId}/calls/${modelPlan.snapshot.runId}.json`,json({schemaVersion:1,projectId:modelPlan.snapshot.projectId,planHash:modelPlan.contentHash,status:'succeeded',output:JSON.stringify(output)}),undefined)
  const checked=await checkCandidate(io,await context(),taskId,second.candidate.id,second.candidateHash,{plan:modelPlan,output})
  assert.equal((await snapshot(io)).document.text,original)
  assert.equal(JSON.parse((await io.read('.scholarflow/reviews/current.json'))!.text).reviewId,mainReview.report.id)
  const plan=await prepareCandidateAdoption(io,await context(),taskId,second.candidate.id,second.candidateHash,checked.check.id),captured=await context()
  const accepted=await adoptCandidate(io,captured,plan,digest(original))
  assert.equal((await snapshot(io)).document.text,second.candidate.text)
  const retry=await adoptCandidate(io,captured,plan,digest(original));assert.equal(retry.alreadyApplied,true);assert.equal(retry.revisionId,accepted.revisionId)
  const cold=new MemoryStore(Object.fromEntries([...io.files].map(([path,file])=>[path,file.text]))),recovered=await committedCandidateAdoption(cold,await context(),taskId,second.candidate.id,plan.id)
  assert.equal(recovered?.accepted.revisionId,accepted.revisionId);assert.equal(recovered?.plan.planHash,plan.planHash)
  const recheck=await recheckAdoptedCandidate(io,await context(),plan)
  assert.equal(recheck.semanticInherited,true)
  assert.equal((await io.read(`.scholarflow/drafts/${accepted.revisionId}/preimage.md`))!.text,original)
})
test('AT-196: dirty buffer, changed main, changed dependencies and cross-project adoption are rejected without overwriting',async()=>{
  const {io,context}=await setup(),original=(await snapshot(io)).document.text
  const candidate=await createCandidate(io,await context(),{taskId,text:original+'\nMore TEST_ONLY text.\n',reason:'TEST_ONLY',scope:'document'})
  const plan=await prepareCandidateAdoption(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash)
  await assert.rejects(adoptCandidate(io,{...await context(),projectId:'project_other'},plan,digest(original)),{code:'INVALID_APPROVAL'})
  await assert.rejects(adoptCandidate(io,await context(),plan,digest('unsaved TEST_ONLY')),{code:'DIRTY_EDITOR_BUFFER'})
  await writeEditorBuffer(io,'TEST_ONLY_session',{baseBufferHash:null,baseHash:digest(original),text:'unsaved TEST_ONLY',state:'dirty'})
  await assert.rejects(adoptCandidate(io,await context(),plan,digest(original)),{code:'DIRTY_EDITOR_BUFFER'})
  io.externalEdit('.scholarflow/profiles/review.md','changed TEST_ONLY reviewer')
  await assert.rejects(checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash),{code:'CANDIDATE_DEPENDENCIES_CHANGED'})
  assert.equal((await snapshot(io)).document.text,original)
  io.externalEdit('manuscript/paper.md','human TEST_ONLY edit')
  await assert.rejects(prepareCandidateAdoption(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash),{code:'STALE_DOCUMENT_VERSION'})
})
test('AT-196: overlapping edits and structural changes masquerading as paragraph operations are rejected',async()=>{
  const {io,context}=await setup()
  const text=(await snapshot(io)).document.text
  await assert.rejects(createCandidate(io,await context(),{taskId,reason:'TEST_ONLY',scope:'paragraphs',edits:[{startUtf16:0,endUtf16:1,expectedText:'#',replacementText:'TEST_ONLY'}]}),{code:'CANDIDATE_SCOPE_INVALID'})
  await assert.rejects(createCandidate(io,await context(),{taskId,reason:'TEST_ONLY',scope:'paragraphs',edits:[{startUtf16:0,endUtf16:2,expectedText:text.slice(0,2),replacementText:'TEST_ONLY'},{startUtf16:1,endUtf16:3,expectedText:text.slice(1,3),replacementText:'TEST_ONLY'}]}),{code:'PROPOSAL_RANGE_INVALID'})
})
test('AT-196: changed review dependencies after adoption require actual semantic recheck',async()=>{
  const {io,context}=await setup(),original=(await snapshot(io)).document.text
  const candidate=await createCandidate(io,await context(),{taskId,text:original+'\nNew TEST_ONLY paragraph.\n',reason:'TEST_ONLY',scope:'document'})
  const checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash)
  const plan=await prepareCandidateAdoption(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,checked.check.id)
  await adoptCandidate(io,await context(),plan,digest(original))
  io.externalEdit('.scholarflow/profiles/review.md','changed TEST_ONLY reviewer')
  const result=await recheckAdoptedCandidate(io,await context(),plan)
  assert.equal(result.semanticInherited,false);assert.equal(result.needsSemanticCheck,true)
})
test('AT-192/193/196: mapped heading adjustments are reviewed in the candidate and publish with the final manuscript, preserving original coverage and outline history',async()=>{
  const {io,context}=await setup(),outline={version:0,title:'TEST_ONLY',researchQuestion:'TEST_ONLY question',thesis:'TEST_ONLY scoped statement',confirmation:'draft' as const,sections:[{id:'section_TEST_ONLY',title:'Body',purpose:'TEST_ONLY content coverage',claimIds:[],missingEvidence:[]}]}
  await confirmOutline(io,outline,(await context()).expectedLedgerRevision,0)
  const current=await snapshot(io),text=current.document.text.replace('## Body','## Revised analysis')
  const candidate=await createCandidate(io,await context(),{taskId,text,scope:'document',reason:'TEST_ONLY explicit scoped heading adjustment',outlineSections:[{id:'section_TEST_ONLY',title:'Revised analysis'}]})
  assert.equal((await snapshot(io)).ledger.outline.sections[0].title,'Body')
  const checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash)
  assert.equal(checked.check.report.checks.find(check=>check.id==='section_section_TEST_ONLY')?.status,'pass')
  await assert.rejects(createCandidate(io,await context(),{taskId,text,scope:'document',reason:'TEST_ONLY attempted coverage removal',outlineSections:[]}),{code:'CANDIDATE_OUTLINE_INVALID'})
  const plan=await prepareCandidateAdoption(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,checked.check.id)
  await adoptCandidate(io,await context(),plan,current.document.contentHash)
  assert.equal((await snapshot(io)).ledger.outline.sections[0].title,'Revised analysis');assert.equal((await snapshot(io)).document.text,text)
  const history=JSON.parse((await io.read(`.scholarflow/planning/outline-history/${plan.id}.json`))!.text);assert.equal(history.previous.sections[0].title,'Body')
  const recheck=await recheckAdoptedCandidate(io,await context(),plan);assert.equal(recheck.report.checks.find(check=>check.id==='section_section_TEST_ONLY')?.status,'pass')
})
test('AT-196/197: a charged unanswered Run cannot certify a check, and changed saved output blocks adoption',async()=>{
  const {io,context}=await setup(),original=(await snapshot(io)).document.text,candidate=await createCandidate(io,await context(),{taskId,text:original+'\nTEST_ONLY correction.\n',reason:'TEST_ONLY',scope:'document'}),model=await prepareCandidateModelReview(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{providerId:'TEST_ONLY',modelId:'TEST_ONLY'}),output=modelReviewOutputSchema.parse({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY controlled output against the actual candidate'})),findings:[],rechecks:[],limitations:['TEST_ONLY not a real quality result']})
  const state={schemaVersion:1,runId:model.snapshot.runId,projectId:model.snapshot.projectId,sessionId:model.snapshot.sessionId,status:'running',usedModelCalls:1,startedAt:'TEST_ONLY',updatedAt:'TEST_ONLY',planHash:model.contentHash,stage:'review',owner:{pid:process.pid,bootInstance:'TEST_ONLY'}}
  await io.write(runFile(state.runId),json(state),undefined);await io.write(inputFile(state.runId),json(model.snapshot),undefined)
  await assert.rejects(checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{plan:model,output}),{code:'CANDIDATE_CALL_UNVERIFIED'})
  io.externalEdit(runFile(state.runId),json({...state,status:'succeeded'}));const receiptPath=`.scholarflow/task-delivery/${taskId}/calls/${state.runId}.json`,receipt=json({schemaVersion:1,projectId:state.projectId,planHash:model.contentHash,status:'succeeded',output:JSON.stringify(output)});await io.write(receiptPath,receipt,undefined);await io.write(`.scholarflow/task-delivery/${taskId}/calls/${state.runId}-plan.json`,json(model),undefined)
  await assert.rejects(checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{plan:model,output:{...output,limitations:['TEST_ONLY invented replacement output']}}),{code:'CANDIDATE_OUTPUT_UNVERIFIED'})
  const checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{plan:model,output}),plan=await prepareCandidateAdoption(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,checked.check.id)
  io.externalEdit(receiptPath,receipt+'\n')
  await assert.rejects(adoptCandidate(io,await context(),plan,digest(original)),{code:'CANDIDATE_CALL_UNVERIFIED'});assert.equal((await snapshot(io)).document.text,original)
})
