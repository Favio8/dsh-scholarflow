import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {sourceConflictFixture} from '../fixtures/source-conflict.ts'
import {approveFirstDraft} from '../../src/core/pipeline/first-draft.ts'
import {saveWritingTask,readWritingTask} from '../../src/core/pipeline/writing-task-store.ts'
import {snapshot} from '../../src/core/project/project.ts'

const output=resolve('.dsh-tmp/contracts/first-draft-controller.mjs');await mkdir(resolve('.dsh-tmp/contracts'),{recursive:true})
await build({entryPoints:['src/host/bridge/writing-controller.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output,
  plugins:[{name:'TEST_ONLY-controlled-host',setup(builder){
    builder.onLoad({filter:/[\\/]executor[\\/]model\.ts$/},()=>({loader:'ts',contents:`
      export async function selectedModel(){return {selected:{provider:'TEST_ONLY',model:'fixture'},session:{},contextWindow:100000,maxOutputTokens:4096}}
      export async function callStageModel(ctx,session,selected,call){return ctx.stageModel(call)}
      export async function callStageModelWithImage(){throw Error('TEST_ONLY no image calls')}
    `}))
    builder.onLoad({filter:/[\\/]bridge[\\/]project-api\.ts$/},()=>({loader:'ts',contents:`export async function resolveStore(ctx){return {io:ctx.io}}`}))
  }}]})
const {WritingController}=await import(pathToFileURL(output).href)
const until=async(predicate)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){if(await predicate())return;await new Promise(done=>setTimeout(done,10))}throw Error('TEST_ONLY stage timeout')}

test('failed native history registration prevents all model stages and preserves the initialized paper',async()=>{
  const f=await sourceConflictFixture(false)
  f.task.mode='first-draft';f.task.firstDraftApproval=await approveFirstDraft(f.io,f.task.spec,f.task.sessionId);await saveWritingTask(f.io,f.task)
  const context={requestId:'req_test',workspaceId:'workspace_test',sessionId:f.task.sessionId,projectId:f.task.projectId}
  let calls=0
  const ctx={io:f.io,effect(){},stageModel(){calls++;throw Error('TEST_ONLY model must not run')}}
  const before=(await snapshot(f.io)).document.text
  const controller=new WritingController(ctx,'owner_test',async()=>{throw Error('TEST_ONLY history flush failed')})
  await assert.rejects(controller.action({context,action:'resume'},new AbortController().signal),/history flush failed/)
  assert.equal(calls,0);assert.equal((await snapshot(f.io)).document.text,before)
  assert.equal(controller.active.size,0)
})

test('real controller shows partial body before completion, cancels immediately, isolates readers and resumes one unfinished call',async()=>{
  const f=await sourceConflictFixture(false)
  f.task.mode='first-draft';f.task.firstDraftApproval=await approveFirstDraft(f.io,f.task.spec,f.task.sessionId);await saveWritingTask(f.io,f.task)
  const context={requestId:'req_test',workspaceId:'workspace_test',sessionId:f.task.sessionId,projectId:f.task.projectId}
  let generationCalls=0,oldCall
  const ctx={io:f.io,effect(){},workspaceRegistry:{get(id){return id===context.workspaceId?{path:'TEST_ONLY_root',sessionIds:[context.sessionId]}:undefined}},
    stageModel:async call=>{
      const data=call.context
      if(data.blocks)return '```json\n'+JSON.stringify({summary:'TEST_ONLY source',bibliography:{}})+'\n```'
      if(data.evidence && data.sections)return '```json\n'+JSON.stringify({claims:data.sections.map(section=>({sectionId:section.id,text:'TEST_ONLY claim',evidenceIds:data.evidence.map(row=>row.id),rationale:'TEST_ONLY raw excerpts'}))})+'\n```'
      assert(data.sectionContract)
      generationCalls++
      const key=data.sources[0].citeKey,ids=data.claims.map(row=>row.id),body='第一段 TEST_ONLY evidence [@'+key+'].\n\n第二段 TEST_ONLY analysis [@'+key+'].'
      const raw=JSON.stringify({replacementText:body,limitations:['TEST_ONLY fixture'],sectionId:data.sectionContract.sectionId,
        paragraphClaims:[{paragraphIndex:0,claimIds:ids},{paragraphIndex:1,claimIds:ids}]})
      const cut=raw.indexOf('第一段')+3
      call.onTextDelta?.(raw.slice(0,cut))
      if(generationCalls===1){oldCall=call;await new Promise((done,reject)=>call.signal.addEventListener('abort',()=>reject(Error('TEST_ONLY aborted')),{once:true}))}
      call.onTextDelta?.(raw.slice(cut));return raw
    }}
  const controller=new WritingController(ctx,'owner_test')
  const observed=await controller.watchDraft({context},'operator_test',new AbortController().signal)
  const beforeWrites=f.io.writes
  assert(observed.watchId);assert.equal(f.io.writes,beforeWrites)
  await controller.action({context,action:'resume'},new AbortController().signal)
  await until(()=>controller.readDraftStream({context,watchId:observed.watchId},'operator_test').preview?.text==='第一段')
  const partial=controller.readDraftStream({context,watchId:observed.watchId},'operator_test')
  assert.equal(partial.preview.status,'generating')
  assert(!(await snapshot(f.io)).document.text.includes('第一段'))
  assert.throws(()=>controller.readDraftStream({context,watchId:observed.watchId},'operator_OTHER'),{code:'DRAFT_WATCH_STALE'})
  assert.throws(()=>controller.readDraftStream({context:{...context,projectId:'project_other'},watchId:observed.watchId},'operator_test'),{code:'DRAFT_WATCH_STALE'})
  const started=Date.now(),stopping=await controller.action({context,action:'pause'},new AbortController().signal)
  assert.equal(stopping.stopping,true);assert(Date.now()-started<200)
  await until(async()=>!controller.active.has(f.task.id))
  assert.equal((await readWritingTask(f.io)).status,'paused')
  const paused=controller.readDraftStream({context,watchId:observed.watchId},'operator_test')
  assert.equal(paused.preview.status,'paused');assert.equal(paused.preview.text,'第一段')
  assert(!(await snapshot(f.io)).document.text.includes('第一段'))
  const seq=paused.preview.seq;oldCall.onTextDelta('{"replacementText":"wrong late output"}')
  assert.equal(controller.readDraftStream({context,watchId:observed.watchId},'operator_test').preview.seq,seq)
  await controller.action({context,action:'resume'},new AbortController().signal)
  await until(()=>!controller.active.has(f.task.id))
  const completed=await readWritingTask(f.io)
  assert.equal(completed.status,'completed');assert.equal(completed.sectionIndex,1);assert.equal(generationCalls,2)
  assert((await snapshot(f.io)).document.text.includes('第二段'))
  assert.equal(controller.readDraftStream({context,watchId:observed.watchId},'operator_test').preview.status,'saved')
  const after=generationCalls
  controller.unwatchDraft({watchId:observed.watchId},'operator_test')
  await controller.watchDraft({context},'operator_test',new AbortController().signal)
  assert.equal(generationCalls,after,'observing completed work never launches a paid request')
})
