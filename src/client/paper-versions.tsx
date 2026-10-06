import React, { useEffect, useState } from 'react'
import { MarkdownView } from './markdown.tsx'
import { projectMarkdown } from '../core/editing/markdown.ts'

export function PaperVersions({ project, api, context }: any) {
  const [versions, setVersions] = useState<any[]>([]), [selected, setSelected] = useState<any>(), [error, setError] = useState('')
  useEffect(() => { let live = true
    api('document.versions', { context: context() }).then((result: any) => live && setVersions(result.versions)).catch((error: Error) => live && setError(error.message))
    return () => { live = false }
  }, [project.document.contentHash])
  return <section className="sf-materials-panel"><h2>版本记录</h2><p className="sf-muted">每次保存与首稿章节写入都会保留稿件快照。</p>
    {versions.map((row, index) => <div className="sf-reference-row" key={row.revisionId}><button onClick={async () => {
      try { setSelected(await api('document.versions', { context: context(), revisionId: row.revisionId })); setError('') } catch (error) { setError((error as Error).message) }
    }}>版本 {versions.length - index}{row.revisionId === project.document.revisionId && ' · 当前版本'}</button><span> {new Date(row.createdAt).toLocaleString()} · {row.origin === 'user-manual' ? '编辑保存' : row.origin === 'proposal-acceptance' ? '接受 AI 建议' : '稿件快照'}</span></div>)}
    {selected && <section className="sf-material-excerpt"><header><strong>版本预览</strong><button onClick={() => setSelected(undefined)}>关闭</button></header><MarkdownView projection={projectMarkdown(selected.text)} /></section>}
    {error && <p role="alert">{error}</p>}
  </section>
}
