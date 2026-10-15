import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {registerMaterial} from '../../src/core/materials/materials.ts'
import {parseRegisteredMaterial} from '../../src/core/materials/parse.ts'
import {parseMaterialBytes} from '../../src/host/parsers/parse.ts'
import {parseResearchConfig,confirmResearchMaterialRoles} from '../../src/core/research/research-inputs.ts'
import {registerSource} from '../../src/core/evidence/evidence.ts'
import {locateEvidence} from '../../src/core/pipeline/writing-task.ts'
import {createWritingTask} from '../../src/core/pipeline/writing-task-store.ts'
import {creationSpec} from '../../src/shared/writing-task.ts'

test('AT-202/203/206: explicitly owned methods and inert JSON settings retain exact evidence without becoming publication references or executing commands',async()=>{
  const config='{"seed":7,"hardware":"TEST_ONLY CPU","train":{"epochs":2},"command":"TEST_ONLY inert data, never execute"}',method='TEST_ONLY author method description with a limited scope.',io=new MemoryStore({'method.txt':method,'settings.json':config,'external.txt':'TEST_ONLY external publication text'})
  await initialize(io,await prepareInit(io,{title:'TEST_ONLY research facts',type:'research-paper'}))
  const context=async()=>({requestId:'TEST_ONLY',workspaceId:'TEST_ONLY',sessionId:'TEST_ONLY',projectId:(await snapshot(io)).ledger.projectId,expectedLedgerRevision:(await snapshot(io)).ledger.revision})
  const a=await registerMaterial(io,{relativePath:'method.txt',role:'notes',confirmExcludedFile:false},0),b=await registerMaterial(io,{relativePath:'settings.json',role:'data',confirmExcludedFile:false},a.revision),signal=new AbortController().signal
  await parseRegisteredMaterial(io,a.material.id,b.revision,signal,(bytes,type)=>parseMaterialBytes(bytes,type,signal))
  await parseRegisteredMaterial(io,b.material.id,(await context()).expectedLedgerRevision,signal,async bytes=>parseResearchConfig(bytes,'settings.json',signal))
  await confirmResearchMaterialRoles(io,{context:await context(),roles:[{path:'method.txt',role:'method'},{path:'settings.json',role:'settings'}],authorConfirmed:true})
  const spec=creationSpec.parse({title:'TEST_ONLY research facts',type:'research-paper',language:'en',format:'latex',requirements:'TEST_ONLY describe supplied research without executing anything',targetLength:200,materials:['method.txt','settings.json'],sections:[{id:'section_TEST_ONLY',title:'Method',purpose:'TEST_ONLY',targetLength:200}],online:false,manuscriptDir:'manuscript'}),task=await createWritingTask(io,spec,'TEST_ONLY','TEST_ONLY')
  await locateEvidence(io,task,async()=>JSON.stringify({summary:'TEST_ONLY actual inert input scope'}),signal,()=>false)
  const current=await snapshot(io);assert.equal(Object.values(current.ledger.sources).filter(row=>row.kind==='user-result').length,2);assert(Object.values(current.ledger.evidence).some(row=>row.excerpt===config&&row.locator.kind==='data'))
  assert.equal((await io.read('settings.json'))?.text,config);assert.equal((await io.read('method.txt'))?.text,method)
  assert.throws(()=>parseResearchConfig(Buffer.from('{"seed":1,"seed":2}'),'settings.json'),{code:'RESULT_FIELDS_INVALID'})
  assert.throws(()=>parseResearchConfig(Buffer.from('TEST_ONLY code'),'run.ipynb'),{code:'RESULT_FORMAT_UNSUPPORTED'})
  const material=await registerMaterial(io,{relativePath:'external.txt',role:'paper',confirmExcludedFile:false},current.ledger.revision)
  await parseRegisteredMaterial(io,material.material.id,material.revision,signal,(bytes,type)=>parseMaterialBytes(bytes,type,signal))
  await registerSource(io,{kind:'paper',title:'TEST_ONLY external publication',authors:[],identifiers:{},materialId:material.material.id},(await context()).expectedLedgerRevision)
  await assert.rejects(confirmResearchMaterialRoles(io,{context:await context(),roles:[{path:'external.txt',role:'results'}],authorConfirmed:true}),{code:'MEASUREMENT_ORIGIN_INVALID'})
})
