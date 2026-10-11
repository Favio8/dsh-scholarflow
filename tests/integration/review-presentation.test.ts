import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot,mutateLedger} from '../../src/core/project/project.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
import {runReview} from '../../src/core/review/review.ts'
import {sourceSchema} from '../../src/shared/schema.ts'
import {reviewItems} from '../../src/client/review-presentation.ts'
import {draftChecklist} from '../../src/client/draft-checklist.ts'
import {bibliographyCandidates,bibliographyGroups} from '../../src/core/export/citation-groups.ts'
import {creationSpec,writingTaskSchema} from '../../src/shared/writing-task.ts'

test('SF-167/169: actual review records and completed-draft checks present one readable issue for a shared bibliography',async()=>{
  const io=new MemoryStore();await initialize(io,await prepareInit(io,{title:'TEST_ONLY review',type:'course-paper'}))
  let current=await snapshot(io)
  await mutateLedger(io,current.ledger.revision,ledger=>{for(let index=0;index<3;index++){const id='src_TEST_ONLY_'+index;ledger.sources[id]=sourceSchema.parse({id,citeKey:'sf_TEST_ONLY_'+index,title:'TEST_ONLY 同一篇论文',authors:[],kind:'paper',year:2025,identifiers:{},provenance:[],identity:{status:'unverified',method:'none'},textAccess:'metadata',...(index&&{bibliographySourceId:'src_TEST_ONLY_0'})})}})
  current=await snapshot(io);await saveManual(io,'# TEST_ONLY\n\n正文[@sf_TEST_ONLY_0; @sf_TEST_ONLY_1; @sf_TEST_ONLY_2]。',current.document.contentHash,current.ledger.revision)
  current=await snapshot(io);await runReview(io,current.ledger.revision);current=await snapshot(io)
  const project={...current,binding:{projectId:current.ledger.projectId}},items=reviewItems(project)
  assert.equal(items.filter(item=>item.identity).length,1)
  assert.equal(items.find(item=>item.identity)!.issueIds.length,3)
  assert(items.find(item=>item.identity)!.detail.includes('TEST_ONLY 同一篇论文'))
  assert(items.every(item=>!item.title.includes('src_TEST_ONLY')&&!item.detail.includes('src_TEST_ONLY')))
  assert.equal(bibliographyGroups(current.ledger).groups.length,1)
  assert.equal(bibliographyCandidates(current.ledger).length,0)
  assert.equal(items.filter(item=>item.key==='model-pending').length,1)
  assert.equal(items.find(item=>item.key==='model-pending')!.issueIds.length,5)
  const reordered={sources:Object.fromEntries(Object.entries(current.ledger.sources).reverse())}
  assert.equal(bibliographyGroups(reordered).groups[0].records.length,3,'The primary encountered after its aliases is included only once')
  const spec=creationSpec.parse({title:'TEST_ONLY',type:'course-paper',requirements:'TEST_ONLY',language:'zh-CN',format:'docx',targetLength:1500,sections:[{id:'sec_TEST_ONLY',title:'正文',targetLength:1500}],materials:[],online:false,manuscriptDir:'manuscript'})
  const task=writingTaskSchema.parse({schemaVersion:1,id:'writing_TEST_ONLY',projectId:current.ledger.projectId,sessionId:'session_TEST_ONLY',mode:'first-draft',status:'completed',stage:'completed',revision:1,spec,materialIndex:0,sectionIndex:1,usedModelCalls:0,usedSearchQueries:0,elapsedMs:0,owner:'TEST_ONLY',expectedDocumentHash:current.document.contentHash,questions:[],notes:[],issues:[],onlineSources:[],createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'})
  const rows=draftChecklist(task,project),identityRows=rows.filter(row=>row.key==='source-identity')
  assert.equal(identityRows.length,1);assert.match(identityRows[0].detail,/1 篇/u)
  assert.equal(rows.some(row=>row.title==='参考文献出版信息待核对'),false)
})
