import React, { useEffect, useRef, useState } from 'react'
import { projectTextPaths } from '../shared/requirements.ts'
import { MemoryEntries } from './memory-entries.tsx'
import { readScratch, scratchKey, ScratchQueue, writeScratch } from './scratch-backup.ts'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>;
  run: (fn: () => Promise<unknown>) => void; busy: boolean; onDirty: (dirty: boolean) => void }
type Pending = { context: any; path: string; text: string; baseHash: string; state: 'dirty' | 'cleared' }

export function ProjectTextEditor({ project, context, api, refresh, run, busy, onDirty }: Props) {
  const [path, setPath] = useState<string>(projectTextPaths[0]), [file, setFile] = useState<any>(), [text, setText] = useState(''), [baseHash, setBaseHash] = useState('')
  const [reason, setReason] = useState(''), [message, setMessage] = useState(''), [bufferMessage, setBufferMessage] = useState('')
  const [impact, setImpact] = useState<any>()
  const [recoverable, setRecoverable] = useState<any>(), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false)
  const bufferHash = useRef<string | null>(null), hostDirty = useRef(false), queue = useRef<ScratchQueue<Pending> | null>(null)
  const latest = useRef({ text, baseHash }), scope = useRef(0)
  latest.current = { text, baseHash }
  const key = scratchKey(project.binding, path), dirty = !!file && (text !== file.text || baseHash !== file.contentHash)
  const risk = dirty || !!recoverable
  useEffect(() => { onDirty(risk); return () => onDirty(false) }, [risk])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (risk) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [risk])
  const backup = (value?: { text: string; baseHash: string }) => {
    try { writeScratch(window.localStorage, key, value, 65536) }
    catch { setBufferMessage('浏览器备份未完成；请等宿主暂存完成后再关闭页面。') }
  }
  const read = async () => {
    if (queue.current?.busy) throw new Error('请先等待正在进行的暂存请求结束。')
    const current = await api('project.readText', { context: context(), path })
    let local
    try { local = readScratch(window.localStorage, key, 65536) } catch { setBufferMessage('浏览器备份不能读取；保留宿主副本供比较。') }
    setFile(current); setText(local?.text ?? current.text); setBaseHash(local?.baseHash ?? current.contentHash); setReason(''); setReady(false); setBlocked(false)
    const generation = ++scope.current
    queue.current = new ScratchQueue(async edit => {
      const result = await api('project.bufferWrite', { ...edit, baseBufferHash: bufferHash.current })
      if (generation !== scope.current) return
      bufferHash.current = result.bufferHash; hostDirty.current = result.buffer.state === 'dirty'
      if (latest.current.text === edit.text && latest.current.baseHash === edit.baseHash || edit.state === 'cleared')
        setBufferMessage(edit.state === 'dirty' ? '项目指令未提交编辑已暂存到宿主；尚未纳入项目上下文。' : '项目指令暂存缓冲已清理。')
    }, error => { if (generation === scope.current) { setBlocked(true); setBufferMessage(`项目指令暂存未完成，保留双方供比较：${(error as Error).message}`) } })
    try {
      const staged = await api('project.bufferRead', { context: context(), path })
      bufferHash.current = staged.bufferHash; hostDirty.current = staged.buffer?.state === 'dirty'
      setRecoverable(hostDirty.current && (!local || local.text !== staged.buffer.text || local.baseHash !== staged.buffer.baseHash) ? staged.buffer : undefined)
      setReady(true); setBufferMessage(local ? '已保留浏览器未提交编辑，正与宿主缓冲核对。' : hostDirty.current ? '宿主有未提交项目指令，可先比较再恢复。' : '未提交编辑将独立暂存；只有明确保存才生效。')
    } catch (error) { setBlocked(true); setBufferMessage(`暂存读取未完成，当前编辑仍保留：${(error as Error).message}`) }
  }
  useEffect(() => {
    if (!file || !ready || blocked || recoverable || (!dirty && !hostDirty.current)) return
    queue.current!.enqueue({ context: context(), path: file.path, text, baseHash, state: dirty ? 'dirty' : 'cleared' })
  }, [text, baseHash, file, ready, blocked, recoverable])
  const clear = async (hash: string) => {
    if (!ready || blocked || !queue.current) throw new Error('请先重读并比较暂存缓冲，再清理未提交副本。')
    queue.current.enqueue({ context: context(), path: file.path, text: '', baseHash: hash, state: 'cleared' })
    await queue.current.flush(); backup(); setRecoverable(undefined)
  }
  const save = () => run(async () => {
    const saved = await api('project.saveText', { context: context(), path: file.path, text, baseHash, ...(file.memory && reason.trim() && { changeReason: reason.trim() }) })
    setImpact(saved.impact)
    // The actual fact is already saved even if subsequent scratch cleanup fails.
    // Preserve its new base before cleanup so a retry cannot duplicate approval.
    const current = await api('project.readText', { context: context(), path: file.path })
    setFile(current)
    if (text === current.text) {
      setBaseHash(current.contentHash)
      try { await clear(current.contentHash) } catch (error) { setBufferMessage(`项目指令已保存，暂存清理仍需处理：${(error as Error).message}`) }
      setFile(undefined); setReady(false)
    } else {
      // A concurrent external editor changed the saved instruction again. Keep
      // the old base, both texts and the scratch; never bless that newer hash.
      backup({ text, baseHash }); setBufferMessage('保存后服务端项目指令再次改变，未提交副本和原基础版本已保留，请比较双方。')
    }
    setReason(''); setMessage('项目指令已保存；相关检查需更新。'); await refresh()
  })
  return <section aria-label="项目指令编辑">
    <label>项目指令文件<select aria-label="项目指令文件" disabled={busy || risk || !!queue.current?.busy} value={path} onChange={e => {
      setPath(e.target.value); setFile(undefined); setReady(false); setText(''); setReason(''); setRecoverable(undefined)
    }}>{projectTextPaths.map(row => <option key={row} value={row}>{row}</option>)}</select></label>
    <button disabled={busy || risk || !!queue.current?.busy} onClick={() => run(read)}>读取所选项目指令</button>
    {file && <>
      <label>项目指令内容<textarea aria-label="项目指令内容" rows={8} maxLength={65536} disabled={busy} value={text} onChange={e => {
        const edited = file.text.includes('\r\n') && !file.text.replaceAll('\r\n', '').includes('\n') ? e.target.value.replace(/\r\n|\r|\n/g, '\r\n') : e.target.value
        setText(edited); backup(edited === file.text && baseHash === file.contentHash ? undefined : { text: edited, baseHash })
      }} /></label>
      {baseHash !== file.contentHash && <p role="alert">项目指令已在服务端改变。未提交编辑已保留；比较双方后再明确采用新版本。</p>}
      <button disabled={busy} onClick={() => run(async () => {
        const current = await api('project.readText', { context: context(), path: file.path }); setFile(current); setMessage('已重读服务端项目指令，当前未提交编辑保持原样。')
      })}>比较当前服务端项目指令</button>
      <details><summary>当前服务端项目指令原文</summary><pre>{file.text}</pre></details>
      <button disabled={busy} onClick={() => run(async () => {
        if (risk && !window.confirm('放弃当前未提交项目指令并采用已显示的服务端版本？')) return
        await clear(file.contentHash); setText(file.text); setBaseHash(file.contentHash); setMessage('已明确采用当前服务端项目指令；未自动确认记忆。')
      })}>显式采用服务端项目指令</button>
      {file.memory && <><label>记忆更正说明（可选）<textarea aria-label="记忆更正说明" maxLength={4000} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <MemoryEntries key={`${file.path}:${file.contentHash}`} file={file} context={context} api={api} run={run} busy={busy} /></>}
      <button disabled={busy || !dirty || baseHash !== file.contentHash || !!recoverable} onClick={save}>确认保存项目指令</button>
      {file.memory && <button disabled={busy || dirty || !!recoverable} onClick={save}>确认将当前文本纳入项目记忆</button>}
      <button disabled={busy} onClick={() => run(async () => {
        if (risk && !window.confirm('放弃这份未保存的项目指令编辑？')) return
        await clear(file.contentHash); setFile(undefined); setReady(false); setText('')
      })}>关闭项目指令编辑</button>
    </>}
    <p role="status" aria-label="项目指令暂存状态">{bufferMessage}</p>
    {recoverable && <section aria-label="宿主项目指令缓冲恢复"><h4>发现宿主未提交项目指令</h4>
      <p>恢复只改变编辑区。需要核对基础版本，并明确保存后才进入项目输入。</p><pre>{recoverable.text}</pre>
      <button disabled={busy} onClick={() => {
        if (dirty && !window.confirm('用宿主缓冲替换当前未提交项目指令？')) return
        setText(recoverable.text); setBaseHash(recoverable.baseHash); backup({ text: recoverable.text, baseHash: recoverable.baseHash }); setRecoverable(undefined)
      }}>恢复宿主未提交项目指令</button>
    </section>}
    {file && <button disabled={busy || !blocked || !!queue.current?.busy} onClick={() => run(async () => {
      const staged = await api('project.bufferRead', { context: context(), path: file.path })
      queue.current!.reset(); bufferHash.current = staged.bufferHash; hostDirty.current = staged.buffer?.state === 'dirty'
      setRecoverable(hostDirty.current ? staged.buffer : undefined); setBlocked(false); setReady(true); setBufferMessage('已重读宿主暂存，当前页面编辑保持原样，请比较双方。')
    })}>重读项目指令冲突缓冲</button>}
    <p role="status">{message}</p>
    {impact?.changed && <section aria-label="项目指令变更影响"><h4>本次变更需要复查</h4>
      <p>检查：{impact.checks.join('、')}。{impact.outlineNeedsConfirmation && '研究决定已改变，大纲需要重新确认。'}</p>
      <ul>{impact.sections.map((section: any) => <li key={section.sectionId}>{section.title} · {section.located ? '已定位正文' : '标题尚未唯一定位'}{section.matchedTerms.length ? ` · 涉及 ${section.matchedTerms.join('、')}` : ''}</li>)}</ul>
      {!impact.sections.length && <p>当前正文未找到明确的字面匹配；仍需核对隐含依赖。</p>}<p>{impact.limitation}</p>
    </section>}
  </section>
}
