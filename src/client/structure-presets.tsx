import React, { useEffect, useState } from 'react'
import { localized } from '../shared/presets.ts'

// The settings page manages structure presets through the same data and the same
// operator-only methods the wizard's picker uses (design 02 §6.1.6). Nothing here is
// wizard-specific: no current structure, no applying to a paper.

export function StructurePresets({ api, run, busy, language }: any) {
  const [library, setLibrary] = useState<any>({ all: [], issues: [] })
  const [message, setMessage] = useState('')
  const load = () => api('presets.list', {}).then((value: any) => { setLibrary(value); return value })
    .catch((failure: Error) => setMessage(failure.message))
  useEffect(() => { void load() }, [])
  const manage = (action: () => Promise<unknown>, note: string) => run(async () => {
    await action(); await load(); setMessage(note)
  })
  const mine = (library.all ?? []).filter((preset: any) => preset.source === 'user')
  const builtin = (library.all ?? []).filter((preset: any) => preset.source === 'builtin')
  return <section className="sf-settings-presets" aria-label="结构预设">
    <h3>结构预设</h3>
    <p>内置预设随插件发布，只读；可复制为我的预设后再修改。这里与创建引导的预设弹窗共用同一份数据。</p>
    <p className="sf-muted">我的预设 {mine.length} 个 · 内置 {builtin.length} 个</p>
    {(library.issues ?? []).length > 0 && <p role="status" className="sf-error">
      {(library.issues ?? []).length} 个预设条目未通过校验，已跳过：{library.issues[0].message}</p>}
    <ul className="sf-settings-preset-list">
      {mine.map((preset: any) => <li key={preset.id}>
        <span>{localized(preset.title, language ?? 'zh-CN')}<small>{preset.paperType} · v{preset.version} · {preset.sectionCount} 章</small></span>
        <button disabled={busy} onClick={() => { const next = window.prompt('新的预设名称', localized(preset.title, language ?? 'zh-CN'))
          if (next?.trim()) void manage(() => api('presets.rename', { id: preset.id, title: next.trim() }), '预设已改名。') }}>改名</button>
        <button disabled={busy} onClick={() => { if (window.confirm(`删除预设「${localized(preset.title, language ?? 'zh-CN')}」？已有论文不受影响。`))
          void manage(() => api('presets.remove', { id: preset.id }), '预设已删除，已有论文不受影响。') }}>删除</button>
      </li>)}
      {!mine.length && <li className="sf-muted">还没有我的预设。可以在创建引导的第三步把当前结构保存为预设，或复制一个内置预设。</li>}
    </ul>
    <details><summary>内置预设（{builtin.length}）</summary>
      <ul className="sf-settings-preset-list">{builtin.map((preset: any) => <li key={preset.id}>
        <span>{localized(preset.title, language ?? 'zh-CN')}<small>{preset.paperType} · {preset.sectionCount} 章</small></span>
        <button disabled={busy} onClick={() => void manage(() => api('presets.copy', { id: preset.id }), '已复制为我的预设。')}>复制为我的预设</button>
      </li>)}</ul>
    </details>
    <p role="status">{message}</p>
  </section>
}
