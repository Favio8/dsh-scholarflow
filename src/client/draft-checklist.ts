import {projectMarkdown,textOf} from '../core/editing/markdown.ts'
import type {WritingTask} from '../shared/writing-task.ts'

export function draftChecklist(task:WritingTask,project:any){
  const rows:Array<{key:string;title:string;detail:string;page:'Draft'|'Research'|'Review'|'Overview';sectionId?:string}>=[]
  const document=project?.document,ledger=project?.ledger
  if(!document||!ledger)return rows
  for(const block of projectMarkdown(document.text).blocks){const text=textOf(block.node)
    if(text.includes('[待补：')||text.includes('[待补:')){const issue=task.deferredIssues.find(row=>row.sectionId&&text.includes(row.message));const section=issue&&task.spec.sections.find(row=>row.id===issue.sectionId)
      rows.push({key:block.id,title:section?.title??'正文有待补内容',detail:text,page:'Draft',sectionId:section?.id})}
  }
  const sources=Object.values(ledger.sources) as any[],unknown=sources.filter(row=>row.identity.status==='unverified'||row.identity.status==='unavailable')
  if(!ledger.requirements?.writing_brief||ledger.requirements.writing_brief.description===task.spec.requirements){
    const questions=[...new Set(task.deferredIssues.filter(row=>row.kind==='requirements'&&!task.questions.some(question=>question.title===row.message&&question.answered)).map(row=>row.message))]
    questions.forEach((detail,index)=>rows.push({key:`requirements_${index}`,title:'确认写作要求',detail,page:'Overview'}))
  }
  if(unknown.length)rows.push({key:'source-identity',title:'核对参考来源',detail:`${unknown.length} 份来源的出版信息尚需核对。`,page:'Research'})
  const partial=(Object.values(ledger.materials) as any[]).filter(row=>project.config.materials.include.includes(row.projectRelativePath)&&['partial','failed','unsupported'].includes(row.parseStatus))
  if(partial.length)rows.push({key:'material-coverage',title:'检查资料读取范围',detail:`${partial.length} 份资料未完整读取，可查看原文或补充内容。`,page:'Research'})
  for(const issue of Object.values(ledger.reviewIssues) as any[])if(!issue.stale&&issue.documentHash===document.contentHash&&!['resolved','dismissed'].includes(issue.state))
    rows.push({key:issue.id,title:issue.title,detail:issue.explanation,page:'Review'})
  return rows
}
