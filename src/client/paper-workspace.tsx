import React, { useEffect, useState } from 'react'
import type { ExportFormat } from '../shared/presentation.ts'

export type PaperView = 'edit' | 'preview' | 'split'
export type DraftController = { dirty: boolean; canSave: boolean; save: () => Promise<void> }
export const FORMAT_LABELS: Record<ExportFormat, string> = { markdown: 'Markdown', latex: 'LaTeX', docx: 'Word' }
export const TYPE_LABELS: Record<string, string> = { 'course-paper': '课程论文', 'literature-review': '文献综述', 'research-paper': '研究论文' }
declare const __SF_KATEX_CSS__: string
export const MATH_CSS = __SF_KATEX_CSS__

export function ProjectSettings({project,refresh,run,busy,diagnostics}:any){
  const [hostInfo,setHostInfo]=useState<any>(),[message,setMessage]=useState('')
  return <section className="sf-settings-card" aria-label="项目设置"><header className="sf-page-heading"><h2>项目设置</h2><button disabled={busy} onClick={()=>run(async()=>{await refresh();setMessage('已重新读取项目。')})}>重新读取项目</button></header>
    <h3>文件位置</h3><div className="sf-form"><div className="sf-field"><span className="sf-field-label">论文主稿</span><div className="sf-field-control">{project.config.paths.mainDocument}</div></div>
      <div className="sf-field"><span className="sf-field-label">项目配置</span><div className="sf-field-control">.scholarflow/project.yaml</div></div></div>
    <p className="sf-muted">{project.document.externalChange?'正文在外部发生了修改，请返回正文比较后继续。':'已保存的正文可以继续编辑。'}</p>
    <details className="sf-detail" onToggle={event=>{if(event.currentTarget.open&&!hostInfo)diagnostics().then(setHostInfo).catch((error:Error)=>setMessage(error.message))}}><summary>诊断详情</summary>
      {hostInfo&&<p>宿主协议 v{hostInfo.protocol} · {hostInfo.settings.length?'设置可保存':'设置能力不足'}</p>}
      <p>项目：{project.binding.projectId}</p><p>数据版本：{project.ledger.revision}</p>
      {!!project.configWarnings?.length&&<p>{project.configWarnings.join('、')}</p>}</details>
    {message&&<p role="status">{message}</p>}
  </section>
}

