import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {registerMaterial} from '../../src/core/materials/materials.ts'
import {parseRegisteredMaterial} from '../../src/core/materials/parse.ts'
import {parseMaterialBytes} from '../../src/host/parsers/parse.ts'
import {registerSource,confirmEvidence,confirmOutline} from '../../src/core/evidence/evidence.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
import {creationSpec} from '../../src/shared/writing-task.ts'
import {createWritingTask,saveWritingSpec,saveWritingTask} from '../../src/core/pipeline/writing-task-store.ts'
import {registerDownloadedText} from '../../src/core/pipeline/writing-task.ts'
import {prepareDeliveryTask,startDeliveryTask,saveDeliveryTask,readDeliveryTask} from '../../src/core/pipeline/delivery-task.ts'
import {driveDelivery} from '../../src/core/pipeline/delivery-drive.ts'
import {semanticReviewChecks} from '../../src/shared/review.ts'
import {createCandidate,checkCandidate} from '../../src/core/pipeline/candidates.ts'
import {build} from 'esbuild'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const output=resolve(`.dsh-tmp/contracts/gap-search-controller-${process.pid}.mjs`);await mkdir(resolve('.dsh-tmp/contracts'),{recursive:true})
await build({entryPoints:['src/host/bridge/delivery-controller.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output})
const {DeliveryController}=await import(pathToFileURL(output).href)

test('AT-194: four distinct gap queries run beyond the old cumulative three; repeated queries and duplicate located bytes never manufacture progress',async()=>{
  class CacheStore extends MemoryStore{override async readBytes(path:string,max:number,signal?:AbortSignal){if(path.startsWith('.scholarflow/cache/writing-assets/')){signal?.throwIfAborted();const bytes=Buffer.from(JSON.parse((await this.read(path))!.text).base64,'base64');assert(bytes.length<=max);return bytes}return super.readBytes(path,max,signal)}}
  const io=new CacheStore({'original.txt':'TEST_ONLY original located fact.'}),signal=new AbortController().signal;await initialize(io,await prepareInit(io,{title:'TEST_ONLY gap search',type:'course-paper',language:'en'}))
  const context=async()=>({requestId:'TEST_ONLY',workspaceId:'TEST_ONLY',sessionId:'TEST_ONLY',projectId:(await snapshot(io)).ledger.projectId,expectedLedgerRevision:(await snapshot(io)).ledger.revision})
  const material=await registerMaterial(io,{relativePath:'original.txt',role:'paper',confirmExcludedFile:false},0),parsed=await parseRegisteredMaterial(io,material.material.id,material.revision,signal,(bytes,type)=>parseMaterialBytes(bytes,type,signal)),source=await registerSource(io,{kind:'paper',title:'TEST_ONLY original',authors:[],identifiers:{},materialId:material.material.id},parsed.revision)
  await confirmEvidence(io,{sourceId:source.source.id,sourceContentHash:parsed.parsed.sourceContentHash,locator:parsed.parsed.blocks[0].locator,excerpt:parsed.parsed.blocks[0].text,kind:'quotation'},source.revision)
  await confirmOutline(io,{version:0,title:'TEST_ONLY',researchQuestion:'TEST_ONLY question',thesis:'TEST_ONLY scope',confirmation:'draft',sections:[{id:'section_TEST_ONLY',title:'Body',purpose:'TEST_ONLY',claimIds:[],missingEvidence:[]}]},(await context()).expectedLedgerRevision,0)
  const spec=creationSpec.parse({title:'TEST_ONLY gap search',type:'course-paper',language:'en',format:'markdown',requirements:'TEST_ONLY find missing evidence under the approved provider scope',targetLength:200,materials:['original.txt'],sections:[{id:'section_TEST_ONLY',title:'Body',purpose:'TEST_ONLY',targetLength:200}],online:true,manuscriptDir:'manuscript'})
  await saveWritingSpec(io,spec,(await context()).expectedLedgerRevision);const finishedWriting=await createWritingTask(io,spec,'TEST_ONLY','TEST_ONLY');finishedWriting.status='completed';await saveWritingTask(io,finishedWriting)
  const current=await snapshot(io);await saveManual(io,`# TEST_ONLY\n\n## Body\n\nTEST_ONLY scoped fact [@${source.source.citeKey}].\n`,current.document.contentHash,current.ledger.revision)
  const owner={pid:process.pid,bootInstance:'TEST_ONLY'},task=await startDeliveryTask(io,await context(),await prepareDeliveryTask(io,{context:await context(),goal:'course-delivery'},{providerId:'TEST_ONLY',modelId:'TEST_ONLY'}),owner)
  const candidate=await createCandidate(io,await context(),{taskId:task.id,text:(await snapshot(io)).document.text,reason:'TEST_ONLY',scope:'document'}),checked=await checkCandidate(io,await context(),task.id,candidate.candidate.id,candidate.candidateHash)
  task.candidateId=candidate.candidate.id;task.candidateHash=candidate.candidateHash;task.checkId=checked.check.id
  let pauseOnFourth=false,stop=new AbortController(),plannerCalls=0
  const titles=['TEST_ONLY cryptographic protocols','TEST_ONLY compiler analyses','TEST_ONLY routing invariants','TEST_ONLY cache consistency'],dispatched:string[]=[],seen=new Set<string>(),writing={searchForDelivery:async(_io:unknown,writing:any,query:string)=>{dispatched.push(query);if(seen.has(query))return;seen.add(query)
    const sourceId=await registerDownloadedText(io,{title:titles[seen.size-1],authors:['TEST_ONLY fixture author'],url:`https://example.org/TEST_ONLY/${seen.size}`,version:'publishedVersion',mediaType:'text/plain',bytes:Buffer.from(`TEST_ONLY independently located fact ${seen.size}.`)},(bytes,type)=>parseMaterialBytes(bytes,type,signal));writing.onlineSources.push(sourceId);if(pauseOnFourth&&query==='TEST_ONLY q4')stop.abort('TEST_ONLY pause after actual cached retrieval')}}
  const controller=new DeliveryController({effect:()=>{}},writing as any,'TEST_ONLY'),services={owner,signal:stop.signal,context:await context(),validateModel:async()=>{},model:async(call:any)=>{const c=call.context;if(c.gaps){plannerCalls++;const names=task.queries.length===0?['TEST_ONLY q1','TEST_ONLY q2','TEST_ONLY q3']:['TEST_ONLY q4'];return JSON.stringify({queries:names.map(query=>({gapIds:[c.gaps[0].id],query}))})}
    if(c.manuscript&&c.blocks){const block=c.blocks.find((row:any)=>row.sourceText.includes('TEST_ONLY scoped fact'));return JSON.stringify({checks:semanticReviewChecks.map(id=>({id,status:'pass',detail:'TEST_ONLY review after an interrupted evidence retrieval'})),findings:[],rechecks:[],limitations:['TEST_ONLY fixture'],requirementAssessments:c.requirements.filter((r:any)=>r.verificationMethod==='model-assisted').map((r:any)=>({requirementId:r.id,status:'pass',detail:'TEST_ONLY actual scoped paragraph addresses the input requirement',quotes:[{blockId:block.id,quote:block.sourceText}]}))})}return JSON.stringify({summary:'TEST_ONLY actual new blocks were located'})}}
  let subject=task
  const search=()=> (controller as any).searchGaps(io,services.context,subject,checked.check.report,services)
  assert.equal(await search(),true,JSON.stringify(task.queries));assert.equal(dispatched.length,3)
  task.phase='evidence';await saveDeliveryTask(io,task,owner);pauseOnFourth=true
  await assert.rejects(search());assert.equal(seen.size,4);assert(task.queries.some(row=>row.outcome==='pending'));assert.equal(plannerCalls,2)
  pauseOnFourth=false;stop=new AbortController();services.signal=stop.signal;subject=(await readDeliveryTask(io,await context(),task.id))!.task
  const recovered=await driveDelivery(io,subject,{...services,waitForWriting:async()=>{throw Error('TEST_ONLY completed first draft must not replay')},searchGaps:async()=>{const progress=await search();stop.abort('TEST_ONLY stop after recovered evidence');return progress}})
  assert.equal(recovered.status,'paused',recovered.message);assert.equal(seen.size,4,'completed retrievals were reused');assert.equal(plannerCalls,2,'the completed query planner was not repeated');assert.equal(recovered.queries.filter(row=>row.outcome==='progress').length,4)
  services.signal=new AbortController().signal
  assert.equal(await search(),false);const count=dispatched.length;assert.equal(await search(),false);assert.equal(dispatched.length,count,'same normalized query and unchanged evidence version is deduplicated')
  assert.equal((await io.read('original.txt'))?.text,'TEST_ONLY original located fact.');assert(subject.queries.some(row=>row.outcome==='no-progress'))
})
