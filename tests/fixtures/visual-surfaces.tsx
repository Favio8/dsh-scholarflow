// TEST_ONLY: mount shipped components in isolated Slot seats. This is rendering evidence,
// not native Host integration evidence. No filesystem, model or network operations are provided.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { apply } from '../../src/client/plugin.tsx'
import { PaperMaterials, MATERIALS_CSS } from '../../src/client/paper-materials.tsx'
import { ApplicationError, ErrorNotice } from '../../src/client/application-error.tsx'
import { SurfaceBoundary, SURFACE_BOUNDARY_CSS } from '../../src/client/surface-boundary.tsx'
import { THEME_CSS } from '../../src/client/theme/tokens.ts'
import { headingSizes } from '../../src/core/export/layout.ts'

const noop = () => {}
;(window as any).sfVisualContracts = { headingRatios: [10, 12, 14].map(bodySize => {
  const sizes = headingSizes(bodySize)
  return { bodySize, ratios: [1, 2, 3].map(level => sizes[level as 1 | 2 | 3] / bodySize) }
}) }
const source = (value: any) => ({ getSnapshot: () => value, subscribe: () => noop })
const slots = new Map<string, React.ComponentType<any>>()
const sessionId = 'session_visual_TEST_ONLY'
const workspace = { workspaceId: 'workspace_visual_TEST_ONLY', title: 'TEST_ONLY 视觉夹具', sessionIds: [sessionId] }
const register = (options: any, component: React.ComponentType<any>) => {
  slots.set(`${options.name}:${options.key ?? options.id ?? ''}`, component)
  return noop
}
const allowedEffects = new Set([
  'scholarflow: scoped native Conversation surface', 'scholarflow: project',
  'scholarflow: existing chat dock body', 'scholarflow: existing chat guide entry',
  'scholarflow: settings entry', 'scholarflow: settings',
])
const data: Record<string, any> = {
  diagnostics: { settings: [{ revision: 0, value: { defaultProjectType: 'course-paper', language: 'zh', networkEnabled: false } }] },
  'profiles.library': { profiles: [], diagnostics: [] },
  'presets.list': { all: [], issues: [] },
  'skills.library': { location: 'TEST_ONLY/skills', versions: [], diagnostics: [] },
}
const ctx: any = {
  effect: (effect: () => unknown, label: string) => { if (allowedEffects.has(label)) effect() },
  slots: { register, inject: (_name: string, effect: () => unknown) => { effect(); return noop } },
  uiSession: { adapter: { current: source({ key: sessionId }) } },
  uiWorkspace: { selection: source({}) },
  sessions: { list: source({ byId: { [sessionId]: { projectionValues: { agentPreset: 'scholarflow' } } } }) },
  layout: { panelInfo: source({ activePanelId: null }) },
  sidebarRight: { mounted: source(sessionId), openTabs: source([{ kind: 'scholarflow-chat', sessionId, tabId: 'visual-chat' }]), toggleExpanded: noop },
  connection: { rpc: { call: async (_route: string, method: string) => {
    const name = method.replace('scholarflow.v1/', '')
    // Deliberately pending: the real Project component remains in its loading branch.
    if (name === 'project.inspect') return new Promise(() => {})
    if (!(name in data)) throw new Error(`TEST_ONLY unsupported RPC: ${name}`)
    return { ok: true, value: name === 'diagnostics' ? data[name] : { ok: true, data: data[name] } }
  } } },
}
document.documentElement.dataset.platform = 'win32'
apply(ctx)

const props = {
  sessionId, useSession: (select: any) => select({ blank: true }),
  useWorkspaces: (select: any) => select({ items: [workspace] }),
  useTabInfo: () => ({ tab: { id: 'visual-chat', actions: { openTab: noop } } }),
  inputActions: { setDraft: noop }, renderFactorySlot: () => null,
  title: 'AI Chat', description: '继续当前 ScholarFlow 会话',
}
const component = (key: string) => {
  const Seat = slots.get(key)
  if (!Seat) throw new Error(`TEST_ONLY missing Slot: ${key}`)
  return <Seat {...props} />
}
function Boom(): React.ReactElement { throw new Error('TEST_ONLY 渲染失败：用于审计真实错误边界') }
const project = { ledger: { materials: {}, sources: {}, evidence: {}, claims: {}, outline: { researchQuestion: 'TEST_ONLY' } }, config: { research: {} } }
const materialApi = async (method: string) => {
  if (method === 'research.list') return []
  if (method === 'research.batchList') return { runs: [], diagnostics: [] }
  throw new Error(`TEST_ONLY unsupported operation: ${method}`)
}
const fixtures: Record<string, React.ReactNode> = {
  empty: <div className="sf-app sf-paper-project"><style>{THEME_CSS + MATERIALS_CSS}</style><PaperMaterials project={project} api={materialApi} context={() => ({ sessionId })} refresh={async () => {}} run={noop} busy={false} /></div>,
  loading: component('scholarflow.project:'),
  error: <div className="sf-app"><ErrorNotice error={new ApplicationError({ code: 'INVALID_REQUEST', message: 'TEST_ONLY 输入有误', details: { operation: 'TEST_ONLY', fields: ['targetLength'] } })} /></div>,
  boundary: <><style>{THEME_CSS + SURFACE_BOUNDARY_CSS}</style><SurfaceBoundary label="TEST_ONLY" onEscape={noop}><Boom /></SurfaceBoundary></>,
  dock: component('sidebar.right.tab.guide.entry:dsh-scholarflow/chat'),
  chat: component('sidebar.right.pane.tab:dsh-scholarflow/chat'),
  settings: component('settings.section:scholarflow-settings'),
  caption: component('shell.overlay:scholarflow-caption'),
}
for (const [name, view] of Object.entries(fixtures)) {
  const element = document.querySelector<HTMLElement>(`[data-sf-fixture="${name}"]`)
  if (element) createRoot(element).render(view)
}
// Readiness depends on the actual populated settings and caught exception, not a fixed delay.
const ready = () => {
  const settings = document.querySelector('[data-sf-fixture=settings] select[aria-label="新项目默认类型"]')
  const boundary = document.querySelector('[data-sf-fixture=boundary] .sf-boundary')
  if (!settings || !boundary) { requestAnimationFrame(ready); return }
  ;(window as any).sfVisualFixturesReady = true
}
requestAnimationFrame(ready)
