import type {Source,Ledger} from '../../shared/schema.ts'
import {projectMarkdown} from '../editing/markdown.ts'
import {apaLabels,apaReferences} from './apa.ts'
import {gbt7714Entry,plainEntry} from './citations.ts'

const doi=(source:Source)=>{const value=source.identifiers.doi?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu,'').toLowerCase();return value&&/^10\.\d{4,9}\/\S+$/u.test(value)?value:undefined}
const completeness=(source:Source)=>source.authors.length+(source.year?2:0)+(source.venue?2:0)+(doi(source)?4:0)
export function citationGroups(text:string,ledger:Pick<Ledger,'sources'>){
  const all=Object.values(ledger.sources),byId=new Map(all.map(row=>[row.id,row])),projection=projectMarkdown(text),groups=new Map<string,Source[]>(),keyMap:Record<string,string>={}
  const root=(source:Source)=>source.bibliographySourceId?byId.get(source.bibliographySourceId)??source:source
  const groupKey=(source:Source)=>{const row=root(source);return doi(row)?'doi:'+doi(row):row.id}
  for(const source of all){const key=groupKey(source);groups.set(key,[...(groups.get(key)??[]),source]);const primary=root(source);if(primary!==source&&!groups.get(key)!.some(row=>row.id===primary.id))groups.get(key)!.push(primary)}
  const canonical=new Map([...groups].map(([key,rows])=>[key,rows.find(row=>rows.some(child=>child.bibliographySourceId===row.id))??[...rows].sort((a,b)=>completeness(b)-completeness(a))[0]]))
  for(const source of all)keyMap[source.citeKey]=canonical.get(groupKey(source))!.citeKey
  const sources:Source[]=[]
  for(const key of projection.citationOrder){const mapped=keyMap[key],source=all.find(row=>row.citeKey===mapped);if(source&&!sources.some(row=>row.id===source.id))sources.push(source)}
  return {sources,keyMap}
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
