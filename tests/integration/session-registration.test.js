// TEST_ONLY: real task/project data; mock only the DSH store and registration seams.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {sourceConflictFixture} from '../fixtures/source-conflict.ts'
import {saveWritingTask} from '../../src/core/pipeline/writing-task-store.ts'

const output=resolve('.dsh-tmp/contracts/session-registration.mjs');await mkdir(resolve('.dsh-tmp/contracts'),{recursive:true})
await build({entryPoints:['src/host/bridge/session-registration.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',
  plugins:[{name:'TEST_ONLY-host-store',setup(builder){builder.onLoad({filter:/[\\/]bridge[\\/]project-api\.ts$/},()=>({loader:'ts',contents:'export async function resolveStore(ctx){return {io:ctx.io}}'}))}}]})
const {SessionRegistration}=await import(pathToFileURL(output).href)
async function fixture(available=true){
 const f=await sourceConflictFixture(false),context={requestId:'req_TEST_ONLY',workspaceId:'workspace_TEST_ONLY',sessionId:f.task.sessionId,projectId:f.task.projectId}
 let provider,binds=0
 const service={register(row){provider=row;return()=>{provider=undefined}},async bind(binding,signal){binds++;const value=await provider.validate(binding,signal);return{registered:true,title:value.title,manualTitlePreserved:false}}}
 const ctx={io:f.io,inject(names,fn){if(available)fn(ctx)},effect(fn){fn()},get(){return available?service:undefined},sessionTasks:service,sessionController:{async resolveAgent(){return{agent:{}}}}}
 return{...f,context,adapter:new SessionRegistration(ctx),service,provider:()=>provider,binds:()=>binds}
}
test('confirmed completed paper repairs a session with no project writes or generation',async()=>{
 const f=await fixture();f.task.status='completed';await saveWritingTask(f.io,f.task)
 const before=f.io.writes
 assert.equal((await f.adapter.sync(f.context,new AbortController().signal)).registered,true)
 assert.equal(f.io.writes,before);assert.equal(f.binds(),1)
})
test('an independent chat in the same folder is not silently registered',async()=>{
 const f=await fixture()
 assert.deepEqual(await f.adapter.sync({...f.context,sessionId:'session_OTHER'},new AbortController().signal),{registered:false,reason:'no-task-binding'})
 assert.equal(f.binds(),0)
})
test('validator rejects a forged project or task binding',async()=>{
 const f=await fixture(),binding={pluginId:'scholarflow',...f.context,taskId:'writing_OTHER'}
 await assert.rejects(f.provider().validate(binding,new AbortController().signal),{code:'SESSION_BINDING_CHANGED'})
 await assert.rejects(f.provider().validate({...binding,taskId:f.task.id,projectId:'project_OTHER'},new AbortController().signal),{code:'SESSION_BINDING_CHANGED'})
})
test('older Harness reports a compatible capability diagnostic; title saves can report it separately',async()=>{
 const f=await fixture(false)
 await assert.rejects(f.adapter.sync(f.context,new AbortController().signal),{code:'SESSION_TASKS_UNSUPPORTED'})
 assert.equal((await f.adapter.trySync(f.context,new AbortController().signal)).diagnostic.code,'SESSION_TASKS_UNSUPPORTED')
})
test('failed durable registration reports retryable work without changing the paper',async()=>{
 const f=await fixture(),before=f.io.writes
 f.service.bind=async()=>{throw Error('TEST_ONLY flush failed')}
 await assert.rejects(f.adapter.sync(f.context,new AbortController().signal),{code:'SESSION_REGISTRATION_FAILED'})
 assert.equal(f.io.writes,before)
})