export const PAPER_CSS = `
body .sf-app .sf-review-item>h3{font-family:var(--sf-family-sans);font-size:var(--sf-font-md);font-weight:600;line-height:var(--sf-leading-body)}body .sf-app :is(.sf-page-heading,.sf-review-panel,.sf-writing-options,.sf-history-panel,.sf-history-tabs,.sf-outline-panel){font-family:var(--sf-family-sans)}body .sf-app .sf-page-heading h2{font-size:var(--sf-font-display-1);font-weight:600}.sf-outline-list{list-style:none;padding:0}.sf-outline-list>li{padding:var(--sf-space-3) 0;border-bottom:1px solid var(--sf-border-soft)}.sf-writing-options .sf-field-control:has(.sf-check){display:block}
.sf-page-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--sf-space-3);margin-bottom:var(--sf-space-4)}.sf-page-heading :is(h2,h3){margin:0}.sf-page-heading p{margin:var(--sf-space-1) 0 0}.sf-page-actions{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap}
.sf-paper-actions{display:flex;gap:var(--sf-space-1);margin-left:auto}.sf-paper-actions button{font-size:var(--sf-font-sm)}.sf-paper-actions button[aria-pressed=true]{color:var(--sf-accent-text);font-weight:600}
.sf-review-panel,.sf-history-panel,.sf-review-history,.sf-settings-card,.sf-requirements-panel{max-width:960px;width:100%;margin-inline:auto;box-sizing:border-box}.sf-review-action>span{display:block;margin-top:var(--sf-space-2);font-size:var(--sf-font-sm)}.sf-review-summary{font-weight:600;margin:var(--sf-space-5) 0 var(--sf-space-1)}.sf-review-item{padding:var(--sf-space-4) 0;border-bottom:1px solid var(--sf-border-soft)}.sf-review-item>header{display:flex;align-items:center;gap:var(--sf-space-3)}.sf-review-item h3{font-size:var(--sf-font-md);font-weight:600;margin:var(--sf-space-2) 0}.sf-review-item>p{font-size:var(--sf-font-sm);line-height:var(--sf-leading-body)}.sf-review-kind{font-size:var(--sf-font-xs);color:var(--sf-accent-text)}.sf-review-item blockquote{margin:var(--sf-space-3) 0;padding-left:var(--sf-space-3);border-left:2px solid var(--sf-border-soft);color:var(--sf-muted);font-size:var(--sf-font-sm)}.sf-review-running{display:flex;gap:var(--sf-space-2);align-items:center}.sf-review-running span{flex:1}.sf-review-fix:empty{display:none}
.sf-duplicate-notice{display:flex;gap:var(--sf-space-3);align-items:center;padding:var(--sf-space-3);background:var(--sf-fill);border-radius:var(--sf-radius-control)}.sf-duplicate-notice p{flex:1;font-size:var(--sf-font-sm);margin:0}.sf-reference-row .sf-detail{margin:var(--sf-space-2) 0}.sf-reference-row .sf-detail button{display:block;text-align:left;margin-top:var(--sf-space-1);white-space:normal}
.sf-paper-content[data-page=Review],.sf-paper-content[data-page=History]{overflow:auto;display:block}.sf-paper-content[data-page=Review]>#sf-panel-Review{overflow:visible}.sf-paper-content>#sf-panel-Draft[data-sf-tool]{display:block;overflow:visible;padding:var(--sf-space-4) var(--sf-space-5);max-width:960px;width:100%;margin-inline:auto}.sf-paper-content>#sf-panel-Draft[data-sf-tool] .sf-draft{display:block;overflow:visible}.sf-history-tabs{display:flex;gap:var(--sf-space-2);max-width:960px;margin:var(--sf-space-3) auto;padding-inline:var(--sf-space-5)}.sf-history-tabs button[aria-selected=true]{color:var(--sf-accent-text);font-weight:600}.sf-outline-panel{position:absolute;inset:0;z-index:5;overflow:auto;padding:var(--sf-space-5);background:var(--sf-plane-0);box-sizing:border-box}.sf-outline-panel>section{max-width:960px;margin:auto}.sf-draft{position:relative}
@container(max-width:600px){.sf-duplicate-notice{align-items:flex-start;flex-direction:column}.sf-page-heading{align-items:flex-start}.sf-review-action>span{max-width:35ch}}
/* Progress read-out, not a band. It carries no rule: the toolbar above it already separates
   chrome from canvas, and a rule here would stack a third hairline onto the two above. */
.sf-stream-status{display:flex;align-items:center;gap:var(--sf-space-2);padding:var(--sf-space-1) var(--sf-space-4);font-size:var(--sf-font-sm);color:var(--sf-muted);flex-shrink:0}
.sf-stream-status span{flex:1;min-width:0}.sf-stream-status button{white-space:nowrap;font-size:var(--sf-font-sm)}
.sf-stream-anchor{display:block;height:1px;scroll-margin-bottom:40px}
.sf-unfinished-preview{padding:var(--sf-space-2) var(--sf-space-3);background:var(--sf-plane-2);max-height:220px;overflow:auto;flex-shrink:0;font-size:var(--sf-font-sm)}
.sf-unfinished-preview pre{white-space:pre-wrap;overflow-wrap:anywhere}
/* Workbench chrome reads its colours, spacing, type and radii from src/client/theme/tokens.ts.
   The simulated page (.sf-paper-page and its prose) is deliberately outside that system: it stands in
   for the exported document, so it keeps a white sheet with its own print typography in both themes.
   The editor metrics are frozen too — the gutter width, the source padding and the --sf-editor-*
   variables come from the measurement code, not from taste. */
.sf-native-workspace{min-height:0;background:var(--dsw-alias-bg-layer-1,var(--sf-surface))}
.sf-native-workspace>.sf-body{display:flex;padding:0;overflow:hidden;min-height:0}
/* The canvas tint lives here, on the root, and the panes above it stay transparent. Two tinted
   layers would be two painted ancestors between the app and the prose, which AT-127 caps at two;
   and this also puts the paper on the darker step so its edge reads without a border. */
.sf-paper-project{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;font-size:var(--sf-font-md);background:var(--sf-plane-0)}
/* The header is the one boundary worth a rule: it is where the plugin's own chrome meets the
   host's canvas, and nothing else on screen crosses that edge. */
.sf-paper-header{display:flex;align-items:center;gap:var(--sf-space-3);min-height:56px;padding:0 var(--sf-space-4);border-bottom:1px solid var(--sf-border-soft);background:var(--sf-plane-1);flex-shrink:0}
.sf-paper-title{font-size:var(--sf-font-prose);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:50px;max-width:40%}
.sf-paper-project button:disabled:not(.sf-native-tools *){cursor:default;opacity:var(--sf-disabled-opacity)}
.sf-paper-header .sf-type-chip,.sf-paper-header select{font-size:var(--sf-font-sm);padding:0 var(--sf-space-2);color:var(--sf-muted);max-width:160px}
body .sf-app .sf-paper-header>.sf-type-chip,body .sf-app .sf-paper-header>select{background-color:transparent;border-color:transparent;box-shadow:none}
.sf-paper-header .sf-native-tools{margin-left:auto}
.sf-paper-export{flex-shrink:0}.sf-export-split{display:flex;align-items:center;gap:0}.sf-export-split>button{border:0!important;font-size:var(--sf-font-md)!important}.sf-export-split .sf-paper-export>summary{padding:0 var(--sf-space-2)}
.sf-paper-menu{position:relative;flex-shrink:0}
.sf-paper-menu>summary{list-style:none;cursor:pointer;padding:var(--sf-space-2);border-radius:var(--sf-radius-md);white-space:nowrap}
.sf-paper-menu>summary::-webkit-details-marker{display:none}
.sf-paper-menu>summary:hover{background:var(--sf-fill)}
.sf-paper-menu-popover{position:absolute;right:0;top:100%;z-index:10;min-width:156px;padding:var(--sf-space-1);background:var(--sf-surface);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-lg);box-shadow:var(--sf-shadow-2);display:flex;flex-direction:column;gap:var(--sf-space-hair)}
.sf-paper-menu-popover button{border:0;text-align:left;border-radius:var(--sf-radius-sm);padding:var(--sf-space-2) var(--sf-space-3);white-space:nowrap}
.sf-paper-menu-popover button:hover{background:var(--sf-fill)}
/* The view switcher and the pane it governs are one control, so they share one band: the
   toolbar tints, the editor grid below it stays on the canvas. No rule between them. */
.sf-paper-toolbar{display:flex;align-items:center;gap:var(--sf-space-3);height:38px;padding:0 var(--sf-space-4);background:var(--sf-plane-1);flex-shrink:0}
.sf-paper-views{display:flex;align-items:center;gap:var(--sf-space-1);padding:var(--sf-space-1);background:var(--sf-fill);border-radius:var(--sf-radius-surface)}
body .sf-app .sf-paper-views button{--sf-control-size:var(--sf-control-sm);min-width:48px;border-color:transparent;background:transparent;font-size:var(--sf-font-sm);color:var(--sf-muted)}
body .sf-app .sf-paper-views button[aria-pressed=true]{color:var(--sf-text);background:var(--sf-surface);border-color:transparent;box-shadow:var(--sf-shadow-1);font-weight:600}
.sf-paper-toolbar>.sf-paper-menu{margin-left:auto}
.sf-paper-content{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.sf-paper-content>[role=tabpanel]{flex:1;min-height:0;overflow:auto;padding:var(--sf-space-5);box-sizing:border-box}
.sf-paper-content>#sf-panel-Draft{display:flex;padding:0;overflow:hidden}
.sf-tool-back{display:flex;align-items:center;gap:var(--sf-space-3);padding:var(--sf-space-2) var(--sf-space-3);background:var(--sf-plane-1);flex-shrink:0}
.sf-tool-back strong{font-size:var(--sf-font-sm);font-weight:500;color:var(--sf-muted)}.sf-tool-back button{border:0;padding:0 var(--sf-space-2);color:var(--sf-accent-text)}
body .sf-app .sf-tool-back button{background:transparent;border-color:transparent;font-size:var(--sf-font-sm)}
.sf-draft{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
.sf-editor-surface{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.sf-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);flex:1;min-height:0;overflow:hidden}
.sf-editor-grid[data-view=edit],.sf-editor-grid[data-view=preview]{grid-template-columns:minmax(0,1fr)}
.sf-source-pane,.sf-preview-pane{display:flex;flex-direction:column;min-height:0;min-width:0}
/* A pane caption labels the pane; it is part of the pane's own surface, so it takes the pane's
   tint instead of a rule. Sitting directly on the pane background, it needs none of its own. */
.sf-pane-caption{display:flex;align-items:center;justify-content:space-between;height:32px;box-sizing:border-box;padding:0 var(--sf-space-3);color:var(--sf-text-faint);font-size:var(--sf-font-xs);background:var(--sf-plane-2);flex-shrink:0}
.sf-pane-caption button{font-size:var(--sf-font-xs);border:0;padding:0 var(--sf-space-2)}
body .sf-app .sf-pane-caption button{background:transparent;border-color:transparent;box-shadow:none;font-size:var(--sf-font-sm)}
/* The split is two panes, not two cards. A rule would frame each pane like a panel; the
   canvas tint on the preview side is enough to say "the editor ends here". */
.sf-source-pane{background:var(--sf-surface)}
.sf-source-editor{display:flex;flex:1;min-height:0;overflow:hidden;position:relative}
.sf-line-gutter{width:48px;flex-shrink:0;box-sizing:border-box;overflow:hidden;padding:20px 10px 20px 0;text-align:right;user-select:none;color:var(--sf-text-faint);background:var(--sf-fill-sunken)}
.sf-line-gutter>div{will-change:transform}
.sf-line-gutter,.sf-app textarea.sf-source-input{font:var(--sf-editor-font,13px)/var(--sf-editor-line,24px) Consolas,'SFMono-Regular',monospace!important;tab-size:2}
.sf-app textarea.sf-source-input{flex:1;width:0;min-width:0;height:100%;resize:none!important;border:0!important;border-radius:0;padding:20px 18px;white-space:pre-wrap;overflow-wrap:break-word;overflow-x:hidden;overflow-y:auto;outline:none!important;background:transparent;color:var(--sf-text);position:relative;z-index:1}
.sf-preview-pane{background:transparent}
.sf-paper-scroll{flex:1;min-height:0;overflow:auto;padding:var(--sf-space-5) var(--sf-space-6)}
/* Paper floats on the canvas by tint and lift, not by outline. A border here draws a hard
   rectangle around a sheet of paper, which reads as a card pasted onto the page; the wide,
   very soft shadow says "this is above that" without drawing a line. */
.sf-paper-page{box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;width:100%;max-width:var(--sf-measure);min-height:900px;margin:auto;padding:0;background:var(--sf-page-bg);color:var(--sf-page-text);border:0;border-radius:0;box-shadow:0 1px 2px rgba(31,28,23,.05),0 8px 28px rgba(31,28,23,.07)}
.sf-paper-sheet{display:flex;flex-direction:column;flex:1;min-height:0;padding:var(--sf-space-7) var(--sf-space-8)}
.sf-paper-running-head{flex:none;font-family:var(--sf-family-sans);font-size:var(--sf-font-xs);letter-spacing:.04em;color:var(--sf-page-faint);padding-bottom:var(--sf-space-4);margin-bottom:var(--sf-space-5);border-bottom:1px solid var(--sf-page-border-soft)}
.sf-paper-foot{flex:none;margin-top:auto;padding-top:var(--sf-space-4);border-top:1px solid var(--sf-page-border-soft);font-family:var(--sf-family-sans);font-size:var(--sf-font-xs);color:var(--sf-page-faint);display:flex;justify-content:center;min-height:1.4em}
.sf-paper-page{font-family:var(--sf-family-serif);font-size:var(--sf-font-prose)}
.sf-paper-page .sf-prose{font-size:var(--sf-font-prose);line-height:var(--sf-leading-prose);overflow-wrap:anywhere}
.sf-paper-page .sf-prose h1{font-size:var(--sf-font-display-2);line-height:var(--sf-leading-display-2);text-align:center;margin:0 0 28px}
.sf-paper-page .sf-prose h2{font-size:var(--sf-font-title);line-height:var(--sf-leading-title);margin:26px 0 12px}
.sf-paper-page .sf-prose h3{font-size:var(--sf-font-prose);margin:22px 0 10px}
.sf-paper-page .sf-prose p{margin:.9em 0}.sf-paper-page .sf-prose>p{text-indent:2em}.sf-paper-page .sf-prose :is(li,blockquote,figcaption,td,th) p,.sf-paper-page .sf-prose>p[data-no-indent]{text-indent:0}.sf-paper-page .sf-prose pre{padding:var(--sf-space-2);background:var(--sf-surface-2)}
.sf-paper-page .sf-prose table{border-collapse:collapse;width:100%}.sf-paper-page .sf-prose td{padding:var(--sf-space-2);border:1px solid var(--sf-border)}
.sf-paper-page .katex-display{overflow-x:auto;overflow-y:hidden;padding:var(--sf-space-2) 0}
/* References belong to the sheet above them, so the rule is the sheet's own ink, one step
   lighter — not a border token, which would put a UI line inside the printed page. */
.sf-paper-references{border-top:1px solid var(--sf-page-border-soft);margin-top:30px;font-size:var(--sf-font-sm);line-height:1.8}
/* Save state and word count are status, not a panel: tint, no rule. */
.sf-draft-status{display:flex;align-items:center;justify-content:space-between;gap:var(--sf-space-3);min-height:28px;padding:0 var(--sf-space-4);background:var(--sf-plane-1);flex-shrink:0;font-size:var(--sf-font-xs);color:var(--sf-muted)}
.sf-draft-status>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sf-saved-dot{color:var(--sf-ok);margin-right:var(--sf-space-1)}
.sf-editor-notice{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap;padding:var(--sf-space-2) var(--sf-space-3);background:var(--sf-accent-soft);border-bottom:1px solid var(--sf-border);font-size:var(--sf-font-sm);flex-shrink:0}
.sf-editor-notice button{padding:0 var(--sf-space-2);font-size:var(--sf-font-sm)}
.sf-draft-tools{flex:1;min-height:0;overflow:auto;padding:var(--sf-space-5)}
.sf-draft-tools>section{border:1px solid var(--sf-border);padding:var(--sf-space-4);margin:var(--sf-space-3) 0;border-radius:var(--sf-radius-lg)}
.sf-paper-project h3{font-size:var(--sf-font-display-2);margin:0 0 var(--sf-space-4)}.sf-paper-project h4{font-size:var(--sf-font-prose);margin:var(--sf-space-3) 0}
.sf-paper-project label{font-size:var(--sf-font-sm);color:var(--sf-muted);display:flex;flex-direction:column;gap:var(--sf-space-2);margin:var(--sf-space-3) 0}
.sf-paper-project input:not([type=checkbox]),.sf-paper-project label select{width:100%;height:36px;border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-md);background:transparent;padding:var(--sf-space-2);color:inherit;box-sizing:border-box;font-size:var(--sf-font-md)}
.sf-form-row{display:flex;gap:var(--sf-space-4)}.sf-form-row>label{flex:1;min-width:0}
.sf-create-scroll{overflow:auto;flex:1;min-height:0;padding:var(--sf-space-5) var(--sf-space-6);background:var(--sf-fill-sunken)}
.sf-create-card{max-width:480px;margin:7vh auto;padding:var(--sf-space-5) var(--sf-space-6);background:var(--sf-surface);border:1px solid var(--sf-border);border-radius:var(--sf-radius-xl);box-shadow:var(--sf-shadow-2)}
.sf-create-card>h3{font-size:var(--sf-font-display-1)}.sf-create-card>p{color:var(--sf-muted);font-size:var(--sf-font-sm)}
.sf-create-card>button{margin:0 var(--sf-space-2) var(--sf-space-2) 0}.sf-create-card details{margin:var(--sf-space-4) 0}.sf-create-card summary,.sf-settings-card summary{cursor:pointer;font-size:var(--sf-font-sm);color:var(--sf-muted)}
.sf-settings-card{max-width:620px}.sf-settings-card details{margin-top:var(--sf-space-5);padding-top:var(--sf-space-4);border-top:1px solid var(--sf-border)}
.sf-paper-project>.sf-error{margin:0;padding:var(--sf-space-2) var(--sf-space-3);flex-shrink:0;font-size:var(--sf-font-sm);border-bottom:1px solid var(--sf-border)}
.sf-export-choice{position:absolute;inset:0;z-index:20;background:var(--sf-scrim);display:flex;align-items:center;justify-content:center;padding:var(--sf-space-5)}
.sf-export-choice>section{width:390px;max-width:100%;padding:var(--sf-space-5);border-radius:var(--sf-radius-xl);background:var(--sf-surface);box-shadow:var(--sf-shadow-3)}
.sf-export-choice button{display:block;width:100%;margin-top:var(--sf-space-2)}
@container (max-width:700px){.sf-paper-header{padding:0 var(--sf-space-3);gap:var(--sf-space-2)}.sf-paper-title{max-width:26%}.sf-paper-sheet{padding:var(--sf-space-5) var(--sf-space-6)}.sf-paper-scroll{padding:var(--sf-space-4) var(--sf-space-5)}.sf-line-gutter{width:36px}}
.sf-paper-project{position:relative;container-type:inline-size}
.sf-pane-caption>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sf-pane-zoom{display:flex;align-items:center;flex:none;white-space:nowrap;gap:1px}
.sf-paper-project .sf-pane-zoom button{padding:var(--sf-space-1);min-width:22px;border:0;font-size:var(--sf-font-xs);font-variant-numeric:tabular-nums}
.sf-paper-header{flex-wrap:nowrap}.sf-type-chip,.sf-export-split>button{white-space:nowrap;flex-shrink:0}
.sf-paper-title{min-width:0;flex:1}.sf-paper-header .sf-native-tools{gap:var(--sf-space-1)}.sf-paper-header select{flex-shrink:0;width:82px}
@container(max-width:640px){.sf-paper-title,.sf-paper-running-head{display:none}.sf-paper-header{padding:0 var(--sf-space-2);gap:var(--sf-space-1)}.sf-native-tools{gap:var(--sf-space-1)}.sf-pane-caption{padding:0 var(--sf-space-2)}.sf-line-gutter{width:28px}.sf-source-input{padding-left:8px!important}.sf-editor-grid[data-view=split]{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}.sf-paper-scroll{padding:var(--sf-space-2)}.sf-paper-sheet{padding:var(--sf-space-4) var(--sf-space-5)}}
@container(max-width:420px){.sf-paper-header select{width:64px}.sf-export-format-label{display:none}.sf-paper-toolbar{padding:0 var(--sf-space-2)}}
`

export const DISCLOSURE_CSS=`
.sf-chapter-nav>summary,.sf-material-maintenance>summary{display:flex;align-items:center;gap:var(--sf-space-1);list-style:none}.sf-chapter-nav>summary::-webkit-details-marker,.sf-material-maintenance>summary::-webkit-details-marker{display:none}
.sf-bibliography-link{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap;padding:var(--sf-space-2) 0}.sf-bibliography-link select{max-width:360px}
`
