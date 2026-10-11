import {test} from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {MemoryStore} from '../fixtures/memory-store.ts'
import {initialize,prepareInit,snapshot,mutateLedger} from '../../src/core/project/project.ts'
import {saveManual} from '../../src/core/editing/proposals.ts'
import {buildWord} from '../../src/core/export/word.ts'
import {typographySpec} from '../../src/shared/writing-task.ts'
import {sourceSchema} from '../../src/shared/schema.ts'
import {citationPresentation,canonicalCitationText} from '../../src/core/export/citation-groups.ts'
import {bibliography} from '../../src/core/export/bibliography.ts'
import {prepareDelivery,createDelivery,readDelivery} from '../../src/core/export/delivery.ts'
import {headingPresentation,scanDocument} from '../../src/core/export/scan.ts'
import {projectMarkdown} from '../../src/core/editing/markdown.ts'
import {draftChecklist} from '../../src/client/draft-checklist.ts'
import {writingTaskSchema,creationSpec} from '../../src/shared/writing-task.ts'

const manuscript='# TEST_ONLY 文稿\n\n## 第一章\n\n这段文字有**强调**与中文内容。\n\n### 子节\n\n其他内容。\n'
async function setup(){const io=new MemoryStore();await initialize(io,await prepareInit(io,{title:'TEST_ONLY 文稿',type:'course-paper'}));return io}
test('SF-165: local formatting survives saving and subsequent edits at its actual text range',async()=>{
  const io=await setup(),first=await snapshot(io),start=manuscript.indexOf('这段'),end=manuscript.indexOf('\n\n###')
  await saveManual(io,manuscript,first.document.contentHash,first.ledger.revision,undefined,{characters:[{start,end:start+2,fontZh:'楷体',sizePt:14}],paragraphs:[{start,end,alignment:'center',afterPt:12}]})
  let current=await snapshot(io)
  assert.equal(current.document.formatting!.characters[0].fontZh,'楷体')
  const next=manuscript.replace('## 第一章','## 第一章标题')
  await saveManual(io,next,current.document.contentHash,current.ledger.revision)
  current=await snapshot(io);const format=current.document.formatting!
  assert.equal(format.characters[0].start,next.indexOf('这段'))
  const zip=await JSZip.loadAsync(await buildWord({text:next,config:current.config,ledger:current.ledger}))
  const xml=await zip.file('word/document.xml')!.async('string')
  assert.match(xml,/w:eastAsia="楷体"/u);assert.match(xml,/w:jc w:val="center"/u);assert.match(xml,/w:after="240"/u)
  const original=current.document.contentHash
  await assert.rejects(saveManual(io,next,original,current.ledger.revision,undefined,{characters:[{start:0,end:next.length+1,sizePt:14}],paragraphs:[]}),{code:'FORMAT_RANGE_INVALID'})
  assert.equal((await snapshot(io)).document.contentHash,original)
})
test('SF-164: document title, chapter levels, black styles, requested margin and header/footer reach Word',async()=>{
  const io=await setup(),current=await snapshot(io),typography=typographySpec.parse({marginsMm:30,bodyFontZh:'楷体',lineSpacing:1.5,headerText:'TEST_ONLY 页眉',footerText:'TEST_ONLY 页脚'})
  const zip=await JSZip.loadAsync(await buildWord({text:manuscript,config:current.config,ledger:current.ledger,typography}))
  const xml=await zip.file('word/document.xml')!.async('string'),styles=await zip.file('word/styles.xml')!.async('string')
  assert.match(xml,/>TEST_ONLY 文稿</u);assert.match(xml,/w:top="1701"/u);assert.match(xml,/w:line="360"/u)
  const levels=[...xml.matchAll(/w:ilvl w:val="(\d)"/gu)].map(row=>Number(row[1]));assert.deepEqual(levels,[0,1])
  for(const id of ['Title','Heading1','Heading2','Heading3']){const style=styles.match(new RegExp(`<w:style[^>]*w:styleId="${id}"[^>]*>([\\s\\S]*?)<\\/w:style>`))?.[1];assert.match(style??'',/w:color w:val="000000"/u)}
  assert.match(await zip.file('word/header1.xml')!.async('string'),/TEST_ONLY 页眉/u)
  assert.match(await zip.file('word/footer1.xml')!.async('string'),/TEST_ONLY 页脚/u)
  const headingRows=[...headingPresentation(scanDocument(projectMarkdown(manuscript)),'decimal').values()];assert.deepEqual(headingRows.map(row=>row.label),['','1','1.1'])
})
test('SF-166: confirmed book entry aliases share numeric/APA references and exports without changing manuscript sources',async()=>{
  const io=await setup(),current=await snapshot(io)
  const source=(id:string,key:string)=>sourceSchema.parse({id,citeKey:key,title:'TEST_ONLY 同题文献',authors:[{literal:'TEST_ONLY Author'}],year:2025,kind:'paper',identifiers:{},provenance:[],identity:{status:'unverified',method:'none'},textAccess:'metadata'})
  await mutateLedger(io,current.ledger.revision,ledger=>{ledger.sources.src_a=source('src_a','sf_a');ledger.sources.src_b=source('src_b','sf_b')})
  let state=await snapshot(io);const text='# TEST_ONLY 文稿\n\n正文[@sf_b; @sf_a]。\n'
  assert.equal(citationPresentation(text,state.ledger,'gbt7714').references.length,2,'Similar titles alone do not merge records')
  await mutateLedger(io,state.ledger.revision,ledger=>{ledger.sources.src_b.bibliographySourceId='src_a'})
  state=await snapshot(io);await saveManual(io,text,state.document.contentHash,state.ledger.revision);state=await snapshot(io)
  const presentation=citationPresentation(text,state.ledger,'gbt7714');assert.equal(presentation.labels['sf_b;sf_a'],'[1]');assert.equal(presentation.references.length,1)
  assert.equal(citationPresentation(text,state.ledger,'apa7').references.length,1)
  assert.match(canonicalCitationText(text,presentation.keyMap),/\[@sf_a\]/u)
  assert.equal((bibliography(text,state.ledger,true).match(/@article\{/gu)??[]).length,1)
  const plan=await prepareDelivery(io,'docx');await createDelivery(io,plan,'working-draft',state.ledger.revision)
  state=await snapshot(io);const delivered=await readDelivery(io,Object.keys(state.ledger.deliveries)[0])
  const exported=delivered.files.find(row=>row.relativePath==='paper.md')!;assert.equal('text' in exported&&exported.text,canonicalCitationText(text,presentation.keyMap))
  assert.equal(state.document.text,text);assert.equal(Object.keys(state.ledger.sources).length,2)
})
test('SF-162: completed draft checklist ignores old interruption logs and deduplicates source checks',async()=>{
  const spec=creationSpec.parse({title:'TEST_ONLY',requirements:'TEST_ONLY 写作要求',type:'course-paper',language:'zh-CN',format:'docx',targetLength:1500,materials:[],sections:[{id:'section_a',title:'第一章',targetLength:1500}],online:false,manuscriptDir:'manuscript'})
  const task=writingTaskSchema.parse({schemaVersion:1,id:'writing_test',projectId:'prj_test',sessionId:'session_test',mode:'first-draft',status:'completed',stage:'completed',revision:1,spec,materialIndex:0,sectionIndex:1,usedModelCalls:0,usedSearchQueries:0,elapsedMs:0,owner:'TEST_ONLY',expectedDocumentHash:'sha256:'+'0'.repeat(64),questions:[],notes:['本次执行未完成：旧问题'],issues:[],onlineSources:[],createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'})
  const source=(id:string)=>sourceSchema.parse({id,citeKey:'sf_'+id,title:'TEST_ONLY '+id,authors:[],kind:'paper',identifiers:{},provenance:[],identity:{status:'unverified',method:'none'},textAccess:'metadata'})
  const rows=draftChecklist(task,{document:{text:manuscript+'\n引用[@sf_a; @sf_b]。'},config:{materials:{include:[]}},ledger:{sources:{a:source('a'),b:source('b')},materials:{},reviewIssues:{}}})
  assert.equal(rows.length,1);assert.equal(rows[0].key,'source-identity');assert.equal(rows[0].detail.includes('旧问题'),false)
})
