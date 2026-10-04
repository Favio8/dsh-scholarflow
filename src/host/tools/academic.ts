import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { resolveStore, applicationResult } from '../bridge/project-api.ts'
import { snapshot } from '../../core/project/project.ts'
import { readParsed } from '../../core/materials/materials.ts'
import { newId } from '../../core/store/files.ts'
import { invariant } from '../../shared/errors.ts'
import { inspectReview, runReview } from '../../core/review/review.ts'
import { prepareDelivery } from '../../core/export/delivery.ts'
import { id } from '../../shared/schema.ts'
import { unicodeBoundary } from '../../core/editing/markdown.ts'
import { approvedMemory } from '../../core/project/memory.ts'

export const academicToolNames = ['scholar_project', 'scholar_materials', 'scholar_research', 'scholar_evidence', 'scholar_outline',
  'scholar_manuscript', 'scholar_review', 'scholar_skill', 'scholar_export'] as const
type Host = any
const actions = (values: readonly string[]) => z.enum(values as [string, ...string[]])
const offset = z.number().int().min(0).max(2 * 1024 * 1024).default(0)
// The tool caller cannot provide a root, workspace or session. Those facts come
// only from the actual executing Agent and the Host's current registrations.
async function boundStore(ctx: Host, exec: Host) {
  const sessionId = exec.agent?.session?.id
  invariant(sessionId, 'SESSION_BINDING_CHANGED', '学术工具必须在真实绑定的 ScholarFlow Agent 中执行。')
  const workspaces = ctx.workspaceRegistry.list().filter((workspace: Host) => workspace.sessionIds.includes(sessionId))
  invariant(workspaces.length === 1, 'SESSION_BINDING_CHANGED', '当前会话没有唯一工作区绑定。')
  return resolveStore(ctx, { requestId: newId('req'), sessionId, workspaceId: workspaces[0].id }, exec.signal)
}
export function academicDefinitions(ctx: Host) {
  const make = (name: typeof academicToolNames[number], allowed: readonly string[], description: string, parameters: any,
    schema: z.ZodType, execute: (args: any, io: Awaited<ReturnType<typeof boundStore>>['io']) => Promise<unknown>) => defineTool({
    name, description,
    parameters: { action: { type: 'string', required: true, enum: allowed, description: '允许的动作；不接受或授予用户确认。' }, ...parameters },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      return JSON.parse(JSON.stringify(await applicationResult(async () => {
        const input = schema.parse(args), { io } = await boundStore(ctx, exec)
        return execute(input, io)
      })))
    },
  })
  const simple = (values: readonly string[]) => z.object({ action: actions(values) }).strict()
  return [
    make('scholar_project', ['inspect', 'requirements', 'memory'], '查看当前项目、写作要求和已确认记忆；不能自定根目录、初始化或变更确认。', {}, simple(['inspect', 'requirements', 'memory']), async (args, io) => {
      const current = await snapshot(io)
      if (args.action === 'requirements') return { requirements: Object.values(current.ledger.requirements), ledgerRevision: current.ledger.revision }
      if (args.action === 'memory') return { memory: await approvedMemory(io, current.ledger.projectId), scope: 'current-project-only' }
      return { project: current.config.project, ledgerRevision: current.ledger.revision, documentHash: current.document.contentHash, revisionId: current.document.revisionId,
        externalChange: current.document.externalChange, outlineConfirmation: current.ledger.outline.confirmation, budget: current.config.workflow.budget,
        capabilities: { localMaterials: true, guardedProposals: true, deterministicReview: true, onlineResearch: false, privateSkillImport: false },
        nextStep: '在工作台确认要求、证据和大纲；正文候选和改写通过 Draft 的可见计划发起，主稿只由用户明确接受建议后改变。' }
    }),
    make('scholar_materials', ['list', 'read'], '列出已登记资料，分块读取实际解析内容；不会扫描未选资料或读取凭据。',
      { materialId: { type: 'string' }, blockIndex: { type: 'integer' }, charOffset: { type: 'integer' } },
      z.object({ action: actions(['list', 'read']), materialId: id.optional(), blockIndex: z.number().int().min(0).default(0), charOffset: offset }).strict(), async (args, io) => {
        const current = await snapshot(io)
        if (args.action === 'list') return { materials: Object.values(current.ledger.materials).filter(row => current.config.materials.include.includes(row.projectRelativePath)) }
        invariant(args.materialId, 'INVALID_REQUEST', '读取资料需要 materialId。')
        const parsed = await readParsed(io, args.materialId), block = parsed.blocks[args.blockIndex]
        invariant(block && args.charOffset <= block.text.length && unicodeBoundary(block.text, args.charOffset), 'MATERIAL_RANGE_INVALID', '资料文本范围无效。')
        let end = Math.min(block.text.length, args.charOffset + 12000)
        if (!unicodeBoundary(block.text, end)) end--
        return { materialId: args.materialId, sourceContentHash: parsed.sourceContentHash, coverage: parsed.coverage, locator: block.locator, blockIndex: args.blockIndex,
          totalBlocks: parsed.blocks.length, charOffset: args.charOffset, nextCharOffset: end < block.text.length ? end : null, text: block.text.slice(args.charOffset, end),
          warnings: [...parsed.warnings, '本次返回所选解析单元的分块；没有自动读取其余页面或未选资料。'] }
      }),
    make('scholar_research', ['sources'], '查看当前已登记来源的元数据、身份与文本访问状态。在线提供方尚未接入，不能假称搜索成功。', {}, simple(['sources']), async (_args, io) => {
      const current = await snapshot(io)
      return { sources: Object.values(current.ledger.sources).slice(0, 80), onlineResearch: 'unavailable', distinction: '登记或身份匹配不等于正文支持关系核验。' }
    }),
    make('scholar_evidence', ['list', 'read'], '查看论点及支持范围；读取已确认定位证据，不把模型摘录自行标记为已定位。', { evidenceId: { type: 'string' }, charOffset: { type: 'integer' } },
      z.object({ action: actions(['list', 'read']), evidenceId: id.optional(), charOffset: offset }).strict(), async (args, io) => {
        const current = await snapshot(io)
        if (args.action === 'list') return { claims: Object.values(current.ledger.claims).slice(0, 50), evidence: Object.values(current.ledger.evidence).slice(0, 50).map(({ excerpt, ...metadata }) => ({ ...metadata, excerptCharacters: excerpt.length })),
          limitations: ['列出的 validation 是登记状态；读取具体证据时重新检查实际资料版本。'] }
        const evidence = current.ledger.evidence[args.evidenceId ?? ''], source = evidence && current.ledger.sources[evidence.sourceId]
        invariant(evidence && source?.materialId && evidence.validation === 'located', 'EVIDENCE_NOT_CURRENT', '所选证据不可用或未定位。')
        const parsed = await readParsed(io, source.materialId)
        invariant(parsed.sourceContentHash === evidence.sourceContentHash && parsed.blocks.some(block => JSON.stringify(block.locator) === JSON.stringify(evidence.locator) && block.text.includes(evidence.excerpt)), 'EVIDENCE_NOT_CURRENT', '证据原文版本或位置已改变。')
        invariant(args.charOffset <= evidence.excerpt.length && unicodeBoundary(evidence.excerpt, args.charOffset), 'MATERIAL_RANGE_INVALID', '证据文本范围无效。')
        let end = Math.min(evidence.excerpt.length, args.charOffset + 12000); if (!unicodeBoundary(evidence.excerpt, end)) end--
        return { ...evidence, excerpt: evidence.excerpt.slice(args.charOffset, end), charOffset: args.charOffset, nextCharOffset: end < evidence.excerpt.length ? end : null,
          scope: 'located-excerpt-only', caveat: '原文定位通过不等于论点语义支持已经通过。' }
      }),
    make('scholar_outline', ['read'], '读取当前大纲版本和确认状态；不能替代用户确认要求或大纲。', {}, simple(['read']), async (_args, io) => {
      const current = await snapshot(io); return { outline: current.ledger.outline, ledgerRevision: current.ledger.revision }
    }),
    make('scholar_manuscript', ['read'], '按源码位置分块读取当前主稿。不能直接写稿、接受建议或覆盖人工编辑；建议从 Draft 的可见确认计划发起。', { startUtf16: { type: 'integer' } },
      z.object({ action: z.literal('read'), startUtf16: offset }).strict(), async (args, io) => {
        const current = await snapshot(io), start = args.startUtf16
        invariant(unicodeBoundary(current.document.text, start), 'SELECTION_INVALID', '源码起点无效或切开 Unicode/CRLF。')
        let end = Math.min(current.document.text.length, start + 12000); if (!unicodeBoundary(current.document.text, end)) end--
        return { documentHash: current.document.contentHash, revisionId: current.document.revisionId, externalChange: current.document.externalChange,
          startUtf16: start, endUtf16: end, nextStartUtf16: end < current.document.text.length ? end : null, text: current.document.text.slice(start, end) }
      }),
    make('scholar_review', ['inspect', 'run'], '执行确定性规则审查或查看版本、问题与未知项。不能删除 B0、记录用户接受风险或冒充模型质量评估。', {}, simple(['inspect', 'run']), async (args, io) => {
      if (args.action === 'inspect') return inspectReview(io)
      const current = await snapshot(io), result = await runReview(io, current.ledger.revision)
      return { report: result.report, ledgerRevision: result.revision, nextStep: '未知项不是通过；用户可在 Review 查看问题。正文修复仍需建议和显式接受。' }
    }),
    make('scholar_skill', ['list'], '仅查看本项目 Skill 绑定与限制；不读取普通 DSH Skill 根、不安装库、不执行脚本。', {}, simple(['list']), async (_args, io) => {
      const current = await snapshot(io)
      return { bindings: current.config.skills.bindings, resolvedSkills: [], capability: 'private-resource-resolver-not-yet-available',
        limitation: '启用但未解析的 Skill 会阻塞生成；不会忽略绑定，也不会从全局普通目录借用其他技能。' }
    }),
    make('scholar_export', ['preflight'], '预检当前稿件三种已支持的导出格式；不创建交付、上传、投稿或发布。用户在 Export 重新预检并确认后才能交付。', {}, simple(['preflight']), async (_args, io) => {
      const plan = await prepareDelivery(io)
      return { revisionId: plan.revisionId, documentHash: plan.documentHash, reviewState: plan.reviewState, reviewedAllowed: plan.reviewedAllowed,
        formats: plan.formats, unresolvedIssueIds: plan.unresolvedIssueIds, limitations: plan.limitations, nextStep: '在 Export 预检并明确确认当前版本工作草稿或已审查草稿。此工具没有写入交付。' }
    }),
  ]
}
