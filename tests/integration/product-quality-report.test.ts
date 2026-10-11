import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {saveWritingSpec} from '../../src/core/pipeline/writing-task-store.ts'
import {creationSpec} from '../../src/shared/writing-task.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
import {runReview} from '../../src/core/review/review.ts'
import {prepareDelivery,createDelivery,readDelivery} from '../../src/core/export/delivery.ts'
import {wordStats} from '../../src/core/editing/markdown.ts'

test('SF-149: English quality report uses the reviewed western-word count and matching unit',async()=>{
  const io=new MemoryStore();await initialize(io,await prepareInit(io,{title:'TEST_ONLY English',type:'course-paper',language:'en'}))
  await saveWritingSpec(io,creationSpec.parse({title:'TEST_ONLY English',type:'course-paper',language:'en',format:'markdown',requirements:'TEST_ONLY',targetLength:500,materials:[],sections:[{id:'section_TEST_ONLY',title:'Analysis',targetLength:500}]}),(await snapshot(io)).ledger.revision)
  const current=await snapshot(io);await saveManual(io,'# TEST_ONLY English paper\n\n'+Array.from({length:500},()=> 'analysis').join(' '),current.document.contentHash,current.ledger.revision)
  const review=await runReview(io,(await snapshot(io)).ledger.revision),plan=await prepareDelivery(io),created=await createDelivery(io,plan,'working-draft',plan.ledgerRevision)
  const delivery=await readDelivery(io,created.manifest.id),file=delivery.files.find(row=>row.relativePath==='quality-report.md')!
  assert.equal(file.encoding,'utf8');const report='text' in file?file.text:''
  const actual=review.report.statistics.westernWords,difference=actual-500
  assert.ok(report.includes(`实际 ${actual} 词／已确认要求 500 词`));assert.ok(report.includes(`偏差 ${difference>=0?'+':''}${difference}`));assert.ok(!report.includes('实际 0 汉字'))
})
test('SF-149 and SF-154: a stale review cannot supply the current delivery word count',async()=>{
  const io=new MemoryStore();await initialize(io,await prepareInit(io,{title:'TEST_ONLY stale report',type:'course-paper',language:'en'}))
  const spec=creationSpec.parse({title:'TEST_ONLY stale report',type:'course-paper',language:'en',format:'markdown',requirements:'TEST_ONLY',targetLength:500,materials:[],sections:[{id:'section_TEST_ONLY',title:'Analysis',targetLength:500}]})
  await saveWritingSpec(io,spec,(await snapshot(io)).ledger.revision)
  let current=await snapshot(io);await saveManual(io,'# TEST_ONLY\n\n'+'analysis '.repeat(500),current.document.contentHash,current.ledger.revision);await runReview(io,(await snapshot(io)).ledger.revision)
  current=await snapshot(io);const text='# TEST_ONLY\n\n'+'revised '.repeat(30);await saveManual(io,text,current.document.contentHash,current.ledger.revision)
  const plan=await prepareDelivery(io),created=await createDelivery(io,plan,'working-draft',plan.ledgerRevision),delivery=await readDelivery(io,created.manifest.id),file=delivery.files.find(row=>row.relativePath==='quality-report.md')!
  const report='text'in file?file.text:'',count=wordStats(text,{bodyOnly:true,sectionKinds:(await snapshot(io)).ledger.outline.sections})
  assert.ok(report.includes(`实际 ${count.westernWords} 词`));assert.ok(report.includes('结果仅作历史参考'));assert.equal(created.manifest.reviewState,'review-stale')
})
