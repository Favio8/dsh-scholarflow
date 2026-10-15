import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {registerMaterial} from '../../src/core/materials/materials.ts'
import {prepareResultImport,confirmResultImport,inspectResults,prepareResultComparison,confirmResultComparison} from '../../src/core/research/results.ts'
import {upsertClaim,confirmOutline} from '../../src/core/evidence/evidence.ts'
import {createCandidate,checkCandidate,prepareCandidateModelReview,prepareCandidateAdoption,adoptCandidate,recheckAdoptedCandidate} from '../../src/core/pipeline/candidates.ts'
import {runFile,inputFile} from '../../src/core/pipeline/run-store.ts'
import {json,digest} from '../../src/core/store/files.ts'
import {projectMarkdown} from '../../src/core/editing/markdown.ts'
import {semanticReviewChecks,modelReviewOutputSchema} from '../../src/shared/review.ts'
import {prepareGeneration} from '../../src/core/pipeline/generation.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
const taskId='delivery_TEST_ONLY'
async function setup(value='85.0',suffix='%',prefix='The accuracy was ',csv='metric,value,unit\naccuracy,85.0,%\n'){
  const io=new MemoryStore({'results.csv':csv});await initialize(io,await prepareInit(io,{title:'TEST_ONLY author results',type:'research-paper',language:'en'}))
  const material=await registerMaterial(io,{relativePath:'results.csv',role:'data',confirmExcludedFile:false},0)
  const context=async()=>({requestId:'TEST_ONLY',workspaceId:'TEST_ONLY',sessionId:'TEST_ONLY',projectId:(await snapshot(io)).ledger.projectId,expectedLedgerRevision:(await snapshot(io)).ledger.revision})
  const plan=await prepareResultImport(io,{context:await context(),materialId:material.material.id,title:'TEST_ONLY own measurements',mapping:{metricField:'metric',valueField:'value',unitField:'unit',direction:'higher',conditions:{task:'TEST_ONLY task',dataset:'TEST_ONLY dataset',split:'test',method:'TEST_ONLY model',settings:'TEST_ONLY same settings',protocol:'TEST_ONLY protocol'}}})
  await confirmResultImport(io,await context(),plan,true)
  const evidence=(await inspectResults(io)).measurements[0],claim=await upsertClaim(io,{kind:'user-observation',text:'TEST_ONLY accuracy in the supplied setting',scope:'section_TEST_ONLY',evidenceLinks:[{evidenceId:evidence.id,relation:'supports',rationale:'TEST_ONLY original mapped value'}],limitations:['TEST_ONLY scope']},(await context()).expectedLedgerRevision)
  await confirmOutline(io,{version:0,title:'TEST_ONLY',researchQuestion:'TEST_ONLY',thesis:'TEST_ONLY scoped result',confirmation:'draft',sections:[{id:'section_TEST_ONLY',title:'Results',purpose:'TEST_ONLY result explanation',claimIds:[claim.claim.id],missingEvidence:[]}]},claim.revision,0)
  const text=`# TEST_ONLY\n\n## Results\n\n${prefix}${value}${suffix} in the supplied setting.\n`,block=projectMarkdown(text).blocks.find(block=>block.node.type==='paragraph')!
  const candidate=await createCandidate(io,await context(),{taskId,text,scope:'document',reason:'TEST_ONLY controlled author result candidate',paragraphClaims:[{blockId:block.id,claimIds:[claim.claim.id]}]})
  return {io,context,candidate,evidence,claim:claim.claim}
}
test('AT-202/204: internal result paragraphs need no fake publication reference and wrong numbers remain B0 even if a model says pass',async()=>{
  const {io,context,candidate}=await setup('86.0'),model=await prepareCandidateModelReview(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{providerId:'TEST_ONLY',modelId:'TEST_ONLY'})
  await io.write(runFile(model.snapshot.runId),json({schemaVersion:1,runId:model.snapshot.runId,projectId:model.snapshot.projectId,sessionId:model.snapshot.sessionId,status:'succeeded',usedModelCalls:1,startedAt:'TEST_ONLY',updatedAt:'TEST_ONLY',planHash:model.contentHash,stage:'review',owner:{pid:process.pid,bootInstance:'TEST_ONLY'}}),undefined)
  await io.write(inputFile(model.snapshot.runId),json(model.snapshot),undefined)
  const output=modelReviewOutputSchema.parse({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY adversarial model wrongly claims the result is acceptable'})),findings:[],rechecks:[],limitations:['TEST_ONLY deliberately wrong model judgment']})
  await io.write(`.scholarflow/task-delivery/${taskId}/calls/${model.snapshot.runId}-plan.json`,json(model),undefined)
  await io.write(`.scholarflow/task-delivery/${taskId}/calls/${model.snapshot.runId}.json`,json({schemaVersion:1,projectId:model.snapshot.projectId,planHash:model.contentHash,status:'succeeded',output:JSON.stringify(output)}),undefined)
  const checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{plan:model,output})
  assert.equal(checked.check.report.checks.find(check=>check.id==='own_result_numbers')?.status,'fail')
  assert.ok(checked.check.report.issues.some(issue=>issue.severity==='B0'&&issue.location?.quote.includes('86.0')))
  assert.equal(projectMarkdown(candidate.candidate.text).citationOrder.length,0)
})
test('AT-201/204: Chinese text adjacent to numbers and explicit wrong units cannot evade result checks',async()=>{
  for(const [value,suffix,prefix]of [['86.0','%','当前准确率为'],['85.0',' ms','The accuracy was ']]){
    const {io,context,candidate}=await setup(value,suffix,prefix),checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash)
    assert.equal(checked.check.report.checks.find(check=>check.id==='own_result_numbers')?.status,'fail')
    assert(checked.check.report.issues.some(issue=>issue.severity==='B0'&&issue.location))
  }
})

