import {test} from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot} from '../../src/core/project/project.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
import {prepareVersionRestore,restoreVersion} from '../../src/core/editing/version-restore.ts'
import {authorSkill} from '../../src/core/skills/authoring.ts'
import {prepareBibliographyImport,confirmBibliographyImport} from '../../src/core/research/bibliography-import.ts'
import {prepareDelivery,createDelivery,readDelivery} from '../../src/core/export/delivery.ts'
import {apaLabels,apaReferences} from '../../src/core/export/apa.ts'
import {exportImages} from '../../src/core/export/images.ts'
import {saveWritingSpec} from '../../src/core/pipeline/writing-task-store.ts'
import {creationSpec,typographySpec} from '../../src/shared/writing-task.ts'
import {cowriteContext} from '../../src/core/pipeline/cowrite-context.ts'
import {projectMarkdown,validateRange} from '../../src/core/editing/markdown.ts'
import {aiProvenance} from '../../src/core/editing/provenance.ts'
import {registerMaterial,selectMaterial} from '../../src/core/materials/materials.ts'
import {digest} from '../../src/core/store/files.ts'
import {layoutOf} from '../../src/core/export/layout.ts'

const bib='@article{TEST_ONLY,title={TEST_ONLY Study},author={Wang, Xin},year={2020},journal={Test Journal},volume={12},number={2},pages={10--20},doi={10.1234/test-only}}'
async function fixture(){const io=new MemoryStore({'figure.png':'TEST_ONLY image placeholder','notes.md':'TEST_ONLY notes'});await initialize(io,await prepareInit(io,{title:'TEST_ONLY product',type:'course-paper',language:'en'}));return io}
const spec=()=>creationSpec.parse({title:'TEST_ONLY product',type:'course-paper',language:'en',format:'markdown',requirements:'TEST_ONLY requirements',targetLength:500,materials:[],sections:[{id:'section_TEST_ONLY',title:'Analysis',targetLength:500}],typography:typographySpec.parse({referenceStyle:'apa7'})})
async function save(io:MemoryStore,text:string){const current=await snapshot(io);return saveManual(io,text,current.document.contentHash,current.ledger.revision)}

