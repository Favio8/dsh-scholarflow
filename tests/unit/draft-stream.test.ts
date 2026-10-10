import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BodyStreamDecoder, DraftStreamCache, readDraftPreview } from '../../src/host/bridge/draft-streams.ts'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { digest } from '../../src/core/store/files.ts'

test('true partial JSON text is decoded before completion, without fields or escape fragments',()=>{
  const values:string[]=[], decoder=new BodyStreamDecoder(value=>values.push(value))
  for(const delta of ['{"replacementText":"第一','段\\n\\n第二段，\\"引','号\\"和\\uD83D','\\uDE00','","limitations":[],"sectionId":"s1"}'])decoder.write(delta)
  assert.equal(values[0],'第一')
  assert(values.some(value=>value==='第一段\n\n第二段，"引'))
  assert.equal(values.at(-1),'第一段\n\n第二段，"引号"和😀')
  assert(values.every(value=>value.isWellFormed()&&!value.includes('replacementText')))
})
test('a JSON code fence split across chunks is an envelope, while prose and nested fields never become正文',()=>{
  const values:string[]=[], decoder=new BodyStreamDecoder(value=>values.push(value))
  for(const chunk of ['`','``j','son\n{"replacement','Text":"TEST_ONLY text','","limitations":[]}\n```'])decoder.write(chunk)
  assert.equal(values.at(-1),'TEST_ONLY text')
  for(const input of ['prose {"replacementText":"wrong"}','{"other":{"replacementText":"wrong"}}']){
    const bad:string[]=[];new BodyStreamDecoder(value=>bad.push(value)).write(input);assert.deepEqual(bad,[])
  }
})
test('paused attempts reject late output, new attempts stay monotonic, and preview cache never writes the manuscript',async()=>{
  const io=new MemoryStore({'manuscript/paper.md':'TEST_ONLY saved text'}),cache=new DraftStreamCache()
  const input={taskId:'task_test',projectId:'project_test',sessionId:'session_test',sectionId:'s1',title:'TEST_ONLY',baseDocumentHash:digest('TEST_ONLY saved text'),start:0,end:0}
  const first=cache.begin(input);cache.update('task_test',first,{text:'TEST_ONLY partial'});cache.update('task_test',first,{status:'paused'})
  cache.update('task_test',first,{text:'wrong late data'});assert.equal(cache.peek('task_test')!.text,'TEST_ONLY partial')
  await cache.persist(io,'task_test',true)
  assert.equal((await readDraftPreview(io,'task_test'))!.text,'TEST_ONLY partial')
  const lastSeq=cache.peek('task_test')!.seq,second=cache.begin(input)
  cache.update('task_test',first,{text:'wrong old attempt'});cache.update('task_test',second,{text:'TEST_ONLY next attempt'})
  assert(cache.peek('task_test')!.seq>lastSeq)
  assert.equal(cache.peek('task_test')!.text,'TEST_ONLY next attempt')
  assert.equal((await io.read('manuscript/paper.md'))!.text,'TEST_ONLY saved text')
})
