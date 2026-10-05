import React, { useState } from 'react'
const kinds: Record<string, string> = { decision: '研究决定', terminology: '术语', 'writing-preference': '写作偏好' }
export function MemoryEntries({ file, context, api, run, busy }: { file: any; context: () => any; api: (method: string, request: any) => Promise<any>;
  run: (fn: () => Promise<unknown>) => void; busy: boolean }) {
  const [history, setHistory] = useState<any>()
  return <section aria-label="记忆条目来源"><h4>记忆条目来源</h4><p>以下来源针对本次读取的文本。手工输入仍需明确确认，才会成为项目记忆。</p>
    {file.memory.diagnostics.map((message: string, index: number) => <p role="status" key={index}>{message}</p>)}
    {file.memory.entries.map((entry: any) => <details key={entry.id}><summary>{kinds[entry.kind]} · 用户已确认 · {new Date(entry.confirmedAt).toLocaleString()}</summary>
      <pre>{entry.text}</pre><p>来源：用户确认操作 {entry.sourceOperationId}{entry.sourceSessionId ? ` · 会话 ${entry.sourceSessionId}` : ''}</p>
      {entry.representation === 'opaque' && <p>此结构保留为普通文本，不推断其中的语义或事实。</p>}</details>)}
    <button disabled={busy} onClick={() => run(async () => setHistory(await api('project.memoryHistory', { context: context(), path: file.path }))) }>读取记忆确认与更正历史</button>
    {history && <section aria-label="记忆确认与更正历史"><h4>确认与更正记录</h4><p>{history.limitation}</p>
      {history.operations.map((operation: any) => <details key={operation.id}><summary>{new Date(operation.confirmedAt).toLocaleString()} · {operation.reason}</summary>
        <p>用户操作 {operation.id}{operation.sourceSessionId ? ` · 会话 ${operation.sourceSessionId}` : ''} · 被替代条目 {operation.supersededEntryIds.length}</p>
        <b>更正前原文</b><pre>{operation.previousText}</pre><b>确认后原文</b><pre>{operation.text}</pre></details>)}
      {!history.operations.length && <p>暂无逐条确认或更正记录；没有推断旧文本的来源。</p>}</section>}
  </section>
}
