import type { TaskIssue } from '../../shared/writing-task.ts'

/**
 * Task details by what they ask of the user (SPEC v1.2 §9). The old `notes: string[]` was
 * shown verbatim, which is how raw errors and repeated "全文未核验" lines became the main
 * content. Every note now becomes an issue with an object, an impact and — where one exists —
 * an action; technical text moves into a secondary detail field.
 */

export type IssueAction = TaskIssue['actions'][number]

const ACTION_PASTE: IssueAction = { label: '粘贴文字', op: 'paste-text' }
const ACTION_RETRY: IssueAction = { label: '重新读取', op: 'retry-read' }
const ACTION_RECONNECT: IssueAction = { label: '重新选择文件夹', op: 'reconnect-source' }
const ACTION_REMOVE: IssueAction = { label: '移除', op: 'remove-member' }
const ACTION_FULLTEXT: IssueAction = { label: '重试获取全文', op: 'retry-fulltext' }
const ACTION_MATERIALS: IssueAction = { label: '补充资料后继续', op: 'answer-materials' }
const ACTION_KEEP_GAP: IssueAction = { label: '保留待补并继续', op: 'answer-keep-gap' }

/** Recognises the closed set of situations the pipeline can raise, plus the legacy wording. */
export function classifyNote(note: string, at: string): TaskIssue {
  const trimmed = note.trim()
  const failure = /^(?<object>[^：]{1,200})：(?<reason>.+)$/.exec(trimmed)
  const object = failure?.groups?.object ?? '本次任务'
  const reason = failure?.groups?.reason ?? trimmed

  if (/^(?:待检查|AI 全文检查|要求检查|全文审查)：/.test(trimmed)) return issue({
    object, at, group: 'needs-action', what: reason.length > 160 ? reason.slice(0, 160) : reason,
    impact: '这是实际检查记录；查看依据并处理，未知不会当作通过。',
    actions: [{ label: '查看检查结果', op: 'view-review' }], detail: trimmed })

  if (/仅找到文献信息|未获得可读全文|未取得全文/.test(trimmed)) return issue({
    object, at, group: 'needs-action', what: '这篇补充文献暂未取得全文（目前只有文献信息）',
    impact: '依赖未见正文的论断不会被写入；其余分析继续使用已取得的材料。',
    actions: [ACTION_FULLTEXT, ACTION_REMOVE], detail: trimmed })
  if (/扫描|文字层|未提取到文字|图片未解析/.test(trimmed)) return issue({
    object, at, group: 'needs-action', what: '这个文件的扫描页没有文字层，未读到文字',
    impact: '其中的要求需要你补充后才会成为已确认要求。',
    actions: [ACTION_PASTE, ACTION_RETRY, ACTION_REMOVE], detail: trimmed })
  if (/授权|重新连接|句柄/.test(trimmed)) return issue({
    object, at, group: 'needs-action', what: '外部来源的读取授权已过期',
    impact: '该来源的内容本次不能读取；已确认的要求文字不受影响。',
    actions: [ACTION_RECONNECT, ACTION_REMOVE], detail: trimmed })
  if (/人工编辑|冲突/.test(trimmed)) return issue({
    object, at, group: 'needs-action', what: reason.length > 120 ? reason.slice(0, 120) : reason,
    impact: '只影响这一处生成目标；其他章节的编辑不会逐节打断你。',
    actions: [{ label: '保留人工内容，重新生成', op: 'resolve-conflict' }, { label: '稍后处理', op: 'defer-issue' }], detail: trimmed })
  if (/待补|缺口|没有可用于正文的定位证据|没有可用于正文的可读资料/.test(trimmed)) return issue({
    object, at, group: 'needs-action', what: '这一部分缺少可定位的证据，正文保留待补标记',
    impact: '保留待补说明缺口；不会把缺口写成已完成的结果。',
    actions: [ACTION_MATERIALS, ACTION_KEEP_GAP], detail: trimmed })
  if (/额度|预算|时限|轮次/.test(trimmed)) return issue({
    object, at, group: 'handled', what: '旧的额度提示已不再限制本次任务',
    impact: '调用次数与耗时只作为统计展示；完成条件来自实际工作与检查结果。',
    actions: [], detail: trimmed })
  if (/保留人工内容/.test(trimmed)) return issue({
    object, at, group: 'handled', what: '已保留你写的正文，未覆盖',
    impact: '这一节按人工内容处理，没有重复生成。', actions: [], detail: trimmed })
  if (/待检查|AI 全文检查/.test(trimmed)) return issue({
    object, at, group: 'needs-action', what: reason.length > 160 ? reason.slice(0, 160) : reason,
    impact: '这是模型辅助检查提出的问题，需要人工判断或修正；未知不能当作通过。',
    actions: [{ label: '查看检查结果', op: 'view-review' }], detail: trimmed })
  // Exception text, stack frames and protocol codes belong in the secondary detail: a reader
  // cannot act on "Error: ENOENT at Object.readFile", and it is not the product's words.
  if (looksTechnical(reason)) return issue({
    object, at, group: 'needs-action', what: `${object === '本次任务' ? '这次操作' : object}没有成功完成`,
    impact: '已产生的正文与已读到的内容都已保留；可以重试，或先处理下面写出的原因。',
    actions: [ACTION_RETRY], detail: trimmed })
  return issue({ object, at, group: 'needs-action', what: reason.length > 200 ? reason.slice(0, 200) : reason,
    impact: '这一项需要处理；处理后会移入「已处理」。', actions: [], detail: trimmed })
}

