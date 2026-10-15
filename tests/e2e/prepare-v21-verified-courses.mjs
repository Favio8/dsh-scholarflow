// Finalize self-defined course tasks with exact primary-paper editions and Crossref metadata.
import assert from 'node:assert/strict'
import {readFile,writeFile,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {digest,json} from '../../src/core/store/files.ts'
const root=resolve(process.argv[2]);assert(root.startsWith(resolve('.dsh-tmp/v21-real-inputs')+'\\'))
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));await writeFile(join(root,'manifest-before-course-finalization.json'),json(manifest))
const papers=[manifest.papers.find(row=>row.id==='gfs'),{id:'dynamo',title:'Dynamo: Amazon’s Highly Available Key-value Store',doi:'10.1145/1294261.1294281',year:2007,url:'https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf',file:'dynamo.pdf'},
{id:'paxos',title:'The Part-Time Parliament',doi:'10.1145/279227.279229',year:1998,url:'https://lamport.azurewebsites.net/pubs/lamport-paxos.pdf',file:'paxos.pdf'}]
for(const paper of papers){if(!paper.hash){const response=await fetch(paper.url,{signal:AbortSignal.timeout(30000)});assert(response.ok);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');paper.hash=digest(bytes);await writeFile(join(root,'sources',paper.file),bytes)}
  const response=await fetch('https://api.crossref.org/works/'+encodeURIComponent(paper.doi),{signal:AbortSignal.timeout(30000)});assert(response.ok);const data=(await response.json()).message,title=[data.title[0],...(data.subtitle??[])].filter(Boolean).join(': ');assert(title.toLowerCase().replace(/[^a-z0-9]/g,'')===paper.title.toLowerCase().replace(/[^a-z0-9]/g,''));paper.title=title;paper.authors=data.author.map(row=>[row.given,row.family].filter(Boolean).join(' '));paper.metadata={title:paper.title,authors:paper.authors,year:paper.year,doi:paper.doi,provider:'Crossref',retrievedAt:new Date().toISOString()}}
for(const [index,row]of manifest.course.entries()){
  row.paperIds=index<2?['gfs']:index<4?['gfs','dynamo']:['gfs','dynamo','paxos'];row.allowedPapers=papers.filter(p=>row.paperIds.includes(p.id));row.title=row.id+' Distributed systems analysis'
  const question=index<2?'Analyze how the Google File System paper connects workload assumptions, architecture and consistency limitations.':index<4?'Develop a scoped case analysis of GFS and Dynamo. Explain how workload and failure assumptions lead to different design choices and consistency trade-offs.':'Synthesize GFS, Dynamo and The Part-Time Parliament. Compare the distinct workload/failure assumptions and roles of consistency, availability and consensus. Distinguish a proof-based protocol from deployed-system measurements; do not imply that the papers evaluate identical workloads.'
  row.requirements=question+' Self-defined real validation assignment: 450 English body words, accepted 405–495 range, three substantive sections, exact real references, no invented experiments. Word output; no mandatory cover or page count. Analyze only actually read original text; figure contents and formal proof checking are outside the parser scope. '+(row.id.endsWith('limited')?'Start from limited bibliographic material and obtain the missing original text under the explicit approved source scope before claiming its content.':'The selected original papers are available in full text.')
  row.selected=row.id.endsWith('limited')?(index===1?[]:['gfs.pdf']):row.allowedPapers.map(p=>p.file)
  for(const paper of row.allowedPapers)await copyFile(join(root,'sources',paper.file),join(row.directory,paper.file))
  await writeFile(join(row.directory,'requirements.txt'),row.requirements);await writeFile(join(row.directory,'case.json'),json(row))
}
manifest.papers=papers;manifest.courseFinalizedAt=new Date().toISOString();await writeFile(join(root,'manifest.json'),json(manifest));console.log(JSON.stringify({root,papers:papers.map(p=>({id:p.id,doi:p.doi,title:p.title})),courses:manifest.course.length,modelCalls:0}))
