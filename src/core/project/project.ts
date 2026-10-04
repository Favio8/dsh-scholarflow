import { parseDocument, stringify } from 'yaml'
import { configSchema, ledgerSchema, relativePath, projectType, type ProjectConfig, type Ledger } from '../../shared/schema.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { digest, newId, json, type FileStore, type FileImage } from '../store/files.ts'
import { commit, inspectRecovery, type Mutation } from '../store/transactions.ts'
import { MEMORY_APPROVALS, memoryApprovalsSchema } from './memory.ts'

export const CONFIG_PATH = '.scholarflow/project.yaml'
export const LEDGER_PATH = '.scholarflow/data/ledger.json'
export function parseConfig(text: string): ProjectConfig {
  return parseConfigWithWarnings(text).config
}
export function parseConfigWithWarnings(text: string): { config: ProjectConfig; warnings: string[] } {
  const yaml = parseDocument(text, { uniqueKeys: true })
  if (yaml.errors.length) throw new ScholarError('PROJECT_CONFIG_INVALID', '项目 YAML 无效，未覆盖原文件。')
  const raw = yaml.toJSON()
  if (raw?.schemaVersion > 1) throw new ScholarError('PROJECT_SCHEMA_TOO_NEW', '此项目需要更新版本的 ScholarFlow；当前只读。')
  let parsed = configSchema.safeParse(raw)
  const warnings: string[] = []
  // Unknown settings are reported and excluded from the effective policy. The
  // original YAML remains untouched, including unsupported keys and comments.
  for (let pass = 0; pass < 8 && !parsed.success; pass++) {
    const unknown = parsed.error.issues.filter(issue => issue.code === 'unrecognized_keys')
    if (!unknown.length) break
    for (const issue of unknown) {
      let parent = raw
      for (const part of issue.path) parent = parent?.[part as string]
      for (const key of issue.keys) { warnings.push([...issue.path, key].join('.')); if (parent) delete parent[key] }
    }
    parsed = configSchema.safeParse(raw)
  }
  if (!parsed.success) throw new ScholarError('PROJECT_CONFIG_INVALID', '项目配置未通过校验，未使用默认值覆盖。', { fields: parsed.error.issues.map(issue => issue.path.join('.')) })
  return { config: parsed.data, warnings }
}
export function parseLedger(text: string): Ledger {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new ScholarError('PROJECT_LEDGER_INVALID', '项目 ledger 不是有效 JSON，已保留原文件。') }
  if ((raw as { schemaVersion?: number })?.schemaVersion! > 1) throw new ScholarError('PROJECT_SCHEMA_TOO_NEW', 'ledger 版本过新，当前只读。')
  const result = ledgerSchema.safeParse(raw)
  if (!result.success) throw new ScholarError('PROJECT_LEDGER_INVALID', 'ledger 未通过校验，禁止写入默认空数据。')
  for (const key of ['requirements', 'materials', 'sources', 'evidence', 'claims', 'documents', 'claimAnchors', 'reviewIssues', 'deliveries'] as const)
    for (const [recordId, record] of Object.entries(result.data[key]))
      invariant(recordId === record.id, 'PROJECT_LEDGER_INVALID', 'ledger 对象身份与索引不符。')
  for (const [proposalId, state] of Object.entries(result.data.proposalStates))
    invariant(proposalId === state.proposalId, 'PROJECT_LEDGER_INVALID', '建议状态身份与索引不符。')
  return result.data
}

