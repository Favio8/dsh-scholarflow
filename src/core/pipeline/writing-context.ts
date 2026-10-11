import { approvedMemory } from '../project/memory.ts'
import { snapshot } from '../project/project.ts'
import { resolveStageSkills, type SkillReader, type SkillStage } from '../skills/bindings.ts'
import { digest, type FileStore } from '../store/files.ts'
import { invariant } from '../../shared/errors.ts'

export function assertWritingAllowed(current: Awaited<ReturnType<typeof snapshot>>) {
  const requirements = Object.values(current.ledger.requirements)
  invariant(requirements.every(row => row.confirmation === 'confirmed'), 'REQUIREMENT_CONFIRMATION_REQUIRED', '写作要求尚有未确认项或冲突。')
  invariant(!requirements.some(row => row.kind === 'ai-policy' && row.confirmation === 'confirmed' &&
    (['forbidden', 'deny', 'disallowed'].includes(String(row.constraint?.value).toLowerCase()) || /(?:禁止|不允许|不得)\s*(?:使用\s*)?(?:AI|人工智能|生成式)/i.test(row.description))),
  'AI_POLICY_FORBIDS_GENERATION', '已确认的项目政策禁止 AI 生成或改写正文。请先核对项目要求。')
}

/** Actual stage resources shared by initial writing and unsaved-buffer rewriting. */
export async function writingContext(io: FileStore, current: Awaited<ReturnType<typeof snapshot>>, stage: SkillStage, reader?: SkillReader, selectedBindingId?: string) {
  const profile = await io.read(current.config.writing.projectProfile)
  invariant(profile && Buffer.byteLength(profile.text) <= 65536, 'PROFILE_UNAVAILABLE', '项目文风缺失或超过 64 KiB。')
  const memory = current.config.writing.useApprovedProjectMemory ? await approvedMemory(io, current.ledger.projectId) : {}
  const skills = await resolveStageSkills(io, stage, reader, selectedBindingId)
  return { projectProfile: profile.text, approvedMemory: memory, academicSkills: skills.resources,
    profileHash: digest(profile.text), resourceLockHash: skills.resourceLockHash,
    skillDigests: skills.resources.map(row => ({ qualifiedId: row.qualifiedId, digest: row.digest })) }
}
