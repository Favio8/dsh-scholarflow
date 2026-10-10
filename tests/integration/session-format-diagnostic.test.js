// TEST_ONLY: fail at the real inspection seam before any filesystem operation.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const output=resolve('.dsh-tmp/contracts/session-format-diagnostic.mjs')
await mkdir(resolve('.dsh-tmp/contracts'),{recursive:true})
await build({entryPoints:['src/host/bridge/project-api.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'})
const {resolveStore}=await import(pathToFileURL(output).href)
const context={requestId:'req_TEST_ONLY',workspaceId:'workspace_TEST_ONLY',sessionId:'session_TEST_ONLY'}
const host=error=>({workspaceRegistry:{get(){return{path:'TEST_ONLY'}}},sessionController:{async inspect(){throw error}}})
test('wrapped unsupported format reports the compatible host requirement without raw paths',async()=>{
 const inner=new Error('TEST_ONLY private raw log');inner.name='SessionFormatUnsupportedError'
 await assert.rejects(resolveStore(host(new Error('TEST_ONLY query failed',{cause:inner})),context,new AbortController().signal),error=>{
  assert.equal(error.code,'SESSION_FORMAT_UNSUPPORTED');assert(!error.message.includes('private raw log'));return true
 })
})
test('ordinary and cyclic failures retain read failure; caller cancellation takes priority',async()=>{
 const cyclic=new Error('TEST_ONLY corruption');cyclic.cause=cyclic
 await assert.rejects(resolveStore(host(cyclic),context,new AbortController().signal),{code:'SESSION_READ_FAILED'})
 const abort=new AbortController();abort.abort(new Error('TEST_ONLY cancelled'))
 await assert.rejects(resolveStore(host(cyclic),context,abort.signal),/cancelled/)
})
