// TEST_ONLY: guided state transitions do not claim successful research or paid execution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { prepareWorkflow, startWorkflow, currentWorkflow, readWorkflow, prepareWorkflowAction, applyWorkflowAction } from '../../src/core/pipeline/workflow.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { runReview } from '../../src/core/review/review.ts'
import { prepareDelivery, createDelivery } from '../../src/core/export/delivery.ts'
import { stage } from '../../src/shared/schema.ts'
import { recover } from '../../src/core/store/transactions.ts'
const goal = { researchQuestion: 'TEST_ONLY 不编造缺失结果', minimumSources: 1, minimumLocatedEvidence: 1,
  noFormalRequirementsReason: 'TEST_ONLY 没有正式课程要求；缺失证据和结果须保留。' }
const context = { requestId: 'req_TEST_ONLY', sessionId: 'session_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY' }
async function setup(io = new MemoryStore({ 'raw.txt': 'TEST_ONLY 原始资料保持原样' })) {
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY guided workflow', type: 'research-paper' }))
  return io
}
async function start(io: MemoryStore) { return (await startWorkflow(io, await prepareWorkflow(io, goal, context.sessionId))).workflowId }
async function act(io: MemoryStore, workflowId: string, action: string, at?: string, reason = '') {
  const plan = await prepareWorkflowAction(io, { context, workflowId, action: action as any, stage: at as any, reason })
  return applyWorkflowAction(io, plan)
}
test('guided previews never write or invoke paid executors; current stages require order and retain explicit insufficiency', async () => {
  const io = await setup(), before = io.writes, plan = await prepareWorkflow(io, goal, context.sessionId)
  assert.equal(io.writes, before); assert.equal((await currentWorkflow(io)).workflow, undefined)
  const { workflowId } = await startWorkflow(io, plan)
  await assert.rejects(act(io, workflowId, 'complete-stage', 'drafting'), { code: 'WORKFLOW_STAGE_ORDER' })
  await act(io, workflowId, 'complete-stage', 'requirements')
  await assert.rejects(act(io, workflowId, 'complete-stage', 'requirements'), { code: 'WORKFLOW_STAGE_CURRENT' })
  await assert.rejects(act(io, workflowId, 'complete-stage', 'research'), { code: 'WORKFLOW_GATE_BLOCKED' })
  await act(io, workflowId, 'complete-stage', 'research', 'TEST_ONLY 当前未达来源与证据目标，保留不足，继续补材料。')
  const saved = await readWorkflow(io, workflowId)
  assert.equal(saved.checkpoint.stamps[1].outcome, 'insufficient')
  await assert.rejects(act(io, workflowId, 'skip-stage', 'outline', 'TEST_ONLY 不应跳过大纲。'), { code: 'WORKFLOW_SKIP_DENIED' })
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY 原始资料保持原样')
})
test('pause and cold resume retain approvals; actual changed inputs stale downstream stages and a changed configuration cannot resume', async () => {
  const io = await setup(), workflowId = await start(io)
  await act(io, workflowId, 'complete-stage', 'requirements')
  await act(io, workflowId, 'pause')
  const cold = new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text])))
  assert.equal((await currentWorkflow(cold)).workflow!.checkpoint.status, 'paused')
  await act(cold, workflowId, 'resume')
  assert.equal((await readWorkflow(cold, workflowId)).gates[0].current, true)
  await act(cold, workflowId, 'complete-stage', 'research', 'TEST_ONLY 明确保留缺口，当前证据不足。')
  const first = await snapshot(cold)
  await confirmOutline(cold, { version: 0, title: 'TEST_ONLY', researchQuestion: goal.researchQuestion, thesis: 'TEST_ONLY', confirmation: 'draft',
    sections: [{ id: 'sec_TEST_ONLY', title: '正文', purpose: '', claimIds: [], missingEvidence: [] }] }, first.ledger.revision, 0)
  await act(cold, workflowId, 'complete-stage', 'outline')
  const profile = '.scholarflow/profiles/writing.md'; cold.externalEdit(profile, (await cold.read(profile))!.text + '\nTEST_ONLY 改文风\n')
  const profiled = await readWorkflow(cold, workflowId)
  assert.equal(profiled.gates[0].current, true); assert.equal(profiled.gates[1].current, true); assert.equal(profiled.gates[2].current, true)
  cold.externalEdit('.scholarflow/context/decisions.md', '# TEST_ONLY 改变研究方案\n')
  assert.equal((await readWorkflow(cold, workflowId)).gates[2].state, 'stale')
  await act(cold, workflowId, 'pause')
  const config = '.scholarflow/project.yaml'; cold.externalEdit(config, (await cold.read(config))!.text + '\n# TEST_ONLY changed config bytes\n')
  await assert.rejects(act(cold, workflowId, 'resume'), { code: 'WORKFLOW_INPUT_CHANGED' })
  await act(cold, workflowId, 'cancel', undefined, 'TEST_ONLY 配置变更，保留原目标历史并取消。')
  const oldInput = (await cold.read(`.scholarflow/runs/${workflowId}/input.json`))!.text
  const replacement = await start(cold)
  assert.notEqual(replacement, workflowId); assert.equal((await cold.read(`.scholarflow/runs/${workflowId}/input.json`))!.text, oldInput)
})
test('a full seven-stage guided checkpoint sequence ends with issues and never closes failures or declares absent results', async () => {
  const io = await setup(), initial = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: goal.researchQuestion, thesis: 'TEST_ONLY', confirmation: 'draft',
    sections: [{ id: 'sec_TEST_ONLY', title: '真实结果待补', purpose: '', claimIds: [], missingEvidence: ['没有真实结果'] }] }, initial.ledger.revision, 0)
  let current = await snapshot(io)
  await saveManual(io, '# TEST_ONLY\n\n## 真实结果待补\n\n[待补：真实结果与定位证据；TEST_ONLY 缺失保留。]\n', current.document.contentHash, current.ledger.revision)
  current = await snapshot(io); await runReview(io, current.ledger.revision)
  current = await snapshot(io); await createDelivery(io, await prepareDelivery(io), 'working-draft', current.ledger.revision)
  const before = await snapshot(io), workflowId = await start(io)
  for (const step of stage.options) await act(io, workflowId, step === 'revision' ? 'stop-revision' : 'complete-stage', step,
    'TEST_ONLY 明确保留证据不足、待补及未关闭问题，仅交付当前工作草稿。')
  await act(io, workflowId, 'finish')
  const finished = await readWorkflow(io, workflowId), after = await snapshot(io)
  assert.equal(finished.checkpoint.status, 'completed-with-issues'); assert.equal(finished.checkpoint.stamps.length, 7)
  assert.deepEqual(after.ledger.reviewIssues, before.ledger.reviewIssues); assert.equal(after.document.contentHash, before.document.contentHash)
  assert.ok(Object.values(after.ledger.reviewIssues).some(row => row.severity === 'B0' && row.state === 'open'))
  await assert.rejects(act(io, workflowId, 'resume'), { code: 'WORKFLOW_TERMINAL' })
})
test('stale approval, duplicate starts, active stage ownership and modified checkpoints cannot mutate guided state', async () => {
  const io = await setup(), plan = await prepareWorkflow(io, goal, context.sessionId)
  const results = await Promise.allSettled([startWorkflow(io, plan), startWorkflow(io, plan)])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  const workflowId = plan.workflowId, action = await prepareWorkflowAction(io, { context, workflowId, action: 'complete-stage', stage: 'requirements', reason: '' })
  io.externalEdit('.scholarflow/context/decisions.md', '# TEST_ONLY changed after preview\n')
  await assert.rejects(applyWorkflowAction(io, action), { code: 'WORKFLOW_INPUT_CHANGED' })
  io.externalEdit('.scholarflow/runs/active.json', JSON.stringify({ runId: 'run_TEST_ONLY' }))
  const pause = await prepareWorkflowAction(io, { context, workflowId, action: 'pause', reason: '' })
  const writes = io.writes; await assert.rejects(applyWorkflowAction(io, pause), { code: 'RUN_IN_PROGRESS' }); assert.equal(io.writes, writes)
  const path = `.scholarflow/runs/${workflowId}/checkpoint.json`, checkpoint = JSON.parse((await io.read(path))!.text)
  checkpoint.revision++; io.externalEdit(path, JSON.stringify(checkpoint))
  await assert.rejects(readWorkflow(io, workflowId), { code: 'WORKFLOW_INVALID' })
})
test('workflow multi-file interruption recovers the original confirmed action without rebuilding or replaying it', async () => {
  class FaultStore extends MemoryStore {
    faultPath?: string
    override async write(path: string, text: string, expected: any) {
      if (path === this.faultPath) { this.faultPath = undefined; throw new Error('TEST_ONLY crash before run publication') }
      return super.write(path, text, expected)
    }
  }
  const io = await setup(new FaultStore()) as FaultStore, workflowId = await start(io)
  const plan = await prepareWorkflowAction(io, { context, workflowId, action: 'complete-stage', stage: 'requirements', reason: '' })
  io.faultPath = `.scholarflow/runs/${workflowId}/run.json`
  await assert.rejects(applyWorkflowAction(io, plan), /TEST_ONLY crash/)
  await assert.rejects(readWorkflow(io, workflowId), { code: 'WORKFLOW_INVALID' })
  await io.lock(() => recover(io, 'manuscript'))
  const restored = await readWorkflow(io, workflowId)
  assert.equal(restored.checkpoint.stamps.length, 1); assert.equal(restored.gates[0].current, true)
  await assert.rejects(applyWorkflowAction(io, plan), { code: 'WORKFLOW_INPUT_CHANGED' })
  assert.equal((await io.list(`.scholarflow/runs/${workflowId}/decisions`)).length, 1)
})
