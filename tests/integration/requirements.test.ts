import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { extractRequirements, upsertRequirement, confirmRequirement, resolveRequirementConflict } from '../../src/core/requirements/requirements.ts'

async function setup(raw = 'TEST_ONLY 老师要求：论文正文不少于2000字。\r\nTEST_ONLY 参考文献至少5篇。\r\n') {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 要求确认', type: 'course-paper' }))
  io.externalEdit('TEST_ONLY_assignment.txt', raw)
  const material = await registerMaterial(io, { relativePath: 'TEST_ONLY_assignment.txt', role: 'assignment', confirmExcludedFile: false }, 0)
  await parseRegisteredMaterial(io, material.material.id, material.revision, new AbortController().signal, (bytes, type) => parseMaterialBytes(bytes, type, new AbortController().signal))
  return { io, materialId: material.material.id, raw }
}

test('AT-07: real located teacher requirements remain proposed and require an explicit counting policy', async () => {
  const { io, materialId, raw } = await setup()
  const extracted = await extractRequirements(io, materialId, 2)
  assert.equal(extracted.requirements.length, 2)
  assert.ok(extracted.requirements.every(row => row.confirmation === 'proposed' && row.origin.materialId === materialId && row.origin.locator?.kind === 'text'))
  const length = extracted.requirements.find(row => row.kind === 'length')!
  await assert.rejects(confirmRequirement(io, length.id, undefined, extracted.revision), { code: 'COUNTING_POLICY_CONFIRMATION_REQUIRED' })
  await confirmRequirement(io, length.id, 'sf-body-han-western-v1', extracted.revision)
  const confirmed = (await snapshot(io)).ledger.requirements[length.id]
  assert.equal(confirmed.confirmation, 'confirmed'); assert.equal(confirmed.constraint!.countingPolicyId, 'sf-body-han-western-v1')
  assert.equal((await io.read('TEST_ONLY_assignment.txt'))!.text, raw)
})

test('AT-07: teacher/user disagreement blocks confirmation until a reasoned choice archives both originals', async () => {
  const { io, materialId } = await setup(), extracted = await extractRequirements(io, materialId, 2)
  const teacher = extracted.requirements.find(row => row.kind === 'length')!
  const user = await upsertRequirement(io, { kind: 'length', description: 'TEST_ONLY 用户希望正文至少1000字', origin: { type: 'user' }, verificationMethod: 'deterministic', constraint: { operator: 'min', value: 1000, unit: 'zh-characters' } }, extracted.revision)
  assert.equal(user.requirement.confirmation, 'conflicting')
  assert.equal((await snapshot(io)).ledger.requirements[teacher.id].confirmation, 'conflicting')
  await assert.rejects(confirmRequirement(io, teacher.id, 'sf-body-han-western-v1', user.revision), { code: 'REQUIREMENT_CONFLICT' })
  await assert.rejects(resolveRequirementConflict(io, [teacher.id, user.requirement.id], teacher.id, '', user.revision), { code: 'INVALID_REQUEST' })
  const decided = await resolveRequirementConflict(io, [teacher.id, user.requirement.id], teacher.id, 'TEST_ONLY 按原课程要求，用户输入为误记。', user.revision)
  assert.equal(decided.ledger.requirements[teacher.id].confirmation, 'proposed')
  assert.equal(decided.ledger.requirements[user.requirement.id], undefined)
  const archive = [...io.files].find(([path]) => path.startsWith('.scholarflow/planning/requirements/'))!
  assert.ok(archive[1].text.includes(user.requirement.description)); assert.ok(archive[1].text.includes(teacher.origin.excerpt!)); assert.ok(archive[1].text.includes('误记'))
  await confirmRequirement(io, teacher.id, 'sf-body-han-western-v1', decided.revision)
})

test('fabricated requirement quotations are refused and forbidden AI policy stays a confirmed hard constraint', async () => {
  const { io, materialId } = await setup('TEST_ONLY 老师规定：禁止使用AI生成论文正文。\n')
  await assert.rejects(upsertRequirement(io, { kind: 'length', description: 'TEST_ONLY 伪造老师要求', origin: { type: 'material', materialId,
    locator: { kind: 'text', lineStart: 1, lineEnd: 1 }, excerpt: 'TEST_ONLY 未出现的要求' }, verificationMethod: 'deterministic' }, 2), { code: 'REQUIREMENT_NOT_LOCATED' })
  const extracted = await extractRequirements(io, materialId, 2), policy = extracted.requirements[0]
  assert.equal(policy.kind, 'ai-policy'); assert.equal(policy.constraint!.value, 'forbidden')
  await confirmRequirement(io, policy.id, undefined, extracted.revision)
  assert.equal((await snapshot(io)).ledger.requirements[policy.id].confirmation, 'confirmed')
})
