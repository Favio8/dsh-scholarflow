import React, { useEffect, useRef, useState } from 'react'

async function textHash(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return 'sha256:' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}
export function useCowrite({ text, baseHash, api, context, merge, refresh }: any) {
  const [suggestions, setSuggestions] = useState<any[]>([]), [briefs, setBriefs] = useState<any[]>([])
  const [generated, setGenerated] = useState<any>()
  const [hash, setHash] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const latest = useRef({ context }); latest.current = { context }
  const load = async () => { const result = await api('cowrite.list', { context: latest.current.context() }); setSuggestions(result.suggestions); setBriefs(result.briefs ?? []); setGenerated(result.generated) }
  useEffect(() => { let live = true
    const read = async () => { try { const result = await api('cowrite.list', { context: latest.current.context() }); if (live) { setSuggestions(result.suggestions); setBriefs(result.briefs ?? []); setGenerated(result.generated) } } catch (error) { if (live) setMessage((error as Error).message) } }
    read(); const timer = window.setInterval(read, 2000); return () => { live = false; clearInterval(timer) }
  }, [context().sessionId])
  useEffect(() => { let live = true; setHash(''); textHash(text).then(value => live && setHash(value)); return () => { live = false } }, [text])
  const act = async (operation: () => Promise<void>) => { setBusy(true); setMessage(''); try { await operation() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
  const decide = (suggestion: any, accepted: boolean) => act(async () => {
    if (accepted) {
      if (suggestion.baseBufferHash !== await textHash(text) || suggestion.baseDocumentHash !== baseHash) throw new Error('正文已变化，请让 AI 基于当前内容重新提出修改。')
      await merge(text.slice(0, suggestion.start) + suggestion.after + text.slice(suggestion.end), text)
    }
    await api('cowrite.decide', { context: context(), suggestionId: suggestion.id, state: accepted ? 'accepted' : 'rejected' }); await load()
  })
  const card = (row: any) => <section className="sf-cowrite-inline" data-sf-protected="true" key={row.id} onMouseUp={e => e.stopPropagation()}>
    <header><strong>AI 修改建议</strong><button disabled={busy || row.baseBufferHash !== hash || row.baseDocumentHash !== baseHash} onClick={() => decide(row, true)}>接受</button><button disabled={busy} onClick={() => decide(row, false)}>放弃</button></header>
    <small>{row.instruction}</small>{(row.protectedFactChanges?.length || row.citationChanges?.added.length || row.citationChanges?.removed.length) ? <details><summary>事实与引用变化</summary>{row.protectedFactChanges?.map((item: string) => <p key={item}>{item}</p>)}{!!row.citationChanges?.added.length && <p>新增引用：{row.citationChanges.added.join('、')}</p>}{!!row.citationChanges?.removed.length && <p>移除引用：{row.citationChanges.removed.join('、')}</p>}</details> : null}{row.baseBufferHash !== hash && <p>正文已变化，这条建议需重新生成。</p>}
    {row.before && <pre className="sf-cowrite-before"><del>{row.before}</del></pre>}<pre className="sf-cowrite-after">{row.after}</pre>
  </section>
  const annotations = (start: number, end: number) => suggestions.filter(row => row.start >= start && row.start < end).map(card)
  const generatedView = generated && <section className="sf-cowrite-inline"><header><strong>本节生成建议 · 人工内容已保留</strong>
    <button disabled={busy || generated.proposal.edits.some((edit: any) => text.slice(edit.startUtf16, edit.endUtf16) !== edit.expectedText)} onClick={() => act(async () => {
      const result = await api('cowrite.adoptGenerated', { context: context(), proposalId: generated.proposal.id, text })
      const row = result.suggestion
      await merge(text.slice(0, row.start) + row.after + text.slice(row.end), text)
      await api('cowrite.decide', { context: context(), suggestionId: row.id, state: 'accepted' })
      await api('edits.reject', { context: context(), proposalId: generated.proposal.id }); await refresh(); await load()
    })}>接受到编辑缓冲</button><button disabled={busy} onClick={() => act(async () => { await api('edits.reject', { context: context(), proposalId: generated.proposal.id }); await refresh(); await load() })}>放弃</button></header>
    {generated.proposal.edits.map((edit: any, index: number) => <div key={index}><pre className="sf-cowrite-before">{edit.expectedText}</pre><pre className="sf-cowrite-after">{edit.replacementText}</pre></div>)}<p>处理后保存正文，再继续写作。</p></section>
  const briefsView = briefs.map(row => <section className="sf-cowrite-inline" key={row.id}><header><strong>AI 建议更新写作要求</strong>
    <button disabled={busy} onClick={() => act(async () => { await api('cowrite.decideBrief', { context: context(), suggestionId: row.id, state: 'accepted' }); await refresh(); await load() })}>接受</button>
    <button disabled={busy} onClick={() => act(async () => { await api('cowrite.decideBrief', { context: context(), suggestionId: row.id, state: 'rejected' }); await load() })}>放弃</button></header><p>{row.spec.title} · {row.spec.format}</p><p>{row.spec.requirements}</p></section>)
  return { suggestions, annotations, briefsView, generatedView, message, busy, reload: load, merge,
    decideProposal: (suggestion: any, state: 'accepted' | 'rejected') => api('cowrite.decide', { context: context(), suggestionId: suggestion.id, state }),
    request: (start: number, end: number, instruction: string) => act(async () => {
      await api('cowrite.propose', { context: context(), text, baseDocumentHash: baseHash, start, end, instruction }); await load()
    }) }
}
