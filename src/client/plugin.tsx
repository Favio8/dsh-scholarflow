import React, { useState, useEffect } from 'react'
import { Research, OutlineEditor } from './research.tsx'
import { Draft } from './draft.tsx'
import { ReviewExport } from './review-export.tsx'
import { Overview } from './overview.tsx'

type Host = any
const TABS = ['Overview', 'Research', 'Outline', 'Draft', 'Review', 'Export'] as const
const TAB_LABELS = ['概览', '资料与研究', '大纲', '正文', '审查', '导出']
const CSS = `.sf-app{height:100%;display:flex;flex-direction:column;color:inherit;font-family:inherit}.sf-header{padding:16px;border-bottom:1px solid #8884}.sf-columns{display:flex;min-height:0;flex:1}.sf-body{flex:1;min-width:0;padding:20px;overflow:auto}.sf-agent{width:360px;min-width:300px;border-left:1px solid #8884;display:flex;flex-direction:column;overflow:hidden}.sf-app button,.sf-app select{font:inherit;color:inherit;padding:7px 12px;border-radius:6px;background:transparent;border:1px solid #8886}.sf-error{color:#d45151;white-space:pre-wrap}.sf-app pre{white-space:pre-wrap}.sf-app label{display:block;margin:12px 0}.sf-settings{padding:20px;max-width:760px}@media(max-width:1000px){.sf-agent{width:310px}}@media(max-width:760px){.sf-columns{flex-direction:column}.sf-agent{width:100%;height:380px;border-left:0;border-top:1px solid #8884;flex-shrink:0}}`
export const inject = ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'layout']
const EXTRA_CSS = `.sf-app [hidden]{display:none!important}.sf-app textarea{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px;padding:8px;resize:vertical}.sf-app input{font:inherit;max-width:100%;box-sizing:border-box}.sf-app pre{overflow-wrap:anywhere}.sf-tabs{display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid #8884;padding:12px 0;margin:12px 0}.sf-tabs button[aria-selected=true]{background:#8882;border-color:currentColor}.sf-app button:focus-visible,.sf-app input:focus-visible,.sf-app select:focus-visible,.sf-app textarea:focus-visible{outline:2px solid currentColor;outline-offset:2px}`