test('AT-202/204: a checked result in one paragraph cannot certify an unlinked quantitative assertion elsewhere',async()=>{
  const {io,context,candidate}=await setup(),text=candidate.candidate.text+'\nTEST_ONLY an unsupported second assertion achieves 99.9%.\n',next=await createCandidate(io,await context(),{taskId,parentCandidateId:candidate.candidate.id,text,scope:'document',reason:'TEST_ONLY missing paragraph provenance'})
  const checked=await checkCandidate(io,await context(),taskId,next.candidate.id,next.candidateHash)
  assert.equal(checked.check.report.checks.find(row=>row.id==='own_result_numbers')?.status,'unknown');assert.equal(checked.check.report.checks.find(row=>row.id==='own_result_links')?.status,'unknown')
  assert(checked.check.report.issues.some(issue=>issue.location?.quote.includes('99.9%')))
})

test('AT-201/204: distinct large integer results do not collapse through floating-point conversion',async()=>{
  const {io,context,candidate}=await setup('9007199254740992','','The observation count was ','metric,value,unit\ncount,9007199254740993,count\n'),checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash)
  assert.equal(checked.check.report.checks.find(row=>row.id==='own_result_numbers')?.status,'fail')
  const correct=await createCandidate(io,await context(),{taskId,parentCandidateId:candidate.candidate.id,text:candidate.candidate.text.replace('9007199254740992','9007199254740993'),scope:'document',reason:'TEST_ONLY exact raw integer',paragraphClaims:[{blockId:projectMarkdown(candidate.candidate.text.replace('9007199254740992','9007199254740993')).blocks.find(row=>row.node.type==='paragraph')!.id,claimIds:[Object.keys((await snapshot(io)).ledger.claims)[0]]}]})
  assert.equal((await checkCandidate(io,await context(),taskId,correct.candidate.id,correct.candidateHash)).check.report.checks.find(row=>row.id==='own_result_numbers')?.status,'pass')
})
test('AT-201/202: confirmed 5 percentage points and 6.25 percent remain distinct in the actual manuscript',async()=>{
  const {io,context,claim}=await setup('80','%','The accuracy was ','metric,value,unit\naccuracy,80.00,%\naccuracy,85.0,%\n'),results=(await inspectResults(io)).measurements
  await upsertClaim(io,{id:claim.id,kind:'user-observation',text:'TEST_ONLY comparison of two supplied observations',scope:'section_TEST_ONLY',evidenceLinks:results.map(row=>({evidenceId:row.id,relation:'supports',rationale:'TEST_ONLY two observations under the same declared protocol'})),limitations:['TEST_ONLY arithmetic only, no significance or method-effect claim']},(await context()).expectedLedgerRevision)
  const plan=await prepareResultComparison(io,{context:await context(),leftEvidenceId:results[0].id,rightEvidenceId:results[1].id});await confirmResultComparison(io,await context(),plan)
  for(const [change,expected]of [['5个百分点，相对变化6.25%','pass'],['5%，相对变化6.25%','fail']]){
    const text=`# TEST_ONLY\n\n## Results\n\n两条观测的准确率从80%到85%，绝对变化${change}，不作统计显著性判断。\n`,block=projectMarkdown(text).blocks.find(block=>block.node.type==='paragraph')!,candidate=await createCandidate(io,await context(),{taskId,text,reason:'TEST_ONLY confirmed arithmetic comparison',scope:'document',paragraphClaims:[{blockId:block.id,claimIds:[claim.id]}]}),checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash)
    assert.equal(checked.check.report.checks.find(check=>check.id==='own_result_numbers')?.status,expected)
  }
})
test('AT-199/202/204: registration stays unknown; actual candidate checks plus final author adoption create same-version evidence without claiming reproduction',async()=>{
  const {io,context,candidate}=await setup(),model=await prepareCandidateModelReview(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{providerId:'TEST_ONLY',modelId:'TEST_ONLY'})
  await io.write(runFile(model.snapshot.runId),json({schemaVersion:1,runId:model.snapshot.runId,projectId:model.snapshot.projectId,sessionId:model.snapshot.sessionId,status:'succeeded',usedModelCalls:1,startedAt:'TEST_ONLY',updatedAt:'TEST_ONLY',planHash:model.contentHash,stage:'review',owner:{pid:process.pid,bootInstance:'TEST_ONLY'}}),undefined)
  await io.write(inputFile(model.snapshot.runId),json(model.snapshot),undefined)
  const output=modelReviewOutputSchema.parse({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY controlled comparison of current result scope'})),findings:[],rechecks:[],limitations:['TEST_ONLY controlled model, no live quality claim']})
  await io.write(`.scholarflow/task-delivery/${taskId}/calls/${model.snapshot.runId}-plan.json`,json(model),undefined)
  await io.write(`.scholarflow/task-delivery/${taskId}/calls/${model.snapshot.runId}.json`,json({schemaVersion:1,projectId:model.snapshot.projectId,planHash:model.contentHash,status:'succeeded',output:JSON.stringify(output)}),undefined)
  const checked=await checkCandidate(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,{plan:model,output})
  assert.equal(checked.check.report.checks.find(check=>check.id==='own_research_results')?.status,'unknown')
  const adoption=await prepareCandidateAdoption(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash,checked.check.id),before=(await snapshot(io)).document.text
  const saved=await adoptCandidate(io,await context(),adoption,digest(before)),recheck=await recheckAdoptedCandidate(io,await context(),adoption)
  assert.equal(recheck.report.checks.find(check=>check.id==='own_research_results')?.status,'pass')
  assert.match((await io.read(`.scholarflow/research/author-approvals/${saved.revisionId}.json`))!.text,/未复现作者实验/)
  assert.equal(Object.values((await snapshot(io)).ledger.sources).filter(source=>source.kind==='paper').length,0)
})

test('AT-205: a new result version proposes dependent claim and paragraph changes, then adopts them together while retaining manual text and old evidence',async()=>{
  const {io,context,candidate,evidence,claim}=await setup(),first=await prepareCandidateAdoption(io,await context(),taskId,candidate.candidate.id,candidate.candidateHash)
  await adoptCandidate(io,await context(),first,(await snapshot(io)).document.contentHash)
  const initial=await snapshot(io),manual=initial.document.text+'\nTEST_ONLY manual limitation: this observation is confined to the supplied setting.\n'
  await saveManual(io,manual,initial.document.contentHash,initial.ledger.revision)
  const original=(await inspectResults(io)).experiments.records,previous=Object.values(original)[0],bytes='metric,value,unit\naccuracy,86.0,%\n'
  io.externalEdit('results.csv',bytes)
  const update=await prepareResultImport(io,{context:await context(),materialId:previous.materialId,previousExperimentId:previous.id,title:'TEST_ONLY updated observation',mapping:{metricField:'metric',valueField:'value',unitField:'unit',direction:'higher',conditions:previous.conditions}})
  const imported=await confirmResultImport(io,await context(),update,true),state=await inspectResults(io),record=state.experiments.records[imported.experimentIds[0]],nextEvidence=(await snapshot(io)).ledger.evidence[record.measurementEvidenceIds[0]]
  assert.equal((await snapshot(io)).document.text,manual);assert.equal((await snapshot(io)).ledger.claims[claim.id].status,'stale')
  const generation=await prepareGeneration(io,{context:await context(),instruction:'TEST_ONLY revise from the new confirmed observation'},{providerId:'TEST_ONLY',modelId:'TEST_ONLY'},undefined,{allowInternalResults:true,includeSourceContext:true})
  assert(generation.evidenceIds.includes(nextEvidence.id));assert(!generation.evidenceIds.includes(evidence.id));assert.equal((generation.context as any).unavailableClaims[0].id,claim.id)
  const text=manual.replace('85.0%','86.0%'),block=projectMarkdown(text).blocks.find(row=>text.slice(row.start,row.end).includes('86.0%'))!
  const proposed=await createCandidate(io,await context(),{taskId,text,scope:'document',reason:'TEST_ONLY current observed value with preserved manual limitation',claimUpdates:[{id:claim.id,text:'TEST_ONLY updated accuracy is 86.0% under the supplied conditions',evidenceLinks:[{evidenceId:nextEvidence.id,relation:'supports',rationale:'TEST_ONLY exact new author record'}],limitations:claim.limitations}],paragraphClaims:[{blockId:block.id,claimIds:[claim.id]}]})
  assert.equal((await snapshot(io)).ledger.claims[claim.id].evidenceLinks[0].evidenceId,evidence.id);assert.equal((await snapshot(io)).document.text,manual)
  const check=await checkCandidate(io,await context(),taskId,proposed.candidate.id,proposed.candidateHash)
  assert.equal(check.check.report.checks.find(row=>row.id==='own_result_numbers')?.status,'pass')
  const model=await prepareCandidateModelReview(io,await context(),taskId,proposed.candidate.id,proposed.candidateHash,{providerId:'TEST_ONLY',modelId:'TEST_ONLY'})
  assert.equal((model.context as any).claimChanges[0].before.evidenceLinks[0].evidenceId,evidence.id)
  assert.equal((model.context as any).basis.text,manual)
  const plan=await prepareCandidateAdoption(io,await context(),taskId,proposed.candidate.id,proposed.candidateHash,check.check.id),accepted=await adoptCandidate(io,await context(),plan,digest(manual)),saved=await snapshot(io)
  assert.equal(saved.document.text,text);assert.equal(saved.ledger.claims[claim.id].evidenceLinks[0].evidenceId,nextEvidence.id)
  assert.equal(saved.ledger.evidence[evidence.id].measurement!.value,'85.0');assert.equal(saved.ledger.evidence[evidence.id].validation,'stale')
  assert.equal((await io.read('results.csv'))!.text,bytes);assert.equal((await io.read(`.scholarflow/drafts/${accepted.revisionId}/preimage.md`))!.text,manual)
  const history=JSON.parse((await io.read(`.scholarflow/research/claim-update-history/${plan.id}.json`))!.text);assert.equal(history.previous[claim.id].evidenceLinks[0].evidenceId,evidence.id)
  const actual=await recheckAdoptedCandidate(io,await context(),plan);assert.equal(actual.report.documentHash,digest(text));assert.equal(actual.report.checks.find(row=>row.id==='own_result_numbers')?.status,'pass');assert.equal(actual.needsSemanticCheck,true)
})
