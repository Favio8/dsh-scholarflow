import React, { useEffect, useState } from 'react'
import type { ExportFormat } from '../shared/presentation.ts'

export type PaperView = 'edit' | 'preview' | 'split'
export type DraftController = { dirty: boolean; canSave: boolean; save: () => Promise<void> }
export const FORMAT_LABELS: Record<ExportFormat, string> = { markdown: 'Markdown', latex: 'LaTeX', docx: 'Word' }
export const TYPE_LABELS: Record<string, string> = { 'course-paper': '课程论文', 'literature-review': '文献综述', 'research-paper': '研究论文' }
declare const __SF_KATEX_CSS__: string
export const MATH_CSS = __SF_KATEX_CSS__

export function ProjectSettings({ project, api, context, refresh, run, busy, diagnostics }: any) {
  const [title, setTitle] = useState(project.config.project.title)
  const [type, setType] = useState(project.config.project.type)
  const [language, setLanguage] = useState(project.config.project.language)
  const [baseHash, setBaseHash] = useState(project.configHash)
  const [message, setMessage] = useState('')
  const [hostInfo, setHostInfo] = useState<any>()
  useEffect(() => {
    setTitle(project.config.project.title); setType(project.config.project.type)
    setLanguage(project.config.project.language); setBaseHash(project.configHash)
  }, [project.binding.projectId, project.configHash])
  return <section className="sf-settings-card" aria-label="项目设置">
    <h3>项目设置</h3>
    <label>论文标题<input value={title} maxLength={300} onChange={e => setTitle(e.target.value)} /></label>
    <div className="sf-form-row"><label>论文类型<select value={type} onChange={e => setType(e.target.value)}>
      {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>论文语言<select value={language} onChange={e => setLanguage(e.target.value)}><option value="zh-CN">中文</option><option value="en">英文</option></select></label></div>
    <button className="sf-primary" disabled={busy || !title.trim()} onClick={() => run(async () => {
      await api('project.updatePresentation', { context: context(), baseConfigHash: baseHash, title: title.trim(), type, language })
      await refresh(); setMessage('项目设置已保存。')
    })}>保存设置</button><p role="status">{message}</p>
    <details onToggle={e => { if (e.currentTarget.open && !hostInfo && diagnostics) diagnostics().then(setHostInfo).catch((error: Error) => setMessage(error.message)) }}><summary>项目详情</summary>
      {hostInfo && <p>已连接 Host · 协议 v{hostInfo.protocol} · {hostInfo.settings.length ? '设置可持久化' : '设置能力不足'}</p>}
      <p>工作区：{project.binding.workspaceId}</p><p>项目：{project.binding.projectId}</p>
      <p>主稿：{project.config.paths.mainDocument}</p><p>当前阶段：{project.ledger.workflow?.stage ?? '以引导任务进度为准'}</p>
      <p>数据版本：{project.ledger.revision} · {project.document.externalChange ? '检测到外部正文修改' : '正文版本一致'}</p>
      {!!project.configWarnings?.length && <p>{project.configWarnings.join('、')}</p>}</details>
  </section>
}

export const PAPER_CSS = `
.sf-stream-status{display:flex;align-items:center;gap:var(--sf-space-2);padding:var(--sf-space-2) var(--sf-space-4);font-size:var(--sf-font-sm);color:var(--sf-muted);border-bottom:1px solid var(--sf-border);flex-shrink:0}
.sf-stream-status span{flex:1;min-width:0}.sf-stream-status button{white-space:nowrap;font-size:var(--sf-font-sm)}
.sf-stream-anchor{display:block;height:1px;scroll-margin-bottom:40px}
.sf-unfinished-preview{padding:var(--sf-space-2) var(--sf-space-4);border-top:1px solid var(--sf-border);max-height:220px;overflow:auto;flex-shrink:0;font-size:var(--sf-font-sm)}
.sf-unfinished-preview pre{white-space:pre-wrap;overflow-wrap:anywhere}
/* Workbench chrome reads its colours, spacing, type and radii from src/client/theme/tokens.ts.
   The simulated page (.sf-paper-page and its prose) is deliberately outside that system: it stands in
   for the exported document, so it keeps a white sheet with its own print typography in both themes.
   The editor metrics are frozen too — the gutter width, the source padding and the --sf-editor-*
   variables come from the measurement code, not from taste. */
.sf-native-workspace{min-height:0;background:var(--dsw-alias-bg-layer-1,var(--sf-surface))}
.sf-native-workspace>.sf-body{display:flex;padding:0;overflow:hidden;min-height:0}
.sf-paper-project{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;font-size:var(--sf-font-md)}
.sf-paper-header{display:flex;align-items:center;gap:var(--sf-space-2);min-height:48px;padding:0 var(--sf-space-5);border-bottom:1px solid var(--sf-border);flex-shrink:0}
.sf-paper-title{font-size:var(--sf-font-lg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:50px;max-width:40%}
/* The creation wizard owns its controls; this fallback must not override its button variants. */
.sf-paper-project button:not(.sf-native-tools *):not(:where(.sf-wizard *)),.sf-paper-project select:not(.sf-native-tools *):not(:where(.sf-wizard *)),.sf-paper-export button{font:inherit;color:inherit;background:transparent;border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);padding:var(--sf-space-2);cursor:pointer}
.sf-paper-project button:disabled:not(.sf-native-tools *){cursor:default;opacity:var(--sf-disabled-opacity)}
.sf-paper-header .sf-type-chip,.sf-paper-header select{font-size:var(--sf-font-sm);padding:var(--sf-space-1) var(--sf-space-2);color:var(--dsw-alias-label-secondary,var(--sf-muted));max-width:160px}
.sf-paper-header .sf-native-tools{margin-left:auto}
.sf-paper-export{flex-shrink:0}.sf-export-split{display:flex;align-items:center;gap:0}.sf-export-split>button{border:0!important;font-size:var(--sf-font-md)!important}.sf-export-split .sf-paper-export>summary{padding:var(--sf-space-1) var(--sf-space-2)}
.sf-paper-menu{position:relative;flex-shrink:0}
.sf-paper-menu>summary{list-style:none;cursor:pointer;padding:var(--sf-space-2);border-radius:var(--sf-radius-md);white-space:nowrap}
.sf-paper-menu>summary::-webkit-details-marker{display:none}
.sf-paper-menu>summary:hover{background:var(--sf-fill)}
.sf-paper-menu-popover{position:absolute;right:0;top:100%;z-index:10;min-width:156px;padding:var(--sf-space-1);background:var(--dsw-alias-bg-layer-1,var(--sf-surface));border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-lg);box-shadow:var(--sf-shadow-2);display:flex;flex-direction:column;gap:var(--sf-space-hair)}
.sf-paper-menu-popover button{border:0;text-align:left;border-radius:var(--sf-radius-sm);padding:var(--sf-space-2) var(--sf-space-3);white-space:nowrap}
.sf-paper-menu-popover button:hover{background:var(--sf-fill)}
.sf-paper-toolbar{display:flex;align-items:center;gap:var(--sf-space-3);height:38px;padding:0 var(--sf-space-5);border-bottom:1px solid var(--sf-border);flex-shrink:0}
.sf-paper-views{display:flex;align-items:center;height:100%;gap:var(--sf-space-1)}
.sf-paper-views button{height:28px;min-width:48px;border:0;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-paper-views button[aria-pressed=true]{color:var(--sf-accent-text);background:var(--sf-accent-soft);font-weight:600}
.sf-paper-toolbar>.sf-paper-menu{margin-left:auto}
.sf-paper-content{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.sf-paper-content>[role=tabpanel]{flex:1;min-height:0;overflow:auto;padding:var(--sf-space-5);box-sizing:border-box}
.sf-paper-content>#sf-panel-Draft{display:flex;padding:0;overflow:hidden}
.sf-tool-back{display:flex;align-items:center;gap:var(--sf-space-3);padding:var(--sf-space-2) var(--sf-space-5);border-bottom:1px solid var(--sf-border);flex-shrink:0}
.sf-tool-back strong{font-size:var(--sf-font-md)}.sf-tool-back button{border:0;padding:var(--sf-space-1) var(--sf-space-2);color:var(--sf-accent-text)}
.sf-draft{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
.sf-editor-surface{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.sf-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);flex:1;min-height:0;overflow:hidden}
.sf-editor-grid[data-view=edit],.sf-editor-grid[data-view=preview]{grid-template-columns:minmax(0,1fr)}
.sf-source-pane,.sf-preview-pane{display:flex;flex-direction:column;min-height:0;min-width:0}
.sf-pane-caption{display:flex;align-items:center;justify-content:space-between;height:32px;box-sizing:border-box;padding:0 var(--sf-space-3);color:var(--dsw-alias-label-tertiary,var(--sf-text-faint));font-size:var(--sf-font-xs);border-bottom:1px solid var(--sf-border-soft);flex-shrink:0}
.sf-pane-caption button{font-size:var(--sf-font-xs);border:0;padding:var(--sf-space-1) var(--sf-space-2)}
.sf-source-pane{border-right:1px solid var(--sf-border);background:var(--dsw-alias-bg-layer-1,var(--sf-surface))}
.sf-source-editor{display:flex;flex:1;min-height:0;overflow:hidden;position:relative}
.sf-line-gutter{width:48px;flex-shrink:0;box-sizing:border-box;overflow:hidden;padding:20px 10px 20px 0;text-align:right;user-select:none;color:var(--sf-text-faint);background:var(--sf-fill-sunken)}
.sf-line-gutter>div{will-change:transform}
.sf-line-gutter,.sf-app textarea.sf-source-input{font:var(--sf-editor-font,13px)/var(--sf-editor-line,24px) Consolas,'SFMono-Regular',monospace!important;tab-size:2}
.sf-app textarea.sf-source-input{flex:1;width:0;min-width:0;height:100%;resize:none!important;border:0!important;border-radius:0;padding:20px 18px;white-space:pre-wrap;overflow-wrap:break-word;overflow-x:hidden;overflow-y:auto;outline:none!important;background:transparent;position:relative;z-index:1}
.sf-preview-pane{background:var(--dsw-alias-bg-layer-2,var(--sf-surface-2))}
.sf-paper-scroll{flex:1;min-height:0;overflow:auto;padding:var(--sf-space-5) var(--sf-space-5) var(--sf-space-7)}
.sf-paper-page{box-sizing:border-box;width:100%;max-width:794px;min-height:900px;margin:auto;padding:42px 38px;background:#fff;color:#252a34;box-shadow:0 1px 8px #19243a0c;border:1px solid #e8e9ec}
.sf-paper-page[data-format=latex],.sf-paper-page[data-format=docx]{font-family:'Times New Roman','Noto Serif SC','宋体',serif}
.sf-paper-page .sf-prose{font-size:14px;line-height:1.9;overflow-wrap:anywhere}
.sf-paper-page .sf-prose h1{font-size:22px;line-height:1.6;text-align:center;margin:0 0 28px}
.sf-paper-page .sf-prose h2{font-size:17px;line-height:1.6;margin:26px 0 12px}
.sf-paper-page .sf-prose h3{font-size:15px;margin:22px 0 10px}
.sf-paper-page .sf-prose p{margin:12px 0}.sf-paper-page .sf-prose pre{padding:10px;background:#f6f7f9}
.sf-paper-page .sf-prose table{border-collapse:collapse;width:100%}.sf-paper-page .sf-prose td{padding:7px 9px;border:1px solid #dfe2e8}
.sf-paper-page .katex-display{overflow-x:auto;overflow-y:hidden;padding:4px 0}
.sf-paper-references{border-top:1px solid #e5e7eb;margin-top:30px;font-size:12px;line-height:1.8}
.sf-draft-status{display:flex;align-items:center;justify-content:space-between;gap:var(--sf-space-3);min-height:28px;padding:0 var(--sf-space-4);border-top:1px solid var(--sf-border);flex-shrink:0;font-size:var(--sf-font-xs);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-draft-status>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sf-saved-dot{color:var(--sf-ok);margin-right:var(--sf-space-1)}
.sf-editor-notice{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap;padding:var(--sf-space-2) var(--sf-space-4);background:var(--sf-accent-soft);border-bottom:1px solid var(--sf-border);font-size:var(--sf-font-sm);flex-shrink:0}
.sf-editor-notice button{padding:var(--sf-space-1) var(--sf-space-2);font-size:var(--sf-font-sm)}
.sf-draft-tools{flex:1;min-height:0;overflow:auto;padding:var(--sf-space-5)}
.sf-draft-tools>section,.sf-paper-content>#sf-panel-Review>section,.sf-paper-content>#sf-panel-Export>section{border:1px solid var(--sf-border);padding:var(--sf-space-4);margin:var(--sf-space-3) 0;border-radius:var(--sf-radius-lg)}
.sf-paper-project h3{font-size:var(--sf-font-xl);margin:0 0 var(--sf-space-4)}.sf-paper-project h4{font-size:var(--sf-font-lg);margin:var(--sf-space-3) 0}
.sf-paper-project label{font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted));display:flex;flex-direction:column;gap:var(--sf-space-2);margin:var(--sf-space-3) 0}
.sf-paper-project input:not([type=checkbox]),.sf-paper-project label select{width:100%;height:36px;border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;padding:var(--sf-space-2);color:inherit;box-sizing:border-box;font-size:var(--sf-font-md)}
.sf-form-row{display:flex;gap:var(--sf-space-4)}.sf-form-row>label{flex:1;min-width:0}
.sf-paper-project .sf-primary{background:var(--sf-accent);color:var(--sf-on-accent);border-color:var(--sf-accent)}
.sf-create-scroll{overflow:auto;flex:1;min-height:0;padding:var(--sf-space-6) var(--sf-space-5);background:var(--sf-fill-sunken)}
.sf-create-card{max-width:480px;margin:7vh auto;padding:var(--sf-space-5) var(--sf-space-6);background:var(--dsw-alias-bg-layer-1,var(--sf-surface));border:1px solid var(--sf-border);border-radius:var(--sf-radius-xl);box-shadow:var(--sf-shadow-2)}
.sf-create-card>h3{font-size:var(--sf-font-2xl)}.sf-create-card>p{color:var(--dsw-alias-label-secondary,var(--sf-muted));font-size:var(--sf-font-sm)}
.sf-create-card>button{margin:0 var(--sf-space-2) var(--sf-space-2) 0}.sf-create-card details{margin:var(--sf-space-4) 0}.sf-create-card summary,.sf-settings-card summary{cursor:pointer;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-settings-card{max-width:620px}.sf-settings-card details{margin-top:var(--sf-space-5);padding-top:var(--sf-space-4);border-top:1px solid var(--sf-border)}
.sf-paper-project>.sf-error{margin:0;padding:var(--sf-space-2) var(--sf-space-5);flex-shrink:0;font-size:var(--sf-font-sm);border-bottom:1px solid var(--sf-border)}
.sf-export-choice{position:absolute;inset:0;z-index:20;background:var(--sf-scrim);display:flex;align-items:center;justify-content:center;padding:var(--sf-space-5)}
.sf-export-choice>section{width:390px;max-width:100%;padding:var(--sf-space-5);border-radius:var(--sf-radius-xl);background:var(--dsw-alias-bg-layer-1,var(--sf-surface));box-shadow:var(--sf-shadow-3)}
.sf-export-choice button{display:block;width:100%;margin-top:var(--sf-space-2)}
@container (max-width:700px){.sf-paper-header{padding:0 var(--sf-space-3);gap:var(--sf-space-2)}.sf-paper-title{max-width:26%}.sf-paper-page{padding:28px 24px}.sf-paper-scroll{padding:var(--sf-space-4) var(--sf-space-3)}.sf-line-gutter{width:36px}}
.sf-paper-project{position:relative;container-type:inline-size}
.sf-pane-caption>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sf-pane-zoom{display:flex;align-items:center;flex:none;white-space:nowrap;gap:1px}
.sf-paper-project .sf-pane-zoom button{padding:var(--sf-space-1);min-width:22px;border:0;font-size:var(--sf-font-xs);font-variant-numeric:tabular-nums}
.sf-paper-header{flex-wrap:nowrap}.sf-type-chip,.sf-export-split>button{white-space:nowrap;flex-shrink:0}
.sf-paper-title{min-width:0;flex:1}.sf-paper-header .sf-native-tools{gap:var(--sf-space-1)}.sf-paper-header select{flex-shrink:0;width:82px}
@container(max-width:640px){.sf-paper-title{display:none}.sf-paper-header{padding:0 var(--sf-space-2);gap:var(--sf-space-1)}.sf-native-tools{gap:var(--sf-space-1)}.sf-pane-caption{padding:0 var(--sf-space-1)}.sf-line-gutter{width:28px}.sf-source-input{padding-left:8px!important}.sf-paper-page{padding:22px 18px}}
@container(max-width:420px){.sf-paper-header select{width:64px}.sf-export-format-label{display:none}.sf-paper-toolbar{padding:0 var(--sf-space-2)}}
`
