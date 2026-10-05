import { test } from 'node:test'
import { prepareSourceRegistration, confirmSourceRegistration } from '../../src/core/research/source-registration.ts'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { extractRequirements, upsertRequirement, confirmRequirement, resolveRequirementConflict, removeRequirement, requirementHistory } from '../../src/core/requirements/requirements.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { runReview } from '../../src/core/review/review.ts'

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
  const archive = [...io.files].find(([path, file]) => path.startsWith('.scholarflow/planning/requirements/') && JSON.parse(file.text).selectedId === teacher.id)!
  assert.ok(archive[1].text.includes(user.requirement.description)); assert.ok(archive[1].text.includes(teacher.origin.excerpt!)); assert.ok(archive[1].text.includes('误记'))
  await confirmRequirement(io, teacher.id, 'sf-body-han-western-v1', decided.revision)
})

test('editing and deleting confirmed requirements preserve original provenance and confirmation in immutable history', async () => {
  const { io, materialId, raw } = await setup(), extracted = await extractRequirements(io, materialId, 2), teacher = extracted.requirements.find(row => row.kind === 'length')!
  const confirmed = await confirmRequirement(io, teacher.id, 'sf-body-han-western-v1', extracted.revision)
  const saved = confirmed.ledger.requirements[teacher.id], { confirmation: _c, confirmedAt: _a, ...input } = saved
  await assert.rejects(upsertRequirement(io, input, confirmed.revision), { code: 'RESOLUTION_REASON_REQUIRED' })
  const edited = await upsertRequirement(io, { ...input, description: 'TEST_ONLY 老师要求的范围说明补充', constraint: { ...input.constraint!, value: 2000 } }, confirmed.revision, 'TEST_ONLY 补充已核对的范围')
  assert.equal(edited.requirement.confirmation, 'proposed'); assert.deepEqual(edited.requirement.origin, saved.origin)
  const reconfirmed = await confirmRequirement(io, teacher.id, 'sf-body-han-western-v1', edited.revision)
  const removed = await removeRequirement(io, teacher.id, 'TEST_ONLY 用户确认该要求已由新作业规则替换', reconfirmed.revision)
  assert.equal(removed.ledger.requirements[teacher.id], undefined); assert.equal(removed.ledger.outline.confirmation, 'draft')
  const history = await requirementHistory(io), edit = history.history.find(row => row.action === 'edit')!, deletion = history.history.find(row => row.action === 'remove')!
  assert.deepEqual(edit.previous, saved); assert.equal(edit.requirement.confirmation, 'proposed')
  assert.equal(deletion.previous.confirmation, 'confirmed'); assert.ok(deletion.reason!.includes('替换'))
  assert.equal((await io.read('TEST_ONLY_assignment.txt'))!.text, raw)
})

test('stale requirement editing and foreign history records cannot overwrite or impersonate the project', async () => {
  const { io, materialId } = await setup(), extracted = await extractRequirements(io, materialId, 2), teacher = extracted.requirements[0]
  await confirmRequirement(io, teacher.id, 'sf-body-han-western-v1', extracted.revision)
  const { confirmation: _c, confirmedAt: _a, ...input } = teacher
  await assert.rejects(upsertRequirement(io, { ...input, description: 'TEST_ONLY stale edit' }, extracted.revision, 'TEST_ONLY stale'), { code: 'STALE_LEDGER_REVISION' })
  io.externalEdit('.scholarflow/planning/requirements/change_TEST_ONLY_foreign.json', JSON.stringify({ schemaVersion: 1, projectId: 'prj_TEST_ONLY_other', previous: teacher, action: 'remove' }))
  const history = await requirementHistory(io)
  assert.equal(history.diagnostics.length, 1); assert.ok(!history.history.some(row => row.id.includes('foreign')))
  assert.equal((await snapshot(io)).ledger.requirements[teacher.id].confirmation, 'confirmed')
})

