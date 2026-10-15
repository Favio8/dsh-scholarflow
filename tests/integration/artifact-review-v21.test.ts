import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
import {saveWritingSpec} from '../../src/core/pipeline/writing-task-store.ts'
import {creationSpec} from '../../src/shared/writing-task.ts'
import {prepareDelivery,createDelivery} from '../../src/core/export/delivery.ts'
import {inspectArtifactReview,recordLayoutVerification} from '../../src/core/export/artifact-review.ts'
import {projectMarkdown} from '../../src/core/editing/markdown.ts'
import JSZip from 'jszip'

test('AT-193/198: actual Word bytes and cover fields are checked; required pagination stays unknown until an exact-artifact viewing receipt',async()=>{
  const io=new MemoryStore();await initialize(io,await prepareInit(io,{title:'TEST_ONLY layout',type:'course-paper'}))
  const spec=creationSpec.parse({title:'TEST_ONLY layout',type:'course-paper',language:'zh-CN',format:'docx',requirements:'TEST_ONLY cover and four rendered pages',targetLength:500,materials:[],sections:[{id:'section_TEST_ONLY',title:'正文',purpose:'TEST_ONLY',targetLength:500}],online:false,manuscriptDir:'manuscript',brief:{length:{pages:4,coverPages:1,bodyPages:3}},cover:{enabled:true,title:'TEST_ONLY layout',fields:[{label:'姓名',value:''}]},typography:{bodyFontZh:'宋体',bodyFontEn:'Times New Roman',bodySizePt:12,lineSpacing:1.2}})
  await saveWritingSpec(io,spec,0);let current=await snapshot(io);await saveManual(io,'# TEST_ONLY layout\n\n## 正文\n\n这是 TEST_ONLY 正文，不声称是真实任务验收。\n',current.document.contentHash,current.ledger.revision)
  const plan=await prepareDelivery(io,'docx'),created=await createDelivery(io,plan,'working-draft',plan.ledgerRevision),deliveryId=created.manifest.id
  let actual=await inspectArtifactReview(io,deliveryId)
  assert.equal(actual.checks.find(row=>row.id==='delivery_format')?.status,'pass')
  assert.equal(actual.checks.find(row=>row.id==='cover_fields')?.status,'fail')
  assert.equal(actual.checks.find(row=>row.id==='cover_artifact')?.status,'fail','missing cover fields must also fail actual-artifact coverage')
  assert.equal(actual.checks.find(row=>row.id==='typography_artifact')?.status,'pass')
  assert.equal(actual.checks.find(row=>row.id==='rendered_pagination')?.status,'unknown')
  const context=async()=>({requestId:'TEST_ONLY',workspaceId:'TEST_ONLY',sessionId:'TEST_ONLY',projectId:(await snapshot(io)).ledger.projectId,expectedLedgerRevision:(await snapshot(io)).ledger.revision})
  await assert.rejects(recordLayoutVerification(io,{context:await context(),deliveryId,viewer:'TEST_ONLY viewer',reason:'TEST_ONLY simulated page count contract, no real viewing claim',pages:4,coverPages:1,bodyPages:2}),{code:'LAYOUT_COUNT_INVALID'})
  await recordLayoutVerification(io,{context:await context(),deliveryId,viewer:'TEST_ONLY viewer',reason:'TEST_ONLY simulated page count contract, no real viewing claim',pages:4,coverPages:1,bodyPages:3})
  actual=await inspectArtifactReview(io,deliveryId);assert.equal(actual.checks.find(row=>row.id==='rendered_pagination')?.status,'pass');assert.equal(actual.checks.find(row=>row.id==='cover_fields')?.status,'fail')
  current=await snapshot(io);await saveManual(io,current.document.text+'\n后续人工编辑。\n',current.document.contentHash,current.ledger.revision)
  assert.equal((await inspectArtifactReview(io,deliveryId)).checks.find(row=>row.id==='rendered_pagination')?.status,'unknown')
  current=await snapshot(io);const paragraph=projectMarkdown(current.document.text).blocks.find(block=>block.node.type==='paragraph')!
  await saveManual(io,current.document.text,current.document.contentHash,current.ledger.revision,undefined,{characters:[{start:paragraph.start,end:paragraph.end,sizePt:24}],paragraphs:[]})
  const changedPlan=await prepareDelivery(io,'docx'),changed=await createDelivery(io,changedPlan,'working-draft',changedPlan.ledgerRevision),actualChanged=await inspectArtifactReview(io,changed.manifest.id)
  assert.equal(actualChanged.checks.find(row=>row.id==='body_typography_overrides')?.status,'fail')
  const bytes=io.binaries.get(`manuscript/exports/${changed.manifest.id}/paper.docx`)!.bytes,zip=await JSZip.loadAsync(bytes);assert.match(await zip.file('word/document.xml')!.async('string'),/w:sz w:val="48"/u)
  const path=`manuscript/exports/${deliveryId}/paper.docx`,binary=io.binaries.get(path)!;io.binaries.set(path,{...binary,bytes:Buffer.from('TEST_ONLY tampered')})
  await assert.rejects(inspectArtifactReview(io,deliveryId),{code:'DELIVERY_CHANGED'})
})
