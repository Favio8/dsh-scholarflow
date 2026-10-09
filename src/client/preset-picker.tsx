import { useTextPrompt } from './text-prompt.tsx'
import React, { useEffect, useState } from 'react'
import { localized, SUPPLEMENTAL_LABELS, SUPPLEMENTAL_PLACEMENT, SUPPLEMENTAL_PRODUCTION, type Preset } from '../shared/presets.ts'
import { sectionsFromPreset } from '../core/presets/apply.ts'

/** Preset browsing, preview and management (design 02 §7). Applying is atomic: the type
 * and the structure change together after one confirmation, and browsing never touches
 * the paper. Management writes only through the explicit operator actions. */

export const PRESET_CSS = `
/* The dialog can render without the wizard's stylesheet, so it carries the same tokens. */
:root{--sf-accent:#3f68d8;--sf-accent-text:#2f5bc4;--sf-muted:#697080;--sf-danger:#b04a4a;--sf-warn-text:#8a5c15}
@media(prefers-color-scheme:dark){:root{--sf-accent-text:#8fb3ff;--sf-muted:#9aa0a8;--sf-danger:#f0a0a0;--sf-warn-text:#f0b860}}
.sf-preset-backdrop{position:fixed;inset:0;background:#00000052;z-index:1400;display:flex;align-items:center;justify-content:center;padding:24px}
.sf-preset-dialog{display:flex;flex-direction:column;width:min(960px,92vw);height:min(80vh,720px);background:var(--dsw-alias-bg-base,#fff);border:1px solid #8883;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px #00000030}
.sf-preset-dialog>header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #8882}
.sf-preset-dialog>header strong{font-size:15px}
.sf-preset-dialog>header button{margin-left:auto;border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}
.sf-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sf-preset-tabs{display:flex;align-items:center;gap:8px;padding:10px 18px;border-bottom:1px solid #8882;flex-wrap:wrap}
.sf-preset-tabs button{height:32px;padding:0 12px;border:1px solid #8884;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
.sf-preset-tabs button[aria-pressed=true]{background:#4475e714;border-color:var(--sf-accent);color:var(--sf-accent-text)}
.sf-preset-tabs input{margin-left:auto;height:32px;min-width:180px}
.sf-preset-body{display:flex;min-height:0;flex:1}
.sf-preset-list{width:40%;min-width:220px;border-right:1px solid #8882;overflow:auto;padding:8px}
.sf-preset-group{margin:6px 10px;font-size:11.5px;color:var(--sf-muted)}
.sf-preset-row{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.sf-preset-row:hover{background:#8881}
.sf-preset-row[aria-pressed=true]{background:#4475e714;border-color:var(--sf-accent)}
.sf-preset-row>span{display:flex;flex-direction:column;flex:1;min-width:0}
.sf-preset-row small{font-size:11.5px;color:var(--sf-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-preset-row em{flex:none;font-size:11px;font-style:normal;color:var(--sf-muted)}
.sf-preset-manage{display:flex;gap:4px;flex:none}
.sf-preset-manage button{border:0;background:transparent;color:var(--sf-muted);cursor:pointer;font-size:12px;padding:2px 4px}
.sf-preset-preview{flex:1;min-width:0;overflow:auto;padding:16px 20px}
.sf-preset-preview h3{margin:0 0 6px;font-size:16px}
.sf-preset-preview p{margin:6px 0;font-size:13px;color:var(--dsw-alias-label-secondary,#727780);line-height:1.6}
.sf-preset-scene{margin:8px 0 0;padding-left:18px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-preset-share{display:flex;align-items:center;gap:8px;font-size:12.5px;margin:8px 0 0}
.sf-preset-bar{flex:1;height:8px;border-radius:4px;background:#8882;overflow:hidden;display:flex}
.sf-preset-bar i{display:block;height:100%;background:var(--sf-accent);opacity:.85}
.sf-preset-sections{margin:10px 0 0;padding:0;list-style:none;font-size:13px}
.sf-preset-sections li{padding:7px 0;border-bottom:1px solid #8881}
.sf-preset-sections strong{font-weight:500}
.sf-preset-sections small{display:block;color:var(--sf-muted);font-size:12px;margin-top:2px}
.sf-preset-subsections{margin:2px 0 0;padding:0 0 0 14px;list-style:none;border-left:2px solid #8882}
.sf-preset-subsections li{padding:5px 0 5px 8px;border-bottom:0;color:var(--dsw-alias-label-secondary,#727780)}
.sf-preset-subsections em{font-style:normal;font-size:11.5px;color:var(--sf-muted);margin-left:6px}
.sf-preset-parts{margin:12px 0 0;padding:10px 12px;border:1px solid #8883;border-radius:8px;font-size:12.5px}
.sf-preset-parts p{margin:0 0 6px;font-size:12.5px}
.sf-preset-parts-row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline}
.sf-preset-parts-label{color:var(--sf-muted);font-size:11.5px}
.sf-preset-part{display:inline-flex;align-items:baseline;gap:5px}
.sf-preset-part small{color:var(--sf-muted);font-size:11px}
.sf-preset-parts-note{margin:6px 0 0;color:var(--sf-muted);font-size:11.5px}
.sf-preset-dialog>footer{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #8882}
.sf-preset-dialog>footer>span{flex:1}
.sf-preset-dialog>footer button{height:36px;padding:0 14px;border:1px solid #8884;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.sf-preset-dialog>footer button.sf-primary{background:var(--sf-accent);border-color:var(--sf-accent);color:#fff}
.sf-preset-error{margin:0;padding:8px 18px;color:var(--sf-danger);font-size:12.5px}
.sf-preset-dialog>header .sf-preset-new{margin-left:auto;height:32px;padding:0 12px;border:1px solid #8884;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
.sf-preset-back{height:30px;padding:0 10px;margin-bottom:10px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.sf-preset-draft{flex:1;min-width:0;overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.sf-preset-draft h3{margin:0;font-size:16px}
.sf-preset-draft p{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-preset-draft label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;width:100%}
.sf-preset-draft input{height:34px;padding:0 10px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit;font:inherit}
.sf-preset-draft .sf-preset-sections{width:100%}
.sf-preset-draft .sf-preset-sections li{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sf-preset-draft .sf-preset-sections li>input:first-child{flex:1 1 160px;min-width:0}
.sf-preset-draft .sf-preset-sections li>input:nth-child(2){flex:1 1 200px;min-width:0}
.sf-preset-draft-length{display:flex;align-items:center;gap:4px;flex:none}
.sf-preset-draft-length input{width:80px}
.sf-preset-draft-length button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px}
.sf-preset-draft-actions{display:flex;gap:10px;margin-top:4px}
.sf-preset-draft-actions button{height:34px;padding:0 14px;border:1px solid #8884;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.sf-preset-draft-actions button.sf-primary{background:var(--sf-accent);border-color:var(--sf-accent);color:#fff}
/* Narrow containers show one column at a time; the apply button stays reachable. */
@media(max-width:720px){.sf-preset-body{flex-direction:column}.sf-preset-body[data-view=list] .sf-preset-preview{display:none}
.sf-preset-body[data-view=detail] .sf-preset-list{display:none}
.sf-preset-list{width:100%;min-width:0;border-right:0;border-bottom:1px solid #8882;flex:0 0 auto;max-height:45%}
.sf-preset-dialog>footer{flex-wrap:wrap}}
`

