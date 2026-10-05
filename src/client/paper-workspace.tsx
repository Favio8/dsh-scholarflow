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
.sf-native-workspace{min-height:0;background:var(--dsw-alias-bg-layer-1,#fff)}
.sf-native-workspace>.sf-body{display:flex;padding:0;overflow:hidden;min-height:0}
.sf-paper-project{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;font-size:13px}
.sf-paper-header{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 20px;border-bottom:1px solid #8882;flex-shrink:0}
.sf-paper-title{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:50px;max-width:40%}
.sf-paper-project button:not(.sf-native-tools *),.sf-paper-project select:not(.sf-native-tools *),.sf-paper-export button{font:inherit;color:inherit;background:transparent;border:1px solid #8883;border-radius:6px;padding:6px 10px;cursor:pointer}
.sf-paper-project button:disabled:not(.sf-native-tools *){cursor:default;opacity:.5}
.sf-paper-header .sf-type-chip,.sf-paper-header select{font-size:12px;padding:4px 8px;color:var(--dsw-alias-label-secondary,#626976);max-width:160px}
.sf-paper-header .sf-native-tools{margin-left:auto}
.sf-paper-export{flex-shrink:0}
.sf-paper-menu{position:relative;flex-shrink:0}
.sf-paper-menu>summary{list-style:none;cursor:pointer;padding:6px 9px;border-radius:6px;white-space:nowrap}
.sf-paper-menu>summary::-webkit-details-marker{display:none}
.sf-paper-menu>summary:hover{background:#8881}
.sf-paper-menu-popover{position:absolute;right:0;top:100%;z-index:10;min-width:156px;padding:5px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid #8883;border-radius:8px;box-shadow:0 8px 24px #0002;display:flex;flex-direction:column;gap:2px}
.sf-paper-menu-popover button{border:0;text-align:left;border-radius:4px;padding:8px 12px;white-space:nowrap}
.sf-paper-menu-popover button:hover{background:#8881}
.sf-paper-toolbar{display:flex;align-items:center;gap:14px;height:38px;padding:0 20px;border-bottom:1px solid #8882;flex-shrink:0}
.sf-paper-views{display:flex;align-items:center;height:100%;gap:4px}
.sf-paper-views button{height:28px;min-width:48px;border:0;font-size:12px;color:var(--dsw-alias-label-secondary,#626976)}
.sf-paper-views button[aria-pressed=true]{color:#456de7;background:#5279ee12;font-weight:600}
.sf-paper-toolbar>.sf-paper-menu{margin-left:auto}
.sf-paper-content{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.sf-paper-content>[role=tabpanel]{flex:1;min-height:0;overflow:auto;padding:24px;box-sizing:border-box}
.sf-paper-content>#sf-panel-Draft{display:flex;padding:0;overflow:hidden}
.sf-tool-back{display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid #8882;flex-shrink:0}
.sf-tool-back strong{font-size:13px}.sf-tool-back button{border:0;padding:4px 6px;color:#456de7}
.sf-draft{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
.sf-editor-surface{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.sf-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);flex:1;min-height:0;overflow:hidden}
.sf-editor-grid[data-view=edit],.sf-editor-grid[data-view=preview]{grid-template-columns:minmax(0,1fr)}
.sf-source-pane,.sf-preview-pane{display:flex;flex-direction:column;min-height:0;min-width:0}
.sf-pane-caption{display:flex;align-items:center;justify-content:space-between;height:32px;box-sizing:border-box;padding:0 14px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:11px;border-bottom:1px solid #8881;flex-shrink:0}
.sf-pane-caption button{font-size:11px;border:0;padding:3px 6px}
.sf-source-pane{border-right:1px solid #8882;background:var(--dsw-alias-bg-layer-1,#fff)}
.sf-source-editor{display:flex;flex:1;min-height:0;overflow:hidden;position:relative}
.sf-line-gutter{width:48px;flex-shrink:0;box-sizing:border-box;overflow:hidden;padding:20px 10px 20px 0;text-align:right;user-select:none;color:#a4a9b3;background:#88803}
.sf-line-gutter>div{will-change:transform}
.sf-line-gutter,.sf-app textarea.sf-source-input{font:13px/24px Consolas,'SFMono-Regular',monospace!important;tab-size:2}
.sf-app textarea.sf-source-input{flex:1;width:0;min-width:0;height:100%;resize:none!important;border:0!important;border-radius:0;padding:20px 18px;white-space:pre;overflow:auto;outline:none!important;background:transparent}
.sf-preview-pane{background:var(--dsw-alias-bg-layer-2,#f4f5f7)}
.sf-paper-scroll{flex:1;min-height:0;overflow:auto;padding:24px 20px 40px}
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
.sf-draft-status{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px;padding:0 16px;border-top:1px solid #8882;flex-shrink:0;font-size:11px;color:var(--dsw-alias-label-secondary,#707784)}
.sf-draft-status>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sf-saved-dot{color:#45a56f;margin-right:5px}
.sf-editor-notice{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 16px;background:#5279ee0b;border-bottom:1px solid #8882;font-size:12px;flex-shrink:0}
.sf-editor-notice button{padding:3px 7px;font-size:12px}
.sf-draft-tools{flex:1;min-height:0;overflow:auto;padding:24px}
.sf-draft-tools>section,.sf-paper-content>#sf-panel-Review>section,.sf-paper-content>#sf-panel-Export>section{border:1px solid #8882;padding:18px;margin:14px 0;border-radius:8px}
.sf-paper-project h3{font-size:17px;margin:0 0 18px}.sf-paper-project h4{font-size:14px;margin:12px 0}
.sf-paper-project label{font-size:12px;color:var(--dsw-alias-label-secondary,#657082);display:flex;flex-direction:column;gap:7px;margin:14px 0}
.sf-paper-project input:not([type=checkbox]),.sf-paper-project label select{width:100%;height:36px;border:1px solid #8883;border-radius:6px;background:transparent;padding:6px 10px;color:inherit;box-sizing:border-box;font-size:13px}
.sf-form-row{display:flex;gap:16px}.sf-form-row>label{flex:1;min-width:0}
.sf-paper-project .sf-primary{background:#5077ea;color:white;border-color:#5077ea}
.sf-create-scroll{overflow:auto;flex:1;min-height:0;padding:36px 24px;background:#88803}
.sf-create-card{max-width:480px;margin:7vh auto;padding:28px 32px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid #8882;border-radius:12px;box-shadow:0 4px 20px #00003}
.sf-create-card>h3{font-size:22px}.sf-create-card>p{color:var(--dsw-alias-label-secondary,#788190);font-size:12px}
.sf-create-card>button{margin:6px 6px 6px 0}.sf-create-card details{margin:18px 0}.sf-create-card summary,.sf-settings-card summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#788190)}
.sf-settings-card{max-width:620px}.sf-settings-card details{margin-top:28px;padding-top:18px;border-top:1px solid #8882}
.sf-paper-project>.sf-error{margin:0;padding:8px 20px;flex-shrink:0;font-size:12px;border-bottom:1px solid #8882}
.sf-export-choice{position:absolute;inset:0;z-index:20;background:#0003;display:flex;align-items:center;justify-content:center;padding:20px}
.sf-export-choice>section{width:390px;max-width:100%;padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 40px #0002}
.sf-export-choice button{display:block;width:100%;margin-top:10px}
@container (max-width:700px){.sf-paper-header{padding:0 12px;gap:6px}.sf-paper-title{max-width:26%}.sf-paper-page{padding:28px 24px}.sf-paper-scroll{padding:16px 12px}.sf-line-gutter{width:36px}}
.sf-paper-project{position:relative;container-type:inline-size}
`
