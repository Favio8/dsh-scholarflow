import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sourceConflictFixture} from '../fixtures/source-conflict.ts'
import {approveFirstDraft} from '../../src/core/pipeline/first-draft.ts'
import {driveWritingTask,type WritingServices} from '../../src/core/pipeline/writing-task.ts'
import {saveWritingTask,saveWritingSpec} from '../../src/core/pipeline/writing-task-store.ts'
import {snapshot} from '../../src/core/project/project.ts'
import {buildProposal,storeProposal,saveManual} from '../../src/core/editing/proposals.ts'
import {projectMarkdown} from '../../src/core/editing/markdown.ts'
import {ScholarError} from '../../src/shared/errors.ts'

async function fixture(existing=false){
  const f=await sourceConflictFixture(existing)
  f.task.spec.sections=[{id:'summary',title:'TEST_ONLY summary',purpose:'summarize actual body',kind:'front',targetLength:100,allocationMode:'auto'},
    {id:'body1',title:'TEST_ONLY first',purpose:'first analysis',kind:'body',targetLength:250,allocationMode:'auto'},
    {id:'body2',title:'TEST_ONLY second',purpose:'second analysis',kind:'body',targetLength:250,allocationMode:'auto'}]
  f.task.mode='first-draft';f.task.firstDraftApproval=await approveFirstDraft(f.io,f.task.spec,f.task.sessionId)
  await saveWritingSpec(f.io,f.task.spec,(await snapshot(f.io)).ledger.revision);await saveWritingTask(f.io,f.task)
  const order:string[]=[]
  const services:WritingServices={signal:new AbortController().signal,pauseRequested:()=>false,parse:async()=>{throw Error('TEST_ONLY already parsed')},search:async()=>[],recoverChild:async()=>undefined,
    review:async()=>{throw Error('no automatic AI review in first draft')},
    model:async(_system,data:any)=>{
      if(data.blocks)return JSON.stringify({summary:'TEST_ONLY observed source',bibliography:{}})
      if(data.manuscript)throw Error('no automatic model review')
      return JSON.stringify({question:{title:'TEST_ONLY optional clarification',options:['TEST_ONLY']},claims:data.sections.map((section:any)=>({sectionId:section.id,text:'TEST_ONLY '+section.title,evidenceIds:data.evidence.map((row:any)=>row.id),rationale:'TEST_ONLY actual excerpts'}))})
    },generate:async(sectionId)=>{
      order.push(sectionId);const current=await snapshot(f.io),section=current.ledger.outline.sections.find(row=>row.id===sectionId)!
      const key=Object.values(current.ledger.sources)[0].citeKey
      const body='TEST_ONLY actual excerpt analysis [@'+key+'].\n\nTEST_ONLY paragraph two [@'+key+'].'
      const proposal=buildProposal(current,{runId:'run_'+sectionId,instruction:'TEST_ONLY fixture',replacementText:'',dependentEvidenceIds:Object.keys(current.ledger.evidence),
        section:{sectionId,outlineVersion:current.ledger.outline.version,body,paragraphClaims:projectMarkdown(body).blocks.map((_,i)=>({paragraphIndex:i,claimIds:section.claimIds})),limitations:['TEST_ONLY simulated provider']}})
      await storeProposal(f.io,proposal,current.ledger.revision);return {proposalId:proposal.id}
    }}
  return {...f,services,order}
}
test('first draft follows body outline then actual summary, defers clarification and never auto-revises',async()=>{
  const f=await fixture();await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'completed');assert.deepEqual(f.order,['body1','body2','summary'])
  assert.equal(f.task.questions.length,0);assert(f.task.deferredIssues.some(row=>row.message.includes('optional clarification')))
  const body=(await snapshot(f.io)).document.text
  assert(body.indexOf('## TEST_ONLY summary')<body.indexOf('## TEST_ONLY first'))
  assert.equal(f.task.modelReviewComplete,false);assert(f.task.outcome)
})
test('first-draft duplicate policy uses only approved file versions and preserves previous source records',async()=>{
  const f=await fixture(true);await driveWritingTask(f.io,f.task,f.services)
  const current=await snapshot(f.io)
  assert.equal(f.task.status,'completed');assert.equal(Object.keys(current.ledger.sources).length,2)
  assert.deepEqual(current.ledger.sources[f.source!.id],f.source)
  assert.equal(f.task.questions.length,0)
  assert([...f.io.files.keys()].some(path=>path.startsWith('.scholarflow/research/source-decisions/')))
})
test('an unavailable section becomes a real gap and the remaining sections still finish',async()=>{
  const f=await fixture(),generate=f.services.generate
  f.services.generate=async(...args)=>{if(args[0]==='body1')throw new ScholarError('MODEL_CITATION_INVALID','TEST_ONLY bad citation');return generate(...args)}
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'completed');assert.equal(f.task.outcome,'draft-with-gaps')
  assert((await snapshot(f.io)).document.text.includes('[待补：本节生成结果'))
  assert.deepEqual(f.order,['body2','summary']);assert.equal(f.task.questions.length,0)
})
test('authentication errors stop with a diagnostic rather than a repeated continue question',async()=>{
  const f=await fixture();f.services.generate=async()=>{throw new ScholarError('AUTH','TEST_ONLY auth failure')}
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'paused');assert.equal(f.task.diagnostic?.code,'AUTH');assert.equal(f.task.questions.length,0)
  assert.equal(f.task.sectionIndex,0)
})
test('pause cancels an unfinished section and resume preserves saved manual changes without regenerating completed sections',async()=>{
  const f=await fixture(),abort=new AbortController(),generate=f.services.generate
  f.services.signal=abort.signal;f.services.generate=async(...args)=>{if(args[0]==='body2'){abort.abort('paused');throw Error('TEST_ONLY abort midsection')}return generate(...args)}
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'paused');assert.equal(f.task.sectionIndex,1);assert.deepEqual(f.order,['body1'])
  let current=await snapshot(f.io)
  await saveManual(f.io,current.document.text.replace('TEST_ONLY actual excerpt analysis','TEST_ONLY manually refined analysis'),current.document.contentHash,current.ledger.revision)
  current=await snapshot(f.io);f.task.expectedDocumentHash=current.document.contentHash
  f.services.signal=new AbortController().signal;f.services.generate=generate
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'completed');assert.deepEqual(f.order,['body1','body2','summary'])
  assert((await snapshot(f.io)).document.text.includes('manually refined analysis'))
})
test('changed approved files stop before model use and historical tasks still default to guided',async()=>{
  const f=await fixture();f.task.stage='materials';f.io.externalEdit('reading-notes.md','TEST_ONLY changed source')
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'paused');assert.equal(f.task.diagnostic?.code,'FIRST_DRAFT_APPROVAL_STALE');assert.equal(f.task.usedModelCalls,0)
  assert.equal((await sourceConflictFixture()).task.mode,'guided')
})
test('missing evidence makes a complete labelled working draft without repeated material questions',async()=>{
  const f=await fixture();f.task.spec.materials=[]
  await saveWritingSpec(f.io,f.task.spec,(await snapshot(f.io)).ledger.revision)
  f.services.generate=async()=>{throw Error('facts cannot be generated without evidence')}
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'completed');assert.equal(f.task.questions.length,0)
  assert.equal(f.task.sectionIndex,3);assert.equal(f.task.outcome,'draft-with-gaps')
  assert.equal((await snapshot(f.io)).document.text.split('[待补：').length-1,3)
})
test('an unusable source summary is deferred while actual parsed excerpts remain available',async()=>{
  const f=await fixture(),model=f.services.model
  f.services.model=async(system,data:any,runId)=>data.blocks?'not valid JSON':model(system,data,runId)
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'completed');assert.equal(f.task.questions.length,0)
  assert.equal(Object.keys((await snapshot(f.io)).ledger.evidence).length,2)
  assert(f.task.deferredIssues.some(row=>row.message.includes('摘要不可用')))
})
test('external manuscript edits stop the first draft before any model call and preserve the new bytes',async()=>{
  const f=await fixture();f.io.externalEdit('manuscript/paper.md','# TEST_ONLY external manual text')
  await driveWritingTask(f.io,f.task,f.services)
  assert.equal(f.task.status,'paused');assert.equal(f.task.diagnostic?.code,'STALE_DOCUMENT_VERSION')
  assert.equal(f.task.usedModelCalls,0);const saved=await f.io.read('manuscript/paper.md');assert(saved);assert.equal(saved.text,'# TEST_ONLY external manual text')
})
