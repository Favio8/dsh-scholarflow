import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize,prepareInit,snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { writeEditorBuffer } from '../../src/core/editing/buffer.ts'
import { createCandidate,checkCandidate,prepareCandidateAdoption,adoptCandidate,recheckAdoptedCandidate,prepareCandidateModelReview } from '../../src/core/pipeline/candidates.ts'
import { runReview } from '../../src/core/review/review.ts'
import { semanticReviewChecks } from '../../src/shared/review.ts'
import { digest,json } from '../../src/core/store/files.ts'
import { runFile,inputFile } from '../../src/core/pipeline/run-store.ts'
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
  await io.write(runFile(modelPlan.snapshot.runId),json({schemaVersion:1,runId:modelPlan.snapshot.runId,projectId:modelPlan.snapshot.projectId,sessionId:modelPlan.snapshot.sessionId,status:'running',usedModelCalls:1,startedAt:'TEST_ONLY',updatedAt:'TEST_ONLY',planHash:modelPlan.contentHash,stage:'review',owner:{pid:process.pid,bootInstance:'TEST_ONLY'}}),undefined)
  await io.write(inputFile(modelPlan.snapshot.runId),json(modelPlan.snapshot),undefined)
  const checked=await checkCandidate(io,await context(),taskId,second.candidate.id,second.candidateHash,{plan:modelPlan,output:{checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY controlled semantic evidence'})),findings:[],rechecks:[],limitations:['TEST_ONLY controlled model, not live quality']}})
  assert.equal((await snapshot(io)).document.text,original)
  assert.equal(JSON.parse((await io.read('.scholarflow/reviews/current.json'))!.text).reviewId,mainReview.report.id)
  const plan=await prepareCandidateAdoption(io,await context(),taskId,second.candidate.id,second.candidateHash,checked.check.id),captured=await context()
  const accepted=await adoptCandidate(io,captured,plan,digest(original))
  assert.equal((await snapshot(io)).document.text,second.candidate.text)
  const retry=await adoptCandidate(io,captured,plan,digest(original));assert.equal(retry.alreadyApplied,true);assert.equal(retry.revisionId,accepted.revisionId)
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
