import { parseDocument } from 'yaml'
import { writingProfileSchema, projectProfileSourceSchema, type WritingProfile } from '../../shared/profiles.ts'
import { invariant, parseStored } from '../../shared/errors.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { snapshot, mutateLedger, invalidateReviews, CONFIG_PATH, parseConfig } from './project.ts'

const PATH = '.scholarflow/profiles/writing.md'
const SOURCE = '.scholarflow/profiles/writing-source.json'
export function profileDigest(profile: Omit<WritingProfile, 'sourceDigest' | 'scope'>) {
  return digest(json({ id: profile.id, displayName: profile.displayName, language: profile.language, instructions: profile.instructions,
    ...(profile.structuredPreferences && { structuredPreferences: profile.structuredPreferences }) }))
}
export function verifyProfile(input: unknown) {
  const profile = writingProfileSchema.parse(input)
  invariant(Buffer.byteLength(profile.instructions) <= 65536 && !profile.instructions.includes('\0'), 'PROFILE_INVALID', '文风说明须为最多 64 KiB 的文本。')
  invariant(profileDigest(profile) === profile.sourceDigest, 'PROFILE_DIGEST_MISMATCH', '文风版本内容与摘要不符。')
  const hint = profile.structuredPreferences?.paragraphLengthHint
  invariant(!hint || hint.min <= hint.max, 'PROFILE_INVALID', '段落长度偏好起止顺序无效。')
  return profile
}
export const profileText = (profile: WritingProfile) => profile.instructions + (profile.structuredPreferences ? `\n\n## 结构化表达偏好（不得覆盖事实与权限约束）\n\n${json(profile.structuredPreferences)}` : '')
const hard = '保留真实证据、引用、数字、术语和限定条件；区分来源报告、作者推论与研究计划，不编造实验结果。'
const types = [
  ['course-paper', '课程论文', '围绕已确认课程要求展开论证。说明概念、论点和资料依据，结论回应研究问题。'],
  ['literature-review', '文献综述', '按明确的分类维度组织综合比较，区分一致结论、争议与证据缺口，避免逐篇堆砌摘要。'],
  ['research-paper', '研究论文', '分开研究问题、方法、实际结果和讨论；尚未执行的实验显示待补，不把计划写成已完成结果。'],
] as const
export const builtinProfiles: WritingProfile[] = types.flatMap(([type, label, instruction]) => (['zh-CN', 'en'] as const).map(language => {
  const base = { id: `builtin_${type}_${language === 'en' ? 'en' : 'zh'}`, displayName: `${label} · ${language === 'en' ? '英文' : '中文'}`, language,
    instructions: `# ${label}文风\n\n${language === 'en' ? 'Use clear, formal academic English. Preserve established terminology and qualify claims.\n\n' : '使用清晰、正式的中文；减少空泛套话，段落围绕一个具体论点展开。\n\n'}${instruction}\n\n${hard}\n` }
  return verifyProfile({ ...base, scope: 'builtin', sourceDigest: profileDigest(base) })
}))
export function builtinProjectProfile(type: string, language: string) {
  const profile = builtinProfiles.find(row => row.id === `builtin_${type}_${language === 'en' ? 'en' : 'zh'}`)
  invariant(profile, 'PROFILE_NOT_FOUND', '未提供此论文类型与语言的内置文风。')
  return profile
}
export async function projectProfile(io: FileStore) {
  const current = await snapshot(io), file = await io.read(PATH), provenance = await io.read(SOURCE)
  invariant(file, 'PROFILE_NOT_FOUND', '当前项目文风文件缺失。')
  let source: Record<string, unknown> | undefined, warning: string | undefined
  if (provenance) {
    try { const value = parseStored(projectProfileSourceSchema, provenance.text, 'PROFILE_SOURCE_INVALID', 'project.profile')
      invariant(value.schemaVersion === 1 && value.projectId === current.ledger.projectId && value.path === PATH, 'PROFILE_INVALID', '来源身份无效。')
      verifyProfile(value.profile); source = value
    } catch { warning = '文风来源记录未通过校验，原文件保留；当前文本按项目自定义显示。' }
  }
  return { path: PATH, instructions: file.text, contentHash: digest(file.text), preset: current.config.writing.preset,
    source, customized: !source || digest(file.text) !== digest(profileText(source.profile as WritingProfile)), warning }
}
export interface ProfileCopyPlan { id: string; projectId: string; expectedRevision: number; configHash: string; ledgerHash: string;
  baseHash: string; sourceHash: string | null; profile: WritingProfile; contentHash: string }
