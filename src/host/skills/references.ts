import { join } from 'node:path'
import { digest, json } from '../../core/store/files.ts'
import { parseConfig } from '../../core/project/project.ts'
import { resourceLockSchema } from '../../shared/skills.ts'
import { runSnapshotSchema } from '../../shared/runs.ts'
import { invariant } from '../../shared/errors.ts'

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
      invariant(before.type === 'file' && before.size <= 2 * 1024 * 1024, 'SKILL_REFERENCES_UNAVAILABLE', '已登记项目的引用记录类型或大小异常，未卸载。')
      const text = await ctx.fs.readText(selected, signal)
      invariant((await ctx.fs.stat(selected, signal))?.version === before.version, 'SKILL_REFERENCES_CHANGED', '引用检查期间项目记录改变，未卸载。')
      observations.push({ rootFingerprint, path, hash: digest(text) })
      return text
    }
    const configText = await read('.scholarflow/project.yaml')
    if (!configText) continue
    const config = parseConfig(configText), lockText = await read('.scholarflow/resources.lock.json')
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
      invariant(/^run_[\w]+$/u.test(row.name) && ++checkedRuns <= 1000, 'SKILL_REFERENCE_SCAN_LIMIT', '项目包含未知运行目录或总量过多，未卸载。')
      const text = await read(`.scholarflow/runs/${row.name}/input.json`) ?? await read(`.scholarflow/runs/${row.name}/snapshot.json`)
      invariant(text, 'SKILL_REFERENCES_UNAVAILABLE', '一个历史运行缺少快照，引用状态未知，未卸载。')
      const run = runSnapshotSchema.parse(JSON.parse(text))
      invariant(run.projectId === config.project.id && run.runId === row.name, 'SKILL_REFERENCES_UNAVAILABLE', '历史运行快照的身份不同，未卸载。')
      if (run.skillDigests.some(skill => skill.qualifiedId === qualifiedId && skill.digest === resourceDigest)) references.push({ workspaceId: workspace.id, kind: 'run', recordId: run.runId })
    }
  }
  observations.sort((a, b) => `${a.rootFingerprint}/${a.path}`.localeCompare(`${b.rootFingerprint}/${b.path}`))
  return { references, observationHash: digest(json(observations)), checkedWorkspaces: seen.size, checkedRuns,
    limitation: '只检查当前 Host 已登记的本机工作区与运行；未登记或在其他机器的副本不在扫描范围。卸载将保留完整资源字节到私有回收区。' }
}
