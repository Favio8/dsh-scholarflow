import React, { useState, useEffect } from 'react'

type Host = any
const CSS = `.sf-app{height:100%;display:flex;flex-direction:column;color:inherit;font-family:inherit}.sf-header{padding:16px;border-bottom:1px solid #8884}.sf-columns{display:flex;min-height:0;flex:1}.sf-body{flex:1;min-width:0;padding:20px;overflow:auto}.sf-agent{width:360px;min-width:300px;border-left:1px solid #8884;display:flex;flex-direction:column;overflow:hidden}.sf-app button,.sf-app select{font:inherit;color:inherit;padding:7px 12px;border-radius:6px;background:transparent;border:1px solid #8886}.sf-error{color:#d45151;white-space:pre-wrap}.sf-app pre{white-space:pre-wrap}.sf-app label{display:block;margin:12px 0}.sf-settings{padding:20px;max-width:760px}@media(max-width:1000px){.sf-agent{width:310px}}@media(max-width:760px){.sf-columns{flex-direction:column}.sf-agent{width:100%;height:380px;border-left:0;border-top:1px solid #8884;flex-shrink:0}}`
export const inject = ['slots', 'connection', 'sessions', 'workspaces']

export function apply(ctx: Host) {
  const call = async (method: string, args: unknown = {}) => {
    const result = await ctx.connection.rpc.call('/api', `scholarflow.v1/${method}`, { args })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
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
    return <div className="sf-app"><style>{CSS}</style><header className="sf-header"><b>ScholarFlow</b> · 宿主连接验证</header>
      <div className="sf-columns"><main className="sf-body"><h2>论文工作台</h2><p>项目初始化和证据链正在接入。当前会话保留在右侧。</p>
        {error && <p role="alert" className="sf-error">{error}</p>}
        {info && <p role="status">已连接 Host · 协议 v{info.protocol} · {info.settings.length ? '设置可持久化' : '设置能力不足'}</p>}
      </main><aside className="sf-agent" aria-label="DSH 当前会话">{props.renderSlot('scholarflow.agent', {})}</aside></div></div>
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
    yield ctx.slots.register({ name: 'main', key: 'scholarflow', children: { 'scholarflow.agent': { kind: 'single', scope: 'session-maybe' } } }, Workspace)
    yield ctx.slots.register({ name: 'scholarflow.agent' }, Agent)
  }), 'scholarflow: workspace and host conversation')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'scholarflow', order: 50, label: () => 'ScholarFlow' }, () => <span>ScholarFlow</span>)), 'scholarflow: navigation')
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'scholarflow-settings', order: 50, label: () => 'ScholarFlow' }, Settings)), 'scholarflow: settings')
}
