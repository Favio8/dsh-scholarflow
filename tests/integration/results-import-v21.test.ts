import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {registerMaterial} from '../../src/core/materials/materials.ts'
import {parseResultBytes} from '../../src/core/research/result-parser.ts'
import {prepareResultImport,confirmResultImport,inspectResults,compareResults,prepareResultComparison,confirmResultComparison,resultTable,associateResults} from '../../src/core/research/results.ts'
import {reviewInput} from '../../src/core/review/review.ts'
import {upsertClaim,confirmOutline} from '../../src/core/evidence/evidence.ts'
import {digest,json} from '../../src/core/store/files.ts'
const conditions={task:'TEST_ONLY classification',dataset:'TEST_ONLY data',split:'test',method:'TEST_ONLY A',settings:'TEST_ONLY same hardware',protocol:'TEST_ONLY protocol'}
async function setup(content='metric,value,unit\r\naccuracy,85.0,%\r\naccuracy,,%\r\n',path='results.csv'){
  const io=new MemoryStore({[path]:content});await initialize(io,await prepareInit(io,{title:'TEST_ONLY import',type:'research-paper'}))
  const material=await registerMaterial(io,{relativePath:path,role:'data',confirmExcludedFile:false},0)
  const context=async()=>({requestId:'TEST_ONLY',workspaceId:'TEST_ONLY_workspace',sessionId:'TEST_ONLY_session',projectId:(await snapshot(io)).ledger.projectId,expectedLedgerRevision:(await snapshot(io)).ledger.revision})
  const request=async()=>({context:await context(),materialId:material.material.id,title:'TEST_ONLY run',mapping:{valueField:'value',metricField:'metric',unitField:'unit',conditions,direction:'higher' as const}})
  return {io,path,context,request}}
