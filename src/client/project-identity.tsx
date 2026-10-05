import React, { useState } from 'react'

type Props = { project: any; workspaceTitle: string; workspaces: any[]; context: () => any;
  api: (method: string, request: any) => Promise<any>; publish: (value: any) => void; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function ProjectIdentity({ project, workspaceTitle, workspaces, context, api, publish, run, busy }: Props) {
  const [reason, setReason] = useState(''), [plan, setPlan] = useState<any>()
  return <section aria-label="项目副本身份"><h3>当前工作区：{workspaceTitle}</h3>
    <p>将这个工作区明确绑定为独立副本。其他工作区及其当前请求继续保留。</p>
    <p>当前项目身份：{project.binding.projectId}</p>
    {project.identityConflict && <ul>{project.identityConflict.copies.map((row: any) => <li key={row.workspaceId}>
      另一个注册：{workspaces.find(item => item.workspaceId === row.workspaceId)?.title ?? row.workspaceId}</li>)}</ul>}
    <button disabled={busy || !!plan} onClick={() => run(async () => {
      const current = context(); delete current.projectId; delete current.expectedLedgerRevision
      publish(await api('project.inspect', { context: current }))
    })}>重新读取当前工作区身份</button>
    {project.recovery && <section aria-label="副本身份事务恢复"><h4>副本身份变更尚未提交完毕</h4>
      <p>恢复将完成此前明确确认的固定变更，保留旧身份原始快照。若目标出现外部改动，恢复会停止。</p>
      {project.recovery.transactions.map((row: any) => <div key={row.id}><p>{row.id}</p><ul>{row.files.map((file: any) => <li key={file.relativePath}>{file.relativePath} · {file.status === 'published' ? '已写入' : '待恢复'}</li>)}</ul></div>)}
      <button disabled={busy} onClick={() => run(async () => publish(await api('project.recover', { context: context(), planId: project.recovery.planId, planHash: project.recovery.planHash })))}>确认恢复副本身份事务</button>
    </section>}
    {!project.recovery && <>
      <label>绑定副本理由<textarea aria-label="绑定副本理由" disabled={busy || !!plan} value={reason} maxLength={4000} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={busy || !!plan || reason.trim().length < 10} onClick={() => run(async () => setPlan(await api('project.prepareCopy', { context: context(), reason })))}>预览绑定为副本</button>
    </>}
    {plan && <section role="dialog" aria-modal="false" aria-label="绑定为副本确认"><h4>确认仅改变这个工作区的身份</h4>
      <p>{workspaceTitle} · {plan.title}</p><p>{plan.oldProjectId} → {plan.projectId}</p><p>{plan.reason}</p>
      <details><summary>原项目配置</summary><pre>{plan.oldConfigText}</pre></details>
      <details open><summary>副本项目配置</summary><pre>{plan.newConfigText}</pre></details>
      <p>原始身份档案将保留以下文件的全文及摘要：</p><ul>{plan.originals.map((row: any) => <li key={row.relativePath}>{row.relativePath} · {row.contentHash}</li>)}</ul>
      {!!plan.detachedPointers.length && <p>旧执行索引归档：{plan.detachedPointers.join('、')}</p>}
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => { const value = await api('project.applyCopy', { context: context(), planId: plan.planId, planHash: plan.planHash });
        setPlan(undefined); publish(value) })}>确认绑定当前工作区为副本</button>
      <button disabled={busy} onClick={() => run(async () => { await api('project.dismissCopy', { planId: plan.planId }); setPlan(undefined) })}>取消绑定副本</button>
    </section>}
  </section>
}

export function ProjectIdentityHistory({ context, api, run, busy }: Pick<Props, 'context' | 'api' | 'run' | 'busy'>) {
  const [history, setHistory] = useState<any>()
  return <section aria-label="副本身份历史"><h4>副本身份与原始记录</h4>
    <button disabled={busy} onClick={() => run(async () => setHistory(await api('project.identityHistory', { context: context() })))}>读取副本身份历史</button>
    {history && <>
      {!history.records.length && <p>当前项目没有副本身份变更记录。</p>}
      <p>历史会话 ID 仅用于来源追踪。旧执行记录和已计费／未知请求不会因此获得当前会话权限，也不能从历史档案重新执行。</p>
      {history.records.map((row: any) => <details key={row.operationId}><summary>{row.oldProjectId} → {row.projectId} · {row.confirmedAt}</summary>
        <p>{row.reason}</p><p>确认操作 {row.operationId} · 来源会话 {row.sourceSessionId}</p>
        <ul>{row.originals.map((file: any) => <li key={file.relativePath}>{file.relativePath} · {file.contentHash}</li>)}</ul>
        <button disabled={busy} onClick={() => run(async () => {
          const value = await api('project.identityArchive', { context: context(), operationId: row.operationId })
          const url = URL.createObjectURL(new Blob([value.text], { type: 'application/json;charset=utf-8' })), link = document.createElement('a')
          link.href = url; link.download = `${value.operationId}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        })}>下载身份原始档案</button>
      </details>)}
    </>}
  </section>
}