/** Recognises text that came from a runtime, not from a sentence written for the reader. */
export function looksTechnical(text: string) {
  return /\b(?:Error|TypeError|RangeError|SyntaxError|ENOENT|EACCES|ENOTDIR|EPERM)\b/.test(text)
    || /\bat\s+(?:Object|async|Node|Function)\b|node:internal|\/src\/|\.ts:\d+/.test(text)
    || /^[A-Z][A-Z_]{3,}$/.test(text.trim())
    || /status\s*\d{3}|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(text)
}

/** Issues are counted by where they point, so the same object never stacks up twice. */
export function issueKey(input: { object: string; what: string }) {
  return `${input.object}|${input.what}`.slice(0, 400)
}

function issue(input: { object: string; what: string; impact: string; actions: IssueAction[]; group: TaskIssue['group']; at: string; detail?: string }): TaskIssue {
  return { id: `issue_${hashOf(issueKey(input))}`, key: issueKey(input), group: input.group, object: input.object,
    what: input.what, impact: input.impact, actions: input.actions, ...(input.detail && { detail: input.detail }), occurrences: 1, at: input.at }
}

/** Small stable digest: the id only has to be reproducible for one project. */
function hashOf(text: string) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Same key merges into one row with an occurrence count; action-less duplicates stay one row. */
export function mergeIssue(issues: TaskIssue[], next: TaskIssue): TaskIssue[] {
  const index = issues.findIndex(row => row.key === next.key)
  if (index < 0) return [...issues, next].slice(-200)
  const existing = issues[index]
  const merged: TaskIssue = { ...existing, occurrences: existing.occurrences + 1, at: next.at,
    ...(next.detail && !existing.detail && { detail: next.detail }),
    group: existing.group === 'needs-action' ? 'needs-action' : next.group }
  return issues.map((row, at) => at === index ? merged : row)
}

export function mergeIssues(issues: TaskIssue[], incoming: TaskIssue[]): TaskIssue[] {
  return incoming.reduce((accumulator, row) => mergeIssue(accumulator, row), issues)
}

/** Legacy tasks store free text; it is mapped on read and never rewritten in place. */
export function mapLegacyNotes(notes: string[], at: string): TaskIssue[] {
  return notes.reduce<TaskIssue[]>((accumulator, note) => mergeIssue(accumulator, classifyNote(note, at)), [])
}

export function progressIssue(input: { object: string; what: string; impact: string; at: string }): TaskIssue {
  return issue({ ...input, group: 'in-progress', actions: [] })
}

export function handledIssue(input: { object: string; what: string; impact: string; at: string }): TaskIssue {
  return issue({ ...input, group: 'handled', actions: [] })
}

export function groupIssues(issues: TaskIssue[]) {
  return { needsAction: issues.filter(row => row.group === 'needs-action'),
    inProgress: issues.filter(row => row.group === 'in-progress'), handled: issues.filter(row => row.group === 'handled') }
}

/** Only issues that block a decision are worth a question; the rest stay in the detail list. */
export function blockingIssues(issues: TaskIssue[]) {
  return issues.filter(row => row.group === 'needs-action' && row.actions.length > 0)
}

/** Moving an issue on after its action succeeds keeps the list from re-asking. */
export function resolveIssue(issues: TaskIssue[], id: string, resolution: { what: string; impact: string; at: string }): TaskIssue[] {
  return mergeIssue(issues, issue({ ...resolution, object: issues.find(row => row.id === id)?.object ?? '本次任务', group: 'handled', actions: [] }))
}
