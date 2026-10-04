import React, { useEffect, useState } from 'react'

type Api = (method: string, request: any) => Promise<any>
const key = (profile: any) => `${profile.id}:${profile.sourceDigest}`
function download(profile: any) {
  const text = profile.instructions + (profile.structuredPreferences ? `\n\n## 结构化表达偏好\n\n${JSON.stringify(profile.structuredPreferences, null, 2)}\n` : '')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })), link = document.createElement('a')
  link.href = url; link.download = `${profile.id}-${profile.sourceDigest.slice(7, 19)}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function WritingProfiles({ api }: { api: Api }) {
  const [library, setLibrary] = useState<any>(), [selected, setSelected] = useState(''), [editorId, setEditorId] = useState<string>()
  const [name, setName] = useState(''), [language, setLanguage] = useState('zh-CN'), [text, setText] = useState(''), [preferences, setPreferences] = useState<any>()
  const [plan, setPlan] = useState<any>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const reload = async () => setLibrary(await api('profiles.library', {}))
  useEffect(() => { let live = true; api('profiles.library', {}).then(value => live && setLibrary(value)).catch(error => live && setMessage(error.message)); return () => { live = false } }, [])
  const run = async (operation: () => Promise<unknown>) => { setBusy(true); setMessage(''); try { await operation() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
  const profile = library?.profiles.find((row: any) => key(row) === selected)
  return <section aria-label="Writing Profiles 私有模板库"><h3>Writing Profiles 文风模板</h3>
    <p>内置模板和自定义版本供明确选择；导入与编辑不改变现有项目。项目定制在概览中完成，表达偏好不能覆盖真实性与权限规则。</p>
    <button disabled={busy} onClick={() => run(reload)}>刷新文风模板库</button>
    {library?.diagnostics.map((warning: string, index: number) => <p key={index} role="alert">{warning}</p>)}
    <label>选择文风模板版本<select aria-label="选择文风模板版本" value={selected} onChange={e => setSelected(e.target.value)}><option value="">请选择</option>
      {library?.profiles.map((row: any) => <option key={key(row)} value={key(row)}>{row.displayName} · {row.scope} · {row.sourceDigest.slice(7, 19)}</option>)}</select></label>
    {profile && <><p>固定来源：{profile.id} · {profile.sourceDigest}</p><pre>{profile.instructions}</pre>
      {profile.structuredPreferences && <pre>{JSON.stringify(profile.structuredPreferences, null, 2)}</pre>}
      <button disabled={busy || !!plan} onClick={() => { setEditorId(undefined); setName(`${profile.displayName}（自定义）`); setLanguage(profile.language); setText(profile.instructions); setPreferences(profile.structuredPreferences) }}>复制为自定义文风模板</button>
      {profile.scope === 'library' && <button disabled={busy || !!plan} onClick={() => { setEditorId(profile.id); setName(profile.displayName); setLanguage(profile.language); setText(profile.instructions); setPreferences(profile.structuredPreferences) }}>编辑文风模板为新版本</button>}
      <button disabled={busy} onClick={() => download(profile)}>导出所选文风说明</button></>}
    <label>导入本机文风说明文件<input aria-label="导入本机文风说明文件" type="file" accept=".md,.txt,text/plain,text/markdown" disabled={busy || !!plan} onChange={e => {
      const file = e.target.files?.[0]; if (!file) return
      void run(async () => { if (file.size > 65536) throw new Error('文风文件最多 64 KiB。')
        const instructions = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
        setEditorId(undefined); setName(file.name.replace(/\.(md|txt)$/iu, '').slice(0, 300)); setText(instructions); setPreferences(undefined)
      })
    }} /></label>
    <label>文风模板名称<input aria-label="文风模板名称" disabled={busy || !!plan} maxLength={300} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>文风模板语言<select aria-label="文风模板语言" disabled={busy || !!plan} value={language} onChange={e => setLanguage(e.target.value)}><option value="zh-CN">中文</option><option value="en">英文</option></select></label>
    <label>文风模板说明<textarea aria-label="文风模板说明" disabled={busy || !!plan} value={text} maxLength={65536} rows={7} onChange={e => setText(e.target.value)} /></label>
    {editorId && <p>保存为 {editorId} 的新固定版本；原版本与项目副本保留。</p>}
    <button disabled={busy || !!plan || !name.trim() || !text.trim()} onClick={() => run(async () => setPlan(await api('profiles.prepareImport', { profile: {
      ...(editorId && { id: editorId }), displayName: name.trim(), language, instructions: text, ...(preferences && { structuredPreferences: preferences }) } })))}>预览导入文风模板</button>
    {plan && <section role="dialog" aria-label="文风模板导入确认"><h4>确认导入私有文风版本</h4><p>{plan.profile.displayName} · {plan.profile.sourceDigest}</p>
      <pre>{plan.profile.instructions}</pre>{plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => { const result = await api('profiles.install', { planId: plan.planId, planHash: plan.planHash }); setSelected(key(result.profile)); setPlan(undefined); setMessage('文风模板已保存；当前论文未改变。'); await reload() })}>确认导入文风模板</button>
      <button disabled={busy} onClick={() => run(async () => { await api('profiles.dismiss', { planId: plan.planId }); setPlan(undefined) })}>取消文风模板导入</button></section>}
    <p role="status">{message}</p>
  </section>
}

export function ProjectWritingProfile({ project, context, api, refresh, run, busy, dirty }: { project: any; context: () => any; api: Api; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean; dirty: boolean }) {
  const [data, setData] = useState<any>(), [library, setLibrary] = useState<any>(), [selected, setSelected] = useState(''), [plan, setPlan] = useState<any>(), [error, setError] = useState('')
  useEffect(() => { let live = true
    Promise.all([api('profiles.project', { context: context() }), api('profiles.library', {})]).then(([data, library]) => { if (live) { setData(data); setLibrary(library); setError('') } }).catch(error => live && setError(error.message))
    return () => { live = false }
  }, [project.ledger.revision])
  const profile = library?.profiles.find((row: any) => key(row) === selected)
  return <section aria-label="当前项目文风模板"><h3>选择模板并为本项目定制</h3>
    {error && <p role="alert">{error}</p>}{data?.warning && <p role="alert">{data.warning}</p>}
    <p>当前文风：{data?.preset ?? project.config.writing.preset} · {data?.customized ? '项目自定义文本' : '已复制固定模板'}</p>
    {data?.source && <p>复制来源：{data.source.profile.displayName} · {data.source.profile.sourceDigest} · {data.source.confirmedAt}</p>}
    <p>复制后可在下方项目指令编辑器定制。库更新不自动替换项目文本；来源核验与正文保持独立。</p>
    <label>当前项目文风模板版本<select aria-label="当前项目文风模板版本" value={selected} disabled={busy || dirty || !!plan} onChange={e => setSelected(e.target.value)}><option value="">请选择</option>
      {library?.profiles.map((row: any) => <option key={key(row)} value={key(row)}>{row.displayName} · {row.sourceDigest.slice(7, 19)}</option>)}</select></label>
    <button disabled={busy || dirty || !!plan || !profile} onClick={() => run(async () => setPlan(await api('profiles.prepareCopy', { context: context(), id: profile.id, sourceDigest: profile.sourceDigest })))}>预览复制文风到本项目</button>
    {dirty && <p role="status">先保存或放弃未保存的项目指令，再选择模板。</p>}
    {plan && <section role="dialog" aria-label="项目文风复制确认"><h4>确认替换本项目文风</h4><p>{plan.profile.displayName} · {plan.profile.sourceDigest}</p><pre>{plan.copiedText}</pre>
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy || dirty} onClick={() => run(async () => { await api('profiles.copyToProject', { context: context(), planId: plan.planId, planHash: plan.planHash }); setPlan(undefined); await refresh() })}>确认复制文风到本项目</button>
      <button disabled={busy} onClick={() => run(async () => { await api('profiles.dismiss', { planId: plan.planId }); setPlan(undefined) })}>取消项目文风复制</button></section>}
  </section>
}