test('SF-155: authored edits create immutable versions under the same user identity; copies receive another identity',()=>{
  const input={name:'TEST_ONLY writer',description:'TEST_ONLY purpose',instructions:'TEST_ONLY instructions',capabilities:['draft-section','selection-transform'],suggestedStages:['drafting','revision']}
  const original=authorSkill(input),before=original.instructions
  const edited=authorSkill({...input,instructions:'TEST_ONLY changed instructions',qualifiedId:original.manifest.metadata.qualifiedId,derivedFrom:{qualifiedId:original.manifest.metadata.qualifiedId,digest:original.manifest.digest}},original)
  assert.equal(original.instructions,before);assert.notEqual(edited.manifest.digest,original.manifest.digest);assert.equal(edited.manifest.metadata.qualifiedId,original.manifest.metadata.qualifiedId);assert.equal(edited.manifest.origin.kind,'user')
  assert.notEqual(authorSkill(input,original).manifest.metadata.qualifiedId,original.manifest.metadata.qualifiedId)
  assert.throws(()=>authorSkill({...input,qualifiedId:'builtin:TEST_ONLY'}),{code:'SKILL_AUTHOR_ID_INVALID'})
})
test('SF-156: arbitrary historic restore creates a new revision with the previous current version retained',async()=>{
  const io=await fixture(),first=await save(io,'# TEST_ONLY\n\nFirst version.'),second=await save(io,'# TEST_ONLY\n\nSecond version.')
  const plan=await prepareVersionRestore(io,first.revisionId),restored=await restoreVersion(io,first.revisionId,plan.planHash)
  assert.notEqual(restored.revisionId,first.revisionId);assert.notEqual(restored.revisionId,second.revisionId)
  assert.equal((await snapshot(io)).document.text,plan.text);assert.equal((await io.read(`.scholarflow/drafts/${second.revisionId}/paper.md`))!.text,'# TEST_ONLY\n\nSecond version.')
  assert.equal(JSON.parse((await io.read(`.scholarflow/drafts/${restored.revisionId}/manifest.json`))!.text).parentRevisionId,second.revisionId)
})
test('SF-156: a stale restore preview cannot overwrite later edits',async()=>{
  const io=await fixture(),first=await save(io,'TEST_ONLY A');await save(io,'TEST_ONLY B');const plan=await prepareVersionRestore(io,first.revisionId);await save(io,'TEST_ONLY C')
  await assert.rejects(restoreVersion(io,first.revisionId,plan.planHash),{code:'RESTORE_PLAN_STALE'});assert.equal((await snapshot(io)).document.text,'TEST_ONLY C')
})
test('SF-158: BibTeX import preserves supplied fields, leaves identity unverified, and requires duplicate decisions',async()=>{
  const io=await fixture(),plan=await prepareBibliographyImport(io,{format:'bibtex',text:bib+'\n'+bib.replace('TEST_ONLY,','TEST_ONLY_second,')})
  assert.equal(plan.candidates[1].exactDuplicate,true)
  const registered=await confirmBibliographyImport(io,plan,[{index:0,reason:''}],'ses_TEST_ONLY'),source=registered.sources[0]
  assert.equal(source.identity.status,'unverified');assert.equal(source.textAccess,'metadata');assert.equal(source.bibliography?.volume,'12');assert.equal(source.bibliography?.issue,'2');assert.equal(Object.keys((await snapshot(io)).ledger.evidence).length,0)
  const duplicate=await prepareBibliographyImport(io,{format:'bibtex',text:bib})
  await assert.rejects(confirmBibliographyImport(io,duplicate,[{index:0,reason:'TEST_ONLY duplicate'}],'ses_TEST_ONLY'),{code:'SOURCE_ALREADY_REGISTERED'})
  assert.equal(Object.keys((await snapshot(io)).ledger.sources).length,1)
})
test('SF-158: RIS imports actual authors, date and identifiers',async()=>{
  const io=await fixture(),plan=await prepareBibliographyImport(io,{format:'ris',text:'TY  - JOUR\nTI  - TEST_ONLY RIS\nAU  - Li, Ming\nPY  - 2021\nDO  - 10.1234/test-ris\nER  -\n'})
  assert.equal(plan.candidates[0].source.authors[0].family,'Li');assert.equal(plan.candidates[0].source.year,2021);assert.equal(plan.candidates[0].source.identifiers.doi,'10.1234/test-ris')
})
test('SF-158: APA labels and bibliography come from CSL; rendered citation remains mapped to its exact source token',async()=>{
  const io=await fixture(),plan=await prepareBibliographyImport(io,{format:'bibtex',text:bib}),source=(await confirmBibliographyImport(io,plan,[{index:0,reason:''}],'ses_TEST_ONLY')).sources[0]
  const text=`TEST_ONLY finding [@${source.citeKey}].`,labels=apaLabels(text,[source]),projection=projectMarkdown(text,[],labels),leaf=projection.leaves.find(row=>row.citationKeys)!
  assert.equal(leaf.text,'(Wang, 2020)');assert.ok(apaReferences([source])[0][1].includes('Test Journal, 12(2), 10–20'))
  assert.deepEqual(validateRange(projection,leaf.start,leaf.end).citationKeys,[source.citeKey])
})
test('SF-157: local image is packaged, embedded in Word, and referenced by LaTeX without changing the manuscript or image',async()=>{
  const io=await fixture(),png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kZkAAAAASUVORK5CYII=','base64'))
  const imageIo=io as MemoryStore&{readImageAssetBytes:(path:string,max:number)=>Promise<Uint8Array>};imageIo.readImageAssetBytes=async path=>{assert.equal(path,'figure.png');return png}
  const manuscript='# TEST_ONLY paper\n\n![TEST_ONLY figure](../figure.png)\n\nFigure 1 TEST_ONLY'
  await save(io,manuscript);const plan=await prepareDelivery(io,'docx'),created=await createDelivery(io,plan,'working-draft',plan.ledgerRevision),delivery=await readDelivery(io,created.manifest.id)
  const image=delivery.files.find(row=>row.relativePath.startsWith('assets/'))!,word=delivery.files.find(row=>row.relativePath==='paper.docx')!
  assert.equal(image.encoding,'base64');assert.equal(image.hash,digest(png));assert.ok('base64'in word)
  const zip=await JSZip.loadAsync(Buffer.from('base64'in word?word.base64:'','base64'))
  assert.equal(Object.keys(zip.files).filter(path=>path.startsWith('word/media/')&&!zip.files[path].dir).length,1)
  const texPlan=await prepareDelivery(io,'latex'),texCreated=await createDelivery(io,texPlan,'working-draft',texPlan.ledgerRevision),texDelivery=await readDelivery(io,texCreated.manifest.id),tex=texDelivery.files.find(row=>row.relativePath==='paper.tex')!
  assert.ok('text'in tex&&tex.text.includes('\\includegraphics'));assert.equal((await snapshot(io)).document.text,manuscript);assert.equal(await imageIo.readImageAssetBytes('figure.png',1000),png)
})
test('SF-157: external images and changed local bytes stop export before publication',async()=>{
  const io=await fixture();await assert.rejects(exportImages(io,'![TEST_ONLY](https://example.org/image.png)','manuscript/paper.md'),{code:'REMOTE_IMAGE_NOT_EXPORTABLE'})
  let bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kZkAAAAASUVORK5CYII=','base64'))
  ;(io as any).readImageAssetBytes=async()=>bytes;await save(io,'![TEST_ONLY](../figure.png)');const plan=await prepareDelivery(io);bytes=new Uint8Array([...bytes,0])
  await assert.rejects(createDelivery(io,plan,'working-draft',plan.ledgerRevision),{code:'EXPORT_PLAN_STALE'});assert.equal(Object.keys((await snapshot(io)).ledger.deliveries).length,0)
})
test('SF-157: long manuscript rewrite includes an honest bounded neighborhood while preserving the entire selected target',async()=>{
  const io=await fixture(),current=await snapshot(io),text=Array.from({length:500},(_,i)=>`## TEST_ONLY ${i}\n\n${'TEST_ONLY surrounding body '.repeat(40)}\n\n`).join(''),start=text.indexOf('TEST_ONLY surrounding body',text.indexOf('## TEST_ONLY 250'))
  const result=cowriteContext(text,start,start+26,{requirements:'TEST_ONLY requirements'},current.ledger,{contextWindow:8000,maxOutputTokens:4096},'TEST_ONLY system')
  assert.equal(result.scope,'target-and-neighbors');assert.equal(result.context.target,text.slice(start,start+26));assert.ok(result.inputBytes<12000)
  assert.throws(()=>cowriteContext(text,0,text.length,{},current.ledger,{contextWindow:8000,maxOutputTokens:4096},'TEST_ONLY'),{code:'COWRITE_TARGET_TOO_LARGE'})
})
test('SF-152 and SF-160: material exclusion persists across requirements saves; a manual manuscript has no invented AI provenance',async()=>{
  const io=await fixture();await saveWritingSpec(io,spec(),(await snapshot(io)).ledger.revision);const material=(await registerMaterial(io,{relativePath:'notes.md',role:'notes',confirmExcludedFile:false},(await snapshot(io)).ledger.revision)).material
  await selectMaterial(io,material.id,false,(await snapshot(io)).ledger.revision);await saveWritingSpec(io,{...spec(),materials:['notes.md']},(await snapshot(io)).ledger.revision)
  assert.deepEqual((await snapshot(io)).config.materials.include,[]);assert.ok((await snapshot(io)).ledger.materials[material.id]);assert.deepEqual(await aiProvenance(io,(await snapshot(io)).document.text,'ses_TEST_ONLY'),[])
})
test('SF-157 and SF-158: an unreported provider output cap is not replaced with a plugin quota; explicit reference choices win over language defaults',async()=>{
  const io=await fixture(),text='TEST_ONLY '.repeat(5000),result=cowriteContext(text,0,text.length,{},(await snapshot(io)).ledger,{contextWindow:1000000},'TEST_ONLY')
  assert.equal(result.context.target,text);assert.equal(result.scope,'full-manuscript')
  assert.equal(layoutOf(typographySpec.parse({referenceStyle:'gbt7714',referenceStyleExplicit:true}),'en').referenceStyle,'gbt7714')
  assert.equal(layoutOf(typographySpec.parse({}),'en').referenceStyle,'plain')
})
