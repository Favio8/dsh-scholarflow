import { join } from 'node:path'
import { digest, json } from '../../core/store/files.ts'
import { parseConfig } from '../../core/project/project.ts'
import { resourceLockSchema } from '../../shared/skills.ts'
import { runSnapshotSchema } from '../../shared/runs.ts'
import { draftSequenceInputSchema, draftSequencePlanSchema, draftSequenceRunSchema, draftSequenceCheckpointSchema } from '../../shared/draft-sequence.ts'
import { workflowInputSchema, workflowPlanSchema, workflowRunSchema } from '../../core/pipeline/workflow.ts'
import { workflowCheckpointSchema } from '../../shared/workflow.ts'
import { invariant } from '../../shared/errors.ts'
import { verifiedIdentityLineage } from '../../core/project/identity.ts'

type Host = any
export async function knownSkillReferences(ctx: Host, qualifiedId: string, resourceDigest: string, signal: AbortSignal) {
  const workspaces = ctx.workspaceRegistry.list()
  invariant(workspaces.length <= 200, 'SKILL_REFERENCE_SCAN_LIMIT', 'Host 已登记工作区过多，尚未完成引用检查；未卸载。')
  const references: { workspaceId: string; kind: 'project' | 'run'; recordId: string }[] = []
  const observations: { rootFingerprint: string; path: string; hash: string }[] = [], seen = new Set<string>()
  let checkedRuns = 0
  for (const workspace of workspaces) {
    signal.throwIfAborted()
    const root = await ctx.fs.resolve(workspace.path, { signal }), canonical = ctx.fs.processPath(root)
    const rootFingerprint = digest(process.platform === 'win32' ? canonical.toLowerCase() : canonical)
    if (seen.has(rootFingerprint)) continue
    seen.add(rootFingerprint)
    const target = async (path: string) => {
      const selected = await ctx.fs.resolve(join(canonical, path), { signal })
      invariant(ctx.fs.contains(root, selected), 'SKILL_REFERENCES_UNAVAILABLE', '已登记项目的元数据链接越界；引用状态未知，未卸载。')
      return selected
    }
    const read = async (path: string) => {
      const selected = await target(path), before = await ctx.fs.stat(selected, signal)
      if (!before) { observations.push({ rootFingerprint, path, hash: 'absent' }); return undefined }
      const cap = /^\.scholarflow\/identity\/history\/project_copy_[a-f0-9]{32}\.json$/u.test(path) ? 8 * 1024 * 1024 : 2 * 1024 * 1024
      invariant(before.type === 'file' && before.size <= cap, 'SKILL_REFERENCES_UNAVAILABLE', '已登记项目的引用记录类型或大小异常，未卸载。')
      const text = await ctx.fs.readText(selected, signal)
      invariant((await ctx.fs.stat(selected, signal))?.version === before.version, 'SKILL_REFERENCES_CHANGED', '引用检查期间项目记录改变，未卸载。')
      observations.push({ rootFingerprint, path, hash: digest(text) })
      return text
    }
    const configText = await read('.scholarflow/project.yaml')
    if (!configText) continue
    const config = parseConfig(configText), lockText = await read('.scholarflow/resources.lock.json')
    // This adapter supplies content versions for readonly lineage observation;
    // it has no Session identity, writer or execution capability.
    const lineage = await verifiedIdentityLineage({ read: async path => {
      const text = await read(path); return text === undefined ? undefined : { text, version: digest(text) }
    }, stat: async path => {
      const info = await ctx.fs.stat(await target(path), signal); return info && { path, type: info.type, size: info.size }
    } }, config.project.id)
    const historicalIdentity = (identity: string) => lineage.projectIds.includes(identity)
    invariant(lockText, 'SKILL_REFERENCES_UNAVAILABLE', '一个已登记项目缺少资源锁，不能确认其引用状态。')
    const raw = JSON.parse(lockText), parsed = resourceLockSchema.safeParse(raw)
    if (parsed.success) {
      invariant(parsed.data.projectId === config.project.id, 'SKILL_REFERENCES_UNAVAILABLE', '已登记项目的资源锁身份不同，未卸载。')
      const bindings = parsed.data.bindings
      invariant(bindings.length === config.skills.bindings.length && config.skills.bindings.every((row, index) => row.ref === bindings[index].bindingId
        && json(row.stages) === json(bindings[index].enabledStages)), 'SKILL_REFERENCES_UNAVAILABLE', '一个已登记项目的配置与资源锁不一致，未卸载。')
      if (bindings.some(row => row.scope === 'library' && row.qualifiedId === qualifiedId && row.digest === resourceDigest)) references.push({ workspaceId: workspace.id, kind: 'project', recordId: config.project.id })
    } else {
      invariant(raw.schemaVersion === 1 && raw.projectId === config.project.id && Array.isArray(raw.skills) && raw.skills.length === 0 && config.skills.bindings.length === 0,
        'SKILL_REFERENCES_UNAVAILABLE', '旧资源锁含无法确认的引用，未卸载。')
    }
    const runRoot = await target('.scholarflow/runs'), info = await ctx.fs.stat(runRoot, signal)
    if (!info) continue
    invariant(info.type === 'directory', 'SKILL_REFERENCES_UNAVAILABLE', '项目运行目录类型异常，未卸载。')
    const rows = await ctx.fs.listDir(runRoot, signal)
    invariant(rows.length <= 1000, 'SKILL_REFERENCE_SCAN_LIMIT', '一个项目的运行记录过多，未卸载。')
    observations.push({ rootFingerprint, path: '.scholarflow/runs', hash: digest(json(rows.map((row: Host) => ({ name: row.name, type: row.type })).sort((a: Host, b: Host) => a.name.localeCompare(b.name)))) })
    for (const row of rows) {
      if (row.type !== 'directory') continue
      invariant(/^(?:run|workflow|draft)_[\w]+$/u.test(row.name) && ++checkedRuns <= 1000, 'SKILL_REFERENCE_SCAN_LIMIT', '项目包含未知运行目录或总量过多，未卸载。')
      const text = await read(`.scholarflow/runs/${row.name}/input.json`) ?? await read(`.scholarflow/runs/${row.name}/snapshot.json`)
      invariant(text, 'SKILL_REFERENCES_UNAVAILABLE', '一个历史运行缺少快照，引用状态未知，未卸载。')
      if (!row.name.startsWith('run_')) {
        const [planText, checkpointText, stateText] = await Promise.all(['plan.json', 'checkpoint.json', 'run.json'].map(file => read(`.scholarflow/runs/${row.name}/${file}`)))
        invariant(planText && checkpointText && stateText, 'SKILL_REFERENCES_UNAVAILABLE', '父流程记录不完整，引用状态未知，未卸载。')
        if (row.name.startsWith('workflow_')) {
          const input = workflowInputSchema.parse(JSON.parse(text)), plan = workflowPlanSchema.parse(JSON.parse(planText)), state = workflowRunSchema.parse(JSON.parse(stateText))
          const checkpoint = workflowCheckpointSchema.parse(JSON.parse(checkpointText)), { contentHash, ...body } = plan
          invariant(historicalIdentity(input.projectId) && [input, plan, state, checkpoint].every(value => value.projectId === input.projectId && value.workflowId === row.name) &&
            plan.inputHash === digest(text) && contentHash === digest(json(body)) && state.planHash === contentHash && checkpoint.planHash === contentHash &&
            state.checkpointHash === digest(checkpointText) && state.status === checkpoint.status,
            'SKILL_REFERENCES_UNAVAILABLE', '引导目标身份或摘要改变，引用状态未知，未卸载。')
          // The goal record declares no fixed Skill versions; actual stage
          // snapshots retain their own references and are scanned separately.
        } else {
          const input = draftSequenceInputSchema.parse(JSON.parse(text)), plan = draftSequencePlanSchema.parse(JSON.parse(planText)), state = draftSequenceRunSchema.parse(JSON.parse(stateText))
          const checkpoint = draftSequenceCheckpointSchema.parse(JSON.parse(checkpointText)), { contentHash, ...body } = plan
          invariant(input.skillDigests && historicalIdentity(input.projectId) && [input, plan, state, checkpoint].every(value => value.projectId === input.projectId && value.sequenceId === row.name) &&
            plan.inputHash === digest(text) && state.inputHash === plan.inputHash && checkpoint.inputHash === plan.inputHash && contentHash === digest(json(body)) &&
            state.planHash === contentHash && checkpoint.planHash === contentHash && state.checkpointHash === digest(checkpointText) && state.status === checkpoint.status,
            'SKILL_REFERENCES_UNAVAILABLE', '初稿顺序缺少固定 Skill 清单、身份或摘要不一致，引用状态未知，未卸载。')
          if (input.skillDigests.some(skill => skill.qualifiedId === qualifiedId && skill.digest === resourceDigest)) references.push({ workspaceId: workspace.id, kind: 'run', recordId: input.sequenceId })
        }
        continue
      }
      const run = runSnapshotSchema.parse(JSON.parse(text))
      invariant(historicalIdentity(run.projectId) && run.runId === row.name, 'SKILL_REFERENCES_UNAVAILABLE', '历史运行快照的身份不同，未卸载。')
      if (run.skillDigests.some(skill => skill.qualifiedId === qualifiedId && skill.digest === resourceDigest)) references.push({ workspaceId: workspace.id, kind: 'run', recordId: run.runId })
    }
  }
  observations.sort((a, b) => `${a.rootFingerprint}/${a.path}`.localeCompare(`${b.rootFingerprint}/${b.path}`))
  return { references, observationHash: digest(json(observations)), checkedWorkspaces: seen.size, checkedRuns,
    limitation: '只检查当前 Host 已登记的本机工作区与运行；未登记或在其他机器的副本不在扫描范围。卸载将保留完整资源字节到私有回收区。' }
}