const copyHash = (plan: Omit<ProfileCopyPlan, 'contentHash'>) => digest(json(plan))
export async function prepareProfileCopy(io: FileStore, input: WritingProfile, expectedRevision: number): Promise<ProfileCopyPlan> {
  const profile = verifyProfile(input), current = await snapshot(io), file = await io.read(PATH), source = await io.read(SOURCE)
  invariant(Buffer.byteLength(profileText(profile)) <= 65536, 'CONTENT_TOO_LARGE', '文风说明与结构化偏好合计超过项目 64 KiB 上限，请精简后再复制。')
  invariant(current.ledger.revision === expectedRevision, 'STALE_LEDGER_REVISION', '项目已改变，请重新预览文风复制。')
  invariant(file, 'PROFILE_NOT_FOUND', '项目文风缺失，未推测覆盖路径。')
  const plan = { id: newId('profilecopy'), projectId: current.ledger.projectId, expectedRevision, configHash: current.configHash,
    ledgerHash: current.ledgerHash, baseHash: digest(file.text), sourceHash: source ? digest(source.text) : null, profile }
  return { ...plan, contentHash: copyHash(plan) }
}
export async function applyProfileCopy(io: FileStore, plan: ProfileCopyPlan, sourceSessionId: string) {
  const { contentHash, ...unsigned } = plan
  invariant(contentHash === copyHash(unsigned), 'INVALID_APPROVAL', '文风复制计划已改变。')
  verifyProfile(plan.profile)
  return mutateLedger(io, plan.expectedRevision, async (ledger, config) => {
    const current = await snapshot(io), file = await io.read(PATH), source = await io.read(SOURCE), yaml = await io.read(CONFIG_PATH)
    invariant(ledger.projectId === plan.projectId && current.configHash === plan.configHash && current.ledgerHash === plan.ledgerHash,
      'STALE_LEDGER_REVISION', '确认期间项目配置或记录改变，未覆盖文风。')
    invariant(file && digest(file.text) === plan.baseHash && (source ? digest(source.text) : null) === plan.sourceHash,
      'STALE_DOCUMENT_VERSION', '确认期间项目文风或来源改变，未覆盖。')
    invariant(yaml && config.writing.projectProfile === PATH, 'PROFILE_INVALID', '当前文风路径不属于支持的项目复制目标。')
    const document = parseDocument(yaml.text); document.setIn(['writing', 'preset'], `${plan.profile.id}@${plan.profile.sourceDigest.slice(7)}`)
    const next = document.toString(); parseConfig(next)
    const decision = projectProfileSourceSchema.parse({ schemaVersion: 1, projectId: ledger.projectId, path: PATH, profile: plan.profile,
      operation: 'copy-template', sourceSessionId, confirmedAt: new Date().toISOString() })
    const history = `.scholarflow/profiles/history/${newId('profile')}.json`
    invalidateReviews(ledger, ['style'])
    return [{ path: PATH, before: file, after: profileText(plan.profile) }, { path: SOURCE, before: source, after: json(decision) },
      { path: CONFIG_PATH, before: yaml, after: next }, { path: history, before: undefined, after: json({ ...decision, previousText: file.text,
        previousPreset: config.writing.preset, previousSource: source?.text ?? null, previousHash: plan.baseHash }) }]
  })
}
