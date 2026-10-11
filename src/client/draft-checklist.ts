import {projectMarkdown,textOf} from '../core/editing/markdown.ts'
import type {WritingTask} from '../shared/writing-task.ts'
import {citationGroups} from '../core/export/citation-groups.ts'
import {reviewItems} from './review-presentation.ts'

export function draftChecklist(task:WritingTask,project:any){
  const rows:Array<{key:string;title:string;detail:string;page:'Draft'|'Research'|'Review'|'Overview';sectionId?:string}>=[]
  const document=project?.document,ledger=project?.ledger
  if(!document||!ledger)return rows
  for(const block of projectMarkdown(document.text).blocks){const text=textOf(block.node)
    if(text.includes('[待补：')||text.includes('[待补:')){const issue=task.deferredIssues.find(row=>row.sectionId&&text.includes(row.message));const section=issue&&task.spec.sections.find(row=>row.id===issue.sectionId)
      rows.push({key:block.id,title:section?.title??'正文有待补内容',detail:text,page:'Draft',sectionId:section?.id})}
  }
  const sources=citationGroups(document.text,ledger).sources,unknown=sources.filter(row=>row.identity.status==='unverified'||row.identity.status==='unavailable'),items=reviewItems(project)
  const identityCount=new Set([...unknown.map(row=>'identity:'+row.id),...items.filter(item=>item.identity).map(item=>item.key)]).size
  if(!ledger.requirements?.writing_brief||ledger.requirements.writing_brief.description===task.spec.requirements){
    const questions=[...new Set(task.deferredIssues.filter(row=>row.kind==='requirements'&&!task.questions.some(question=>question.title===row.message&&question.answered)).map(row=>row.message))]
    questions.forEach((detail,index)=>rows.push({key:`requirements_${index}`,title:'确认写作要求',detail,page:'Overview'}))
  }
  if(identityCount)rows.push({key:'source-identity',title:'核对参考文献',detail:`${identityCount} 篇文献的出版信息待核对。`,page:'Research'})
  const partial=(Object.values(ledger.materials) as any[]).filter(row=>project.config.materials.include.includes(row.projectRelativePath)&&['partial','failed','unsupported'].includes(row.parseStatus))
  if(partial.length)rows.push({key:'material-coverage',title:'检查资料读取范围',detail:`${partial.length} 份资料未完整读取，可查看原文或补充内容。`,page:'Research'})
  for(const item of items)if(!item.identity)
    rows.push({key:item.issue.id,title:item.title,detail:item.detail,page:'Review'})
  return rows
}
