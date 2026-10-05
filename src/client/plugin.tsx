import React, { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { Research, OutlineEditor } from './research.tsx'
import { Draft } from './draft.tsx'
import { ReviewExport } from './review-export.tsx'
import { Overview } from './overview.tsx'
import { AcademicSkills } from './academic-skills.tsx'
import { WritingProfiles } from './writing-profiles.tsx'
import { ReadonlyProject } from './readonly-project.tsx'
import { ProjectIdentity } from './project-identity.tsx'
import { SelectionCard, clearSelectionCard, invalidateSelectionCard } from './selection-card.tsx'
import { useConfirmationFocus } from './confirmation-focus.ts'
import { CAPTION_CSS, CHAT_CSS, WorkbenchIcon } from './workbench-chrome.tsx'
import { CHAT_ID, CHAT_KIND, NATIVE_DOCK_CSS, NativeTools, createNativeHeader, createWorkbenchNavigation, openExistingChat } from './native-dock.tsx'

type Host = any
const TABS = ['Overview', 'Research', 'Outline', 'Draft', 'Review', 'Export'] as const
const TAB_LABELS = ['概览', '资料与研究', '大纲', '正文', '审查', '导出']
const CSS = `.sf-app{height:100%;display:flex;flex-direction:column;color:inherit;font-family:inherit}.sf-header{padding:16px;border-bottom:1px solid #8884}.sf-columns{display:flex;min-height:0;flex:1}.sf-body{flex:1;min-width:0;padding:20px;overflow:auto}.sf-agent{width:360px;min-width:300px;border-left:1px solid #8884;display:flex;flex-direction:column;overflow:hidden}.sf-body button,.sf-body select,.sf-header button,.sf-settings button,.sf-settings select{font:inherit;color:inherit;padding:7px 12px;border-radius:6px;background:transparent;border:1px solid #8886}.sf-error{color:#d45151;white-space:pre-wrap}.sf-app pre{white-space:pre-wrap}.sf-app label{display:block;margin:12px 0}.sf-settings{padding:20px;max-width:760px}@media(max-width:1000px){.sf-agent{width:310px}}@media(max-width:760px){.sf-columns{flex-direction:column}.sf-agent{width:100%;height:380px;border-left:0;border-top:1px solid #8884;flex-shrink:0}}`
export const inject = ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'layout', 'sidebarRight', 'sidebarRightTabs']
const LAYOUT_CSS = `.sf-agent-resize{width:8px;flex-shrink:0;cursor:col-resize;touch-action:none;background:#8881}.sf-agent-resize:focus-visible{outline:2px solid currentColor;outline-offset:-2px}.sf-app[data-sf-narrow=true] .sf-agent{height:100%;min-height:0;flex:1}.sf-header{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.sf-header button{margin-left:auto}`
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
  const navigation = createWorkbenchNavigation(ctx, WorkspaceSurface)
  const nativeHeader = createNativeHeader(ctx)
  function WorkspaceSurface(props: Host) { return props.renderFactorySlot('scholarflow.workspace', {}) }
  function LegacyWorkspace(props: Host) {
    const readCurrent = () => ctx.uiSession.adapter.current.getSnapshot().key
    const current = useSyncExternalStore(listener => ctx.uiSession.adapter.current.subscribe(listener), readCurrent, readCurrent)
    useEffect(() => { if (current) navigation.open(current) }, [current])
    return props.renderFactorySlot('scholarflow.workspace', {})
  }
  function ChatViews(props: Host) { return props.renderSlot('conversation.session', { view: 'chat' }) }
  function DockChat(props: Host) {
    const scope = useSyncExternalStore(navigation.source.subscribe, navigation.source.getSnapshot, navigation.source.getSnapshot)
    const readTabs = () => ctx.sidebarRight.openTabs.getSnapshot()
    const tabs = useSyncExternalStore(listener => ctx.sidebarRight.openTabs.subscribe(listener), readTabs, readTabs)
    const { tab } = props.useTabInfo()
    const owner = tabs.find((item: Host) => item.sessionId === props.sessionId && item.kind === CHAT_KIND)
    const live = scope.active && scope.sessionId === props.sessionId && owner?.tabId === tab.id
    return <><style>{CHAT_CSS + NATIVE_DOCK_CSS}</style>{live
      ? <aside className="sf-agent sf-dock-chat" aria-label="DSH 当前会话"><Agent {...props} onClose={() => ctx.sidebarRight.toggleExpanded()} /></aside>
      : <section className="sf-chat-resume"><WorkbenchIcon kind="chat" /><p>AI Chat · ScholarFlow 工作台</p>
        <button onClick={() => navigation.open(props.sessionId)}>{scope.active ? '转到当前 AI Chat' : '打开 ScholarFlow 工作台'}</button></section>}</>
  }
  function ChatGuide(props: Host) {
    return <><style>{NATIVE_DOCK_CSS}</style><button className="sf-chat-guide" data-sidebar-right-guide-entry={CHAT_KIND}
      onClick={() => { if (navigation.source.getSnapshot().active) openExistingChat(ctx, { replaceTab: true }); else navigation.open() }}><WorkbenchIcon kind="chat" /><span>{props.title}{props.description && <small>{props.description}</small>}</span></button></>
  }
  function Agent(props: Host) {
    const session = props.useSession((s: Host) => s)
    const workspaces = props.useWorkspaces((s: Host) => s.items)
    const workspace = workspaces.find((item: Host) => item.sessionIds.includes(props.sessionId))
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const newSession = async () => {
      setBusy(true); setError('')
      try {
        const created = await ctx.connection.rpc.call('/api', 'session/create', { args: { request: { workspaceId: workspace.workspaceId, agentPreset: 'scholarflow' } } })
        if (!created.ok) throw new Error(created.error.message)
        await ctx.sessions.refresh()
        await ctx.uiWorkspace.openSession(created.value.sessionId)
        navigation.open(created.value.sessionId)
      } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
    }
    return <><header className="sf-chat-toolbar"><WorkbenchIcon kind="chat" /><strong>AI 助手</strong><div className="sf-chat-actions">
      <button className="sf-chat-icon" aria-label="新建 ScholarFlow 聊天" title="新建 ScholarFlow 聊天" disabled={busy || !workspace} onClick={newSession}><WorkbenchIcon kind="plus" /></button>
      <button className="sf-chat-icon" aria-label="关闭聊天面板" title="关闭聊天面板" onClick={props.onClose}><WorkbenchIcon kind="close" /></button>
    </div></header>
      <div className="sf-chat-scope"><span title={workspace?.title}>{workspace?.title ?? '未选择工作区'}</span><span className="sf-chat-mode">ScholarFlow</span></div>
      {error && <p role="alert" className="sf-chat-error">{error}</p>}
      <SelectionCard sessionId={props.sessionId} inputActions={props.inputActions} api={api} />
      <div className="sf-chat-content">{session?.blank && <section className="sf-chat-empty" aria-label="聊天建议">
        <WorkbenchIcon kind="chat" /><h3>一起完善这篇论文</h3><p>描述你的研究主题，或选中正文后继续讨论。</p>
        {['帮我梳理研究思路', '帮我核查论文引用', '帮我润色选中的段落'].map(prompt => <button key={prompt} onClick={() => props.inputActions.setDraft(prompt)}>{prompt} <span aria-hidden="true">↗</span></button>)}
      </section>}{props.renderFactorySlot('conversation.content', {
      variant: 'embedded', phase: 'active', hero: false,
    }, { slots: { views: ChatViews } })}</div></>
  }
  function CaptionEntry(props: Host) {
    const scope = useSyncExternalStore(navigation.source.subscribe, navigation.source.getSnapshot, navigation.source.getSnapshot)
    const legacyActive = props.usePanelInfo((info: Host) => info.activePanelId === 'scholarflow')
    const active = scope.active || legacyActive
    const entry = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
      const menu = document.querySelector<HTMLElement>('[data-windows-menu]')
      if (!menu || !entry.current) return
      const position = () => entry.current?.style.setProperty('--sf-caption-left', `${menu.getBoundingClientRect().right + 4}px`)
      position()
      const size = new ResizeObserver(position), offset = new MutationObserver(position)
      size.observe(menu)
      offset.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-fullscreen'] })
      window.addEventListener('resize', position)
      return () => { size.disconnect(); offset.disconnect(); window.removeEventListener('resize', position) }
    }, [])
    return <><style>{CAPTION_CSS}</style><div ref={entry} className="sf-caption-entry"><button aria-label="ScholarFlow" aria-pressed={active}
      title="打开 ScholarFlow 工作台" onClick={() => navigation.open()}><WorkbenchIcon />ScholarFlow</button></div></>
  }
  function Workspace(props: Host) {
    const [info, setInfo] = useState<Host>()
    const [error, setError] = useState('')
    useEffect(() => { let live = true; call('diagnostics').then(v => live && setInfo(v)).catch(e => live && setError(e.message)); return () => { live = false } }, [])
    const readMounted = () => ctx.sidebarRight.mounted.getSnapshot()
    const mounted = useSyncExternalStore(listener => ctx.sidebarRight.mounted.subscribe(listener), readMounted, readMounted)
    useEffect(() => { if (props.sessionId && mounted === props.sessionId) navigation.revealChat(props.sessionId) }, [props.sessionId, mounted])
    return <div className="sf-app sf-native-workspace"><style>{CSS + EXTRA_CSS + LAYOUT_CSS + NATIVE_DOCK_CSS}</style>
      <header className="sf-native-header"><span className="sf-workspace-title"><b>ScholarFlow</b> · 学术写作工作台</span><NativeTools source={nativeHeader} sessionId={props.sessionId} renderFactorySlot={props.renderFactorySlot} /></header>
      <main className="sf-body"><h2>论文工作台</h2>
        {error && <p role="alert" className="sf-error">{error}</p>}
        {info && <p role="status">已连接 Host · 协议 v{info.protocol} · {info.settings.length ? '设置可持久化' : '设置能力不足'}</p>}
        {props.renderSlot('scholarflow.project', {})}
      </main></div>
  }
  function Project(props: Host) {
    const confirmationRoot = useRef<HTMLElement>(null)
    useConfirmationFocus(confirmationRoot)
    const workspaces = props.useWorkspaces((state: Host) => state.items)
    const workspace = workspaces.find((item: Host) => item.sessionIds.includes(props.sessionId))
    const [selectedWorkspace, setSelectedWorkspace] = useState('')
    const [project, setProject] = useState<Host>()
    const [title, setTitle] = useState('')
    const [type, setType] = useState('course-paper')
    const [language, setLanguage] = useState('zh-CN')
    const [maxModelCalls, setMaxModelCalls] = useState(40)
    const defaultsScope = useRef('')
    const [output, setOutput] = useState('manuscript')
    const [plan, setPlan] = useState<Host>()
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [tab, setTab] = useState<(typeof TABS)[number]>('Overview')
    const [issueLocation, setIssueLocation] = useState<Host>()
    const bindingKey = `${workspace?.workspaceId ?? ''}:${props.sessionId ?? ''}`
    const liveBinding = useRef(bindingKey), readSequence = useRef(0)
    const latest = useRef({ busy, project })
    liveBinding.current = bindingKey; latest.current = { busy, project }
    const context = () => ({ requestId: `req_${crypto.randomUUID()}`, workspaceId: workspace?.workspaceId, sessionId: props.sessionId,
      ...(project?.ledger && { expectedLedgerRevision: project.ledger.revision }),
      ...(project?.binding?.projectId && project.binding.workspaceId === workspace?.workspaceId && project.binding.sessionId === props.sessionId
        ? { projectId: project.binding.projectId } : {}) })
    useEffect(() => {
      if (!props.sessionId) return
      if (project?.initialized) invalidateSelectionCard(project.binding, project.document)
      else clearSelectionCard(props.sessionId)
    }, [bindingKey, project?.initialized, project?.binding?.projectId, project?.document?.contentHash, project?.document?.revisionId])
    useEffect(() => () => { if (props.sessionId) clearSelectionCard(props.sessionId) }, [props.sessionId])
    const publish = (value: Host) => {
      if (`${value.binding.workspaceId}:${value.binding.sessionId}` !== liveBinding.current) return
      readSequence.current++ // Invalidate reads started before a committed mutation.
      if (!value.initialized && value.defaults && defaultsScope.current !== liveBinding.current) {
        defaultsScope.current = liveBinding.current
        setType(value.defaults.defaultProjectType); setLanguage(value.defaults.language === 'en' ? 'en' : 'zh-CN'); setMaxModelCalls(value.defaults.maxModelCalls)
      }
      setProject(value)
    }
    const refresh = async () => {
      const scope = bindingKey, sequence = ++readSequence.current
      const value = await api('project.inspect', { context: context() })
      if (sequence === readSequence.current && scope === liveBinding.current) publish(value)
    }
    const refreshRef = useRef(refresh); refreshRef.current = refresh
    useEffect(() => {
      let live = true
      setPlan(undefined); setProject(undefined); setError(''); setTab('Overview'); setIssueLocation(undefined)
      defaultsScope.current = ''; setTitle(''); setOutput('manuscript')
      if (workspace && props.sessionId) refresh().catch(e => live && setError(e.message))
      return () => { live = false }
    }, [workspace?.workspaceId, props.sessionId])
    useEffect(() => {
      if (!workspace || !props.sessionId) return
      let live = true
      const timer = window.setInterval(() => {
        if (!live || document.hidden || latest.current.busy || !latest.current.project?.initialized) return
        refreshRef.current().catch(error => {
          if (live) setError(`刷新未完成，当前页面和编辑仍保留：${error.message}`)
        })
      }, 10000)
      return () => { live = false; clearInterval(timer) }
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
      await ctx.uiWorkspace.openSession(sessionId)
      navigation.open(sessionId)
    })
    return <section ref={confirmationRoot} className="sf-project" aria-label="ScholarFlow 项目" data-sf-session-id={props.sessionId} aria-busy={busy}>
      <label>DSH 工作区 <select aria-label="DSH 工作区" value={selectedWorkspace || workspace?.workspaceId || ''} onChange={e => setSelectedWorkspace(e.target.value)}><option value="">请选择</option>
        {workspaces.map((item: Host) => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select></label>
      <button disabled={busy} onClick={startSession}>新建 ScholarFlow 会话</button>
      <button disabled={busy || !workspace || !props.sessionId} onClick={() => act(refresh)}>刷新项目状态</button>
      {error && <p role="alert" className="sf-error">{error}</p>}
      {!project && <p>选择 DSH 工作区并创建专属会话，切换 Mode 本身不会创建论文目录。</p>}
      {project?.readonly && project.binding.sessionId === props.sessionId && project.binding.workspaceId === workspace?.workspaceId && <ReadonlyProject value={project.readonly} />}
      {project?.identityConflict && project.binding.sessionId === props.sessionId && project.binding.workspaceId === workspace?.workspaceId &&
        <ProjectIdentity key={`copy_${project.binding.projectId}`} project={project} workspaceTitle={workspace.title} workspaces={workspaces} context={context} api={api} publish={publish} run={act} busy={busy} />}
      {project && project.binding.sessionId === props.sessionId && project.binding.workspaceId === workspace?.workspaceId && !project.initialized && !project.readonly && <>
        <p>当前工作区：{workspace.title} · 尚未初始化</p>
        {project.recovery ? <section aria-label="事务恢复确认"><h3>检测到未完成的项目事务</h3>
          <p>恢复只会完成已记录的提交。若文件出现外部修改，保留当前稿件并停止恢复。</p>
          {project.recovery.transactions.map((txn: Host) => <div key={txn.id}><p>{txn.id}</p><ul>{txn.files.map((file: Host) => <li key={file.relativePath}>{file.relativePath} · {file.status === 'published' ? '已写入' : '待恢复'}</li>)}</ul></div>)}
          <button disabled={busy} onClick={() => act(async () => publish(await api('project.recover', { context: context(), planId: project.recovery.planId, planHash: project.recovery.planHash })))}>确认恢复已记录事务</button>
        </section> : project.metadataExists ? <p role="alert">检测到既有 .scholarflow 目录，请先检查项目，禁止覆盖。</p> : <>
          <label>项目标题 <input aria-label="项目标题" value={title} onChange={e => setTitle(e.target.value)} maxLength={300} /></label>
          <label>论文类型 <select aria-label="论文类型" value={type} onChange={e => setType(e.target.value)}><option value="course-paper">课程论文</option><option value="literature-review">文献综述</option><option value="research-paper">研究论文</option></select></label>
          <label>论文语言 <select aria-label="论文语言" value={language} onChange={e => setLanguage(e.target.value)}><option value="zh-CN">中文</option><option value="en">英文</option></select></label>
          <label>每次运行模型调用上限 <input aria-label="每次运行模型调用上限" type="number" min={1} max={40} step={1} value={maxModelCalls} onChange={e => setMaxModelCalls(Number(e.target.value))} /></label>
          <label>论文输出目录 <input aria-label="论文输出目录" value={output} onChange={e => setOutput(e.target.value)} /></label>
          <button disabled={busy || !title.trim() || !Number.isInteger(maxModelCalls) || maxModelCalls < 1 || maxModelCalls > 40} onClick={() => act(async () => setPlan(await api('project.prepareInit', { context: context(), input: { title: title.trim(), type, language, maxModelCalls, manuscriptDir: output } })))}>预览初始化计划</button>
        </>}
      </>}
      {plan && <section role="dialog" aria-modal="false" aria-label="初始化确认"><h3>确认创建专属项目文件</h3>
        <p>类型：{plan.project.type} · 语言：{plan.project.language} · 每次运行模型调用上限：{plan.budget.maxModelCalls}</p>
        <ul>{plan.files.map((file: Host) => <li key={file.relativePath}>{file.relativePath}</li>)}</ul>
        {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
        <button disabled={busy} onClick={() => act(async () => { publish(await api('project.initialize', { context: context(), planId: plan.planId, planHash: plan.planHash })); setPlan(undefined) })}>确认初始化</button>
        <button disabled={busy} onClick={() => setPlan(undefined)}>取消</button></section>}
      {project?.initialized && project.binding.sessionId === props.sessionId && project.binding.workspaceId === workspace?.workspaceId && <><h3>{project.config.project.title}</h3><p>项目已保存 · ledger 版本 {project.ledger.revision} · {project.document.externalChange ? '检测到外部稿件修改' : '主稿版本一致'}</p>
        {!!project.configWarnings?.length && <p role="alert">以下配置键未生效，原文件已保留：{project.configWarnings.join('、')}</p>}
        <p>当前绑定：{project.binding.projectId}。同一工作区的多个 ScholarFlow 会话读取同一份项目数据。</p>
        <nav className="sf-tabs" role="tablist" aria-label="论文工作区页面">{TABS.map((name, index) => <button key={name} id={`sf-tab-${name}`} role="tab" aria-controls={`sf-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={e => {
          const next = e.key === 'ArrowRight' ? (index + 1) % TABS.length : e.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
          if (next < 0) return; e.preventDefault(); setTab(TABS[next]); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#sf-tab-${TABS[next]}`)?.focus()
        }}>{name} · {TAB_LABELS[index]}</button>)}</nav>
        <div id="sf-panel-Overview" role="tabpanel" aria-labelledby="sf-tab-Overview" hidden={tab !== 'Overview'}><Overview key={`overview_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} navigate={page => { if (TABS.includes(page as typeof tab)) setTab(page as typeof tab) }} /></div>
        <div id="sf-panel-Research" role="tabpanel" aria-labelledby="sf-tab-Research" hidden={tab !== 'Research'}><Research key={`research_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} /></div>
        <div id="sf-panel-Outline" role="tabpanel" aria-labelledby="sf-tab-Outline" hidden={tab !== 'Outline'}><OutlineEditor key={`outline_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} /></div>
        <div id="sf-panel-Draft" role="tabpanel" aria-labelledby="sf-tab-Draft" hidden={tab !== 'Draft'}><Draft key={`draft_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} issueLocation={issueLocation} /></div>
        <ReviewExport key={`review_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} mode={tab} onLocate={location => { setIssueLocation({ ...location, request: crypto.randomUUID() }); setTab('Draft') }} />
      </>}
    </section>
  }
  function Settings() {
    const confirmationRoot = useRef<HTMLElement>(null)
    useConfirmationFocus(confirmationRoot)
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
    return <section ref={confirmationRoot} className="sf-app sf-settings" style={{ overflow: 'auto' }}><style>{CSS + EXTRA_CSS}</style><h2>ScholarFlow 设置</h2>
      {row ? <><label>新项目默认类型 <select aria-label="新项目默认类型" value={row.value.defaultProjectType} onChange={e => save('defaultProjectType', e.target.value)}>
        <option value="course-paper">课程论文</option><option value="literature-review">文献综述</option><option value="research-paper">研究论文</option></select></label>
        <label>新项目默认语言 <select aria-label="新项目默认语言" value={row.value.language} onChange={e => save('language', e.target.value)}><option value="zh">中文</option><option value="en">英文</option></select></label>
        <label>新项目默认模型调用上限 <select aria-label="新项目默认模型调用上限" value={row.value.maxModelCalls} onChange={e => save('maxModelCalls', Number(e.target.value))}>{Array.from({ length: 40 }, (_, i) => i + 1).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><input type="checkbox" checked={row.value.networkEnabled} onChange={e => save('networkEnabled', e.target.checked)} />允许外部检索与公开 Skill 读取（每次操作展示发送范围）</label></>
        : <p>正在读取宿主设置…</p>}<p role="status">{message}</p><WritingProfiles api={api} /><AcademicSkills api={api} /></section>
  }
  ctx.effect(() => ctx.slots.registerFactory({ name: 'scholarflow.workspace', scope: 'session-maybe', children: { 'scholarflow.project': { kind: 'single', scope: 'session-maybe' } } }, Workspace), 'scholarflow: project surface')
  ctx.effect(() => ctx.slots.inject('scholarflow.project', () => ctx.slots.register({ name: 'scholarflow.project' }, Project)), 'scholarflow: project')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'scholarflow' }, LegacyWorkspace)), 'scholarflow: workspace entry')
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: CHAT_ID, kind: CHAT_KIND, title: () => 'AI Chat', keepMounted: true,
    guide: [{ id: 'chat', order: 40, title: () => 'AI Chat', description: () => '继续当前 ScholarFlow 会话', icon: () => <WorkbenchIcon kind="chat" /> }] }), 'scholarflow: existing chat dock type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CHAT_ID }, DockChat)), 'scholarflow: existing chat dock body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: CHAT_ID }, () => <WorkbenchIcon kind="chat" />)), 'scholarflow: chat dock title')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({ name: 'sidebar.right.tab.guide.entry', key: CHAT_ID }, ChatGuide)), 'scholarflow: existing chat guide entry')
  if (document.documentElement.dataset.platform === 'win32') {
    ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'scholarflow-caption', order: 50 }, CaptionEntry)), 'scholarflow: caption navigation')
  } else {
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'scholarflow', order: 50, label: () => 'ScholarFlow' }, WorkbenchIcon)), 'scholarflow: navigation')
  }
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'scholarflow-settings', order: 50, label: () => 'ScholarFlow' }, Settings)), 'scholarflow: settings')
}
