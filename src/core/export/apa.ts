import {Cite} from '@citation-js/core'
import '@citation-js/plugin-csl'
import type {Source} from '../../shared/schema.ts'
import {projectMarkdown} from '../editing/markdown.ts'

export function sourceCsl(source:Source){return {id:source.citeKey,type:source.kind==='paper'&&source.bibliography?.publicationType==='conference-paper'?'paper-conference':source.kind==='paper'?'article-journal':source.kind==='book'?'book':source.kind==='dataset'?'dataset':'webpage',
  title:source.title,author:source.authors.map(({literal,family,given})=>family?{family,...(given&&{given})}:{literal}),
  ...(source.year&&{issued:{'date-parts':[[source.year]]}}),...(source.venue&&{'container-title':source.venue}),
  ...(source.identifiers.doi&&{DOI:source.identifiers.doi}),...(source.identifiers.url&&{URL:source.identifiers.url}),
  ...(source.bibliography&&Object.fromEntries(Object.entries(source.bibliography).filter(([key])=>key!=='publicationType').map(([key,value])=>[({pages:'page',publisherPlace:'publisher-place'} as Record<string,string>)[key]??key,value])))}}
export function apaReferences(sources:Source[]){
  if(!sources.length)return [] as Array<[string,string]>
  return (new Cite(sources.map(sourceCsl)).format('bibliography',{style:'apa',format:'text',asEntryArray:true}) as Array<[string,string]>).map(([id,text])=>[id,text.trim()] as [string,string])
}
export function apaLabels(text:string,sources:Source[]){
  const cite=new Cite(sources.map(sourceCsl)),clusters=[...new Map(projectMarkdown(text).leaves.filter(leaf=>leaf.citationKeys).map(leaf=>[leaf.citationKeys!.join(';'),leaf.citationKeys!])).values()]
  const labels:Record<string,string>={}
  for(const keys of [...sources.map(source=>[source.citeKey]),...clusters]) if(keys.every(key=>sources.some(source=>source.citeKey===key)))
    labels[keys.join(';')]=cite.format('citation',{style:'apa',format:'text',entry:keys,citationsPre:sources.filter(source=>!keys.includes(source.citeKey)).map(source=>[source.citeKey]),citationsPost:[]})
  return labels
}
export function publicationMarkdown(text:string,labels?:Record<string,string>){
  const leaves=projectMarkdown(text).leaves.filter(leaf=>leaf.citationKeys)
  for(const leaf of leaves.reverse()) text=text.slice(0,leaf.start)+(labels?.[leaf.citationKeys!.join(';')]??leaf.text)+text.slice(leaf.end)
  return text
}
