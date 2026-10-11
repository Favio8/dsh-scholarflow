import {projectMarkdown,citationKeys,textOf} from '../editing/markdown.ts'
import {invariant} from '../../shared/errors.ts'
import type {Ledger} from '../../shared/schema.ts'

export function cowriteContext(text:string,start:number,end:number,base:Record<string,unknown>,ledger:Ledger,limits:{contextWindow:number;maxOutputTokens?:number},overhead:string){
  const target=text.slice(start,end),projection=projectMarkdown(text),keys=citationKeys(target)
  const relatedSources=Object.values(ledger.sources).filter(source=>keys.includes(source.citeKey))
  const relatedEvidence=Object.values(ledger.evidence).filter(evidence=>relatedSources.some(source=>source.id===evidence.sourceId)&&evidence.validation==='located')
  const context={...base,target,manuscript:text,sources:relatedSources,evidence:relatedEvidence,contextScope:'full-manuscript'}
  const tokens=(value:unknown)=>Math.ceil(Buffer.byteLength(JSON.stringify(value))/3)
  const targetTokens=Math.ceil(Buffer.byteLength(target)/3),output=limits.maxOutputTokens??Math.ceil(targetTokens*1.8)+512,available=limits.contextWindow-output-tokens(overhead)-1000
  invariant(limits.maxOutputTokens===undefined||targetTokens<limits.maxOutputTokens-256,'COWRITE_TARGET_TOO_LARGE',`所选范围约 ${targetTokens} 个输入词元，超过当前模型单次输出容量 ${limits.maxOutputTokens}。请按章节或段落改写。`)
  if(tokens(context)<=available)return {context,inputBytes:Buffer.byteLength(JSON.stringify(context)),scope:'full-manuscript' as const}
  const nodes=projection.tree.children??[],index=nodes.findIndex(node=>(node.position?.end.offset??0)>start)
  const from=nodes[Math.max(0,index-2)]?.position?.start.offset??start,to=nodes[Math.min(nodes.length-1,index+2)]?.position?.end.offset??end
  const ancestry:typeof nodes=[]
  for(const node of nodes.filter(node=>node.type==='heading'&&(node.position?.start.offset??0)<=start)){
    while(ancestry.length&&(ancestry.at(-1)!.depth??1)>=(node.depth??1))ancestry.pop();ancestry.push(node)
  }
  const nextHeading=nodes.find(node=>node.type==='heading'&&(node.position?.start.offset??0)>=end)
  const nearby={...context,manuscript:text.slice(Math.min(from,start),Math.max(to,end)),contextScope:'target-and-neighbors',
    manuscriptOutline:[...ancestry,...(nextHeading?[nextHeading]:[])].map(node=>({depth:node.depth,title:textOf(node)})),outlineScope:'section-ancestry-and-next-heading',sourceRange:{start,end},fullDocumentLength:text.length}
  invariant(tokens(nearby)<=available,'CONTEXT_WINDOW_EXCEEDED','目标正文、邻接段落、相关证据和项目规则超过当前模型上下文。请缩小改写范围或选择上下文更大的模型。')
  return {context:nearby,inputBytes:Buffer.byteLength(JSON.stringify(nearby)),scope:'target-and-neighbors' as const}
}
