import React, { useState } from 'react'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>;
  run: (fn: () => Promise<unknown>) => void; busy: boolean; dirty: boolean }
export function ManuscriptImport({ project, context, api, refresh, run, busy, dirty }: Props) {
  const [path, setPath] = useState(''), [source, setSource] = useState<any>(), [mappings, setMappings] = useState<Record<string, string>>({})
  const [reason, setReason] = useState(''), [plan, setPlan] = useState<any>()
  const sources = Object.values(project.ledger.sources) as any[]
  return <section aria-label="采用已有 Markdown 原稿"><h4>采用已有 Markdown 原稿</h4>
    <p>先初始化到新的输出目录，再选择项目内的原稿。预览确认后复制为主稿，原稿与当前稿件备份均保留。</p>
    {dirty && <p role="alert">当前有未提交正文。请先保存或明确处理缓冲，再采用已有稿件。</p>}
    <label>已有 Markdown 相对路径<input aria-label="已有 Markdown 相对路径" value={path} disabled={busy || !!plan} onChange={e => { setPath(e.target.value); setSource(undefined); setMappings({}) }} /></label>
    <button disabled={busy || dirty || !path.trim() || !!plan} onClick={() => run(async () => { setSource(await api('document.inspectImport', { context: context(), sourcePath: path.trim() })); setMappings({}) })}>读取已有 Markdown 原稿</button>
    {source && <fieldset disabled={busy || !!plan}><legend>{source.sourcePath} · {source.sourceHash}</legend>
      <details><summary>查看完整原稿（{source.sizeBytes} 字节）</summary><pre>{source.sourceText}</pre></details>
      {source.keys.map((key: string) => <label key={key}>{key}{source.requiredMappings.includes(key) ? ' · 必须映射另一个项目的引用键' : ' · 可选引用映射'}
        <select aria-label={`导入引用映射 ${key}`} value={Object.hasOwn(mappings, key) ? mappings[key] : ''} onChange={e => { const value = e.target.value;
          setMappings(previous => Object.fromEntries([...Object.entries(previous).filter(([from]) => from !== key), ...(value ? [[key, value]] : [])])) }}>
          <option value="">{source.requiredMappings.includes(key) ? '请选择已登记来源' : '保留原文'}</option>
          {sources.map(row => <option key={row.id} value={row.citeKey}>{row.title} · {row.citeKey} · {row.identity.status}</option>)}
        </select></label>)}
      {!!source.requiredMappings.length && <p>若尚无对应来源，请前往 Research 明确登记元数据，再返回选择。映射只表达你的关联决定，不证明文献支持原稿论点。</p>}
      {!!source.unmanagedMarkers.length && <p>发现 {source.unmanagedMarkers.length} 个非项目引用／数字标记。未映射时保留原文并列入待核对项；不推断参考文献顺序。</p>}
      <label>采用原稿说明<textarea aria-label="采用原稿说明" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={dirty || !reason.trim() || source.requiredMappings.some((key: string) => !mappings[key])} onClick={() => run(async () => setPlan(await api('document.prepareImport', {
        context: context(), sourcePath: source.sourcePath, sourceHash: source.sourceHash, mappings, reason }))) }>预览采用原稿差异与备份</button>
    </fieldset>}
    {plan && <section role="dialog" aria-modal="false" aria-label="采用已有稿件确认"><h4>确认采用差异与备份方案</h4>
      <p>{plan.sourcePath} → {plan.destinationPath}</p><p>{plan.reason}</p>
      <p>当前修订 {plan.baseRevisionId} 将保留。源文件版本：{plan.sourceHash}</p>
      <details open><summary>当前主稿全文</summary><pre>{plan.beforeText}</pre></details>
      <details open><summary>将采用的主稿全文</summary><pre>{plan.text}</pre></details>
      {Object.entries(plan.mappings).map(([from, to]) => <p key={from}>明确引用映射：{from} → {String(to)}</p>)}
      {plan.resourceChanges.map((row: any) => <p key={row.startUtf16}>资源地址：{row.raw} → {row.replacement} · 项目目标 {row.projectRelativeTarget}</p>)}
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy || dirty} onClick={() => run(async () => { await api('document.applyImport', { context: context(), planId: plan.planId, planHash: plan.planHash });
        setPlan(undefined); setSource(undefined); setPath(''); setReason(''); await refresh() })}>确认采用原稿并保留备份</button>
      <button disabled={busy} onClick={() => run(async () => { await api('document.dismissImport', { planId: plan.planId }); setPlan(undefined) })}>取消采用原稿</button>
    </section>}
  </section>
}