export interface InitPlan {
  id: string; config: ProjectConfig; files: Array<{ path: string; text: string }>; contentHash: string; risks: string[]
}
export async function prepareInit(io: FileStore, input: { title: string; type: string; language?: string; manuscriptDir?: string; maxModelCalls?: number }): Promise<InitPlan> {
  const output = relativePath.parse(input.manuscriptDir ?? 'manuscript')
  invariant(!['.scholarflow', '.git', 'node_modules'].includes(output.split('/')[0]), 'OUTPUT_PATH_CONFLICT', '请选择论文输出专属目录。')
  invariant(!await io.stat('.scholarflow'), 'OUTPUT_PATH_CONFLICT', '.scholarflow 已存在，请检查或恢复原项目。')
  const existing = await io.stat(output)
  invariant(!existing || (existing.type === 'directory' && (await io.list(output)).length === 0),
    'OUTPUT_PATH_CONFLICT', '输出目录已有文件；请选择不同目录或先明确采用现有稿件。')
  const projectId = newId('prj')
  const config = configSchema.parse({ schemaVersion: 1,
    project: { id: projectId, title: input.title, type: projectType.parse(input.type), language: input.language ?? 'zh-CN' },
    paths: { manuscriptDir: output, mainDocument: `${output}/paper.md`, references: `${output}/references.bib` },
    materials: { selection: 'explicit', include: [], exclude: ['**/.env*', '**/node_modules/**', '**/.git/**', '**/credentials/**', '**/secrets/**'] },
    writing: { preset: `builtin:${input.type}-${input.language === 'en' ? 'en' : 'zh'}`, projectProfile: '.scholarflow/profiles/writing.md', useApprovedProjectMemory: true },
    skills: { bindings: [] }, workflow: { executionMode: 'guided', confirmOutline: true, maxReviewRounds: 2,
      budget: { maxModelCalls: input.maxModelCalls ?? 40, maxSearchQueries: 12, maxCandidateSources: 80, maxDurationMinutes: 30 } },
    research: { providerRefs: [], allowLocalOnly: true, fullTextDownload: 'ask' }, privacy: { sendSelectedContentOnly: true, verboseModelLogging: false },
    output: { formats: ['markdown', 'bibtex', 'quality-report'] },
  })
  const revision = newId('rev')
  const paper = `# ${config.project.title.replaceAll('\n', ' ')}\n\n[待补：已确认的写作要求、可定位证据与大纲。]\n`
  const references = '% No cited sources in this document.\n'
  const ledger: Ledger = { schemaVersion: 1, projectId, revision: 0, requirements: {}, materials: {}, sources: {}, evidence: {}, claims: {},
    outline: { version: 0, title: config.project.title, researchQuestion: '', thesis: '', confirmation: 'draft', sections: [] },
    documents: { paper: { id: 'paper', relativePath: config.paths.mainDocument, format: 'markdown', currentHash: digest(paper), revisionId: revision, encoding: 'utf-8', lineEnding: 'lf', initialPlaceholder: true } },
    claimAnchors: {}, proposalStates: {}, reviewIssues: {}, deliveries: {} }
  const writingProfile = '# 项目文风\n\n清晰、准确、具体。区分来源事实与作者推论，保留限定条件与引用，不编造实验或数据。\n'
  const files = [
    { path: CONFIG_PATH, text: stringify(config) },
    { path: config.paths.mainDocument, text: paper }, { path: config.paths.references, text: references },
    { path: '.scholarflow/.gitignore', text: 'cache/\ntmp/\nlogs/\ntransactions/\nstate.json\ndrafts/editor-buffers/\n' },
    { path: '.scholarflow/profiles/writing.md', text: writingProfile },
    { path: '.scholarflow/profiles/review.md', text: '# 项目审查\n\n分别报告规则检查、模型判断和未执行项目。真实性与引用问题优先。\n' },
    { path: '.scholarflow/context/decisions.md', text: '# 已确认决定\n' },
    { path: '.scholarflow/context/terminology.md', text: '# 已确认术语\n' },
    { path: '.scholarflow/context/writing-memory.md', text: '# 已确认写作记忆\n' },
    { path: MEMORY_APPROVALS, text: json({ schemaVersion: 1, projectId, entries: Object.fromEntries([
      ['decisions', '# 已确认决定\n'], ['terminology', '# 已确认术语\n'], ['writing-memory', '# 已确认写作记忆\n']
    ].map(([name, text]) => [`.scholarflow/context/${name}.md`, { contentHash: digest(text), source: 'initialization', confirmedAt: new Date().toISOString() }])) }) },
    { path: '.scholarflow/resources.lock.json', text: json({ schemaVersion: 1, projectId, bindings: [], resolvedAt: new Date().toISOString() }) },
    { path: `.scholarflow/drafts/${revision}/paper.md`, text: paper },
    { path: `.scholarflow/drafts/${revision}/manifest.json`, text: json({ schemaVersion: 1, revisionId: revision, documentId: 'paper', contentHash: digest(paper), referencesHash: digest(references), createdAt: new Date().toISOString() }) },
    { path: LEDGER_PATH, text: json(ledgerSchema.parse(ledger)) },
  ]
  return { id: newId('plan'), config, files, contentHash: digest(json(files)), risks: ['创建列出的正文与项目文件，以及 .scholarflow 内部事务与锁元数据。原始资料保持只读。禁止覆盖既有文件。'] }
}

// Approval is enforced by the authenticated Host adapter before entering Core.
export async function initialize(io: FileStore, plan: InitPlan) {
  invariant(digest(json(plan.files)) === plan.contentHash, 'INVALID_MUTATION', '初始化计划内容发生改变。')
  await io.lock(async () => {
    // Lock metadata lives under .scholarflow/tmp; user-facing files still must be absent.
    const output = plan.config.paths.manuscriptDir
    const existing = await io.stat(output)
    invariant(!existing || (existing.type === 'directory' && (await io.list(output)).length === 0), 'OUTPUT_PATH_CONFLICT', '确认期间输出目录已改变，未覆盖文件。')
    for (const file of plan.files) invariant(!await io.stat(file.path), 'OUTPUT_PATH_CONFLICT', '确认期间出现文件冲突，未覆盖文件。')
    await commit(io, plan.files.map(file => ({ path: file.path, before: undefined, after: file.text })))
  })
  return plan.config.project.id
}