test('AT-200: CSV quoted/multiline fields, Chinese BOM, JSON raw scientific values and field pointers preserve original positions',()=>{
  const csv=parseResultBytes(Buffer.from('\uFEFF指标,数值,说明\r\n准确率,85.00,"中文\r\n换行，保留"\r\n'),'结果.csv')
  assert.equal(csv.cells.find(c=>c.field==='数值')!.raw,'85.00')
  assert.equal(csv.cells.find(c=>c.field==='说明')!.value,'中文\r\n换行，保留')
  assert.match(csv.cells[0].locator.kind==='data'?csv.cells[0].locator.rowRange!:'',/lines:2-3/)
  const json=parseResultBytes(Buffer.from('\uFEFF{"结果":[{"metric":"准确率","value":8.500e1,"unit":"%"}]}'),'结果.json','/结果')
  const value=json.cells.find(c=>c.field==='value')!
  assert.equal(value.raw,'8.500e1');assert.equal(value.value,85)
  assert.equal(value.locator.kind==='data'&&value.locator.rowRange,'pointer:/结果/0/value')
  assert.equal(Buffer.from('\uFEFF{"结果":[{"metric":"准确率","value":8.500e1,"unit":"%"}]}').subarray(value.byteOffset,value.byteEnd).toString(),'8.500e1')
  assert.throws(()=>parseResultBytes(Buffer.from('[{"value":1,"value":2}]'),'x.json'),{code:'RESULT_FIELDS_INVALID'})
})
test('AT-200: confirmed mapping publishes Source, Evidence and experiments once and keeps missing values explicit',async()=>{
  const {io,context,request,path}=await setup(),original=(await io.read(path))!.text,plan=await prepareResultImport(io,await request())
  assert.equal(plan.rows[0].rawValue,'85.0');assert.equal(plan.rows[1].problems.includes('原值缺失或异常'),true)
  assert.equal((await inspectResults(io)).measurements.length,0)
  const first=await confirmResultImport(io,await context(),plan,true),again=await confirmResultImport(io,await context(),plan,true)
  assert.equal(again.alreadyImported,true)
  const stored=await inspectResults(io);assert.equal(stored.measurements.length,1);assert.equal(stored.measurements[0].measurement!.value,'85.0')
  assert.deepEqual(stored.experiments.records[first.experimentIds[0]].conditions,conditions)
  assert.equal((await io.read(path))!.text,original)
  const reopened=await inspectResults(new MemoryStore(Object.fromEntries([...io.files].map(([path,file])=>[path,file.text]))))
  assert.equal(reopened.measurements.length,1)
})
test('AT-200/205: source changes reject old mapping; update previews impacts and retains old results and author text',async()=>{
  const {io,context,request,path}=await setup(),plan=await prepareResultImport(io,await request())
  io.externalEdit(path,'metric,value,unit\r\naccuracy,86.0,%\r\n')
  await assert.rejects(confirmResultImport(io,await context(),plan,true),{code:'STALE_MATERIAL_VERSION'})
  const newPlan=await prepareResultImport(io,await request()),first=await confirmResultImport(io,await context(),newPlan,true)
  const before=(await snapshot(io)).document.text,old=(await inspectResults(io)).measurements[0]
  io.externalEdit(path,'metric,value,unit\r\naccuracy,87.0,%\r\n')
  const update=await prepareResultImport(io,{...await request(),previousExperimentId:first.experimentIds[0]})
  assert.equal(update.impact.summaryAndConclusionNeedRecheck,true)
  const second=await confirmResultImport(io,await context(),update,true),state=await inspectResults(io)
  assert.equal(state.experiments.records[first.experimentIds[0]].status,'superseded')
  assert.equal(state.experiments.records[second.experimentIds[0]].version,2)
  assert.equal((await snapshot(io)).ledger.evidence[old.id].measurement!.value,'86.0')
  assert.equal((await snapshot(io)).ledger.evidence[old.id].validation,'stale')
  assert.equal((await snapshot(io)).document.text,before)
})
test('AT-200: cancellation, mapping conflicts, unsupported code and cross-project import are rejected',async()=>{
  const {io,context,request}=await setup(),controller=new AbortController();controller.abort()
  await assert.rejects(prepareResultImport(io,await request(),controller.signal),{name:'AbortError'})
  const requestValue=await request();await assert.rejects(prepareResultImport(io,{...requestValue,mapping:{...requestValue.mapping,metric:'guessed'}}),{code:'RESULT_MAPPING_CONFLICT'})
  const plan=await prepareResultImport(io,await request())
  await assert.rejects(confirmResultImport(io,{...await context(),projectId:'other'},plan,true),{code:'INVALID_APPROVAL'})
  assert.throws(()=>parseResultBytes(Buffer.from('print("TEST_ONLY")'),'run.ipynb'),{code:'RESULT_FORMAT_UNSUPPORTED'})
})
test('AT-201: percentage points and relative changes differ, lower-is-better works, incompatible protocols never compare',async()=>{
  const {io,context,request}=await setup(),plan=await prepareResultImport(io,await request()),saved=await confirmResultImport(io,await context(),plan,true)
  const record=(await inspectResults(io)).experiments.records[saved.experimentIds[0]]
  const value=compareResults({record,value:80,unit:'%',metric:'accuracy'},{record,value:85,unit:'%',metric:'accuracy'})
  assert.equal(value.comparability,'comparable');if(value.comparability==='comparable'){assert.equal(value.absoluteChange,5);assert.equal(value.relativePercent,6.25);assert.equal(value.changeUnit,'percentage-points');assert.equal(value.statistics,'not-provided')}
  assert.equal(compareResults({record,value:80,unit:'%'},{record:{...record,conditions:{...record.conditions,split:'validation'}},value:85,unit:'%'}).comparability,'incomparable')
  const lower={...record,direction:'lower' as const};const latency=compareResults({record:lower,value:100,unit:'ms',metric:'latency'},{record:lower,value:90,unit:'ms',metric:'latency'})
  assert.equal(latency.comparability==='comparable'&&latency.improved,true)
})
test('AT-201/202/205: confirmed arithmetic keeps exact inputs and becomes stale when results update; tables keep original raw values',async()=>{
  const {io,context,request}=await setup('metric,value,unit\naccuracy,80.00,%\naccuracy,85.0,%\n'),saved=await confirmResultImport(io,await context(),await prepareResultImport(io,await request()),true)
  const state=await inspectResults(io),record=state.experiments.records[saved.experimentIds[0]],ids=record.measurementEvidenceIds
  const plan=await prepareResultComparison(io,{context:await context(),leftEvidenceId:ids[0],rightEvidenceId:ids[1],decimals:2})
  assert.equal(plan.comparison.comparability,'comparable');if(plan.comparison.comparability==='comparable'){assert.equal(plan.comparison.absoluteChange,5);assert.equal(plan.comparison.relativePercent,6.25)}
  await confirmResultComparison(io,await context(),plan);assert.equal((await confirmResultComparison(io,await context(),plan)).alreadyApplied,true)
  assert.equal((await reviewInput(io)).results.comparisons[0].current,true)
  assert.match((await resultTable(io,record.id)).markdown,/80\.00/)
  const update=await prepareResultImport(io,{...await request(),previousExperimentId:record.id});await confirmResultImport(io,await context(),update,true)
  assert.equal((await reviewInput(io)).results.comparisons[0].current,false)
  await assert.rejects(prepareResultComparison(io,{context:await context(),leftEvidenceId:ids[0],rightEvidenceId:ids[1]}),{code:'RESULT_COMPARISON_INVALID'})
})
test('AT-201: explicit unit conversion is reversible, incompatible units are rejected, and recorded values are never overwritten',async()=>{
  const {io,context,request}=await setup('metric,value,unit,method\nlatency,1000,ms,A\nlatency,0.9,s,B\n'),input=await request()
  const saved=await confirmResultImport(io,await context(),await prepareResultImport(io,{...input,mapping:{...input.mapping,direction:'lower',conditionFields:{method:'method'},conditions:{...conditions,method:undefined}}}),true)
  const state=await inspectResults(io),[a,b]=saved.experimentIds.map((id:string)=>state.experiments.records[id]),leftEvidenceId=a.measurementEvidenceIds[0],rightEvidenceId=b.measurementEvidenceIds[0]
  const requestValue={context:await context(),leftEvidenceId,rightEvidenceId}
  assert.equal((await prepareResultComparison(io,requestValue)).comparison.comparability,'incomparable')
  const plan=await prepareResultComparison(io,{...requestValue,conversion:'seconds-to-ms'})
  assert.equal(plan.right.original.value,.9);assert.equal(plan.right.value,900)
  assert.equal(plan.comparison.comparability==='comparable'&&plan.comparison.absoluteChange,-100)
  await assert.rejects(prepareResultComparison(io,{...requestValue,conversion:'fraction-to-percent'}),{code:'RESULT_UNIT_CONVERSION_INVALID'})
  assert.equal((await snapshot(io)).ledger.evidence[rightEvidenceId].measurement?.value,'0.9')
})
test('AT-202/205: contribution and section associations are versioned and appear in update impact without touching the manuscript',async()=>{
  const {io,context,request}=await setup(),saved=await confirmResultImport(io,await context(),await prepareResultImport(io,await request()),true),state=await inspectResults(io),record=state.experiments.records[saved.experimentIds[0]],evidenceId=record.measurementEvidenceIds[0]
  const claim=await upsertClaim(io,{kind:'user-observation',text:'TEST_ONLY limited contribution',scope:'section_TEST_ONLY',evidenceLinks:[{evidenceId,relation:'partial',rationale:'TEST_ONLY limited measurement'}],limitations:['TEST_ONLY scope']},(await context()).expectedLedgerRevision)
  await confirmOutline(io,{version:0,title:'TEST_ONLY',researchQuestion:'TEST_ONLY',thesis:'TEST_ONLY',confirmation:'draft',sections:[{id:'section_TEST_ONLY',title:'Results',purpose:'TEST_ONLY',claimIds:[claim.claim.id],missingEvidence:[]}]},claim.revision,0)
  const before=(await snapshot(io)).document.text
  await associateResults(io,{context:await context(),experimentId:record.id,storeHash:state.storeHash,claimIds:[claim.claim.id],sectionIds:['section_TEST_ONLY'],figures:[]})
  const updated=await inspectResults(io);assert.deepEqual(updated.experiments.records[record.id].links.claimIds,[claim.claim.id]);assert.equal(updated.associations.records[record.id].experimentHash,digest(json(updated.experiments.records[record.id])))
  const update=await prepareResultImport(io,{...await request(),previousExperimentId:record.id});assert.deepEqual(update.impact.claimIds,[claim.claim.id]);assert.equal((await snapshot(io)).document.text,before)
})