test('recent-reference ratio needs an explicit year window and denominator policy before confirmation', async () => {
  const { io } = await setup()
  const saved = await upsertRequirement(io, { kind: 'references', description: 'TEST_ONLY 2021–2026 年引用至少60%', origin: { type: 'user' }, verificationMethod: 'deterministic',
    constraint: { operator: 'ratio', value: 60, unit: 'percent', windowStart: '2021', windowEnd: '2026' } }, 2)
  await assert.rejects(confirmRequirement(io, saved.requirement.id, undefined, saved.revision), { code: 'COUNTING_POLICY_CONFIRMATION_REQUIRED' })
  const confirmed = await confirmRequirement(io, saved.requirement.id, 'sf-cited-year-window-ratio-v1', saved.revision)
  assert.equal(confirmed.ledger.requirements[saved.requirement.id].constraint!.countingPolicyId, 'sf-cited-year-window-ratio-v1')
  const invalid = await upsertRequirement(io, { kind: 'references', description: 'TEST_ONLY reversed years', origin: { type: 'user' }, verificationMethod: 'deterministic',
    constraint: { operator: 'ratio', value: 60, unit: 'percent', windowStart: '2026', windowEnd: '2021' } }, confirmed.revision)
  await assert.rejects(confirmRequirement(io, invalid.requirement.id, 'sf-cited-year-window-ratio-v1', invalid.revision), { code: 'COUNTING_POLICY_CONFIRMATION_REQUIRED' })
})

test('actual review reports recent ratio, mixed counting and missing-year unknowns from the saved manuscript', async () => {
  const { io } = await setup()
  const a = await registerSource(io, { title: 'TEST_ONLY metadata 2021', authors: [], kind: 'paper', identifiers: {}, year: 2021 }, 2)
  const sourceCurrent = await snapshot(io)
  const duplicatePlan = await prepareSourceRegistration(io, { context: { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'ses_TEST_ONLY',
    projectId: sourceCurrent.ledger.projectId, expectedLedgerRevision: a.revision }, source: { title: 'TEST_ONLY metadata 2026', authors: [], kind: 'paper', identifiers: {}, year: 2026 } })
  const b = await confirmSourceRegistration(io, duplicatePlan, 'TEST_ONLY 这两条独立测试元数据仅用于不同年份计数。', 'ses_TEST_ONLY')
  const unknown = await registerSource(io, { title: 'TEST_ONLY metadata without year', authors: [], kind: 'paper', identifiers: {} }, b.revision)
  const current = await snapshot(io)
  const changed = await saveManual(io, `中文 Test words [@${a.source.citeKey}; @${b.source.citeKey}].\n\n\`\`\`\n排除代码 excluded code\n\`\`\`\n`, current.document.contentHash, unknown.revision)
  const ratio = await upsertRequirement(io, { kind: 'references', description: 'TEST_ONLY all references from 2021–2026', origin: { type: 'user' }, verificationMethod: 'deterministic',
    constraint: { operator: 'ratio', value: 100, unit: 'percent', windowStart: '2021', windowEnd: '2026' } }, changed.revision)
  const confirmed = await confirmRequirement(io, ratio.requirement.id, 'sf-cited-year-window-ratio-v1', ratio.revision)
  const mixed = await upsertRequirement(io, { kind: 'length', description: 'TEST_ONLY 2 Han + 2 Western tokens', origin: { type: 'user' }, verificationMethod: 'deterministic',
    constraint: { operator: 'equals', value: 4, unit: 'words', countingPolicyId: 'sf-body-han-plus-western-v1' } }, confirmed.revision)
  const mixedConfirmed = await confirmRequirement(io, mixed.requirement.id, 'sf-body-han-plus-western-v1', mixed.revision)
  const report = await runReview(io, mixedConfirmed.revision)
  assert.equal(report.report.checks.find(row => row.id === `requirement_${ratio.requirement.id}`)!.status, 'pass')
  assert.equal(report.report.checks.find(row => row.id === `requirement_${mixed.requirement.id}`)!.status, 'pass')
  assert.ok(report.report.checks.some(row => row.id.startsWith('identity_') && row.status === 'unknown'), 'year count does not falsely verify publication identity')
  const latest = await snapshot(io)
  const changedAgain = await saveManual(io, `${latest.document.text}\nTEST_ONLY missing year [@${unknown.source.citeKey}].\n`, latest.document.contentHash, report.revision)
  const rereview = await runReview(io, changedAgain.revision)
  const check = rereview.report.checks.find(row => row.id === `requirement_${ratio.requirement.id}`)!
  assert.equal(check.status, 'unknown'); assert.match(check.detail, /缺失年份 1/)
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
