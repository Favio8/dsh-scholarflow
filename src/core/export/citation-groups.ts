import type {Source,Ledger} from '../../shared/schema.ts'
import {projectMarkdown} from '../editing/markdown.ts'
import {apaLabels,apaReferences} from './apa.ts'
import {gbt7714Entry,plainEntry} from './citations.ts'

const doi=(source:Source)=>{const value=source.identifiers.doi?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu,'').toLowerCase();return value&&/^10\.\d{4,9}\/\S+$/u.test(value)?value:undefined}
const completeness=(source:Source)=>source.authors.length+(source.year?2:0)+(source.venue?2:0)+(doi(source)?4:0)
export function bibliographyGroups(ledger:Pick<Ledger,'sources'>){
  const all=Object.values(ledger.sources),byId=new Map(all.map(row=>[row.id,row])),groups=new Map<string,Source[]>(),keyMap:Record<string,string>={},sourceMap:Record<string,Source>={}
  const root=(source:Source)=>source.bibliographySourceId?byId.get(source.bibliographySourceId)??source:source
  const groupKey=(source:Source)=>{const row=root(source);return doi(row)?'doi:'+doi(row):row.id}
  for(const source of all){const key=groupKey(source),records=groups.get(key)??[],primary=root(source);if(!records.some(row=>row.id===source.id))records.push(source);if(primary!==source&&!records.some(row=>row.id===primary.id))records.push(primary);groups.set(key,records)}
  const canonical=new Map([...groups].map(([key,rows])=>[key,rows.find(row=>rows.some(child=>child.bibliographySourceId===row.id))??[...rows].sort((a,b)=>completeness(b)-completeness(a))[0]]))
  for(const source of all){sourceMap[source.id]=canonical.get(groupKey(source))!;keyMap[source.citeKey]=sourceMap[source.id].citeKey}
  return {groups:[...groups].map(([key,records])=>({source:canonical.get(key)!,records})),keyMap,sourceMap}
}
export function citationGroups(text:string,ledger:Pick<Ledger,'sources'>){
  const {groups,keyMap}=bibliographyGroups(ledger),byKey=new Map(groups.map(row=>[row.source.citeKey,row.source])),projection=projectMarkdown(text)
  const sources:Source[]=[]
  for(const key of projection.citationOrder){const source=byKey.get(keyMap[key]);if(source&&!sources.some(row=>row.id===source.id))sources.push(source)}
  return {sources,keyMap}
}
export function bibliographyCandidates(ledger:Pick<Ledger,'sources'>){
  const {groups}=bibliographyGroups(ledger),title=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu,'')
  const candidates=new Map<string,typeof groups>()
  for(const group of groups){const key=title(group.source.title);if(key)candidates.set(key,[...(candidates.get(key)??[]),group])}
  return [...candidates.values()].filter(rows=>rows.length>1&&new Set(rows.map(row=>doi(row.source)).filter(Boolean)).size<=1&&
    new Set(rows.map(row=>row.source.year).filter(Boolean)).size<=1)
}
export function canonicalCitationText(text:string,keyMap:Record<string,string>){
  for(const leaf of projectMarkdown(text).leaves.filter(row=>row.citationKeys).reverse()){
    const keys=[...new Set(leaf.citationKeys!.map(key=>keyMap[key]??key))]
    text=text.slice(0,leaf.start)+'['+keys.map(key=>'@'+key).join('; ')+']'+text.slice(leaf.end)
  }
  return text
}
export function citationPresentation(text:string,ledger:Pick<Ledger,'sources'>,style:string){
  const {sources,keyMap}=citationGroups(text,ledger),labels:Record<string,string>={},clusters=projectMarkdown(text).leaves.filter(row=>row.citationKeys).map(row=>row.citationKeys!)
  const apa=style==='apa7'?apaLabels(canonicalCitationText(text,keyMap),sources):undefined
  for(const keys of clusters){if(!keys.every(key=>keyMap[key]))continue;const mapped=[...new Set(keys.map(key=>keyMap[key]??key))];labels[keys.join(';')]=apa?apa[mapped.join(';')]:`[${mapped.map(key=>sources.findIndex(source=>source.citeKey===key)+1).join(', ')}]`}
  const references:Array<[string,string]>=style==='apa7'?apaReferences(sources):sources.map((source,index)=>[source.citeKey,style==='gbt7714'?gbt7714Entry(source,index+1):plainEntry(source,index+1)])
  return {sources,keyMap,labels,references}
}
