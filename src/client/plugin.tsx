import React, { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { PaperVersions } from './paper-versions.tsx'
import { PaperMaterials, MATERIALS_CSS } from './paper-materials.tsx'
import { MOTION_CSS } from './motion/tokens.ts'
import { OVERLAY_CSS } from './middle-overlay.tsx'
import { REWRITE_CSS } from './rewrite-candidate.tsx'
import { SELECTION_MENU_CSS } from './selection-menu.tsx'
import { OutlineEditor } from './research.tsx'
import { CreationWizard, WIZARD_CSS } from './creation-wizard.tsx'
import { WritingProgress, PROGRESS_CSS } from './writing-progress.tsx'
import { WritingRequirements } from './writing-requirements.tsx'
import { Draft } from './draft.tsx'
import { ReviewExport } from './review-export.tsx'
import { Overview } from './overview.tsx'
import { AcademicSkills } from './academic-skills.tsx'
import { WritingProfiles } from './writing-profiles.tsx'
import { StructurePresets } from './structure-presets.tsx'
import { ReadonlyProject } from './readonly-project.tsx'
import { ProjectIdentity } from './project-identity.tsx'
import { createSelectionReferences, SelectionReferenceDetails, SELECTION_CSS, type SelectionContext } from './selection-card.tsx'
import { useConfirmationFocus } from './confirmation-focus.ts'
import { CAPTION_CSS, CHAT_CSS, WorkbenchIcon } from './workbench-chrome.tsx'
import { PAPER_CSS, MATH_CSS, ProjectSettings, TYPE_LABELS, FORMAT_LABELS, type PaperView, type DraftController } from './paper-workspace.tsx'
import type { ExportFormat } from '../shared/presentation.ts'
import { CHAT_ID, CHAT_KIND, NATIVE_DOCK_CSS, NativeTools, createNativeHeader, createWorkbenchNavigation, connectPresetEntry, openExistingChat } from './native-dock.tsx'
import { SurfaceBoundary, SURFACE_BOUNDARY_CSS } from './surface-boundary.tsx'
import { connectNewSessionEntry } from './new-session-entry.tsx'

type Host = any
const TABS = ['Overview', 'Research', 'Outline', 'Draft', 'Review', 'Export', 'Settings', 'Changes', 'History'] as const
const TAB_LABELS = ['写作要求', '资料与引用', '大纲', '正文', '审查', '导出', '项目设置', '修改建议', '版本记录']
const CSS = `.sf-app{height:100%;display:flex;flex-direction:column;color:inherit;font-family:inherit}.sf-header{padding:16px;border-bottom:1px solid #8884}.sf-columns{display:flex;min-height:0;flex:1}.sf-body{flex:1;min-width:0;padding:20px;overflow:auto}.sf-agent{width:360px;min-width:300px;border-left:1px solid #8884;display:flex;flex-direction:column;overflow:hidden}.sf-body button:not(.sf-native-tools *),.sf-body select:not(.sf-native-tools *),.sf-header button,.sf-settings button,.sf-settings select{font:inherit;color:inherit;padding:7px 12px;border-radius:6px;background:transparent;border:1px solid #8886}.sf-error{color:#d45151;white-space:pre-wrap}.sf-app pre{white-space:pre-wrap}.sf-app label{display:block;margin:12px 0}.sf-settings{padding:20px;max-width:760px}@media(max-width:1000px){.sf-agent{width:310px}}@media(max-width:760px){.sf-columns{flex-direction:column}.sf-agent{width:100%;height:380px;border-left:0;border-top:1px solid #8884;flex-shrink:0}}`
export const inject = ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'layout', 'sidebarRight', 'sidebarRightTabs', 'inputTriggers', 'conversation']
const LAYOUT_CSS = `.sf-agent-resize{width:8px;flex-shrink:0;cursor:col-resize;touch-action:none;background:#8881}.sf-agent-resize:focus-visible{outline:2px solid currentColor;outline-offset:-2px}.sf-app[data-sf-narrow=true] .sf-agent{height:100%;min-height:0;flex:1}.sf-header{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.sf-header button{margin-left:auto}`
const EXTRA_CSS = `.sf-app [hidden]{display:none!important}.sf-app textarea{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px;padding:8px;resize:vertical}.sf-app input{font:inherit;max-width:100%;box-sizing:border-box}.sf-app pre{overflow-wrap:anywhere}.sf-tabs{display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid #8884;padding:12px 0;margin:12px 0}.sf-tabs button[aria-selected=true]{background:#8882;border-color:currentColor}.sf-app button:focus-visible,.sf-app input:focus-visible,.sf-app select:focus-visible,.sf-app textarea:focus-visible{outline:2px solid currentColor;outline-offset:2px}`
// The settings surface reached from the top entry: the same component as the global
// settings section, so the two can never drift into two configurations.
const SETTINGS_CSS = `.sf-caption-settings{position:absolute;top:calc(100% + 4px);left:var(--sf-caption-left,150px);width:min(600px,94vw);max-height:min(72vh,640px);overflow:auto;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8883;border-radius:12px;box-shadow:0 18px 44px #00000024;z-index:1200}
.sf-caption-settings>header{position:sticky;top:0;display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #8882;background:var(--dsw-alias-bg-base,#fff)}
.sf-caption-settings>header strong{font-size:14px;font-weight:600}
.sf-caption-settings>header button{margin-left:auto;border:0;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
.sf-caption-settings .sf-settings{max-width:none;padding:16px}`

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
  connectNewSessionEntry(ctx)
  connectPresetEntry(ctx, navigation)
  const selectionReferences = createSelectionReferences(ctx)
  const nativeHeader = createNativeHeader(ctx)
  function WorkspaceSurface(props: Host) { return props.renderFactorySlot('scholarflow.workspace', {}) }
  // The settings surface for platforms whose top entry is a sidebar row rather than a
  // caption button; it renders the same Settings component as the global section.
  function SettingsSurface() { return <div className="sf-app"><style>{CSS + EXTRA_CSS + SETTINGS_CSS + SURFACE_BOUNDARY_CSS}</style><SurfaceBoundary label="设置面"><Settings /></SurfaceBoundary></div> }
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
    const scope = useSyncExternalStore(navigation.source.subscribe, navigation.source.getSnapshot, navigation.source.getSnapshot)
    if (!scope.active || scope.sessionId !== props.sessionId) return null
    return <><style>{NATIVE_DOCK_CSS}</style><button className="sf-chat-guide" data-sidebar-right-guide-entry={CHAT_KIND}
      onClick={() => openExistingChat(ctx, { replaceTab: true })}><WorkbenchIcon kind="chat" /><span>{props.title}{props.description && <small>{props.description}</small>}</span></button></>
  }
  function Agent(props: Host) {
    const session = props.useSession((s: Host) => s)
    // The Host's catalog can be momentarily empty (a workspace was removed, a profile is
    // still loading). Reading it defensively keeps a transient gap from blanking the surface.
    const workspaces = props.useWorkspaces((s: Host) => s.items) ?? []
    const workspace = workspaces.find((item: Host) => (item?.sessionIds ?? []).includes(props.sessionId))
    const [busy, setBusy] = useState(false), [error, setError] = useState('')
    const newSession = async () => {
      setBusy(true); setError('')
      try {
        const created = await ctx.connection.rpc.call('/api', 'session/create', { args: { request: { workspaceId: workspace.workspaceId, agentPreset: 'scholarflow' } } })
        if (!created.ok) throw new Error(created.error.message)
        await ctx.sessions.refresh()
        await ctx.uiWorkspace.openSession(created.value.sessionId)
        navigation.open(created.value.sessionId)
        navigation.openChat(created.value.sessionId)
      } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
    }
    return <><header className="sf-chat-toolbar"><WorkbenchIcon kind="chat" /><strong>AI 助手</strong><div className="sf-chat-actions">
      <button className="sf-chat-icon" aria-label="新建 ScholarFlow 聊天" title="新建 ScholarFlow 聊天" disabled={busy || !workspace} onClick={newSession}><WorkbenchIcon kind="plus" /></button>
      <button className="sf-chat-icon" aria-label="关闭聊天面板" title="关闭聊天面板" onClick={props.onClose}><WorkbenchIcon kind="close" /></button>
    </div></header>
      <div className="sf-chat-scope"><span title={workspace?.title}>{workspace?.title ?? '未选择工作区'}</span><span className="sf-chat-mode">ScholarFlow</span></div>
      {error && <p role="alert" className="sf-chat-error">{error}</p>}
      <div className="sf-chat-content">{session?.blank && <section className="sf-chat-empty" aria-label="聊天建议">
        <WorkbenchIcon kind="chat" /><h3>一起完善这篇论文</h3><p>描述你的研究主题，或选中正文后继续讨论。</p>
        {['帮我梳理研究思路', '帮我核查论文引用', '帮我润色选中的段落'].map(prompt => <button key={prompt} onClick={() => props.inputActions.setDraft(prompt)}>{prompt} <span aria-hidden="true">↗</span></button>)}
      </section>}{props.renderFactorySlot('conversation.content', {
      variant: 'embedded', phase: 'active', hero: false,
    }, { slots: { views: ChatViews } })}</div></>
  }
  // The top entry opens the plugin's settings, nothing else. Mode entry belongs to the
  // new-conversation mode picker, and an existing ScholarFlow conversation restores its
  // workbench on its own (SPEC v1.1 §10). DSH keeps the settings panel's open state
  // private to its shell, so this renders the SAME Settings component against the same
  // namespace and write path — one configuration, reachable from both places.
  function CaptionEntry(props: Host) {
    const [open, setOpen] = useState(false)
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
    return <><style>{CAPTION_CSS + SETTINGS_CSS}</style><div ref={entry} className="sf-caption-entry">
      <button aria-label="ScholarFlow 设置" aria-expanded={open} title="打开 ScholarFlow 设置" onClick={() => setOpen(value => !value)}><WorkbenchIcon />ScholarFlow</button>
      {open && <section className="sf-caption-settings" role="dialog" aria-label="ScholarFlow 设置">
        <header><strong>ScholarFlow 设置</strong><button aria-label="关闭设置" onClick={() => setOpen(false)}>×</button></header>
        <Settings />
      </section>}
    </div></>
  }
  function Workspace(props: Host) {
    return <div className="sf-app sf-native-workspace"><style>{CSS + EXTRA_CSS + LAYOUT_CSS + NATIVE_DOCK_CSS + PAPER_CSS + MATH_CSS + SELECTION_CSS + WIZARD_CSS + PROGRESS_CSS + MATERIALS_CSS + SURFACE_BOUNDARY_CSS + MOTION_CSS + OVERLAY_CSS + REWRITE_CSS + SELECTION_MENU_CSS}</style>
      <SelectionReferenceDetails sessionId={props.sessionId} />
      <main className="sf-body">{props.renderSlot('scholarflow.project', {
        renderNativeTools: (extra: React.ReactNode) => <NativeTools source={nativeHeader} sessionId={props.sessionId} renderFactorySlot={props.renderFactorySlot} extra={extra} />,
      })}</main></div>
  }

  function ProjectSurface(props: Host) {
    // DSH catches and hides failed Slot entries. The boundary must be inside the
    // registered entry to show its error before the Host handles it.
    return <SurfaceBoundary label="项目面" onEscape={() => navigation.ordinary()}><Project {...props} /></SurfaceBoundary>
  }

  function Project(props: Host) {
    const confirmationRoot = useRef<HTMLElement>(null)
    useConfirmationFocus(confirmationRoot)
    const workspaces = props.useWorkspaces((state: Host) => state.items) ?? []
    const workspace = workspaces.find((item: Host) => (item?.sessionIds ?? []).includes(props.sessionId))
    const [selectedWorkspace, setSelectedWorkspace] = useState('')
    const [project, setProject] = useState<Host>()
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [tab, setTab] = useState<(typeof TABS)[number]>('Draft')
    const [issueLocation, setIssueLocation] = useState<Host>()
    const [view, setView] = useState<PaperView>('split'), [format, setFormat] = useState<ExportFormat>('markdown')
    const [editor, setEditor] = useState<DraftController>(), [exportPrompt, setExportPrompt] = useState(false), [exportTrigger, setExportTrigger] = useState(0)
    const bindingKey = `${workspace?.workspaceId ?? ''}:${props.sessionId ?? ''}`
    const liveBinding = useRef(bindingKey), readSequence = useRef(0)
    const latest = useRef({ busy, project })
    liveBinding.current = bindingKey; latest.current = { busy, project }
    const context = () => ({ requestId: `req_${crypto.randomUUID()}`, workspaceId: workspace?.workspaceId, sessionId: props.sessionId,
      ...(project?.ledger && { expectedLedgerRevision: project.ledger.revision }),
      ...(project?.binding?.projectId && project.binding.workspaceId === workspace?.workspaceId && project.binding.sessionId === props.sessionId
        ? { projectId: project.binding.projectId } : {}) })
    const attachSelection = (card: SelectionContext, ask: boolean, insertion: Host) => {
      const scope = navigation.source.getSnapshot()
      if (!scope.active || scope.sessionId !== card.binding.sessionId || card.binding.sessionId !== props.sessionId ||
        card.binding.workspaceId !== workspace?.workspaceId) throw new Error('当前工作区或会话已切换，请重新选择正文。')
      selectionReferences.attach(card, insertion)
      if (ask) navigation.openChat(props.sessionId, () => {
        if (navigation.source.getSnapshot().active && navigation.source.getSnapshot().sessionId === props.sessionId) selectionReferences.focus(props.sessionId)
      })
    }
    const publish = (value: Host) => {
      if (`${value.binding.workspaceId}:${value.binding.sessionId}` !== liveBinding.current) return
      readSequence.current++ // Invalidate reads started before a committed mutation.
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
      setProject(undefined); setError(''); setTab('Draft'); setView('split'); setFormat('markdown'); setExportPrompt(false); setExportTrigger(0); setEditor(undefined); setIssueLocation(undefined)
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
    const ready = !!project?.initialized && project.binding.sessionId === props.sessionId && project.binding.workspaceId === workspace?.workspaceId
    useEffect(() => { if (project?.initialized) setFormat(project.config.output.defaultFormat ?? 'markdown') }, [project?.config?.output?.defaultFormat, project?.binding.projectId])
    const changeFormat = (value: ExportFormat) => act(async () => { await api('writingTask.format', { context: context(), format: value }); setFormat(value); await refresh() })
    const draftTool = tab === 'Changes' ? tab : undefined
    const startExport = () => { setExportPrompt(false); setExportTrigger(value => value + 1) }
    const requestExport = (selected: ExportFormat) => { setFormat(selected); if (editor?.dirty) setExportPrompt(true); else startExport() }
    const closeMenu = (element: HTMLElement) => element.closest('details')?.removeAttribute('open')
    return <section ref={confirmationRoot} className="sf-project sf-paper-project" aria-label="ScholarFlow 项目" data-sf-session-id={props.sessionId} aria-busy={busy}>
      <header className="sf-paper-header"><strong className="sf-paper-title" title={ready ? project.config.project.title : 'ScholarFlow'}>{ready ? project.config.project.title : 'ScholarFlow'}</strong>
        {ready && <><button className="sf-type-chip" title="写作要求" onClick={() => setTab('Overview')}>{TYPE_LABELS[project.config.project.type]} ▾</button>
          <select aria-label="排版与导出格式" title="排版与导出格式" value={format} onChange={e => changeFormat(e.target.value as ExportFormat)}>
            {Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></>}
        {props.renderNativeTools?.(ready && <div className="sf-export-split"><button disabled={busy} onClick={() => requestExport(format)}>导出 {FORMAT_LABELS[format]}</button><details className="sf-paper-menu sf-paper-export"><summary aria-label="更多导出选项">▾</summary><div className="sf-paper-menu-popover">
          {Object.entries(FORMAT_LABELS).filter(([value]) => value !== format).map(([value, label]) => <button key={value} disabled={busy} onClick={e => { closeMenu(e.currentTarget); requestExport(value as ExportFormat) }}>导出 {label}</button>)}
          <button onClick={e => { closeMenu(e.currentTarget); setTab('Export') }}>引用库、报告与交付历史</button>
        </div></details></div>)}
      </header>
      {error && <p role="alert" className="sf-error">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}
      {!ready && <div className="sf-create-scroll">
        {!workspace && <div className="sf-create-card"><h3>选择论文工作区</h3><select value={selectedWorkspace} onChange={e => setSelectedWorkspace(e.target.value)}><option value="">请选择</option>{workspaces.map((item: Host) => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select><button disabled={busy || !selectedWorkspace} onClick={startSession}>进入 ScholarFlow</button></div>}
        {workspace && !project && !error && <p className="sf-muted" style={{ padding: 24 }}>正在打开论文工作区…</p>}
        {project?.readonly && <ReadonlyProject value={project.readonly} />}
        {project?.identityConflict && <ProjectIdentity project={project} workspaceTitle={workspace.title} workspaces={workspaces} context={context} api={api} publish={publish} run={act} busy={busy} />}
        {project && !project.initialized && !project.readonly && !project.identityConflict && (project.recovery ? <div className="sf-create-card"><h3>恢复未完成的创建</h3><button disabled={busy} onClick={() => act(async () => publish(await api('project.recover', { context: context(), planId: project.recovery.planId, planHash: project.recovery.planHash })))}>继续已确认的创建</button></div>
          : project.metadataExists ? <p className="sf-error">已有论文目录需要恢复，请查看项目状态。</p>
          : <CreationWizard key={bindingKey} scope={bindingKey} api={api} context={context} defaults={project.defaults} workspaceTitle={workspace.title} onCreated={refresh} />)}
      </div>}
      {ready && <>
        <div className="sf-paper-toolbar"><nav className="sf-paper-views" aria-label="正文视图">
          {(['edit', 'preview', 'split'] as const).map((name, index) => <button key={name} aria-pressed={tab === 'Draft' && view === name} onClick={() => { setTab('Draft'); setView(name) }}>{['编辑', '预览', '分屏'][index]}</button>)}
        </nav><details className="sf-paper-menu"><summary aria-label="更多论文选项">⋯</summary><div className="sf-paper-menu-popover">
          {(['Overview', 'Research', 'History'] as const).map(name => <button key={name} onClick={e => { closeMenu(e.currentTarget); setTab(name) }}>{TAB_LABELS[TABS.indexOf(name)]}</button>)}
        </div></details></div>
        {tab !== 'Draft' && <div className="sf-tool-back"><button onClick={() => setTab('Draft')}>← 返回正文</button><strong>{TAB_LABELS[TABS.indexOf(tab)]}</strong></div>}
        <WritingProgress api={api} context={context} refresh={refresh} />
        <div className="sf-paper-content">
          <div id="sf-panel-Overview" role="tabpanel" aria-label="概览" hidden={tab !== 'Overview'}><WritingRequirements key={`requirements_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} onFormat={setFormat} /></div>
          <div id="sf-panel-Research" role="tabpanel" aria-label="资料与研究" hidden={tab !== 'Research'}><PaperMaterials key={`research_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} /></div>
          <div id="sf-panel-History" role="tabpanel" aria-label="版本记录" hidden={tab !== 'History'}><PaperVersions project={project} api={api} context={context} /></div>
          <div id="sf-panel-Outline" role="tabpanel" aria-label="大纲" hidden={tab !== 'Outline'}><OutlineEditor key={`outline_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} /></div>
          <div id="sf-panel-Draft" role="tabpanel" aria-label={draftTool ? TAB_LABELS[TABS.indexOf(draftTool)] : '正文'} hidden={tab !== 'Draft' && !draftTool}>
            <Draft key={`draft_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} issueLocation={issueLocation}
              view={view} format={format} tool={draftTool} visible={tab === 'Draft'} onController={setEditor} captureChatInsertion={() => props.inputActions.captureInsertion()}
              onAttachSelection={attachSelection} onReview={() => setTab('Review')} onTool={() => setTab('Changes')} onReturnEditor={() => { setView('split'); setTab('Draft') }} />
          </div>
          <div id="sf-panel-Settings" role="tabpanel" aria-label="项目设置" hidden={tab !== 'Settings'}><ProjectSettings key={project.binding.projectId} project={project} diagnostics={() => call('diagnostics')} api={api} context={context} refresh={refresh} run={act} busy={busy} /></div>
          <ReviewExport key={`review_${project.binding.projectId}`} project={project} context={context} api={api} refresh={refresh} run={act} busy={busy} mode={tab} format={format} exportTrigger={exportTrigger}
            onLocate={location => { setIssueLocation({ ...location, request: crypto.randomUUID() }); setView('split'); setTab('Draft') }} />
        </div>
      </>}
      {ready && exportPrompt && <div className="sf-export-choice"><section role="dialog" aria-modal="true" aria-label="选择导出正文版本"><h3>正文还有未保存的编辑</h3><p>选择本次 {FORMAT_LABELS[format]} 导出使用的版本。</p>
        <button className="sf-primary" disabled={busy || !editor?.canSave} onClick={() => act(async () => { await editor!.save(); startExport() })}>保存并导出</button>
        <button disabled={busy} onClick={startExport}>导出已保存版本</button><button disabled={busy} onClick={() => setExportPrompt(false)}>取消</button>
      </section></div>}

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
        : <p>正在读取宿主设置…</p>}<p role="status">{message}</p><WritingProfiles api={api} /><StructurePresets api={api} run={async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { setMessage((error as Error).message) } }} busy={false} /><AcademicSkills api={api} /></section>
  }
  ctx.effect(() => ctx.slots.registerFactory({ name: 'scholarflow.workspace', scope: 'session-maybe', children: { 'scholarflow.project': { kind: 'single', scope: 'session-maybe' } } }, Workspace), 'scholarflow: project surface')
  ctx.effect(() => ctx.slots.inject('scholarflow.project', () => ctx.slots.register({ name: 'scholarflow.project' }, ProjectSurface)), 'scholarflow: project')
  // The workbench entry is gone: the surface appears for ScholarFlow conversations and is
  // never reached by selecting a panel, so no `main` cell registers it any more.
  // A persisted panel from the removed workbench entry is not an explicit click in this
  // app lifetime; clearing it once keeps old installations from opening a dead panel.
  if (ctx.layout.panelInfo.getSnapshot().activePanelId === 'scholarflow') ctx.layout.selectPanel(null)
  ctx.effect(() => {
    let disposeType: (() => void) | undefined, reconciling = false
    const sync = () => {
      if (reconciling) return
      reconciling = true
      try {
        const scope = navigation.source.getSnapshot()
        // Retract only our tabs, leaving native tools and their layout intact.
        for (const tab of ctx.sidebarRight.openTabs.getSnapshot()) {
          if (tab.kind === CHAT_KIND && (!scope.active || tab.sessionId !== scope.sessionId)) ctx.sidebarRight.closeIn(tab.sessionId, tab.tabId)
        }
        if (scope.active && !disposeType) disposeType = ctx.sidebarRightTabs.register({ id: CHAT_ID, kind: CHAT_KIND, title: () => 'AI Chat', keepMounted: true,
          guide: [{ id: 'chat', order: 40, title: () => 'AI Chat', description: () => '继续当前 ScholarFlow 会话', icon: () => <WorkbenchIcon kind="chat" /> }] })
        else if (!scope.active && disposeType) { disposeType(); disposeType = undefined }
      } finally { reconciling = false }
    }
    const disposeScope = navigation.source.subscribe(sync), disposeTabs = ctx.sidebarRight.openTabs.subscribe(sync)
    sync()
    return () => { disposeScope(); disposeTabs(); disposeType?.() }
  }, 'scholarflow: mode-scoped chat dock type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CHAT_ID }, DockChat)), 'scholarflow: existing chat dock body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: CHAT_ID }, () => <WorkbenchIcon kind="chat" />)), 'scholarflow: chat dock title')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({ name: 'sidebar.right.tab.guide.entry', key: CHAT_ID }, ChatGuide)), 'scholarflow: existing chat guide entry')
  if (document.documentElement.dataset.platform === 'win32') {
    ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'scholarflow-caption', order: 50 }, CaptionEntry)), 'scholarflow: settings entry')
  } else {
    // No caption bar: the same settings surface is reached through a sidebar row. The key
    // is deliberately new, so a persisted panel from the removed workbench entry stays dead.
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'scholarflow-settings' }, SettingsSurface)), 'scholarflow: settings panel')
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'scholarflow-settings', order: 50, label: () => 'ScholarFlow 设置' }, WorkbenchIcon)), 'scholarflow: settings navigation')
  }
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'scholarflow-settings', order: 50, label: () => 'ScholarFlow' }, Settings)), 'scholarflow: settings')
}
