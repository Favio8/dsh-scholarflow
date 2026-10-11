import React,{useEffect,useState} from 'react'
import type {DocumentFormatting,CharacterFormat,ParagraphFormat} from '../shared/formatting.ts'
import {type TypographySpec} from '../shared/writing-task.ts'
import {CHINESE_SIZE_LABELS,DEFAULT_TYPOGRAPHY} from '../core/export/typography.ts'
import {WorkbenchIcon} from './workbench-chrome.tsx'

const chineseFonts=['宋体','黑体','楷体','仿宋','微软雅黑','思源宋体']
const latinFonts=['Times New Roman','Arial','Calibri','Cambria']
export function FormatToolbar({range,formatting,typography=DEFAULT_TYPOGRAPHY,disabled,onMarkdown,onCharacters,onParagraph,onSave,dirty,api,context,refresh,onTypography}:any){
  const [open,setOpen]=useState(false)
  const selected=!!range&&range.end>range.start
  const character=(formatting as DocumentFormatting).characters.filter(row=>range&&row.start<range.end&&row.end>range.start).reduce((style,row)=>({...style,...row}),{} as Partial<CharacterFormat>)
  const paragraph=(formatting as DocumentFormatting).paragraphs.filter(row=>range&&row.start<=range.start&&row.end>=range.end).at(-1) as ParagraphFormat|undefined
  return <div className="sf-format-tools" onMouseDown={event=>{if((event.target as HTMLElement).closest('button'))event.preventDefault()}}>
    <div className="sf-format-toolbar" role="toolbar" aria-label="正文格式">
      <button title="加粗" aria-label="加粗" disabled={disabled||!selected} onClick={()=>onMarkdown('bold')}><strong>B</strong></button>
      <button title="斜体" aria-label="斜体" disabled={disabled||!selected} onClick={()=>onMarkdown('italic')}><em>I</em></button>
      <select aria-label="段落类型" value="" disabled={disabled} onChange={event=>onMarkdown(event.target.value)}><option value="" disabled>正文／标题</option><option value="body">正文</option><option value="h1">一级标题</option><option value="h2">二级标题</option><option value="h3">三级标题</option></select>
      <select aria-label="选中文字字号" disabled={disabled||!selected} value={character.sizePt??typography.bodySizePt} onChange={event=>onCharacters({sizePt:Number(event.target.value)})}>{CHINESE_SIZE_LABELS.filter(row=>row.pt<=36).map(row=><option key={row.pt} value={row.pt}>{row.label} · {row.pt}</option>)}</select>
      <button className="sf-format-settings" disabled={disabled} aria-expanded={open} onClick={()=>setOpen(!open)}>排版<WorkbenchIcon kind="down" /></button>
      {dirty&&<button disabled={disabled} onClick={onSave}><WorkbenchIcon kind="save" />保存</button>}
    </div>
    {open&&<div className="sf-format-popover"><section className="sf-formatting-panel" aria-label="局部排版"><header><strong>{selected?"选中文字与段落":"当前段落"}</strong></header><div className="sf-formatting-fields"><label>中文字体<select aria-label="选中文字中文字体" disabled={disabled||!selected} value={character.fontZh??typography.bodyFontZh} onChange={event=>onCharacters({fontZh:event.target.value})}>{[...new Set([typography.bodyFontZh,...chineseFonts])].map(font=><option key={font}>{font}</option>)}</select></label>
<label>英文字体<select aria-label="选中文字英文字体" disabled={disabled||!selected} value={character.fontEn??typography.bodyFontEn} onChange={event=>onCharacters({fontEn:event.target.value})}>{[...new Set([typography.bodyFontEn,...latinFonts])].map(font=><option key={font}>{font}</option>)}</select></label>
<label>对齐<select aria-label="段落对齐" disabled={disabled} value={paragraph?.alignment??typography.bodyAlignment} onChange={event=>onParagraph({alignment:event.target.value})}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option></select></label>
<label>首行缩进<select aria-label="段落首行缩进" disabled={disabled} value={paragraph?.firstLineIndentChars??typography.firstLineIndentChars} onChange={event=>onParagraph({firstLineIndentChars:Number(event.target.value)})}>{[0,1,2,3,4].map(value=><option key={value} value={value}>缩进 {value} 字</option>)}</select></label>
<label>段后间距<select aria-label="段落段后间距" disabled={disabled} value={paragraph?.afterPt??typography.paragraphAfterPt} onChange={event=>onParagraph({afterPt:Number(event.target.value)})}>{[0,3,6,12,18,24].map(value=><option key={value} value={value}>段后 {value} 磅</option>)}</select></label>
<label>段前间距<select aria-label="段落段前间距" disabled={disabled} value={paragraph?.beforePt??typography.paragraphBeforePt} onChange={event=>onParagraph({beforePt:Number(event.target.value)})}>{[0,3,6,12,18,24].map(value=><option key={value} value={value}>段前 {value} 磅</option>)}</select></label></div></section><TypographyPanel api={api} context={context} refresh={refresh} onTypography={onTypography} onClose={()=>setOpen(false)} /></div>}
  </div>
}