export function PresetPicker({ open, language, paperType, applied, structure, api, run, busy, onClose, onUse }: any) {
  const textPrompt = useTextPrompt()
  const [library, setLibrary] = useState<{ all: Preset[]; issues: { message: string }[] }>({ all: [], issues: [] })
  const [tab, setTab] = useState<string>(paperType)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string>()
  const [error, setError] = useState('')
  // Narrow containers show one column at a time: list, then detail with a way back
  // (design 02 §7). The breakpoint follows the container, not the whole desktop.
  const [detail, setDetail] = useState(false), [narrow, setNarrow] = useState(false)
  const [draft, setDraft] = useState<{ title: string; sections: { key: string; title: string; focus: string; targetLength: number }[] }>()
  // Which front and back matter this paper drafts. Everything the preset declares is
  // pre-checked; the user narrows it here, once, before the structure is applied.
  const [kept, setKept] = useState<string[]>([])
  const draftedKinds = (preset: Preset) => preset.supplementalParts
    .filter(part => SUPPLEMENTAL_PRODUCTION[part.kind] === 'manuscript').map(part => part.kind)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const sync = () => setNarrow(query.matches)
    sync(); query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  useEffect(() => {
    if (!open) return
    let live = true
    setTab(paperType); setChosen(applied?.id); setError('')
    api('presets.list', {}).then((value: any) => live && setLibrary(value)).catch((failure: Error) => live && setError(failure.message))
    return () => { live = false }
  }, [open, paperType])
  useEffect(() => {
    const preset = library.all.find(row => row.id === chosen)
    if (preset) setKept(draftedKinds(preset))
  }, [chosen, library])
  if (!open) return null
  const needle = query.trim().toLowerCase()
  const rows = library.all.filter(preset => preset.paperType === tab)
    .filter(preset => !needle || localized(preset.title, language).toLowerCase().includes(needle) || localized(preset.summary, language).toLowerCase().includes(needle))
    .sort((a, b) => (a.source === b.source ? 0 : a.source === 'user' ? -1 : 1))
  const selected = library.all.find(preset => preset.id === chosen)
  const reload = () => api('presets.list', {}).then((value: any) => { setLibrary(value); return value }).catch((failure: Error) => setError(failure.message))
  const manage = (action: () => Promise<unknown>) => run(async () => { await action(); await reload() })
  const apply = () => {
    if (!selected) return
    const switching = selected.paperType !== paperType
    if ((switching || applied?.modified) && !window.confirm(switching
      ? `将论文类型切换为「${localized(selected.title, language)}」所属类型，并替换当前结构。继续？`
      : '当前结构已被修改，使用该预设会替换它。继续？')) return
    onUse(selected, switching, kept)
  }
  // An abstract without keywords, or the reverse, is almost never what an assignment asks
  // for; saying so here is cheaper than finding out in the finished paper.
  const halfPair = !!selected && (kept.includes('abstract') !== kept.includes('keywords'))
    && draftedKinds(selected).includes('abstract') && draftedKinds(selected).includes('keywords')
  return <>{textPrompt.dialog}<div className="sf-preset-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="sf-preset-dialog" role="dialog" aria-modal="true" aria-label="选择结构预设">
      <style>{PRESET_CSS}</style>
      <header><strong>结构预设</strong>
        <button className="sf-preset-new" disabled={busy} onClick={() => { setDetail(false)
          setDraft({ title: '', sections: [{ key: 'k-section-1', title: '引言', focus: '', targetLength: 1000 }] }) }}>新建我的预设</button>
        <button aria-label="关闭" onClick={onClose}><span className="sf-visually-hidden">关闭</span><span aria-hidden="true">×</span></button></header>
      <div className="sf-preset-tabs" role="group" aria-label="论文类型">
        {(['course-paper', 'research-paper', 'literature-review'] as const).map(name => <button key={name} aria-pressed={tab === name}
          onClick={() => setTab(name)}>{name === 'course-paper' ? '课程论文' : name === 'research-paper' ? '研究论文' : '文献综述'}</button>)}
        <input aria-label="搜索预设" placeholder="搜索名称或说明" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      {error && <p className="sf-preset-error" role="alert">{error}</p>}
      {library.issues.length > 0 && <p className="sf-preset-error" role="status">{library.issues.length} 个预设条目未通过校验，已跳过：{library.issues[0].message}</p>}
      <div className="sf-preset-body" data-view={draft ? 'draft' : narrow ? (detail ? 'detail' : 'list') : 'wide'}>
        {draft ? <>
          <div className="sf-preset-draft">
            <h3>新建我的预设</h3>
            <p>从空白开始，至少一章；保存后加入列表，使用才会应用到论文，不依赖先创建论文。</p>
            <label>预设名称<input value={draft.title} maxLength={80} placeholder="例如：我的课程论文骨架"
              onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <ul className="sf-preset-sections">{draft.sections.map((section, index) => <li key={section.key}>
              <input aria-label={`第${index + 1}章标题`} value={section.title} placeholder="章节标题"
                onChange={event => setDraft({ ...draft, sections: draft.sections.map(row => row.key === section.key ? { ...row, title: event.target.value } : row) })} />
              <input aria-label={`第${index + 1}章写作重点`} value={section.focus} placeholder="本节写什么（可选）"
                onChange={event => setDraft({ ...draft, sections: draft.sections.map(row => row.key === section.key ? { ...row, focus: event.target.value } : row) })} />
              <span className="sf-preset-draft-length"><input aria-label={`第${index + 1}章篇幅`} type="number" min={50} value={section.targetLength}
                onChange={event => setDraft({ ...draft, sections: draft.sections.map(row => row.key === section.key ? { ...row, targetLength: Number(event.target.value) } : row) })} />
                <button aria-label="删除章节" disabled={draft.sections.length === 1}
                  onClick={() => setDraft({ ...draft, sections: draft.sections.filter(row => row.key !== section.key) })}>×</button></span>
            </li>)}</ul>
            <button onClick={() => setDraft({ ...draft, sections: [...draft.sections,
              { key: `k-section-${draft.sections.length + 1}`, title: '新章节', focus: '', targetLength: 500 }] })}>+ 添加章节</button>
            <div className="sf-preset-draft-actions">
              <button onClick={() => setDraft(undefined)}>取消</button>
              <button className="sf-primary" disabled={busy || !draft.title.trim() || !draft.sections.every(section => section.title.trim())}
                onClick={() => void manage(() => api('presets.save', { title: draft.title.trim(), summary: '由我创建的空白预设',
                  paperType, sections: draft.sections })).then(() => setDraft(undefined))}>保存为我的预设</button>
            </div>
          </div>
        </> : <>
        <div className="sf-preset-list">
          {(['user', 'builtin'] as const).map(source => { const group = rows.filter(preset => preset.source === source)
            if (!group.length) return null
            return <div key={source}><p className="sf-preset-group">{source === 'user' ? '我的预设' : '内置'}</p>
              {group.map(preset => <div key={preset.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button className="sf-preset-row" aria-pressed={chosen === preset.id} onClick={() => { setChosen(preset.id); if (narrow) setDetail(true) }}>
                  <span><strong>{localized(preset.title, language)}</strong><small>{localized(preset.summary, language)}</small></span>
                  {applied?.id === preset.id && <em>当前</em>}
                </button>
                {source === 'user' && <div className="sf-preset-manage">
                  <button disabled={busy} onClick={async () => { const next = await textPrompt.ask('新的预设名称', localized(preset.title, language)); if (next?.trim())
                    void manage(() => api('presets.rename', { id: preset.id, title: next.trim() })) }}>改名</button>
                  <button disabled={busy} onClick={() => { if (window.confirm(`删除预设「${localized(preset.title, language)}」？已有论文不受影响。`))
                    void manage(() => api('presets.remove', { id: preset.id })) }}>删除</button>
                </div>}
              </div>)}</div> })}
          {!rows.length && <p className="sf-preset-group">没有匹配的预设。</p>}
          {tab !== paperType && !rows.some(preset => preset.source === 'builtin') && <p className="sf-preset-group">该类型还没有内置预设。</p>}
        </div>
        <div className="sf-preset-preview">
          {narrow && <button className="sf-preset-back" onClick={() => setDetail(false)}>← 返回列表</button>}
          {selected ? <>
            <h3>{localized(selected.title, language)}</h3>
            <p>{localized(selected.summary, language)}</p>
            {selected.whenToUse.length > 0 && <ul className="sf-preset-scene">{selected.whenToUse.map((item, index) => <li key={index}>{localized(item, language)}</li>)}</ul>}
            <div className="sf-preset-share"><span>建议分配</span><span className="sf-preset-bar">
              {selected.sections.map(section => <i key={section.key} style={{ width: `${section.share * 100}%` }} />)}</span></div>
            <ul className="sf-preset-sections">{selected.sections.map(section => <li key={section.key}>
              <strong>{localized(section.title, language)}</strong><em style={{ marginLeft: 8, fontSize: 12, color: 'var(--sf-muted)' }}>{Math.round(section.share * 100)}%</em>
              <small>{localized(section.focus, language)}</small>
              {section.subsections.length > 0 && <ul className="sf-preset-subsections">
                {section.subsections.map(subsection => <li key={subsection.key}>
                  <span>{localized(subsection.title, language)}</span><em>{Math.round(subsection.share * 100)}%</em>
                  <small>{localized(subsection.focus, language)}</small></li>)}</ul>}
            </li>)}</ul>
            {selected.supplementalParts.length > 0 && <div className="sf-preset-parts">
              <p>前置与后置部分（不占正文目标）</p>
              {(['front', 'back'] as const).map(placement => {
                const parts = selected.supplementalParts.filter(part => SUPPLEMENTAL_PLACEMENT[part.kind] === placement)
                if (!parts.length) return null
                return <div key={placement} className="sf-preset-parts-row">
                  <span className="sf-preset-parts-label">{placement === 'front' ? '前置' : '后置'}</span>
                  {parts.map(part => SUPPLEMENTAL_PRODUCTION[part.kind] === 'manuscript'
                    ? <label key={part.kind} className="sf-preset-part">
                      <input type="checkbox" checked={kept.includes(part.kind)}
                        onChange={event => setKept(event.target.checked ? [...kept, part.kind] : kept.filter(kind => kind !== part.kind))} />
                      <span>{localized(SUPPLEMENTAL_LABELS[part.kind], language)}</span></label>
                    : <span key={part.kind} className="sf-preset-part">
                      <span>{localized(SUPPLEMENTAL_LABELS[part.kind], language)}</span><small>导出时生成</small></span>)}
                </div> })}
              <p className="sf-preset-parts-note">勾掉的部分不会写入论文；参考文献按正文实际引用在导出时生成。</p>
            </div>}
            {selected.methodNotes && <p>{localized(selected.methodNotes, language)}</p>}
            {selected.references.length > 0 && <p>结构依据：{selected.references.map(reference => reference.label).join('、')}</p>}
            <p>比例是建议起点，可按自己的需要修改。</p>
          </> : <p>从左侧选择一个预设查看结构。</p>}
        </div>
        </>}
      </div>
      <footer>
        <button disabled={busy} onClick={() => void manage(() => api('presets.save', structure()))}>保存当前结构为我的预设</button>
        <button disabled={busy || !selected} onClick={() => selected && void manage(() => api('presets.copy', { id: selected.id }))}>复制为我的预设</button>
        <span />
        {halfPair && <span style={{ fontSize: 12, color: 'var(--sf-warn-text)' }}>摘要与关键词通常一起出现，请同时勾选或同时取消。</span>}
        <button className="sf-primary" disabled={busy || !selected || halfPair} onClick={apply}>使用此预设</button>
      </footer>
    </section>
  </div></>
}