export function apply(ctx: Host) {
  const call = async (method: string, args: unknown = {}) => {
    const result = await ctx.connection.rpc.call('/api', `scholarflow.v1/${method}`, { args })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const api = async (method: string, request: Host) => {
    const result = await call(method, { request })
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.data
  }
  function Agent(props: Host) {
    const session = props.useSession((s: Host) => s)
    return <>{props.renderFactorySlot('conversation.content', {
      variant: 'main', phase: session?.blank ? 'hero' : 'active', hero: !!session?.blank,
    })}</>
  }
  function Workspace(props: Host) {
    const [info, setInfo] = useState<Host>()
    const [error, setError] = useState('')
    useEffect(() => { let live = true; call('diagnostics').then(v => live && setInfo(v)).catch(e => live && setError(e.message)); return () => { live = false } }, [])
    return <div className="sf-app"><style>{CSS + EXTRA_CSS}</style><header className="sf-header"><b>ScholarFlow</b> · 学术写作工作台</header>
      <div className="sf-columns"><main className="sf-body"><h2>论文工作台</h2>
        {error && <p role="alert" className="sf-error">{error}</p>}
        {info && <p role="status">已连接 Host · 协议 v{info.protocol} · {info.settings.length ? '设置可持久化' : '设置能力不足'}</p>}
        {props.renderSlot('scholarflow.project', {})}
      </main><aside className="sf-agent" aria-label="DSH 当前会话">{props.renderSlot('scholarflow.agent', {})}</aside></div></div>
  }
  function Project(props: Host) {
    const workspaces = props.useWorkspaces((state: Host) => state.items)
    const workspace = workspaces.find((item: Host) => item.sessionIds.includes(props.sessionId))
    const [selectedWorkspace, setSelectedWorkspace] = useState('')
    const [project, setProject] = useState<Host>()
    const [title, setTitle] = useState('')
    const [type, setType] = useState('course-paper')
    const [output, setOutput] = useState('manuscript')
    const [plan, setPlan] = useState<Host>()
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [tab, setTab] = useState<(typeof TABS)[number]>('Overview')
    const context = () => ({ requestId: `req_${crypto.randomUUID()}`, workspaceId: workspace?.workspaceId, sessionId: props.sessionId,
      ...(project?.ledger && { expectedLedgerRevision: project.ledger.revision }),
      ...(project?.binding?.projectId && project.binding.workspaceId === workspace?.workspaceId && project.binding.sessionId === props.sessionId
        ? { projectId: project.binding.projectId } : {}) })
    useEffect(() => {
      let live = true
      setPlan(undefined); setProject(undefined); setError(''); setTab('Overview')
      if (workspace && props.sessionId) api('project.inspect', { context: context() }).then(value => { if (live) setProject(value) }).catch(e => live && setError(e.message))
      return () => { live = false }
    }, [workspace?.workspaceId, props.sessionId])
    const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
    const startSession = () => act(async () => {
      const workspaceId = selectedWorkspace || workspace?.workspaceId
      if (!workspaceId) throw new Error('请先选择 DSH 工作区。')
      // Installed ClientSessions.create drops agentPreset; call the authenticated
      // Host contract explicitly, then refresh the public catalog before retaining.
      const created = await ctx.connection.rpc.call('/api', 'session/create', { args: { request: { workspaceId, agentPreset: 'scholarflow' } } })
      if (!created.ok) throw new Error(created.error.message)
      await ctx.sessions.refresh()
      const sessionId = created.value.sessionId
      ctx.uiWorkspace.openSession(sessionId)
      ctx.layout.selectPanel('scholarflow')
    })
    return <section className="sf-project" aria-label="ScholarFlow 项目">
      <label>DSH 工作区 <select aria-label="DSH 工作区" value={selectedWorkspace || workspace?.workspaceId || ''} onChange={e => setSelectedWorkspace(e.target.value)}><option value="">请选择</option>
        {workspaces.map((item: Host) => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select></label>
      <button disabled={busy} onClick={startSession}>新建 ScholarFlow 会话</button>
      {error && <p role="alert" className="sf-error">{error}</p>}
      {!project && <p>选择 DSH 工作区并创建专属会话，切换 Mode 本身不会创建论文目录。</p>}
      {project && project.binding.sessionId === props.sessionId && project.binding.workspaceId === workspace?.workspaceId && !project.initialized && <>
        <p>当前工作区：{workspace.title} · 尚未初始化</p>
        {project.recovery ? <section aria-label="事务恢复确认"><h3>检测到未完成的项目事务</h3>
          <p>恢复只会完成已记录的提交。若文件出现外部修改，保留当前稿件并停止恢复。</p>
          {project.recovery.transactions.map((txn: Host) => <div key={txn.id}><p>{txn.id}</p><ul>{txn.files.map((file: Host) => <li key={file.relativePath}>{file.relativePath} · {file.status === 'published' ? '已写入' : '待恢复'}</li>)}</ul></div>)}
          <button disabled={busy} onClick={() => act(async () => setProject(await api('project.recover', { context: context(), planId: project.recovery.planId, planHash: project.recovery.planHash })))}>确认恢复已记录事务</button>
        </section> : project.metadataExists ? <p role="alert">检测到既有 .scholarflow 目录，请先检查项目，禁止覆盖。</p> : <>
          <label>项目标题 <input aria-label="项目标题" value={title} onChange={e => setTitle(e.target.value)} maxLength={300} /></label>
          <label>论文类型 <select aria-label="论文类型" value={type} onChange={e => setType(e.target.value)}><option value="course-paper">课程论文</option><option value="literature-review">文献综述</option><option value="research-paper">研究论文</option></select></label>
          <label>论文输出目录 <input aria-label="论文输出目录" value={output} onChange={e => setOutput(e.target.value)} /></label>
          <button disabled={busy || !title.trim()} onClick={() => act(async () => setPlan(await api('project.prepareInit', { context: context(), input: { title: title.trim(), type, manuscriptDir: output } })))}>预览初始化计划</button>
        </>}
      </>}
      {plan && <section role="dialog" aria-modal="false" aria-label="初始化确认"><h3>确认创建专属项目文件</h3>
        <ul>{plan.files.map((file: Host) => <li key={file.relativePath}>{file.relativePath}</li>)}</ul>
        {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
        <button disabled={busy} onClick={() => act(async () => { setProject(await api('project.initialize', { context: context(), planId: plan.planId, planHash: plan.planHash })); setPlan(undefined) })}>确认初始化</button>
        <button disabled={busy} onClick={() => setPlan(undefined)}>取消</button></section>}
      {project?.initialized && project.binding.sessionId === props.sessionId && project.binding.workspaceId === workspace?.workspaceId && <><h3>{project.config.project.title}</h3><p>项目已保存 · ledger 版本 {project.ledger.revision} · {project.document.externalChange ? '检测到外部稿件修改' : '主稿版本一致'}</p>
        {!!project.configWarnings?.length && <p role="alert">以下配置键未生效，原文件已保留：{project.configWarnings.join('、')}</p>}
        <p>当前绑定：{project.binding.projectId}。同一工作区的多个 ScholarFlow 会话读取同一份项目数据。</p>
        <nav className="sf-tabs" role="tablist" aria-label="论文工作区页面">{TABS.map((name, index) => <button key={name} id={`sf-tab-${name}`} role="tab" aria-controls={`sf-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={e => {
          const next = e.key === 'ArrowRight' ? (index + 1) % TABS.length : e.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
          if (next < 0) return; e.preventDefault(); setTab(TABS[next]); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#sf-tab-${TABS[next]}`)?.focus()
        }}>{name} · {TAB_LABELS[index]}</button>)}</nav>
        <div id="sf-panel-Overview" role="tabpanel" aria-labelledby="sf-tab-Overview" hidden={tab !== 'Overview'}><Overview key={`overview_${project.binding.projectId}`} project={project} context={context} api={api} refresh={async () => setProject(await api('project.inspect', { context: context() }))} run={act} busy={busy} /></div>
        <div id="sf-panel-Research" role="tabpanel" aria-labelledby="sf-tab-Research" hidden={tab !== 'Research'}><Research key={`research_${project.binding.projectId}`} project={project} context={context} api={api} refresh={async () => setProject(await api('project.inspect', { context: context() }))} run={act} busy={busy} /></div>
        <div id="sf-panel-Outline" role="tabpanel" aria-labelledby="sf-tab-Outline" hidden={tab !== 'Outline'}><OutlineEditor key={`outline_${project.binding.projectId}`} project={project} context={context} api={api} refresh={async () => setProject(await api('project.inspect', { context: context() }))} run={act} busy={busy} /></div>
        <div id="sf-panel-Draft" role="tabpanel" aria-labelledby="sf-tab-Draft" hidden={tab !== 'Draft'}><Draft key={`draft_${project.binding.projectId}`} project={project} context={context} api={api} refresh={async () => setProject(await api('project.inspect', { context: context() }))} run={act} busy={busy} /></div>
        <ReviewExport key={`review_${project.binding.projectId}`} project={project} context={context} api={api} refresh={async () => setProject(await api('project.inspect', { context: context() }))} run={act} busy={busy} mode={tab} />
      </>}
    </section>
  }
  function Settings() {
    const [row, setRow] = useState<Host>()
    const [message, setMessage] = useState('')
    useEffect(() => { let live = true; call('diagnostics').then(v => live && setRow(v.settings[0])).catch(e => live && setMessage(e.message)); return () => { live = false } }, [])
    const save = async (key: string, value: unknown) => {
      try {
        const result = await ctx.connection.rpc.call('/api', 'settings/update', { args: { ns: 'scholarflow', patch: { [key]: value }, expectedRevision: row.revision } })
        if (!result.ok) throw new Error(result.error.message)
        setRow(result.value); setMessage('已保存，仅影响新项目默认值。')
      } catch (e) { setMessage((e as Error).message) }
    }
    return <section className="sf-app sf-settings"><style>{CSS}</style><h2>ScholarFlow 设置</h2>
      {row ? <><label>新项目默认类型 <select aria-label="新项目默认类型" value={row.value.defaultProjectType} onChange={e => save('defaultProjectType', e.target.value)}>
        <option value="course-paper">课程论文</option><option value="literature-review">文献综述</option><option value="research-paper">研究论文</option></select></label>
        <label><input type="checkbox" checked={row.value.networkEnabled} onChange={e => save('networkEnabled', e.target.checked)} />允许外部检索（查询词发送给检索提供方）</label></>
        : <p>正在读取宿主设置…</p>}<p role="status">{message}</p></section>
  }
  ctx.effect(() => ctx.slots.inject('main', function* () {
    yield ctx.slots.register({ name: 'main', key: 'scholarflow', children: { 'scholarflow.agent': { kind: 'single', scope: 'session-maybe' }, 'scholarflow.project': { kind: 'single', scope: 'session-maybe' } } }, Workspace)
    yield ctx.slots.register({ name: 'scholarflow.agent' }, Agent)
    yield ctx.slots.register({ name: 'scholarflow.project' }, Project)
  }), 'scholarflow: workspace and host conversation')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'scholarflow', order: 50, label: () => 'ScholarFlow' }, () => <span>ScholarFlow</span>)), 'scholarflow: navigation')
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'scholarflow-settings', order: 50, label: () => 'ScholarFlow' }, Settings)), 'scholarflow: settings')
}
