import type { ModelReviewPlan } from '../../src/core/review/model.ts'
import { semanticReviewChecks } from '../../src/shared/review.ts'

export const firstParagraph = 'TEST_ONLY 第一段的判断缺少边界。引用[@sf_TEST_ONLY]。'
export const secondParagraph = 'TEST_ONLY 第二段的表达有些冗长，需要精简。'
export function improvementOutput(plan: ModelReviewPlan) {
  const first = plan.context.blocks.find(row => row.sourceText.includes(firstParagraph))!
  const second = plan.context.blocks.find(row => row.sourceText.includes(secondParagraph))!
  const ids = plan.context.semanticScope ? semanticReviewChecks : semanticReviewChecks.slice(0, 2)
  const finding = (blockId: string, quote: string, title: string, category: 'logic' | 'style', assessmentId: 'argument_assessment' | 'style_assessment') => ({
    blockId, quote, title, category, assessmentId, severity: 'B1' as const, explanation: 'TEST_ONLY 需要在当前段落保留事实并明确适用范围。',
    suggestedFix: 'TEST_ONLY 精简表达并保留原有引用和限定条件。', claimIds: [], evidenceIds: [], requirementIds: [],
  })
  return { checks: ids.map(id => ({ id, status: id === 'argument_assessment' || id === 'style_assessment' ? 'fail' as const : 'pass' as const,
    detail: 'TEST_ONLY 使用固定测试响应核对当前范围。' })), findings: [
    finding(first.id, 'TEST_ONLY 第一段的判断缺少边界。', 'TEST_ONLY 补充边界', 'logic', 'argument_assessment'),
    finding(first.id, 'TEST_ONLY 第一段的判断缺少边界。', 'TEST_ONLY 精简第一段', 'style', 'style_assessment'),
    finding(second.id, secondParagraph, 'TEST_ONLY 精简第二段', 'style', 'style_assessment'),
  ], rechecks: [], limitations: ['TEST_ONLY 固定模型响应，不代表论文质量验收。'] }
}
export function improvementText(text: string) {
  return text.includes(firstParagraph) ? text.replace('缺少边界', '可能只适用于当前范围') : text.replace('的表达有些冗长，需要精简', '的表达可以精简')
}
