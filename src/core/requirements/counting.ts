import type { Requirement, Source } from '../../shared/schema.ts'

export function requirementCount(requirement: Requirement, count: { chineseCharacters: number; westernWords: number }, cited: Source[]): { actual?: number; detail: string } {
  const rule = requirement.constraint
  if (requirement.confirmation !== 'confirmed' || !rule) return { detail: '尚未确认计数约束。' }
  if (requirement.kind === 'length') {
    if (rule.countingPolicyId === 'sf-body-han-plus-western-v1') return { actual: count.chineseCharacters + count.westernWords,
      detail: `按 sf-body-han-plus-western-v1：${count.chineseCharacters} 汉字 + ${count.westernWords} 西文词元；排除参考文献、代码和公式。` }
    if (rule.countingPolicyId === 'sf-body-han-western-v1' && ['zh-characters', 'words'].includes(rule.unit ?? '')) return {
      actual: rule.unit === 'zh-characters' ? count.chineseCharacters : count.westernWords, detail: `按 ${rule.countingPolicyId} 的 ${rule.unit} 检查；排除参考文献、代码和公式。` }
    return { detail: '篇幅统计口径未确认或当前不支持。' }
  }
  if (requirement.kind !== 'references') return { detail: '此项不是确定性篇幅／引用计数。' }
  if (!rule.windowStart && !rule.windowEnd && rule.unit === 'items') return { actual: cited.length, detail: `分母／总量为正文实际使用的 ${cited.length} 个可解析唯一来源；不计搜索候选。` }
  const policy = rule.operator === 'ratio' ? 'sf-cited-year-window-ratio-v1' : 'sf-cited-year-window-v1'
  if (rule.countingPolicyId !== policy || !rule.windowStart || !rule.windowEnd || !/^\d{4}$/u.test(rule.windowStart) || !/^\d{4}$/u.test(rule.windowEnd) ||
    Number(rule.windowStart) > Number(rule.windowEnd)) return { detail: '引用年份窗口和分母口径尚未明确确认。' }
  const missing = cited.filter(source => source.year === undefined).length
  const matched = cited.filter(source => source.year !== undefined && source.year >= Number(rule.windowStart) && source.year <= Number(rule.windowEnd)).length
  const detail = `${policy}：年份窗口 ${rule.windowStart}–${rule.windowEnd}（含两端）；窗口内 ${matched}；分母为正文实际使用的 ${cited.length} 个唯一来源；缺失年份 ${missing}。元数据年份不代表出版身份已核验。`
  if (missing || rule.operator === 'ratio' && !cited.length) return { detail: detail + ' 结果未知，不能用当前年份填补。' }
  return { actual: rule.operator === 'ratio' ? matched / cited.length * 100 : matched, detail }
}