function TypographyPanel({api,context,refresh,onTypography,onClose}:any){
  const [spec,setSpec]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let live=true;api('writingTask.requirements',{context:context()}).then((row:any)=>{if(live)setSpec(row.spec)}).catch((error:Error)=>live&&setError(error.message));return()=>{live=false}},[])
  const typography:TypographySpec={...DEFAULT_TYPOGRAPHY,...spec?.typography}
  const update=(values:Partial<TypographySpec>)=>setSpec({...spec,typography:{...typography,...values}})
  if(!spec)return <div className="sf-formatting-panel" role="status">{error||'正在读取排版设置…'}</div>
  return <section className="sf-formatting-panel" aria-label="全文排版设置"><header><strong>全文排版</strong><button onClick={onClose} aria-label="关闭全文排版"><WorkbenchIcon kind="close" /></button></header>
    <div className="sf-formatting-fields">
      <label>中文字体<select value={typography.bodyFontZh} onChange={e=>update({bodyFontZh:e.target.value})}>{[...new Set([typography.bodyFontZh,...chineseFonts])].map(font=><option key={font}>{font}</option>)}</select></label>
      <label>英文字体<select value={typography.bodyFontEn} onChange={e=>update({bodyFontEn:e.target.value})}>{[...new Set([typography.bodyFontEn,...latinFonts])].map(font=><option key={font}>{font}</option>)}</select></label>
      <label>正文字号<select value={typography.bodySizePt} onChange={e=>{const size=CHINESE_SIZE_LABELS.find(row=>row.pt===Number(e.target.value))!;update({bodySizePt:size.pt,bodySizeLabel:size.label})}}>{CHINESE_SIZE_LABELS.filter(row=>row.pt<=36).map(row=><option key={row.pt} value={row.pt}>{row.label} · {row.pt} 磅</option>)}</select></label>
      <label>行距<select aria-label="行距" value={typography.lineSpacing} onChange={e=>update({lineSpacing:Number(e.target.value)})}>{[1,1.2,1.5,2,2.5,3].map(value=><option key={value} value={value}>{value} 倍</option>)}</select></label>
      <label>页边距（毫米）<input type="number" min="10" max="50" value={typography.marginsMm} onChange={e=>update({marginsMm:Number(e.target.value)})} /></label>
      <label>标题字体<select value={typography.headingFontZh} onChange={e=>update({headingFontZh:e.target.value})}>{[...new Set([typography.headingFontZh,...chineseFonts])].map(font=><option key={font}>{font}</option>)}</select></label>
      {([['titleSizePt','论文标题'],['heading1SizePt','一级标题'],['heading2SizePt','二级标题'],['heading3SizePt','三级标题']] as const).map(([key,label])=><label key={key}>{label}（磅）<input type="number" min="6" max="36" value={typography[key]} onChange={e=>update({[key]:Number(e.target.value)})} /></label>)}
      <label>章节编号<select value={typography.headingNumbering} onChange={e=>update({headingNumbering:e.target.value as TypographySpec['headingNumbering']})}><option value="none">不编号</option><option value="decimal">1 / 1.1</option><option value="chinese">一 / 1.1</option></select></label>
      <label>首行缩进（字符）<input type="number" min="0" max="6" value={typography.firstLineIndentChars} onChange={e=>update({firstLineIndentChars:Number(e.target.value)})} /></label>
      <label>页眉<input aria-label="页眉" value={typography.headerText} onChange={e=>update({headerText:e.target.value})} /></label>
      <label>页脚<input aria-label="页脚" value={typography.footerText} onChange={e=>update({footerText:e.target.value})} /></label>
      <label className="sf-check"><input type="checkbox" checked={typography.showPageNumbers} onChange={e=>update({showPageNumbers:e.target.checked})} />导出页码</label>
      <label className="sf-check"><input type="checkbox" checked={typography.referencePageBreak} onChange={e=>update({referencePageBreak:e.target.checked})} />参考文献另起一页</label>
      <label className="sf-check"><input type="checkbox" checked={spec.cover?.enabled??false} onChange={e=>setSpec({...spec,cover:{...spec.cover,title:spec.cover?.title||spec.title,enabled:e.target.checked}})} />包含封面</label>
      {spec.cover?.enabled&&<><label>封面标题<input value={spec.cover.title??''} onChange={e=>setSpec({...spec,cover:{...spec.cover,title:e.target.value}})} /></label>{(spec.cover.fields??[]).map((field:any,index:number)=><label key={index}>{field.label}<input value={field.value} onChange={e=>setSpec({...spec,cover:{...spec.cover,fields:spec.cover.fields.map((row:any,at:number)=>at===index?{...row,value:e.target.value}:row)}})} /></label>)}</>}
    </div>
    <footer><span role="status">{error}</span><button className="sf-primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const row=await api('typography.update',{context:context(),spec});onTypography(row.typography);await refresh();onClose()}catch(error){setError((error as Error).message)}finally{setBusy(false)}}}>{busy?'保存中…':'应用全文排版'}</button></footer>
  </section>
}
export const FORMAT_TOOLBAR_CSS=`
.sf-format-tools{flex:none;background:var(--sf-plane-1)}.sf-format-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:var(--sf-space-1);padding:var(--sf-space-2) var(--sf-space-3)}
body .sf-app .sf-format-toolbar :is(button,select){--sf-control-size:var(--sf-control-sm);font-size:var(--sf-font-xs);max-width:150px;padding:0 var(--sf-space-2);border-color:transparent;background:transparent}
.sf-format-toolbar button{display:inline-flex;align-items:center;gap:var(--sf-space-1)}.sf-format-toolbar .sf-format-settings{margin-left:auto;color:var(--sf-accent-text)}
.sf-format-popover{max-height:60vh;overflow:auto}.sf-format-popover .sf-formatting-panel{max-height:none;overflow:visible}.sf-formatting-panel{padding:var(--sf-space-3) var(--sf-space-4);max-height:320px;overflow:auto;background:var(--sf-surface);border-block:1px solid var(--sf-border-soft)}.sf-formatting-panel>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sf-space-3)}
.sf-formatting-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--sf-space-3)}.sf-formatting-fields label{display:flex;flex-direction:column;gap:var(--sf-space-1);margin:0;color:var(--sf-muted);font-size:var(--sf-font-xs)}
.sf-formatting-fields label.sf-check{flex-direction:row;align-items:center}.sf-formatting-fields :is(input,select){width:100%;min-width:0}.sf-formatting-fields .sf-check input{width:auto}.sf-formatting-panel>footer{display:flex;align-items:center;justify-content:space-between;gap:var(--sf-space-3);margin-top:var(--sf-space-3)}
.sf-paper-page .sf-prose{font-family:var(--sf-body-en,'Times New Roman'),var(--sf-body-zh,'宋体'),serif;font-size:var(--sf-body-size,var(--sf-font-prose));line-height:var(--sf-body-line,var(--sf-leading-prose))}
.sf-paper-page .sf-prose h1{font-size:var(--sf-title-size,var(--sf-font-display-2))}.sf-paper-page .sf-prose :is(h1,h2,h3,h4,h5,h6){font-family:var(--sf-body-en,'Times New Roman'),var(--sf-heading-zh,'黑体'),serif}
.sf-paper-page .sf-prose h2{font-size:var(--sf-h1-size,var(--sf-font-title))}.sf-paper-page .sf-prose h3{font-size:var(--sf-h2-size,var(--sf-font-prose))}.sf-paper-page .sf-prose h4{font-size:var(--sf-h3-size,var(--sf-font-prose))}
.sf-paper-page .sf-prose>p{margin-top:var(--sf-paragraph-before,.9em);margin-bottom:var(--sf-paragraph-after,.9em);text-indent:var(--sf-indent,2em)}
`
