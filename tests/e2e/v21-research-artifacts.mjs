// Complete only the artifact check after the controlled research Host scenario.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {digest} from '../../src/core/store/files.ts'
const root=resolve(process.argv[2]);assert(root.startsWith(resolve('.dsh-tmp/v21-host')+'\\'))
const workspace=join(root,'Workspace TEST_ONLY'),pointer=JSON.parse(await readFile(join(workspace,'.scholarflow/task-delivery/current.json'),'utf8')),task=JSON.parse(await readFile(join(workspace,`.scholarflow/task-delivery/${pointer.taskId}/task.json`),'utf8'))
assert.equal(task.model.providerId,'TEST_ONLY');assert.equal(task.phase,'finished');const directory=join(workspace,'manuscript/exports',task.deliveryId),manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'))
for(const file of manifest.files){const bytes=await readFile(join(directory,file.relativePath));assert.equal(digest(bytes),file.hash);assert.equal(bytes.length,file.sizeBytes)}
assert.equal(digest(await readFile(join(workspace,'manuscript/paper.md'))),manifest.documentHash)
const tex=await readFile(join(directory,'paper.tex'),'utf8'),bib=await readFile(join(directory,'references.bib'),'utf8'),support=JSON.parse(await readFile(join(directory,'research-support.json'),'utf8'))
assert(tex.includes('85.0'));assert.equal(bib.split(/\r?\n/u).filter(line=>line.trim()&&!line.trim().startsWith('%')).length,0);assert.equal(support.documentHash,manifest.documentHash);assert.equal(support.experiments[0].measurements[0].measurement.value,'85.0');assert(!manifest.files.some(file=>file.relativePath==='results.csv'))
const result={passed:true,deliveryId:task.deliveryId,files:manifest.files,paidModelCalls:0,realQuality:'not tested; TEST_ONLY measurements and controlled model',scope:'actual same-snapshot LaTeX/support artifact verification only; prior successful Host stages not replayed',priorFailure:'test expected empty bibliography instead of accepting its honest no-citations comment; original report retained'}
await writeFile(join(root,'research-artifacts-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