export async function snapshot(io: FileStore) {
  const configFile = await io.read(CONFIG_PATH)
  if (!configFile) throw new ScholarError('PROJECT_NOT_INITIALIZED', '尚未初始化当前工作区。')
  const { config, warnings: configWarnings } = parseConfigWithWarnings(configFile.text)
  const ledgerFile = await io.read(LEDGER_PATH)
  if (!ledgerFile) throw new ScholarError('PROJECT_LEDGER_INVALID', '缺少 ledger，禁止自动创建空数据覆盖。')
  const ledger = parseLedger(ledgerFile.text)
  invariant(ledger.projectId === config.project.id, 'PROJECT_ID_CONFLICT', '配置与 ledger 项目身份不同。')
  invariant(ledger.documents.paper, 'DOCUMENT_NOT_FOUND', '项目没有主稿记录，禁止推测或重建覆盖。')
  const documentFile = await io.read(config.paths.mainDocument)
  invariant(documentFile, 'DOCUMENT_NOT_FOUND', '主稿缺失，已保留项目记录。')
  invariant((await io.read(CONFIG_PATH))?.version === configFile.version && (await io.read(LEDGER_PATH))?.version === ledgerFile.version,
    'STALE_LEDGER_REVISION', '读取期间项目发生提交，请重新读取完整快照。')
  return { config, configWarnings, configHash: digest(configFile.text), ledgerHash: digest(ledgerFile.text), ledger, document: { ...ledger.documents.paper, text: documentFile.text,
    contentHash: digest(documentFile.text), externalChange: digest(documentFile.text) !== ledger.documents.paper.currentHash } }
}

export async function mutateLedger(io: FileStore, expectedRevision: number, change: (ledger: Ledger, config: ProjectConfig) => void | Mutation[] | Promise<void | Mutation[]>) {
  return io.lock(async () => {
    const current = await snapshot(io)
    invariant((await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length === 0, 'RECOVERY_REQUIRED', '存在未完成事务，请先检查并确认恢复。')
    invariant(current.ledger.revision === expectedRevision, 'STALE_LEDGER_REVISION', '项目数据已更新，请重新读取。')
    const next = structuredClone(current.ledger)
    const mutations = await change(next, current.config) ?? []
    next.revision++
    const ledgerFile = await io.read(LEDGER_PATH)
    invariant(ledgerFile && digest(ledgerFile.text) === current.ledgerHash && digest((await io.read(CONFIG_PATH))!.text) === current.configHash,
      'STALE_LEDGER_REVISION', '提交前项目记录或配置被外部修改，已保留改动。')
    await commit(io, [...mutations, { path: LEDGER_PATH, before: ledgerFile, after: json(ledgerSchema.parse(next)) }])
    return { revision: next.revision, ledger: next }
  })
}

export function invalidateReviews(ledger: Ledger, categories?: string[]) {
  for (const issue of Object.values(ledger.reviewIssues)) if (!categories || categories.includes(issue.category)) issue.stale = true
}

export async function updateProjectText(io: FileStore, path: string, text: string, expectedHash: string, expectedRevision: number, sourceSessionId?: string) {
  invariant(['.scholarflow/profiles/writing.md', '.scholarflow/profiles/review.md', '.scholarflow/context/decisions.md', '.scholarflow/context/terminology.md', '.scholarflow/context/writing-memory.md'].includes(path), 'PATH_OUTSIDE_ALLOWED_ROOT', '仅允许项目 Profile 和确认记忆。')
  invariant(Buffer.byteLength(text) <= 65536, 'CONTENT_TOO_LARGE', '项目指令最多 64 KiB。')
  return mutateLedger(io, expectedRevision, async ledger => {
    const file = await io.read(path)
    invariant(file && digest(file.text) === expectedHash, 'STALE_DOCUMENT_VERSION', '项目 Profile 或记忆已更新，请重新读取。')
    invalidateReviews(ledger, path.endsWith('/review.md') ? undefined : path.includes('/profiles/') ? ['style'] : ['style', 'logic'])
    const mutations: Mutation[] = [{ path, before: file, after: text }]
    if (path.includes('/context/')) {
      const previous = await io.read(MEMORY_APPROVALS)
      const approvals = previous ? memoryApprovalsSchema.parse(JSON.parse(previous.text)) : { schemaVersion: 1 as const, projectId: ledger.projectId, entries: {} as MemoryEntries }
      invariant(approvals.projectId === ledger.projectId, 'PROJECT_ID_CONFLICT', '确认记忆记录的项目身份不同。')
      approvals.entries[path] = { contentHash: digest(text), source: 'user', ...(sourceSessionId && { sourceSessionId }), confirmedAt: new Date().toISOString() }
      mutations.push({ path: MEMORY_APPROVALS, before: previous, after: json(memoryApprovalsSchema.parse(approvals)) })
      if (path.endsWith('/decisions.md') && file.text !== text) ledger.outline.confirmation = 'draft'
    }
    return mutations
  })
}
type MemoryEntries = ReturnType<typeof memoryApprovalsSchema.parse>['entries']
