import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {saveWritingSpec} from '../../src/core/pipeline/writing-task-store.ts'
import {creationSpec} from '../../src/shared/writing-task.ts'
import {registerMaterial,selectMaterial} from '../../src/core/materials/materials.ts'
import {packageSkill} from '../../src/core/skills/package.ts'
import {prepareBindings,applyBindings} from '../../src/core/skills/bindings.ts'
import {digest} from '../../src/core/store/files.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'

const output=resolve('.dsh-tmp/contracts/product-chain-controller.mjs');await mkdir(resolve('.dsh-tmp/contracts'),{recursive:true})
await build({entryPoints:['src/host/bridge/writing-controller.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:output,plugins:[{name:'TEST_ONLY-host',setup(builder){
  builder.onLoad({filter:/[\\/]executor[\\/]model\.ts$/},()=>({loader:'ts',contents:`export async function selectedModel(){return {selected:{provider:'TEST_ONLY',model:'fixture'},session:{},contextWindow:100000,maxOutputTokens:4096}};export async function callStageModel(ctx,s,m,call){return ctx.stageModel(call)};export async function callStageModelWithImage(){throw Error('TEST_ONLY no image calls')}`}))
  builder.onLoad({filter:/[\\/]bridge[\\/]project-api\.ts$/},()=>({loader:'ts',contents:`export async function resolveStore(ctx){return {io:ctx.io}}`}))
  builder.onLoad({filter:/[\\/]skills[\\/]reader\.ts$/},()=>({loader:'ts',contents:`export async function readPrivateSkill(binding,io){return io.TEST_ONLY_SKILL_BUNDLE}`}))
}}]})
const {WritingController}=await import(pathToFileURL(output).href)
const spec=(requirements='TEST_ONLY paper')=>creationSpec.parse({title:'TEST_ONLY',type:'course-paper',language:'zh-CN',format:'markdown',requirements,targetLength:500,materials:[],sections:[{id:'section_TEST_ONLY',title:'测试',targetLength:500}]})
async function fixture(requirements){const io=new MemoryStore({'notes.md':'TEST_ONLY notes'});await initialize(io,await prepareInit(io,{title:'TEST_ONLY',type:'course-paper'}));await saveWritingSpec(io,spec(requirements),(await snapshot(io)).ledger.revision);return io}
const context=async io=>{const s=await snapshot(io);return {requestId:'req_TEST_ONLY',workspaceId:'ws_TEST_ONLY',sessionId:'ses_TEST_ONLY',projectId:s.ledger.projectId,expectedLedgerRevision:s.ledger.revision}}
const rewrite=async(io,controller)=>controller.propose({context:await context(io),text:'TEST_ONLY 原句。',baseDocumentHash:(await snapshot(io)).document.contentHash,start:0,end:13,action:'polish'},new AbortController().signal)

