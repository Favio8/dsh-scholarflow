import type { Ledger, ProjectConfig } from '../shared/schema.ts'
import type { CreationSpec, WritingTask } from '../shared/writing-task.ts'
import type { ReviewReport } from '../shared/review.ts'
import { reviewItems } from './review-presentation.ts'

export type FlowNodeId = 'requirements' | 'materials' | 'outline' | 'draft' | 'review'
export type FlowState = 'pending' | 'completed' | 'running' | 'paused' | 'attention' | 'stale'
export type ReviewActivity = 'running' | 'paused' | 'stopped' | 'failed'
export type FlowNode = { id: FlowNodeId; title: string; state: FlowState; label: string; detail: string }
export type FlowReview = { report?: ReviewReport; stale?: boolean; error?: string }
type Project = { ledger: Ledger; config: ProjectConfig; document: { contentHash: string; initialPlaceholder: boolean; externalChange: boolean } }
const taskNode: Record<WritingTask['stage'], FlowNodeId> = {
  materials: 'materials', research: 'materials', evidence: 'materials', outline: 'outline', drafting: 'draft', review: 'review', completed: 'draft',
}

/** A read-only projection of current artifacts. Visiting a page never completes a step. */
export function flowNodes(project: Project, options: { task?: WritingTask; spec?: CreationSpec; review?: FlowReview; dirty?: boolean; reviewActivity?: ReviewActivity } = {}): FlowNode[] {
  const { ledger, config, document } = project, { task, spec, review, dirty, reviewActivity } = options
  const nodes: FlowNode[] = [
    { id: 'requirements', title: '写作要求', state: 'pending', label: '待填写', detail: '填写并保存本次写作要求。' },
    { id: 'materials', title: '资料', state: 'pending', label: '未添加', detail: '查看本次选用的资料与引用。' },
    { id: 'outline', title: '大纲', state: 'pending', label: '待规划', detail: '规划并确认论文的章节结构。' },
    { id: 'draft', title: '正文', state: 'pending', label: '待开始', detail: '当前尚无已保存的正文。' },
    { id: 'review', title: '检查', state: 'pending', label: '待检查', detail: '检查当前正文、资料与引用。' },
  ]
  const update = (id: FlowNodeId, state: FlowState, label: string, detail: string) => Object.assign(nodes.find(node => node.id === id)!, { state, label, detail })
  const requirements = Object.values(ledger.requirements)
  if (requirements.some(row => row.confirmation !== 'confirmed')) update('requirements', 'attention', '待确认', '写作要求中有尚未确认或冲突的条目。')
  else if (requirements.length || spec?.requirements.trim()) update('requirements', 'completed', '已确认', '写作要求已保存，可查看与调整。')

  const selected = config.materials.include, excluded = config.materials.exclude
  const materials = Object.values(ledger.materials).filter(row => selected.includes(row.projectRelativePath) && !excluded.includes(row.projectRelativePath))
  if (materials.some(row => ['partial', 'unsupported', 'failed', 'stale'].includes(row.parseStatus)))
    update('materials', 'attention', '待处理', '选用资料中有未完整读取、读取失败或已更新的文件。')
  else if (materials.some(row => ['queued', 'parsing'].includes(row.parseStatus))) update('materials', 'running', '读取中', '正在读取所选资料。')
  else if (selected.length && materials.length === selected.length && materials.every(row => row.parseStatus === 'ready'))
    update('materials', 'completed', '已读取', `已读取 ${materials.length} 份选用资料。`)
  else if (selected.length) update('materials', 'pending', '待读取', '所选资料尚未全部读取。')
  else if (Object.keys(ledger.sources).length) update('materials', 'completed', '已有来源', '已登记参考来源，可查看原文与引用信息。')

  if (ledger.outline.sections.length) update('outline', ledger.outline.confirmation === 'confirmed' ? 'completed' : 'attention',
    ledger.outline.confirmation === 'confirmed' ? '已确认' : '待确认', `${ledger.outline.sections.length} 个章节；打开章节结构可查看与调整。`)
  if (!document.initialPlaceholder) update('draft', 'completed', '已有正文', '已保存正文，可继续编辑或预览。')
  if (task?.status === 'completed' && task.expectedDocumentHash === document.contentHash && !document.initialPlaceholder)
    update('draft', task.outcome === 'draft-with-gaps' ? 'attention' : 'completed', task.outcome === 'draft-with-gaps' ? '有待补项' : '已生成',
      task.outcome === 'draft-with-gaps' ? '初稿已生成，仍有待补内容。' : '初稿已生成；检查结果由检查节点单独显示。')

  if (review?.error) update('review', 'attention', '读取未完成', review.error)
  else if (review?.report) {
    if (dirty || review.stale || review.report.documentHash !== document.contentHash || document.externalChange)
      update('review', 'stale', '需复查', '正文或资料已更新，已有检查对应先前版本。')
    else {
      const issues = reviewItems(project), unknown = review.report.checks.some(check => check.status === 'unknown')
      const failed = review.report.checks.some(check => check.status === 'fail')
      if (issues.length || failed || unknown || !review.report.checks.length)
        update('review', 'attention', failed || issues.length ? '待处理' : '待核对', '检查仍有未解决问题或尚未判断的项目。')
      else update('review', 'completed', '已检查', '当前版本已完成本次检查，没有待处理检查项。')
    }
  }

  if (task && task.status !== 'completed') {
    const node = taskNode[task.stage]
    if (['running', 'queued'].includes(task.status)) update(node, 'running', task.status === 'queued' ? '准备中' : '进行中',
      ({ materials: '正在读取资料。', research: '正在检索公开文献。', evidence: '正在整理证据与引用。', outline: '正在规划章节内容。', drafting: '正在撰写正文。', review: '正在检查全文。', completed: '正在保存任务结果。' })[task.stage])
    else update(node, task.status === 'failed' || task.status === 'waiting-input' ? 'attention' : 'paused',
      ({ failed: '未完成', 'waiting-input': '待处理', interrupted: '已中断', cancelled: '已停止', paused: '已暂停' } as Record<string, string>)[task.status],
      '查看对应页面或运行记录，继续处理当前任务。')
  }
  if (reviewActivity) update('review', reviewActivity === 'running' ? 'running' : reviewActivity === 'failed' ? 'attention' : 'paused',
    ({ running: '检查中', paused: '已暂停', stopped: '已停止', failed: '未完成' })[reviewActivity], '查看检查页面中的当前结果与操作。')
  return nodes
}
