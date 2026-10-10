/** Zod issues may arrive locally or as a JSON message from the bridge. Neither is UI copy. */
export function creationErrorMessage(error: unknown): string {
  const failure = error as { message?: string; issues?: { path?: unknown[] }[] }
  const message = failure?.message ?? String(error ?? '')
  let issues = failure?.issues
  if (!issues) {
    try {
      const parsed = JSON.parse(message.replace(/^[A-Z_]+:\s*/, ''))
      if (Array.isArray(parsed) && parsed.every(issue => issue && Array.isArray(issue.path))) issues = parsed
    } catch { /* A normal service message is already readable. */ }
  }
  if (issues) {
    const labels: Record<string, string> = { title: '论文题目', requirements: '写作要求',
      requirementSources: '要求来源', sections: '章节结构', targetLength: '目标篇幅', materials: '参考材料', manuscriptDir: '输出目录' }
    const fields = [...new Set(issues.map(issue => labels[String(issue.path?.[0])] ?? '创建信息'))]
    return `请检查${fields.join('、')}，修正后重试；已填写的内容会保留。`
  }
  return message.replace(/^[A-Z_]+:\s*/, '') || '操作未完成，请重试；已填写的内容会保留。'
}