test('SF-144: forbidden writing policy stops quick rewriting before any model call',async()=>{
  const io=await fixture('TEST_ONLY 禁止使用 AI，包括润色和改写。');let calls=0
  const controller=new WritingController({io,effect(){},stageModel(){calls++;throw Error('TEST_ONLY must not call')}},'TEST_ONLY')
  await assert.rejects(rewrite(io,controller),{code:'AI_POLICY_FORBIDS_GENERATION'});assert.equal(calls,0)
})
test('SF-147: quick rewriting consumes pinned revision Skill and profile and records their digests',async()=>{
  const io=await fixture();const marker='TEST_ONLY pinned revision instructions'
  const bundle=packageSkill('local:TEST_ONLY:revision',[{relativePath:'SKILL.md',bytes:new TextEncoder().encode('---\nname: test-only-revision\ndescription: TEST_ONLY revision\n---\n'+marker)}],{kind:'local',rootFingerprint:digest('TEST_ONLY'),subpath:'revision'},{capabilities:['selection-transform'],suggestedStages:['revision']})
  await applyBindings(io,await prepareBindings(io,[{bindingId:'binding_TEST_ONLY',qualifiedId:bundle.manifest.metadata.qualifiedId,digest:bundle.manifest.digest,scope:'library',entryPath:'TEST_ONLY/SKILL.md',enabledStages:['revision']}],async()=>bundle))
  io.TEST_ONLY_SKILL_BUNDLE=bundle;const current=await snapshot(io);io.externalEdit(current.config.writing.projectProfile,'TEST_ONLY profile marker')
  const controller=new WritingController({io,effect(){},stageModel:async call=>{assert.equal(call.context.academicSkills[0].instructions,bundle.instructions);assert.equal(call.context.projectProfile,'TEST_ONLY profile marker');return JSON.stringify({replacementText:'TEST_ONLY 改进。'})}},'TEST_ONLY')
  const {suggestion}=await rewrite(io,controller);assert.equal(suggestion.usage.skillDigests[0].digest,bundle.manifest.digest)
  assert.equal(suggestion.usage.profileHash,digest('TEST_ONLY profile marker'))
})
test('SF-148: requirements edits preserve newly selected materials and their stored selection',async()=>{
  const io=await fixture();await registerMaterial(io,{relativePath:'notes.md',role:'notes',confirmExcludedFile:false},(await snapshot(io)).ledger.revision)
  const controller=new WritingController({io,effect(){}},'TEST_ONLY')
  await controller.preferences({context:await context(io),spec:spec('TEST_ONLY updated requirements')},new AbortController().signal)
  assert.deepEqual((await snapshot(io)).config.materials.include,['notes.md'])
  assert.deepEqual(JSON.parse((await io.read('.scholarflow/writing/requirements.json')).text).spec.materials,['notes.md'])
})
test('SF-150: repeated acknowledged decision is idempotent; opposite decision still refuses',async()=>{
  const io=await fixture();const controller=new WritingController({io,effect(){},stageModel:async()=>JSON.stringify({replacementText:'TEST_ONLY 改进。'})},'TEST_ONLY')
  const {suggestion}=await rewrite(io,controller);const current=await snapshot(io)
  await saveManual(io,suggestion.after,current.document.contentHash,current.ledger.revision)
  const request={context:await context(io),suggestionId:suggestion.id,state:'accepted'}
  await controller.decideSuggestion(request,new AbortController().signal);await controller.decideSuggestion(request,new AbortController().signal)
  await assert.rejects(controller.decideSuggestion({...request,state:'rejected'},new AbortController().signal),{code:'PROPOSAL_ALREADY_DECIDED'})
})
test('SF-148: changes to material selection do not create false requirements conflicts; concurrent owned fields still do',async()=>{
  const io=await fixture(),controller=new WritingController({io,effect(){}},'TEST_ONLY')
  const material=(await registerMaterial(io,{relativePath:'notes.md',role:'notes',confirmExcludedFile:false},(await snapshot(io)).ledger.revision)).material
  const image=await controller.requirements({context:await context(io)},new AbortController().signal)
  await selectMaterial(io,material.id,false,(await snapshot(io)).ledger.revision)
  const saved=await controller.preferences({context:await context(io),spec:{...image.spec,title:'TEST_ONLY changed title'},baseSpecHash:image.baseSpecHash,baseRequirementsHash:image.baseRequirementsHash},new AbortController().signal)
  assert.deepEqual((await snapshot(io)).config.materials.include,[])
  await saveWritingSpec(io,{...saved.spec,requirements:'TEST_ONLY another author changed this field'},(await snapshot(io)).ledger.revision)
  await assert.rejects(controller.preferences({context:await context(io),spec:saved.spec,baseSpecHash:saved.baseSpecHash,baseRequirementsHash:saved.baseRequirementsHash},new AbortController().signal),{code:'WRITING_SPEC_CHANGED'})
})
test('SF-150: an explicitly tracked acceptance position can move after unrelated editing without guessed matching',async()=>{
  const io=await fixture(),controller=new WritingController({io,effect(){},stageModel:async()=>JSON.stringify({replacementText:'TEST_ONLY 改进。'})},'TEST_ONLY'),{suggestion}=await rewrite(io,controller)
  const prefix='TEST_ONLY unrelated manual paragraph.\n\n';await saveManual(io,prefix+suggestion.after,(await snapshot(io)).document.contentHash,(await snapshot(io)).ledger.revision)
  await assert.rejects(controller.decideSuggestion({context:await context(io),suggestionId:suggestion.id,state:'accepted'},new AbortController().signal),{code:'EDITOR_BUFFER_CONFLICT'})
  await controller.decideSuggestion({context:await context(io),suggestionId:suggestion.id,state:'accepted',acceptedStart:prefix.length},new AbortController().signal)
  const stored=JSON.parse((await io.read(`.scholarflow/writing/suggestions/${suggestion.id}.json`)).text);assert.equal(stored.acceptedStart,prefix.length);assert.equal(stored.start,0)
})
test('SF-153: input selection changes preserve independently added materials and explicitly clear a removed legacy requirement source',async()=>{
  const io=await fixture();io.externalEdit('more.md','TEST_ONLY independently selected material')
  await saveWritingSpec(io,{...spec(),assignmentPath:'notes.md'},(await snapshot(io)).ledger.revision)
  await registerMaterial(io,{relativePath:'notes.md',role:'notes',confirmExcludedFile:false},(await snapshot(io)).ledger.revision)
  const controller=new WritingController({io,effect(){}},'TEST_ONLY'),image=await controller.requirements({context:await context(io)},new AbortController().signal)
  assert.equal(image.spec.requirementSources[0].path,'notes.md')
  await registerMaterial(io,{relativePath:'more.md',role:'notes',confirmExcludedFile:false},(await snapshot(io)).ledger.revision)
  const result=await controller.inputs({context:await context(io),baseSpecHash:image.baseSpecHash,baseMaterials:['notes.md'],materials:[],requirementSources:[],online:false},'TEST_ONLY',new AbortController().signal)
  assert.deepEqual(result.spec.materials,['more.md']);assert.equal(result.spec.assignmentPath,undefined)
  await controller.preferences({context:await context(io),spec:image.spec,baseSpecHash:image.baseSpecHash,baseRequirementsHash:image.baseRequirementsHash},new AbortController().signal)
  const saved=await controller.requirements({context:await context(io)},new AbortController().signal);assert.equal(saved.spec.assignmentPath,undefined);assert.deepEqual(saved.spec.requirementSources,[])
})
