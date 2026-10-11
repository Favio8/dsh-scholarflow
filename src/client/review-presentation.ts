import {bibliographyGroups} from '../core/export/citation-groups.ts'
import {pendingModelReviewDetails} from '../shared/review.ts'

/** One current, readable result shared by the check page and the manuscript checklist. */
export function reviewItems(project:any){
  const {sourceMap}=bibliographyGroups(project.ledger)
  const sources=Object.values(project.ledger.sources) as any[]
  const names=[...sources.flatMap(source=>[[source.id,sourceMap[source.id].title],[source.citeKey,sourceMap[source.id].title]]),...(project.ledger.outline?.sections??[]).map((row:any)=>[row.id,row.title]),...(Object.values(project.ledger.claims??{}) as any[]).map(row=>[row.id,row.text]),...(Object.values(project.ledger.requirements??{}) as any[]).map(row=>[row.id,row.description])]
  const readable=(value:string)=>names.reduce((text,[id,title])=>text.replaceAll(id,`「${title}」`),value)
  const items=new Map<string,any>()
  for(const issue of Object.values(project.ledger.reviewIssues) as any[]){
    if(issue.stale||issue.documentHash!==project.document.contentHash||['resolved','dismissed'].includes(issue.state))continue
    const source=sources.find(row=>issue.title.includes(row.id)),identity=!!source&&issue.title.includes('元数据身份状态')
    const pendingModel=issue.checkMethod==='model-assisted'&&!issue.location&&(Object.values(pendingModelReviewDetails) as string[]).includes(issue.title)
    const missingEvidence=source&&issue.category==='evidence'&&issue.title.includes('可定位证据')
    const requirement=issue.requirementIds?.map((id:string)=>project.ledger.requirements?.[id]).find(Boolean)
    const key=identity?`identity:${sourceMap[source.id].id}`:pendingModel?'model-pending':missingEvidence?`evidence:${sourceMap[source.id].id}`:`issue:${issue.id}`
    const existing=items.get(key)
    if(existing){existing.issueIds.push(issue.id);if(identity&&source.identity.status==='mismatch'){existing.title='参考文献出版信息不一致';existing.detail=`「${sourceMap[source.id].title}」的出版信息与记录不一致，请查看原始资料。`}continue}
    const title=identity?source.identity.status==='mismatch'?'参考文献出版信息不一致':'参考文献出版信息待核对':pendingModel?'AI 内容检查尚未完成':missingEvidence?'引用缺少可核对的原文':requirement?'核对写作要求':readable(issue.title)
    const detail=identity?source.identity.status==='mismatch'?`「${sourceMap[source.id].title}」的出版信息与记录不一致，请查看原始资料。`:`「${sourceMap[source.id].title}」的出版信息尚未确认。可在资料中查看并核对。`:pendingModel?'论证、文风和跨章节一致性尚未完成检查。':missingEvidence?`「${sourceMap[source.id].title}」缺少当前可核对的原文片段，请补充全文或重新读取资料。`:requirement?requirement.description+'。'+(issue.explanation.match(/实际计数／比例：[^。]+。/u)?.[0]??'这项要求还需要确认。'):readable(issue.explanation)
    items.set(key,{key,title,detail,issue,issueIds:[issue.id],sourceId:source?.id,identity,
      method:issue.checkMethod==='model-assisted'?'AI 检查':issue.checkMethod==='manual'?'需要资料确认':'规则检查'})
  }
  return [...items.values()]
}
