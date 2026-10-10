import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { requirementDraftSpec } from '../../src/shared/writing-task.ts'

// Real controller/candidate store/parser, with only the host/model seams replaced.
const output = resolve('.dsh-tmp/contracts/outline-controller.mjs')
await mkdir(resolve('.dsh-tmp/contracts'), { recursive: true })
await build({ entryPoints: ['src/host/bridge/writing-controller.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output,
  plugins: [{ name: 'controlled-host-seams', setup(builder) {
    builder.onLoad({ filter: /[\\/]executor[\\/]model\.ts$/ }, () => ({ contents: `
      export async function selectedModel(ctx) { return { selected: {provider:'TEST_ONLY',model:'fixture'}, session:{}, contextWindow:100000, maxOutputTokens:4096 } }
      export async function callStageModel(ctx, session, selected, call) { call.signal.throwIfAborted(); ctx.calls.push(call); const answer=ctx.answers.shift(); return typeof answer==='string'?answer:JSON.stringify(answer) }
      export async function callStageModelWithImage() { throw new Error('No image model call permitted') }
    `, loader: 'ts' }))
    builder.onLoad({ filter: /[\\/]bridge[\\/]project-api\.ts$/ }, () => ({ contents: `export async function resolveStore(ctx) { return { io: ctx.io } }`, loader: 'ts' }))
  } }] })
const { WritingController } = await import(pathToFileURL(output).href)
const context = { requestId: 'req_test', workspaceId: 'workspace_test', sessionId: 'session_test' }
const section = { id: 's1', title: '叙事中的距离变化', purpose: '比较两种视角如何影响读者理解。', targetLength: 1200 }
function fixture() {
  let content = 'TEST_ONLY 叙事视角的来源片段。'
  const reads = []
  const host = { effect() {}, calls: [], answers: [
    { taskSummary: '分析叙事视角而非论证立场', targetLength: 1200, sections: [section], requirements: [{ id: 'r1', text: '分析叙事视角', quote: '分析叙事视角' }] },
    { coverage: [{ itemId: 'r1', sectionIds: ['s1'], status: 'covered', reason: '章节解释视角转换与叙事距离。' }], issues: [] },
  ], io: { async readBytes(path) { reads.push(path); assert.equal(path, '已选.txt'); return new TextEncoder().encode(content) } } }
  const spec = requirementDraftSpec.parse({ title: '', requirements: '分析叙事视角，约1200字', type: 'course-paper', language: 'zh-CN', format: 'docx',
    materials: ['已选.txt'], sections: [], targetLength: 4000 })
  return { host, reads, spec, controller: new WritingController(host, 'owner'), change: () => { content = 'changed' } }
}

test('actual outline controller reads only selected material, generates then reviews, and adopts its own candidate', async () => {
  const f = fixture()
  const { candidate } = await f.controller.suggestOutline({ context, spec: f.spec }, 'owner', new AbortController().signal)
  assert.equal(f.host.calls.length, 2)
  assert.match(f.host.calls[0].context.materials[0].text, /来源片段/)
  assert.deepEqual(f.host.calls[0].context.currentSections, [])
  assert.equal(f.host.calls[1].context.generated.sections[0].title, section.title)
  assert.equal(candidate.coverage[0].covered, true)
  assert.deepEqual(f.reads, ['已选.txt'])
  const result = await f.controller.adoptCandidate({ context, spec: f.spec, candidateId: candidate.candidateId, all: true }, 'owner')
  assert.equal(result.spec.targetLength, 1200)
  assert.equal(result.spec.structureOrigin, 'generated')
  assert.equal(result.spec.title, '')
  assert.equal(f.spec.sections.length, 0)
})

test('source changes after generation prevent adoption without replaying a model request', async () => {
  const f = fixture()
  const { candidate } = await f.controller.suggestOutline({ context, spec: f.spec }, 'owner', new AbortController().signal)
  f.change()
  await assert.rejects(f.controller.adoptCandidate({ context, spec: f.spec, candidateId: candidate.candidateId }, 'owner'), /资料.*改变/)
  assert.equal(f.host.calls.length, 2)
})

test('an invalid generated requirement stops before semantic review and leaves the draft alone', async () => {
  const f = fixture()
  f.host.answers[0].requirements[0].quote = '原文没有这条要求'
  await assert.rejects(f.controller.suggestOutline({ context, spec: f.spec }, 'owner', new AbortController().signal), /无法回到/)
  assert.equal(f.host.calls.length, 1)
  assert.deepEqual(f.spec.sections, [])
})

test('fenced generation and review responses pass the real controller without a repair call', async () => {
  const f = fixture()
  f.host.answers = f.host.answers.map(answer => '```json\n' + JSON.stringify(answer) + '\n```')
  const { candidate } = await f.controller.suggestOutline({ context, spec: f.spec }, 'owner', new AbortController().signal)
  assert.equal(candidate.sections[0].title, section.title)
  assert.equal(candidate.coverage[0].covered, true)
  assert.equal(f.host.calls.length, 2)
})

test('a malformed generation is repaired once before the separate semantic review', async () => {
  const f = fixture(), valid = structuredClone(f.host.answers[0])
  delete f.host.answers[0].taskSummary
  f.host.answers.splice(1, 0, valid)
  const { candidate } = await f.controller.suggestOutline({ context, spec: f.spec }, 'owner', new AbortController().signal)
  assert.equal(candidate.coverage[0].covered, true)
  assert.equal(f.host.calls.length, 3)
  assert.deepEqual(f.host.calls[1].context.formatIssues, [{ path: 'taskSummary', code: 'invalid_type' }])
})

test('concurrent cover edits share one host execution and adoption retains the latest cover', async () => {
  const f = fixture()
  const requests = Array.from({ length: 15 }, (_, i) => ({ ...f.spec,
    cover: { enabled: true, title: `封面 ${i}`, date: '', fields: [{ label: '姓名', value: `TEST_ONLY_${i}` }] } }))
  const results = await Promise.all(requests.map((spec, i) => f.controller.suggestOutline({ context, spec, operationId: `op_${i}` }, 'owner', new AbortController().signal)))
  assert.equal(new Set(results.map(row => row.candidate.candidateId)).size, 1)
  assert.equal(f.host.calls.length, 2, 'one generation and one review, not 15 pairs')
  const adopted = await f.controller.adoptCandidate({ context, spec: requests[14], candidateId: results[0].candidate.candidateId }, 'owner')
  assert.equal(adopted.spec.cover.fields[0].value, 'TEST_ONLY_14')
})

test('an explicit stop arriving before setup completes prevents provider calls', async () => {
  const f = fixture()
  f.controller.stopOutline({ context, operationId: 'op_early' }, 'owner')
  await assert.rejects(f.controller.suggestOutline({ context, spec: f.spec, operationId: 'op_early' }, 'owner', new AbortController().signal), { name: 'AbortError' })
  assert.equal(f.host.calls.length, 0)
})

test('mixed chapter, cover, page and submission requirements reach an adoptable candidate through the real controller', async () => {
  const f = fixture(), texts = ['分析叙事视角', '需要封面', '总计7页', '星期五提交']
  f.spec = requirementDraftSpec.parse({ ...f.spec, requirements: texts.join('\n'),
    cover: { enabled: true, title: 'TEST_ONLY', date: '', fields: [] },
    brief: { length: { value: 1200, pages: 7, coverPages: 1, bodyPages: 6 }, submission: { when: '星期五' } } })
  f.host.answers[0].requirements = texts.map((text, i) => ({ id: `r${i + 1}`, text, quote: text }))
  f.host.answers[1] = { coverage: [
    { itemId: 'r1', scope: 'sections', sectionIds: ['s1'], status: 'covered', reason: '章节承担分析。' },
    { itemId: 'r2', scope: 'document', documentFields: ['cover'], sectionIds: [], status: 'covered', reason: '配置启用了封面。' },
    { itemId: 'r3', scope: 'document', documentFields: ['requestedPages'], sectionIds: [], status: 'covered', reason: '计划7页。' },
    { itemId: 'r4', scope: 'submission', documentFields: ['submission'], sectionIds: [], status: 'covered', reason: '保留提交时间。' },
  ], issues: [] }
  const { candidate } = await f.controller.suggestOutline({ context, spec: f.spec }, 'owner', new AbortController().signal)
  assert.equal(f.host.calls.length, 2)
  assert.equal(f.host.calls[1].context.documentPlan.cover.enabled, true)
  assert.equal(f.host.calls[1].context.documentPlan.requestedPages.total, 7)
  assert.deepEqual(candidate.coverage.map(row => row.status), ['covered', 'covered', 'pending', 'pending'])
  const adopted = await f.controller.adoptCandidate({ context, spec: f.spec, candidateId: candidate.candidateId }, 'owner')
  assert.equal(adopted.spec.cover.enabled, true)
  assert.equal(adopted.spec.sections.length, 1)
})

test('an explicitly chapter-scoped empty reference gets one review-contract repair without regenerating the outline', async () => {
  const f = fixture(), validReview = structuredClone(f.host.answers[1])
  f.host.answers[1].coverage[0].scope = 'sections'; f.host.answers[1].coverage[0].sectionIds = []
  f.host.answers.push(validReview)
  const { candidate } = await f.controller.suggestOutline({ context, spec: f.spec }, 'owner', new AbortController().signal)
  assert.equal(candidate.coverage[0].covered, true)
  assert.equal(f.host.calls.length, 3)
  assert.equal(f.host.calls[2].context.formatIssues[0].path, 'coverage.r1.sectionIds')
  assert.equal(f.host.calls.filter(call => call.system.includes('结构规划助手')).length, 1)
})
