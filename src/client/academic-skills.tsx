import React, { useEffect, useRef, useState } from 'react'
import type { SkillManifest } from '../shared/skills.ts'

type Api = (method: string, request: any) => Promise<any>
const CAPABILITIES = [['draft-section', '章节写作'], ['selection-transform', '选区改写'], ['review', '审查'], ['research', '研究'], ['planning', '规划']] as const
const STAGES = [['requirements', '要求'], ['research', '研究'], ['outline', '大纲'], ['drafting', '写作'], ['review', '审查'], ['revision', '修订'], ['delivery', '交付']] as const
const toggle = (values: string[], value: string, enabled: boolean) => enabled ? [...new Set([...values, value])] : values.filter(item => item !== value)

export function AcademicSkills({ api }: { api: Api }) {
  const [catalog, setCatalog] = useState<any>(), [source, setSource] = useState<any>(), [plan, setPlan] = useState<any>()
  const [path, setPath] = useState(''), [subpath, setSubpath] = useState('')
  const [kind, setKind] = useState<'local' | 'github'>('local'), [url, setUrl] = useState(''), [ref, setRef] = useState(''), [githubPath, setGithubPath] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>(['selection-transform']), [stages, setStages] = useState<string[]>(['revision'])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const pending = useRef({ sourceId: undefined as string | undefined, planId: undefined as string | undefined })
  pending.current = { sourceId: source?.sourceId, planId: plan?.planId }
  useEffect(() => {
    let live = true
    api('skills.library', {}).then(result => live && setCatalog(result)).catch(error => live && setError(error.message))
    return () => { live = false; const row = pending.current; if (row.sourceId || row.planId) void api('skills.dismiss', row).catch(() => {}) }
  }, [])
  const refresh = async () => setCatalog(await api('skills.library', {}))
  const act = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await operation() } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  const closePreview = async () => { if (plan) await api('skills.dismiss', { planId: plan.planId }); setPlan(undefined) }
  const scan = async () => {
    await closePreview()
    if (source) await api('skills.dismiss', { sourceId: source.sourceId })
    setSource(undefined)
    const result = kind === 'local' ? await api('skills.scanLocal', { path: path.trim() })
      : await api('skills.scanGithub', { url: url.trim(), ...(ref.trim() && { ref: ref.trim() }), ...(githubPath.trim() && { subpath: githubPath.trim() }) })
    setSource({ ...result, kind, diagnostics: result.diagnostics ?? result.warnings }); setSubpath(result.candidates[0]?.subpath ?? '')
  }
  return <section aria-label="Academic Skills 私有库"><h3>Academic Skills · 学术 Skill 私有库</h3>
    <p>保存在 {catalog?.location ?? '<DSH_HOME>/scholarflow/skills'}。导入后需在项目中选择固定版本和启用阶段。</p>
    <p>只使用说明文本和静态资源；附带脚本、工具权限、依赖及服务声明不会执行。</p>
    {error && <p role="alert" className="sf-error">{error}</p>}<p role="status">{message}</p>
    <label>Skill 导入来源 <select aria-label="Skill 导入来源" disabled={busy} value={kind} onChange={e => {
      const value = e.target.value as 'local' | 'github'
      void act(async () => { await closePreview(); if (source) await api('skills.dismiss', { sourceId: source.sourceId }); setSource(undefined); setKind(value) })
    }}><option value="local">Host 本地目录</option><option value="github">公开 GitHub 仓库</option></select></label>
    {kind === 'local' ? <><h4>从 Host 本地目录导入</h4>
    <p>这里选择运行 DSH 的 Host 文件目录，浏览器上传文件不是目录导入。</p>
    {catalog?.pickerKind === 'native' && <button disabled={busy} onClick={() => act(async () => {
      const result = await api('skills.pickLocal', {}); if (result.path) setPath(result.path)
    })}>选择 Host Skill 目录</button>}
    <label>Host Skill 来源目录 <input aria-label="Host Skill 来源目录" value={path} onChange={e => setPath(e.target.value)} maxLength={4000} /></label>
    <button disabled={busy || !path.trim()} onClick={() => act(scan)}>扫描本地 Skill 候选</button></> : <>
      <h4>从 GitHub 导入</h4><p>读取动作向 api.github.com 发送仓库、ref 和子目录信息，不发送论文、资料或凭据。需先开启本插件网络设置。</p>
      <label>GitHub Skill 地址 <input aria-label="GitHub Skill 地址" value={url} onChange={e => setUrl(e.target.value)} maxLength={3000} /></label>
      <label>完整 ref（分支、标签或 commit） <input aria-label="GitHub 完整 ref" value={ref} onChange={e => setRef(e.target.value)} maxLength={300} /></label>
      <p>仓库根地址留空 ref 时查询默认分支。tree／blob 地址必须明确填写完整 ref，避免将含斜杠的分支猜成路径。</p>
      <label>仓库内子目录（根地址可选） <input aria-label="GitHub Skill 子目录" value={githubPath} onChange={e => setGithubPath(e.target.value)} maxLength={800} /></label>
      <button disabled={busy || !url.trim()} onClick={() => act(scan)}>读取 GitHub Skill 候选</button>
    </>}
    {source && <>
      {source.diagnostics.map((message: string) => <p key={message}>{message}</p>)}
      {source.kind === 'github' && <p>仓库：{source.repository} · ref：{source.ref}<br />本次固定 commit：{source.commit}</p>}
      {!source.candidates.length ? <p>没有发现带 SKILL.md 的目录。README 文件不会作为 Skill 导入。</p> : <>
        <label>选择具体 Skill <select aria-label="选择具体 Skill" value={subpath} onChange={e => setSubpath(e.target.value)}>
          {source.candidates.map((candidate: any) => <option key={candidate.subpath} value={candidate.subpath}>{candidate.subpath || '所选目录本身'}{candidate.instructionBytes !== undefined && ` · ${candidate.instructionBytes} 字节`}</option>)}
        </select></label>
        <fieldset><legend>此 Skill 的说明用途</legend>{CAPABILITIES.map(([value, label]) => <label key={value}><input type="checkbox" checked={capabilities.includes(value)} onChange={e => setCapabilities(toggle(capabilities, value, e.target.checked))} />{label}</label>)}</fieldset>
        <fieldset><legend>建议阶段（项目启用时仍需确认）</legend>{STAGES.map(([value, label]) => <label key={value}><input type="checkbox" checked={stages.includes(value)} onChange={e => setStages(toggle(stages, value, e.target.checked))} />{label}</label>)}</fieldset>
        <button disabled={busy || !capabilities.length || !stages.length} onClick={() => act(async () => {
          await closePreview(); setPlan(await api(source.kind === 'github' ? 'skills.prepareGithub' : 'skills.prepareLocal', { sourceId: source.sourceId, subpath, options: { capabilities, suggestedStages: stages } }))
        })}>预览 Skill 导入</button>
      </>}
    </>}
    {plan && <section role="dialog" aria-modal="false" aria-label="Skill 导入确认"><h4>{plan.manifest.metadata.displayName}</h4>
      <p>{plan.manifest.metadata.description}</p><p>兼容性：{plan.manifest.metadata.compatibility === 'partial' ? '部分支持' : '说明性支持'}</p>
      <p>来源：{plan.manifest.origin.kind === 'github' ? plan.manifest.origin.repository : '本地目录'} / {plan.manifest.origin.subpath || '根目录'}</p>
      {plan.manifest.origin.commit && <p>固定 commit：{plan.manifest.origin.commit}；完整资源摘要在下载全部固定文件后计算。</p>}
      {plan.manifest.digest && <p>固定摘要：{plan.manifest.digest}</p>}
      <p>许可：{plan.manifest.origin.license ?? '来源未提供可识别的许可文本'}</p>
      <p>用途：{plan.manifest.metadata.capabilities.join('、')}；建议阶段：{plan.manifest.metadata.suggestedStages.join('、')}</p>
      {plan.manifest.metadata.warnings.map((message: string) => <p key={message}>{message}</p>)}
      <details><summary>原始 SKILL.md</summary><pre>{plan.instructions}</pre></details>
      <details><summary>将复制的完整文件树（{plan.manifest.files.length} 个文件）</summary><ul>{plan.manifest.files.map((file: any) => <li key={file.relativePath}>{file.relativePath} · {file.sizeBytes} 字节</li>)}</ul></details>
      {plan.risks.map((message: string) => <p key={message}>{message}</p>)}
      <button disabled={busy} onClick={() => act(async () => {
        const result = await api('skills.install', { planId: plan.planId, planHash: plan.planHash }); setPlan(undefined)
        await refresh(); setMessage(result.alreadyInstalled ? '此固定版本已在私有库中；项目绑定尚未改变。' : '已安装到私有库；项目绑定尚未改变。')
      })}>确认安装到私有库</button>
      <button disabled={busy} onClick={() => act(closePreview)}>取消 Skill 导入</button>
    </section>}
    <h4>已安装的固定版本</h4><button disabled={busy} onClick={() => act(refresh)}>刷新私有 Skill 库</button>
    {catalog?.diagnostics.map((message: string, index: number) => <p role="alert" key={index}>{message}</p>)}
    {catalog?.versions.length ? <ul>{catalog.versions.map((manifest: SkillManifest) => <li key={`${manifest.metadata.qualifiedId}:${manifest.digest}`}>
      <b>{manifest.metadata.displayName}</b> · {manifest.metadata.compatibility === 'partial' ? '部分支持' : '说明性支持'}
      <p>{manifest.metadata.description}</p><p>身份：{manifest.metadata.qualifiedId}<br />固定摘要：{manifest.digest}</p>
    </li>)}</ul> : <p>尚未安装外部 Skill。</p>}
  </section>
}
