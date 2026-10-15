import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { registerSource, confirmEvidence } from '../../src/core/evidence/evidence.ts'
import { confirmEvidenceRequest } from '../../src/shared/research.ts'
import { runReview } from '../../src/core/review/review.ts'

const context={requestId:'TEST_ONLY_request',sessionId:'TEST_ONLY_session',workspaceId:'TEST_ONLY_workspace'}
async function setup(kind:'user-result'|'paper'='user-result') {
  const io=new MemoryStore({'结果.txt':'TEST_ONLY accuracy 85.0 %, TEST_ONLY dataset, test split, model A; latency 185 ms.'})
  await initialize(io,await prepareInit(io,{title:'TEST_ONLY results',type:'research-paper'}))
  const material=await registerMaterial(io,{relativePath:'结果.txt',role:'data',confirmExcludedFile:false},0)
  const parsed=await parseRegisteredMaterial(io,material.material.id,material.revision,new AbortController().signal,(bytes,type)=>parseMaterialBytes(bytes,type,new AbortController().signal))
  const source=await registerSource(io,{title:'TEST_ONLY result record',kind,authors:[],identifiers:{},materialId:material.material.id},parsed.revision)
  const input={sourceId:source.source.id,sourceContentHash:parsed.parsed.sourceContentHash,locator:parsed.parsed.blocks[0].locator,excerpt:parsed.parsed.blocks[0].text,kind:'user-measurement' as const,
    measurement:{metric:'accuracy',value:'85.0',unit:'%',conditions:'TEST_ONLY dataset / test / model A',origin:'user-supplied' as const}}
  return {io,input,revision:source.revision,source}
}
test('AT-199: normal request registers a located author result, survives reopen, and remains author-supplied',async()=>{
  const {io,input,revision}=await setup(), request=confirmEvidenceRequest.parse({context,...input})
  const result=await confirmEvidence(io,request,revision)
  const reopened=await snapshot(new MemoryStore(Object.fromEntries([...io.files].map(([path,file])=>[path,file.text]))))
  assert.deepEqual(reopened.ledger.evidence[result.evidence.id].measurement,input.measurement)
  const review=await runReview(io,result.revision)
  assert.equal(review.report.checks.find(c=>c.id==='own_research_results')?.status,'unknown','registration does not prove full settings/body correspondence')
  assert.match((await io.read(`.scholarflow/research/result-confirmations/${result.evidence.id}.json`))!.text,/未复现作者实验/)
})
test('AT-199: incomplete measurements and converted external results are rejected',async()=>{
  const {io,input,revision}=await setup('paper')
  assert.equal(confirmEvidenceRequest.safeParse({context,...input,measurement:undefined}).success,false)
  assert.equal(confirmEvidenceRequest.safeParse({context,...input,measurement:{...input.measurement,metric:' '}}).success,false)
  assert.equal(confirmEvidenceRequest.safeParse({context,...input,measurement:{...input.measurement,origin:'reported-in-source'}}).success,false)
  await assert.rejects(confirmEvidence(io,input,revision),{code:'MEASUREMENT_ORIGIN_INVALID'})
})
test('AT-199: original values must be at the actual position; edited or excluded bytes never count as current results',async()=>{
  const {io,input,revision}=await setup()
  await assert.rejects(confirmEvidence(io,{...input,measurement:{...input.measurement,value:'85'}},revision),{code:'MEASUREMENT_NOT_LOCATED'})
  await assert.rejects(confirmEvidence(io,{...input,measurement:{...input.measurement,value:'86'}},revision),{code:'MEASUREMENT_NOT_LOCATED'})
  const result=await confirmEvidence(io,input,revision)
  io.externalEdit('结果.txt','TEST_ONLY changed accuracy 12')
  const review=await runReview(io,result.revision)
  assert.equal(review.report.checks.find(c=>c.id==='own_research_results')?.status,'fail')
  assert.equal((await snapshot(io)).ledger.evidence[result.evidence.id].measurement!.value,'85.0')
})
