// Render implemented surfaces to static pages and screenshot them, so the visual reviews can be
// re-run instead of trusted: the creation wizard and preset picker (docs/entry-wizard-presets/05),
// and the source pane's soft wrapping (SF-086).
//
// The CSS is read out of the client components and the markup mirrors their JSX, so a capture
// shows the implemented look rather than a hand-drawn mockup. No host and no model call is
// involved: this is a rendering check, not a substitute for the interface acceptance items.
//
// Each capture is measured before it is accepted. A collapsed stage, a blank image or a
// single-colour image fails the run, because a screenshot that silently renders nothing is
// exactly the failure this script exists to catch. The wrap surface is measured against the real
// implementation — its module is bundled for the page rather than re-implemented here.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

export function extractCss(file, name) {
  const text = readFileSync(join(root, file), 'utf8')
  const marker = `export const ${name} = \``
  const start = text.indexOf(marker)
  if (start < 0) throw new Error(`${name} not found in ${file}`)
  const from = start + marker.length
  const end = text.indexOf('`', from)
  if (end < 0) throw new Error(`${name} is not a terminated template literal`)
  return text.slice(from, end)
}

// Render the actual structure editor, not a second copy of its markup.
const editorModule = join(root, '.dsh-tmp/render-structure-editor.mjs')
mkdirSync(join(root, '.dsh-tmp'), { recursive: true })
await build({ entryPoints: [join(root, 'src/client/structure-editor.tsx')], outfile: editorModule,
  bundle: true, platform: 'node', format: 'esm', packages: 'external' })
const { StructureEditor } = await import(pathToFileURL(editorModule).href)
const structureMarkup = renderToStaticMarkup(React.createElement(StructureEditor, { busy: false,
  sections: [
    { id:'demo_a',title:'问题与材料范围',purpose:'TEST_ONLY 说明本次比较的对象与依据。',targetLength:300,kind:'body',allocationMode:'auto' },
    { id:'demo_b',title:'案例比较',purpose:'TEST_ONLY 组织不同案例之间的联系与差异。',targetLength:100,kind:'body',allocationMode:'auto' },
    { id:'demo_b1',parentId:'demo_b',title:'比较维度',purpose:'TEST_ONLY 解释选择这些维度的理由。',targetLength:600,kind:'body',allocationMode:'auto' },
    { id:'demo_c',title:'比较所得与适用边界',purpose:'TEST_ONLY 回应任务，明确材料能支持到哪里。',targetLength:500,kind:'body',allocationMode:'auto' },
  ], onEdit(){}, onMove(){}, onAdd(){} }))

const sourceRow = (badge, kind, name, dir, actions) => `<li class="sf-source-row"><span class="sf-source-badge"${kind ? ` data-kind="${kind}"` : ''}>${badge}</span>
  <span class="sf-source-name">${name}<small>${dir}</small></span>${actions}</li>`

const material = (checked, name, note, disabled) => `<label${disabled ? ' class="sf-material-disabled"' : ''}><input type="checkbox"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} />
  <span>${name}</span><small>${note}</small></label>`

const head = (step) => `<header><span class="sf-wizard-eyebrow">科技论文写作</span><h2>开始一篇论文</h2><p>确定要求与资料，我们一起完成初稿。</p>${step === 0 ? '<button class="sf-wizard-clear">清除草稿</button>' : ''}</header>
<nav class="sf-wizard-steps">${['写作要求', '资料范围', '行文结构'].map((title, index) => `<button${index === step ? ' aria-current="step"' : ''}${index > step ? ' disabled' : ''}${index < step ? ' data-done="true"' : ''}><span>${index + 1}</span>${title}</button>`).join('')}</nav>
<p class="sf-wizard-step-compact"${step === 0 ? ' aria-current="step"' : ''}>第 ${step + 1} 步 / 共 3 步 · ${['写作要求', '资料范围', '行文结构'][step]}</p>`

const step1 = `<section class="sf-wizard">${head(0)}
<div class="sf-wizard-page">
<label>论文标题<input value="科技论文大作业" readonly /></label>
<div class="sf-wizard-row"><label>论文类型<select><option>课程论文</option></select></label><label>语言<select><option>中文</option></select></label><label>提交格式<select><option>Word</option></select></label></div>
<div class="sf-field"><span class="sf-field-label">引用样式</span><p class="sf-choice-current">顺序编号 [1]</p><p class="sf-field-hint">当前只支持这一种样式。作者—年份、学校或期刊的引用标准尚未实现，可以写进下面的写作要求作为要求记录，不会被当成已支持。</p></div>
<label>写作要求<textarea rows="4" readonly>科技论文大作业，要求在文件中，要求4页内容，第一页是封面</textarea></label>
<div class="sf-field"><span class="sf-field-label">写作要求来源</span>
<div class="sf-assignment-row"><div class="sf-picker"><button class="sf-picker-toggle"><span class="sf-picker-current"><em>添加要求文件或文件夹</em></span><span class="sf-picker-caret">⌄</span></button></div><button class="sf-assignment-extract">整理要求</button></div>
<p class="sf-field-hint">要求来源规定这篇论文该怎么写；第二步的论文参考材料提供写作所需的资料。两者独立选择，互不要求对方包含自己。文件保持原样，只在整理或写作时读取。</p>
<ul class="sf-source-list">
${sourceRow('可读取', '', '作业说明.md', '要求', '<button class="sf-source-action">移除</button>')}
${sourceRow('图片', 'image', '老师截图.png', '要求/截图', '<button class="sf-source-action">识别文字</button><button class="sf-source-action">移除</button>')}
${sourceRow('文件夹', '', '课程要求', '工作区根目录', '<button class="sf-source-action">移除</button><ul class="sf-source-members"><li><span>课程要求/评分标准.pdf</span><button>×</button></li><li><span>课程要求/补充说明.md</span><button>×</button></li></ul>')}
</ul></div></div>
<footer class="sf-wizard-footer"><span></span><button class="sf-primary">下一步 →</button></footer></section>`

const step2 = `<section class="sf-wizard">${head(1)}
<div class="sf-wizard-page">
<h3>选择论文使用的资料</h3>
<p class="sf-muted">这里是写作所需的参考材料，原文件保持原样。要求来源已在第一步单独选择，清空材料不会移除它们。</p>
<div class="sf-material-toolbar"><input placeholder="搜索资料" readonly /><span class="sf-material-count">已选 3 · 可解析 2 · 仅附件 1</span><button>全选可解析</button><button>清空</button></div>
<div class="sf-material-checklist">
${material(true, '讲义/第三章.md', '可解析 · 文本')}
${material(true, '讲义/第五章.md', '可解析 · 文本')}
${material(true, '数据/问卷结果.xlsx', '可解析 · 表格')}
${material(false, '课堂板书.png', '仅附件，尚未解析')}
${material(false, '旧版/存档.pdf', '当前格式暂不支持', true)}
</div></div>
<footer class="sf-wizard-footer"><button>← 上一步</button><span></span><button class="sf-primary">下一步 →</button></footer></section>`

const step3 = `<section class="sf-wizard"><header class="sf-wizard-header-compact"><span class="sf-wizard-eyebrow">TEST_ONLY 结构示例</span><button>清除草稿</button></header>
<div class="sf-wizard-page"><div class="sf-outline-heading"><h3>行文结构</h3><span class="sf-outline-status">结构已确认</span></div>
<p class="sf-outline-summary">TEST_ONLY 根据本次案例比较任务组织结构。</p>
<div class="sf-outline-toolbar"><label>正文目标<span class="sf-length-input"><input value="1500" readonly /><span>字</span></span></label>
<div class="sf-outline-tools"><button>参考预设</button><button>重新按要求生成</button></div></div>
${structureMarkup}
<div class="sf-outline-totals"><span>正文计划 1500 / 1500 字</span><button>重新分配正文篇幅</button></div>
</div><footer class="sf-wizard-footer"><button class="sf-wizard-nav sf-wizard-back">← 上一步</button><span></span><button class="sf-primary sf-wizard-nav">创建论文并开始撰写</button></footer></section>`

const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// One paragraph far longer than any pane can fit on a row, so "did it wrap at all" is unambiguous.
const LONG_PARAGRAPH = '多模态情感识别从语音、文本与视频等异质来源推断情绪状态，已被用于患者情绪状态分析、客户服务中的实时情绪检测以及自闭症儿童的社交技能训练。'.repeat(18)
const DRAFT_LINES = ['# 科技论文写作', '', '## 引言', '', LONG_PARAGRAPH, '', '## 主题论证', '', '短段落。', '', '## 结论', '', '结束。']
const DRAFT_LONG_LINE = 4
const DRAFT_TEXT = DRAFT_LINES.join('\n')
// The marked range for the SF-087 capture: the start of the long paragraph, which wraps over several
// rows. The selection is deliberately longer than the mark so a selected row *without* a band can be
// sampled next to a selected row *with* one — if the platform selection hid the mark, the two would
// look the same, which is the defect this check exists for.
const MARK_START = DRAFT_TEXT.indexOf(LONG_PARAGRAPH)
const MARK_END = MARK_START + 60, FULL_END = MARK_START + LONG_PARAGRAPH.length
const SELECT_END = MARK_START + 300

/** Mirrors the source pane's JSX: a line-number column and the pane itself, at the pane's own width. */
const draftSource = (gutterId, extra = '') => `<div class="sf-source-editor">${extra}<div class="sf-line-gutter" aria-hidden="true"><div id="${gutterId}">${DRAFT_LINES.map((_, index) => `<div>${index + 1}</div>`).join('')}</div></div>
<textarea class="sf-source-input" aria-label="Markdown 手工编辑">${escapeHtml(DRAFT_TEXT)}</textarea>`

const draftBody = () => `<div class="sf-app sf-paper-project" style="height:420px;display:flex;flex-direction:column">
<div class="sf-editor-grid" data-view="split">
<div class="sf-source-pane" style="--sf-editor-font:13px;--sf-editor-line:24px">
${draftSource('sf-wrap-gutter')}
</div></div></div></div>`

/** The same pane with the marking layer the component renders, so the mirror can be measured. Taller
    than the real pane so a long marked range shows enough of its rows to measure the seams between
    them; nothing else about the surface depends on the height. */
const draftMarkBody = () => `<div class="sf-app sf-paper-project" style="height:620px;display:flex;flex-direction:column">
<div class="sf-editor-grid" data-view="split">
<div class="sf-source-pane" style="--sf-editor-font:13px;--sf-editor-line:24px">
${draftSource('sf-mark-gutter', '<div class="sf-source-marks" aria-hidden="true"><div id="sf-mark-stack"></div></div>')}
</div></div></div>
<script>
// The pane's own wiring, reproduced so the composition retreat can be driven the way the app drives
// it: draft.tsx writes the attribute from the two composition events and nothing else.
document.querySelectorAll('.sf-source-editor').forEach(editor => {
  const area = editor.querySelector('textarea')
  area.addEventListener('compositionstart', () => editor.setAttribute('data-composing', ''))
  area.addEventListener('compositionend', () => editor.removeAttribute('data-composing'))
})
</script>`

/** The preview's half of the mark: the range is coloured on the glyphs themselves. The marked text
    is long enough to wrap, because "does the gradient continue across the wrap" is only answerable
    on a range that actually wraps — a one-line span cannot show a seam. */
const draftPreviewBody = () => `<div class="sf-app sf-paper-project" style="height:340px;display:flex;flex-direction:column">
<div class="sf-preview-pane" style="display:flex;flex-direction:column;min-height:0;flex:1">
<div class="sf-paper-scroll" style="flex:1;min-height:0;overflow:auto"><div class="sf-paper-page">
<p data-sf-block="p_TEST_ONLY" style="white-space:pre-wrap"><span data-sf-leaf="leaf_TEST_ONLY_plain">同样长度的未标注文字</span><span class="sf-mark-inline" data-sf-marked="true" data-flow="off">这是一段很长的被标注文字用来测试折行之后渐变是否仍然连续这是一段很长的被标注文字用来测试折行之后渐变是否仍然连续</span></p>
</div></div></div></div>`

const presetRow = (title, summary, chosen, current, manage) => `<div style="display:flex;align-items:center">
<button class="sf-preset-row"${chosen ? ' aria-pressed="true"' : ''}><span><strong>${title}</strong><small>${summary}</small></span>${current ? '<em>当前</em>' : ''}</button>
${manage ? '<div class="sf-preset-manage"><button>改名</button><button>删除</button></div>' : ''}</div>`

// data-view mirrors the component: at wide it renders both columns, at narrow the component
// sets list or detail itself, so the narrow capture shows the detail column alone.
const presetBody = (view) => `<div class="sf-preset-body" data-view="${view}">
<div class="sf-preset-list">
<p class="sf-preset-group">我的预设</p>
${presetRow('我的课程论文骨架', '由我创建的空白预设', true, true, true)}
<p class="sf-preset-group">内置</p>
${presetRow('论述/分析型', '围绕一个中心观点组织证据并回应反方', false, false, false)}
${presetRow('案例分析型', '按案例背景、分析框架、诊断与对策展开', false, false, false)}
${presetRow('实验/实证型', '以方法、结果与讨论为主体，数据自采', false, false, false)}
${presetRow('读书报告/书评型', '以文本细读与评价为主，不要求自采数据', false, false, false)}
</div>
<div class="sf-preset-preview">
<h3>论述/分析型</h3><p>围绕一个中心观点组织证据并回应反方，适合文史哲社类课程作业。</p>
<ul class="sf-preset-scene"><li>老师给了议题或问题，要求表态并论证</li><li>没有自己采集的数据，材料以文本与文献为主</li><li>需要呈现对反方观点的理解</li></ul>
<div class="sf-preset-share"><span>建议分配</span><span class="sf-preset-bar"><i style="width:12%"></i><i style="width:65%"></i><i style="width:13%"></i><i style="width:10%"></i></span></div>
<ul class="sf-preset-sections">
<li><strong>引言</strong><em style="margin-left:8px;font-size:12px;color:#8b9099">12%</em><small>交代议题背景，给出可被辩护的中心观点，并说明为什么这个问题值得讨论。</small></li>
<li><strong>主题论证</strong><em style="margin-left:8px;font-size:12px;color:#8b9099">65%</em><small>按分论点组织段落，每段先给主题句再给证据与解释，与中心观点形成一条线。</small></li>
<li><strong>反方观点与回应</strong><em style="margin-left:8px;font-size:12px;color:#8b9099">13%</em><small>选择有代表性的反对意见，公平陈述后说明为何不推翻本文观点。</small></li>
<li><strong>结论</strong><em style="margin-left:8px;font-size:12px;color:#8b9099">10%</em><small>回到最初的问题，说明证据支持到什么程度；不引入未经论证的新结论。</small></li>
</ul>
<p>附属部分：参考文献（不计入正文目标）</p>
<p>结构依据：Purdue OWL · Argumentative Essays</p>
<p>比例是建议起点，可按自己的需要修改。</p>
</div></div>`

const modal = (view) => `<div class="sf-preset-backdrop"><section class="sf-preset-dialog" role="dialog" aria-modal="true" aria-label="选择结构预设">
<header><strong>结构预设</strong><button class="sf-preset-new">新建我的预设</button><button aria-label="关闭"><span aria-hidden="true">×</span></button></header>
<div class="sf-preset-tabs" role="group" aria-label="论文类型"><button aria-pressed="true">课程论文</button><button>研究论文</button><button>文献综述</button><input placeholder="搜索名称或说明" readonly /></div>
${presetBody(view)}
<footer><button>保存当前结构为我的预设</button></footer>
</section></div>`

const stage = (id, title, body, width) => `<div class="stage" id="${id}"><h1>${title}</h1><div class="frame" style="width:${width}">${body}</div></div>`

const surfaces = {
  step1: { title: '第 1 步 · 写作要求', body: step1, width: '830px' },
  step2: { title: '第 2 步 · 资料范围', body: step2, width: '830px' },
  step3: { title: '第 3 步 · 行文结构与创建前确认', body: step3, width: '830px' },
  preset: { title: '结构预设弹窗（宽屏双栏）', body: modal('wide'), width: '100%' },
  presetDetail: { title: '结构预设弹窗（窄屏详情栏）', body: modal('detail'), width: '100%' },
  draftWrap: { title: '正文源码区 · 长行软换行', body: draftBody(), width: '100%' },
  draftMark: { title: '正文源码区 · 改写范围标注', body: draftMarkBody(), width: '1060px' },
  draftPreview: { title: '正文预览 · 改写范围标注', body: draftPreviewBody(), width: '520px' }
}

export function pageHtml(theme, wizard, picker, paper, motion, dark = false) {
  const stages = Object.entries(surfaces)
    .map(([id, surface], index) => stage(`s${index + 1}`, surface.title, surface.body, surface.width))
    .join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ScholarFlow 界面静态渲染</title><style>
${theme}
:root{--dsw-alias-bg-layer-1:#fafbfc;--dsw-alias-bg-base:#fff;--dsw-alias-label-secondary:#727780;--dsw-alias-interactive-bg-hover:#f0f1f3}
${dark ? `body[data-ds-dark-theme]{--dsw-alias-bg-layer-1:#1c1c1f;--dsw-alias-bg-base:#151517;--dsw-alias-label-secondary:#9aa0a8;--dsw-alias-interactive-bg-hover:#26262a}
body[data-ds-dark-theme]{background:#101013;color:#e8eaed}` : ''}
body{margin:0;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1f2329;background:#e9ecef}
.stage{padding:18px 20px 28px}
.stage>h1{font-size:13px;font-weight:600;margin:0 0 10px;color:#4b5157}
.frame{margin:0 auto}
@media(max-width:900px){.frame{width:auto!important}}
${wizard}
${picker}
${paper}
${motion}
/* Same specificity as the plugin rule, so this must come after it. The real dialog is a fixed
   overlay, which would sit out of flow and collapse its stage in a static page. */
.sf-preset-backdrop{position:static;padding:0;background:transparent}
</style></head><body${dark ? ' data-ds-dark-theme' : ''}>
${stages}
</body></html>`
}

/** Wide captures both columns; narrow captures the single column the component switches to. The dark
    pass is its own page rather than a second screenshot of every surface: the tokens key off
    body[data-ds-dark-theme], and what has to be proven in the dark is that the mark still reads —
    its paper is paper in either theme, so the glyphs keep their contrast (AT-88 (2)). */
const passes = [
  { viewport: { width: 1100, height: 900 }, suffix: '', ids: ['step1', 'step2', 'step3', 'preset', 'draftWrap', 'draftMark', 'draftPreview'] },
  { viewport: { width: 420, height: 900 }, suffix: '-narrow', ids: ['step1', 'step2', 'step3', 'presetDetail', 'draftWrap', 'draftMark', 'draftPreview'] },
  { viewport: { width: 1100, height: 900 }, suffix: '-dark', dark: true, ids: ['draftWrap', 'draftMark', 'draftPreview'] }
]

const indexPath = (id) => Object.keys(surfaces).indexOf(id) + 1

async function measure(page, base64) {
  return page.evaluate(async src => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    // "Renders nothing" is a question about how much of the capture is one colour, not about how dark
    // it is: a dark theme is legitimately mostly dark pixels, and only a capture that is almost
    // entirely a single colour says nothing rendered.
    const buckets = new Map()
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const dominant = Math.max(...buckets.values()) / (canvas.width * canvas.height)
    return { width: image.width, height: image.height, dominant }
  }, base64)
}

export async function renderSurfaces(outDir = join(root, '.dsh-tmp/ui-review')) {
  const theme = extractCss('src/client/theme/tokens.ts', 'THEME_CSS')
  const motion = extractCss('src/client/motion/tokens.ts', 'MOTION_CSS')
  const wizard = extractCss('src/client/creation-wizard.tsx', 'WIZARD_CSS')
  const picker = extractCss('src/client/preset-picker.tsx', 'PRESET_CSS')
  const paper = extractCss('src/client/paper-workspace.tsx', 'PAPER_CSS')
  const marks = extractCss('src/client/range-mark.tsx', 'RANGE_MARK_CSS')
  // The wrap and mark surfaces run the shipped modules, so they cannot pass against a stale copy of
  // a rule. Both are bundled for the page rather than re-implemented here.
  const gutterModule = await build({ entryPoints: [join(root, 'src/client/gutter-rows.ts')], bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'ScholarFlowGutter' })
  const measureModule = await build({ entryPoints: [join(root, 'src/client/source-measure.ts')], bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'ScholarFlowMeasure' })
  const rangeModule = await build({ entryPoints: [join(root, 'src/client/rewrite-range.ts')], bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'ScholarFlowRange' })
  const mirrorModule = await build({ entryPoints: [join(root, 'src/client/source-mirror.ts')], bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'ScholarFlowMirror' })
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'wizard.html'), pageHtml(theme, wizard, picker, paper + marks, motion))
  writeFileSync(join(outDir, 'wizard-dark.html'), pageHtml(theme, wizard, picker, paper + marks, motion, true))

  const browser = await chromium.launch({ executablePath: chromePath(), headless: true })
  const results = [], wrap = [], mark = [], preview = []
  try {
    for (const pass of passes) {
      const page = await (await browser.newContext({ viewport: pass.viewport })).newPage()
      await page.goto(pathToFileURL(join(outDir, pass.dark ? 'wizard-dark.html' : 'wizard.html')).href)
      await page.addScriptTag({ content: gutterModule.outputFiles[0].text })
      await page.addScriptTag({ content: measureModule.outputFiles[0].text })
      await page.addScriptTag({ content: rangeModule.outputFiles[0].text })
      await page.addScriptTag({ content: mirrorModule.outputFiles[0].text })
      await page.waitForTimeout(500)
      // The mark surface is checked against the wrapping of its own pass: every pass measures its own
      // wrap surface, so the comparison is between two measurements of the same page.
      let passWrap
      for (const id of pass.ids) {
        const name = `surface-${id}${pass.suffix}.png`
        const file = join(outDir, name)
        // The wrap and mark surfaces are measured before they are captured, so the capture shows the
        // state the check just accepted instead of an unmeasured column or an unpainted pane.
        if (id === 'draftWrap') { const report = await checkDraftWrap(page, `#s${indexPath(id)}>.frame`); passWrap = report; wrap.push({ name, report, problems: auditWrap(name, report) }) }
        const markReport = id === 'draftMark' ? await checkDraftMark(page, `#s${indexPath(id)}>.frame`) : undefined
        const previewReport = id === 'draftPreview' ? await checkDraftPreview(page, `#s${indexPath(id)}>.frame`) : undefined
        const shot = await page.locator(`#s${indexPath(id)}>.frame`).screenshot()
        writeFileSync(file, shot)
        results.push({ name, ...(await measure(page, shot.toString('base64'))) })
        if (markReport) {
          // Read the marked row back out of the capture with the platform selection over it: if that
          // selection covered the mark, the row would read as one flat colour and its spread would
          // collapse, which is what this measures.
          const probes = await sampleColors(page, shot.toString('base64'), markReport.sample.slice(0, -1))
          markReport.selected = Math.max(...probes.flatMap((one, index) => probes.slice(index + 1)
            .map(other => Math.hypot(one.r - other.r, one.g - other.g, one.b - other.b))), 0)
          // The background itself, for the wrap seam, the row's spread and the glyph contrast. The
          // full range is repainted first: the selection reproduction above left a shorter one.
          const background = await backgroundProbe(page, `#s${indexPath(id)}>.frame .sf-source-mirror .sf-mark-inline`,
            `#s${indexPath(id)}>.frame .sf-source-paper>i`,
            () => page.evaluate(({ selector, start, end }) => {
              const root = document.querySelector(selector)
              window.ScholarFlowMirror.paintSourceMark(root.querySelector('#sf-mark-stack'),
                root.querySelector('textarea.sf-source-input'), { start, end, state: 'ready' },
                root.querySelector('.sf-source-editor'))
            }, { selector: `#s${indexPath(id)}>.frame`, start: MARK_START, end: FULL_END }))
          markReport.seam = background
          // G-1 on the glyphs: the flow has to move pixels, with the off and reduced-motion captures
          // as its controls. Before the drag, so the probe cannot disturb what was measured above.
          markReport.motion = await motionProbe(page, page.locator(`#s${indexPath(id)}>.frame .sf-source-mirror .sf-mark-inline`),
            on => page.evaluate(({ selector, on }) => { document.querySelector(selector).dataset.flow = on ? 'on' : 'off' },
              { selector: `#s${indexPath(id)}>.frame .sf-source-mirror .sf-mark-inline`, on }))
          // After the capture, so the drag cannot disturb what was measured above.
          markReport.live = await dragRangeProbe(page, `#s${indexPath(id)}>.frame`)
          mark.push({ name, report: markReport, problems: auditMark(name, markReport, passWrap?.longRows) })
        }
        if (previewReport) {
          const [marked, plain] = await sampleColors(page, shot.toString('base64'), previewReport.sample)
          previewReport.contrast = Math.hypot(marked.r - plain.r, marked.g - plain.g, marked.b - plain.b)
          // G-2 and G-3 on the glyphs: the wrap seam and whether the gradient is readable on the
          // paper it is carried on — the preview had never been asked either question.
          previewReport.seam = await backgroundProbe(page, `#s${indexPath(id)}>.frame .sf-mark-inline`,
            `#s${indexPath(id)}>.frame .sf-paper-page`)
          previewReport.fragments = previewReport.seam.fragments
          // G-1 on the glyphs: the preview had never been asked whether its flow moves at all.
          previewReport.motion = await motionProbe(page, page.locator(`#s${indexPath(id)}>.frame .sf-mark-inline`),
            on => page.evaluate(({ selector, on }) => { document.querySelector(selector).dataset.flow = on ? 'on' : 'off' },
              { selector: `#s${indexPath(id)}>.frame .sf-mark-inline`, on }))
          preview.push({ name, report: previewReport, problems: auditPreview(name, previewReport) })
        }
      }
      await page.close()
    }
  } finally { await browser.close() }
  return { outDir, results, wrap, mark, preview, problems: [...audit(results), ...wrap.flatMap(row => row.problems), ...mark.flatMap(row => row.problems), ...preview.flatMap(row => row.problems)] }
}

function chromePath() {
  return process.env.SCHOLARFLOW_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
}

/**
 * AT-87 (1)(2) and SF-090 in a real browser page. The shipped painter is run against a real textarea
 * and measured: the mirror, the chips and the three-way split are the implementation under test, so
 * they are bundled into the page rather than re-implemented here — a copy would pass against a stale
 * rule. A mark that silently collapsed to one chip would still screenshot fine, so these numbers are
 * the point.
 */
async function checkDraftMark(page, selector) {
  return page.evaluate(({ selector, start, end, markEnd, selectionEnd }) => {
    const root = document.querySelector(selector)
    const area = root.querySelector('textarea.sf-source-input')
    const editor = root.querySelector('.sf-source-editor')
    const layer = root.querySelector('.sf-source-marks'), stack = root.querySelector('#sf-mark-stack')
    const style = getComputedStyle(area), row = parseFloat(style.lineHeight)
    const layerBox = layer.getBoundingClientRect()
    const contentWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    // The layer's origin is read fresh each time: the pane can scroll — and the page with it — between
    // one paint and the next, and a stale origin would place the whole mirror where it used to be.
    const place = () => { const box = area.getBoundingClientRect()
      stack.style.transform = `translate(${box.left - layerBox.left}px, ${box.top - layerBox.top - area.scrollTop}px)` }
    const paint = (from, to, state) => {
      window.ScholarFlowMirror.paintSourceMark(stack, area, { start: from, end: to, state }, editor)
      place()
      return window.ScholarFlowMeasure.sourceRangeRects(area, from, to)
    }
    // Everything about the mirror is read from this one paint: the selection reproduction below
    // repaints with a shorter range, and a measurement taken after it would describe the wrong mark.
    paint(start, end, 'generating')
    const chips = [...stack.querySelectorAll('.sf-source-paper>i')].map(chip => chip.getBoundingClientRect())
    const mirror = stack.querySelector('.sf-source-mirror'), marked = mirror.querySelector('.sf-mark-inline')
    // The three-way split is the mirror's whole content contract: the copy is the pane's text, and
    // the middle node is exactly the range.
    const split = { whole: mirror.textContent === area.value,
      slice: marked.textContent === area.value.slice(start, end) }
    // Alignment against the pane's own measurement, line by line: the measurement splits a line where
    // a space hangs at the wrap and the mirror does not, so fragment boundaries inside a line
    // legitimately differ while where a line starts and ends must not.
    const byLine = list => { const lines = new Map()
      for (const rect of list) { const key = Math.round(rect.top); if (!lines.has(key)) lines.set(key, []); lines.get(key).push(rect) }
      return [...lines.entries()].sort((a, b) => a[0] - b[0])
        .map(([top, rects]) => ({ top, left: rects[0].left, right: Math.max(...rects.map(rect => rect.right)) })) }
    const bounds = area.getBoundingClientRect()
    const mine = byLine([...marked.getClientRects()])
    const truth = byLine(window.ScholarFlowMeasure.sourceRangeRects(area, start, end)
      .map(rect => ({ left: rect.left + bounds.left - area.scrollLeft, top: rect.top + bounds.top - area.scrollTop,
        right: rect.left + bounds.left - area.scrollLeft + rect.width })))
    const align = Math.max(...mine.flatMap((line, index) => { const other = truth[index]
      return other ? [Math.abs(line.left - other.left), Math.abs(line.top - other.top), Math.abs(line.right - other.right)] : [99] }),
      mine.length === truth.length ? 0 : 99)
    // The same mark with the candidate ready must stop, and a plain selection must never flow: the
    // settled states are part of the contract, not a side effect. The painter writes data-flow from
    // the single truth, and the animation is off by default, so the gate drives the same attribute.
    const flowOf = value => { marked.dataset.flow = value; return getComputedStyle(marked).animationName }
    const flow = flowOf('on'), settled = flowOf('off'), held = flowOf('off')
    // What the pane looks like while the mirror is up, and what it falls back to without one.
    const markedLook = { colour: getComputedStyle(area).color, caret: getComputedStyle(area).caretColor }
    editor.removeAttribute('data-mirrored')
    const plainLook = { colour: getComputedStyle(area).color, caret: getComputedStyle(area).caretColor }
    editor.setAttribute('data-mirrored', '')
    // The composition retreat, driven the way the app drives it: the attribute comes from the
    // composition events (the pane's own wiring, reproduced in the page), and the CSS does the rest.
    area.dispatchEvent(new CompositionEvent('compositionstart'))
    const composing = { attribute: editor.hasAttribute('data-composing'),
      mirror: getComputedStyle(mirror).visibility, colour: getComputedStyle(area).color }
    area.dispatchEvent(new CompositionEvent('compositionend'))
    const mirrorState = { hidden: mirror.getAttribute('aria-hidden'), events: getComputedStyle(mirror).pointerEvents,
      height: Math.abs(mirror.scrollHeight - Math.max(area.scrollHeight, area.clientHeight)) }
    // The mark's contract with the token layer: the painted gradient is the token's, not a copy. The
    // expected value is computed from the token in the page, so the comparison is between two
    // computed backgrounds rather than between a computed one and a hand-parsed literal.
    const probe = document.createElement('div')
    probe.style.backgroundImage = 'var(--sf-mark-gradient)'
    document.body.append(probe)
    const tokenImage = getComputedStyle(probe).backgroundImage
    probe.remove()
    const image = getComputedStyle(marked).backgroundImage
    const paper = getComputedStyle(stack.querySelector('.sf-source-paper>i')).backgroundColor
    // Now reproduce the selection defect: select the text for real. The selection runs past the
    // marked range, so the last rows it covers carry a mark and a row further down carries only the
    // selection.
    const selected = paint(start, markEnd, 'ready')
    area.focus(); area.setSelectionRange(start, selectionEnd); area.scrollTop = 0; place()
    // Everything the strips are positioned from is read after the pane is in its final state:
    // focusing the textarea scrolls it — and with it the page — so a rectangle read before that would
    // place the strips where the mark used to be. The second paint's first chip sits where the full
    // range's does, because both start at the same offset.
    const box = area.getBoundingClientRect(), frame = root.getBoundingClientRect()
    const first = stack.querySelector('.sf-source-paper>i')?.getBoundingClientRect() ?? chips[0]
    // The reference row is two rows below the last chip, in the pane's content coordinates: it is
    // inside the selection but carries no mark, and measuring from the chips keeps it in view at any
    // column width instead of relying on a character offset that only fits one of them.
    const last = selected[selected.length - 1]
    const plainTop = box.top + last.top + row * 2
    const strip = (left, top, width) => ({ x: left - frame.left + 2, y: top - frame.top + 1, width: Math.max(4, width - 4), height: 5 })
    // Sampled across one marked row at that row's vertical middle, because the glyphs sit in the
    // middle of the line box: "is it a rainbow" is a question about the spread of colours within a
    // row, not about its average, and a strip above or below the glyphs would read the bare paper.
    const probeWidth = Math.max(6, first.width / 10)
    const across = [0.04, 0.28, 0.5, 0.72, 0.96]
      .map(share => strip(first.left + first.width * share - probeWidth / 2, first.top + first.height / 2 - 2, probeWidth))
    const lefts = chips.map(chip => chip.left - (box.left + parseFloat(style.paddingLeft)))
    return { row, count: chips.length, marked: selected.length, contentWidth, paper, tokenImage, image,
      heights: chips.map(chip => chip.height), minLeft: Math.min(...lefts),
      maxRight: Math.max(...chips.map((chip, index) => lefts[index] + chip.width)),
      gaps: chips.slice(1).map((chip, index) => chip.top - chips[index].bottom),
      flow, settled, held, split, align, mirror: mirrorState, markedLook, plainLook, composing,
      inView: box.top <= plainTop && plainTop + row <= box.bottom, view: { probe: plainTop, top: box.top, bottom: box.bottom, last: last.top },
      sample: [...across, strip(box.left + parseFloat(style.paddingLeft), plainTop, contentWidth)] }
  }, { selector, start: MARK_START, end: FULL_END, markEnd: MARK_END, selectionEnd: SELECT_END })
}

/**
 * The mark's background, measured once for three questions: does the gradient continue across a wrap
 * (G-2), is it a rainbow within one line, and is every stop readable on the paper it is carried on
 * (G-3). With the gradient clipped to the glyphs a strip's colour is an ink-and-paper mixture that
 * depends on which glyph happens to sit there, so the background is unclipped for one capture and the
 * same question is asked of the paint itself. The DOM selection is dropped for that capture so the
 * tint cannot level the differences, and only fragments the pane's window shows are sampled — a
 * clipped line paints no background at all and would read the page behind the pane.
 */
async function backgroundProbe(page, selector, paperSelector, prepare) {
  // A caller may need to put the mark back the way it wants it measured: the selection reproduction
  // leaves a shorter range painted, and the background questions are about the full one.
  if (prepare) await prepare()
  await page.evaluate(selector => {
    window.getSelection()?.removeAllRanges()
    const marked = document.querySelector(selector)
    marked.style.webkitBackgroundClip = 'border-box'; marked.style.backgroundClip = 'border-box'
  }, selector)
  await page.waitForTimeout(60)
  const shot = await page.locator(selector).screenshot()
  const geometry = await page.evaluate(({ selector, paperSelector }) => {
    const marked = document.querySelector(selector)
    marked.style.webkitBackgroundClip = ''; marked.style.backgroundClip = ''
    const editor = marked.closest('.sf-source-editor')?.getBoundingClientRect()
    const box = marked.getBoundingClientRect(), fragments = [...marked.getClientRects()]
    const shows = rect => !editor || (rect.top >= editor.top - 1 && rect.bottom <= editor.bottom + 1)
    const across = rect => [0.06, 0.28, 0.5, 0.72, 0.94].map(share =>
      ({ x: rect.left - box.left + (rect.right - rect.left) * share - 5, y: rect.top + rect.height / 2 - box.top - 3, width: 10, height: 6 }))
    const seam = []
    for (let index = 0; index + 1 < fragments.length; index++) {
      const one = fragments[index], two = fragments[index + 1]
      if (!shows(one) || !shows(two)) continue
      const middle = rect => rect.top + rect.height / 2 - box.top - 2
      seam.push({ x: one.right - box.left - 4, y: middle(one), width: 4, height: 5 },
        { x: two.left - box.left, y: middle(two), width: 4, height: 5 })
    }
    // The widest visible fragment shows the most of the period, so the row's spread is read from it.
    const widest = fragments.filter(shows).sort((one, two) => two.width - one.width)[0]
    const paper = document.querySelector(paperSelector)
    return { fragments: fragments.length, visible: seam.length / 2, seam, across: widest ? across(widest) : [],
      paper: paper ? getComputedStyle(paper).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number) : null }
  }, { selector, paperSelector })
  const colours = await sampleColors(page, shot.toString('base64'), [...geometry.seam, ...geometry.across])
  const seamColours = colours.slice(0, geometry.seam.length), across = colours.slice(geometry.seam.length)
  const seamDelta = seamColours.reduce((worst, one, index) => index % 2
    ? Math.max(worst, Math.hypot(one.r - seamColours[index - 1].r, one.g - seamColours[index - 1].g, one.b - seamColours[index - 1].b)) : worst, 0)
  const spread = Math.max(...across.flatMap((one, index) => across.slice(index + 1)
    .map(other => Math.hypot(one.r - other.r, one.g - other.g, one.b - other.b))), 0)
  const contrast = geometry.paper && across.length
    ? Math.min(...across.map(one => contrastRatio(one, { r: geometry.paper[0], g: geometry.paper[1], b: geometry.paper[2] }))) : undefined
  return { fragments: geometry.fragments, visible: geometry.visible, seamDelta, spread, contrast }
}

/** WCAG relative luminance and contrast ratio, for the text sitting on a band. */
function contrastRatio(one, other) {
  const channel = value => { const part = value / 255; return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4) }
  const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

/** Average colour of each sampled strip, read back out of the capture. */
async function sampleColors(page, base64, rects) {  return page.evaluate(async ({ src, rects }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return rects.map(({ x, y, width, height }) => {
      const data = context.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)),
        Math.max(1, Math.round(width)), Math.max(1, Math.round(height))).data
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++ }
      return { r: r / n, g: g / n, b: b / n }
    })
  }, { src: base64, rects })
}

/**
 * The mark follows the pointer while it is still down, which only works if the range can be read
 * during the drag: `select` fires once, on release (measured: none during a drag). This drags for
 * real and counts how often the range could be read before the button came up, so a platform that
 * stops reporting mid-drag fails here instead of silently lagging a gesture behind.
 */
async function dragRangeProbe(page, selector) {
  const box = await page.locator(`${selector} textarea.sf-source-input`).boundingBox()
  await page.evaluate(selector => {
    window.__sfLive = 0
    const input = document.querySelector(`${selector} textarea.sf-source-input`)
    document.addEventListener('selectionchange', () => {
      const start = window.ScholarFlowRange.sourceOffset(input.value, input.selectionStart, 'lf')
      const end = window.ScholarFlowRange.sourceOffset(input.value, input.selectionEnd, 'lf')
      if (end > start) window.__sfLive++
    })
  }, selector)
  await page.mouse.move(box.x + 12, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 60, { steps: 6 })
  const during = await page.evaluate(() => window.__sfLive)
  await page.mouse.move(box.x + 260, box.y + 96, { steps: 5 })
  const grown = await page.evaluate(() => window.__sfLive)
  await page.mouse.up()
  return { during, grown }
}

/**
 * G-1: does the flow actually move? An animation that exists but displaces nothing — a percentage
 * of a box that already equals the image width — produces identical frames, which is exactly the
 * defect this caught. Two captures of the marked element, one sixth of a sweep apart, are compared
 * pixel by pixel. The switched-off and reduced-motion captures are the controls: without them a
 * difference could come from anything else on the surface. Leaves the switch off.
 */
async function motionProbe(page, locator, turn) {
  const capture = async () => (await locator.screenshot()).toString('base64')
  const delta = (one, other) => page.evaluate(async ({ one, other }) => {
    const load = async src => { const image = new Image(); image.src = 'data:image/png;base64,' + src; await image.decode(); return image }
    const [first, second] = [await load(one), await load(other)]
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(first.width, second.width); canvas.height = Math.max(first.height, second.height)
    const context = canvas.getContext('2d')
    const read = image => { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height).data }
    const [a, b] = [read(first), read(second)]
    let changed = 0
    for (let index = 0; index < a.length; index += 4) {
      if (Math.abs(a[index] - b[index]) > 12 || Math.abs(a[index + 1] - b[index + 1]) > 12 || Math.abs(a[index + 2] - b[index + 2]) > 12) changed++
    }
    return changed / (a.length / 4)
  }, { one, other })
  await turn(true)
  const onOne = await capture()
  await page.waitForTimeout(460)
  const onTwo = await capture()
  await turn(false)
  const offOne = await capture()
  await page.waitForTimeout(460)
  const offTwo = await capture()
  await turn(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(120)
  const reducedOne = await capture()
  await page.waitForTimeout(460)
  const reducedTwo = await capture()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await turn(false)
  return { moving: await delta(onOne, onTwo), still: await delta(offOne, offTwo), reduced: await delta(reducedOne, reducedTwo) }
}


/**
 * The preview's half of the same defect: there the range is coloured on the glyphs, and selecting it
 * made the platform paint over that colour. A DOM selection is set over the marked span and its
 * unmarked neighbour, both of which are then sampled from the capture — if the selection covered the
 * mark, the two would read alike.
 */
async function checkDraftPreview(page, selector) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector)
    const marked = root.querySelector('.sf-mark-inline'), plain = root.querySelector('[data-sf-leaf]')
    const range = document.createRange()
    range.setStartBefore(plain); range.setEndAfter(marked)
    const selection = window.getSelection()
    selection.removeAllRanges(); selection.addRange(range)
    const frame = root.getBoundingClientRect()
    const strip = element => { const box = element.getBoundingClientRect()
      return { x: box.left - frame.left + 1, y: box.top - frame.top + 1, width: Math.max(4, box.width - 2), height: Math.max(4, box.height - 2) } }
    const style = getComputedStyle(marked)
    return { selected: selection.toString().length, gradient: style.backgroundImage.includes('linear-gradient'),
      // The seam measurement only exposes a restart at widths where the wrap lands away from the
      // period's matching stop, so the wrap mode itself is asserted as well: the pixel check proves
      // the effect where the layout shows it, this proves the contract everywhere.
      wrap: style.boxDecorationBreak || style.webkitBoxDecorationBreak,
      colour: style.color, sample: [strip(marked), strip(plain)] }
  }, selector)
}

/** G-1's three assertions, shared by both surfaces: the flow moves, and only when asked to. The
    off and reduced-motion legs are what make the first one mean something. */
function auditMotion(name, report, what) {
  const problems = []
  if (report.motion) {
    if (report.motion.moving < 0.005) problems.push(`${name}: the ${what} does not flow (${(report.motion.moving * 100).toFixed(2)}% of pixels changed between frames)`)
    if (report.motion.still > 0.0005) problems.push(`${name}: the ${what} keeps moving while switched off (${(report.motion.still * 100).toFixed(2)}%)`)
    if (report.motion.reduced > 0.0005) problems.push(`${name}: the ${what} ignores reduced motion (${(report.motion.reduced * 100).toFixed(2)}%)`)
  }
  return problems
}

/** The mark's shared assertions, for whichever surface carries it (the source pane's mirror or the
    preview's inline span): one gradient, one period, a continuous wrap, a readable stop and a flow
    that moves only when asked to. */
function auditMarkCommon(name, report) {
  const problems = []
  if (!report.gradient) problems.push(`${name}: the marked text lost its gradient`)
  if (report.wrap !== undefined && report.wrap !== 'slice') problems.push(`${name}: the marked text wraps with ${report.wrap}, so every line restarts the gradient`)
  if (report.fragments !== undefined && report.fragments < 2) problems.push(`${name}: the marked text does not wrap, so no seam could be measured`)
  const seam = report.seam ?? {}
  if (seam.visible !== undefined && seam.visible < 1) problems.push(`${name}: no seam is visible to measure`)
  if (seam.seamDelta !== undefined && seam.seamDelta > 18) problems.push(`${name}: the gradient restarts at a wrap (seam differs by ${seam.seamDelta.toFixed(1)})`)
  if (seam.spread !== undefined && seam.spread < 140) problems.push(`${name}: the gradient reads as one colour rather than a rainbow (spread ${seam.spread.toFixed(0)} across the row)`)
  if (seam.contrast !== undefined && seam.contrast < 4.5) problems.push(`${name}: a gradient stop is only ${seam.contrast.toFixed(2)}:1 on the paper it is carried on`)
  return [...problems, ...auditMotion(name, report, 'marked text')]
}

export function auditPreview(name, report) {
  const problems = []
  if (!report.selected) problems.push(`${name}: no text was selected, so nothing was compared`)
  if (report.contrast !== undefined && report.contrast < 20) problems.push(`${name}: the selection hides the marked colour (marked and unmarked text differ by ${report.contrast.toFixed(1)})`)
  return [...problems, ...auditMarkCommon(name, report)]
}

export function auditMark(name, report, expectedRows) {  const problems = []
  if (report.count <= 1) problems.push(`${name}: the marked range produced ${report.count} chip(s)`)
  if (expectedRows !== undefined && Math.abs(report.count - expectedRows) > 1) problems.push(`${name}: ${report.count} chips for a range the pane wraps over ${expectedRows.toFixed(0)} rows`)
  if (report.gaps.some(gap => Math.abs(gap) > 1)) problems.push(`${name}: the chips are not on consecutive lines (largest gap ${Math.max(...report.gaps.map(Math.abs)).toFixed(2)}px)`)
  const short = report.heights.find(height => Math.abs(height - report.row) > 1)
  if (short !== undefined) problems.push(`${name}: a chip is ${short.toFixed(1)}px tall instead of one line (${report.row}px)`)
  if (report.minLeft < -1 || report.maxRight > report.contentWidth + 1) problems.push(`${name}: a chip leaves the pane's content box (${report.minLeft.toFixed(1)} to ${report.maxRight.toFixed(1)} of ${report.contentWidth.toFixed(1)}px)`)
  // The mirror is the pane's own text, three ways: the copy is the whole value, the middle node is
  // exactly the range, and every marked line sits where the pane's own text sits.
  if (!report.split.whole) problems.push(`${name}: the mirror does not render the pane's whole text`)
  if (!report.split.slice) problems.push(`${name}: the mirror's marked node is not exactly the marked range`)
  if (report.align > 1) problems.push(`${name}: the mirror's marked lines sit ${report.align.toFixed(1)}px away from the pane's own text`)
  if (report.mirror.height > 2) problems.push(`${name}: the mirror is ${report.mirror.height.toFixed(1)}px taller or shorter than the pane's content`)
  if (!report.mirror.hidden) problems.push(`${name}: the mirror is not hidden from assistive technology`)
  if (report.mirror.events !== 'none') problems.push(`${name}: the mirror takes pointer events (${report.mirror.events})`)
  // The pane's glyphs step aside only while a mirror is up, and the caret keeps its own colour.
  if (report.markedLook.colour !== 'rgba(0, 0, 0, 0)') problems.push(`${name}: the pane's text does not step aside while the mirror is up (${report.markedLook.colour})`)
  if (report.markedLook.caret === 'rgba(0, 0, 0, 0)') problems.push(`${name}: the caret would be invisible while the mirror is up`)
  if (report.plainLook.colour === 'rgba(0, 0, 0, 0)') problems.push(`${name}: the pane's text stays transparent with no mark to show`)
  // The composition retreat: the mirror steps aside and the pane's own glyphs come back, because the
  // composition preview is painted in the pane's text colour.
  if (!report.composing.attribute) problems.push(`${name}: a composition does not put the pane into its composing state`)
  if (report.composing.mirror !== 'hidden') problems.push(`${name}: the mirror does not step aside during a composition`)
  if (report.composing.colour === 'rgba(0, 0, 0, 0)') problems.push(`${name}: the characters being spelled would be invisible`)
  // The painted gradient is the token's, not a second copy of it.
  if (!report.image || report.image !== report.tokenImage) problems.push(`${name}: the painted gradient is not the token's (${report.image} vs ${report.tokenImage})`)
  // The flow states: generating flows, ready and a plain selection hold still.
  if (!report.flow.includes('sf-range-flow')) problems.push(`${name}: the mark is not flowing while the candidate is generating (${report.flow})`)
  if (report.settled !== 'none') problems.push(`${name}: the mark keeps flowing after the candidate is ready (${report.settled})`)
  if (report.held !== 'none') problems.push(`${name}: a plain selection flows instead of holding still (${report.held})`)
  // If the platform selection colour covered the mark, the marked row would read as one flat colour
  // instead of a sweep of hues.
  if (report.selected !== undefined && report.selected < 60) problems.push(`${name}: the selection flattens the mark (spread ${report.selected.toFixed(0)} across the marked row)`)
  if (!report.inView) problems.push(`${name}: the unmarked row used as the colour reference is outside the pane (probe ${report.view.probe.toFixed(1)} vs pane ${report.view.top.toFixed(1)}–${report.view.bottom.toFixed(1)}, last chip ${report.view.last.toFixed(1)})`)
  if (report.live && report.live.during < 2) problems.push(`${name}: the range cannot be read while the pointer is still down (${report.live.during} updates during the drag)`)
  if (report.live && report.live.grown <= report.live.during) problems.push(`${name}: the live range stopped keeping up with the drag`)
  return [...problems, ...auditMarkCommon(name, { ...report, gradient: true })]
}

/** A capture that renders nothing is the failure this check exists for. */
export function audit(results) {
  const problems = []
  for (const shot of results) {
    if (shot.width < 300 || shot.height < 300) problems.push(`${shot.name}: collapsed to ${shot.width}x${shot.height}`)
    else if (shot.dominant > 0.95) problems.push(`${shot.name}: renders as a single colour (${(shot.dominant * 100).toFixed(1)}% of its pixels)`)
  }
  return problems
}

/**
 * AT-86 in a real browser page. The pane's own wrapping module is applied here rather than a copy of
 * it, and the line-number column is then measured against the pane: a column that drifted from the
 * wrapping would still screenshot fine, so these numbers are what the check is for.
 */
async function checkDraftWrap(page, selector) {
  return page.evaluate(({ selector, longLine }) => {
    const root = document.querySelector(selector)
    const area = root.querySelector('textarea.sf-source-input')
    const gutter = root.querySelector('#sf-wrap-gutter')
    window.ScholarFlowGutter.applyGutterRows(gutter, area, area.value)
    const style = getComputedStyle(area), row = parseFloat(style.lineHeight)
    const boxes = [...gutter.children].map(cell => cell.getBoundingClientRect())
    const heights = boxes.map(box => box.height)
    return { row, overflow: area.scrollWidth - area.clientWidth, heights,
      gaps: boxes.slice(1).map((box, index) => Math.abs(box.top - boxes[index].bottom)),
      gutterTotal: heights.reduce((sum, height) => sum + height, 0),
      content: area.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      longRows: heights[longLine] / row }
  }, { selector, longLine: DRAFT_LONG_LINE })
}

export function auditWrap(name, report) {
  const problems = []
  if (report.overflow > 1) problems.push(`${name}: the pane still overflows horizontally by ${report.overflow}px`)
  if (report.longRows < 1.5) problems.push(`${name}: the long paragraph did not wrap (${report.longRows.toFixed(2)} rows)`)
  report.heights.forEach((height, index) => {
    const rows = height / report.row
    if (Math.abs(height - Math.round(rows) * report.row) > 1) problems.push(`${name}: line ${index + 1} is ${rows.toFixed(2)} rows tall, not a whole number`)
  })
  const gap = report.gaps.length ? Math.max(...report.gaps) : 0
  if (gap > 1) problems.push(`${name}: line numbers are not contiguous (largest gap ${gap.toFixed(2)}px)`)
  if (Math.abs(report.gutterTotal - report.content) > 1.5) problems.push(`${name}: the column is ${report.gutterTotal.toFixed(1)}px tall but the pane's content is ${report.content.toFixed(1)}px`)
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir, results, wrap, mark, preview, problems } = await renderSurfaces()
  for (const shot of results) {
    console.log(`${shot.name.padEnd(30)} ${String(shot.width).padStart(4)}x${String(shot.height).padStart(4)}  主色占比 ${(shot.dominant * 100).toFixed(2)}%`)
  }
  // The measured numbers are printed, not just asserted: a wrapping check that reports "the long
  // paragraph occupies one row" is the difference between a real gate and a vacuous one, and the
  // mark count has to match the rows the same range actually wraps over.
  for (const row of wrap) console.log(`${row.name}: 横向溢出 ${row.report.overflow}px · 长段落 ${row.report.longRows.toFixed(1)} 行 · 行号列 ${row.report.gutterTotal.toFixed(0)}px / 编辑区内容 ${row.report.content.toFixed(0)}px`)
  for (const row of mark) console.log(`${row.name}: 标注 ${row.report.count} 条 · 内容宽 ${row.report.contentWidth}px · 镜像对齐 ${row.report.align}px · 内容高差 ${row.report.mirror?.height ?? 0}px · 行内色散 ${(row.report.seam?.spread ?? 0).toFixed(0)} · 字形对比 ${(row.report.seam?.contrast ?? 0).toFixed(2)}:1 · 接缝色差 ${(row.report.seam?.seamDelta ?? 0).toFixed(1)} · 拖选中可读 ${row.report.live?.during ?? 0}→${row.report.live?.grown ?? 0} 次 · 流动像素 ${((row.report.motion?.moving ?? 0) * 100).toFixed(2)}%（关 ${((row.report.motion?.still ?? 0) * 100).toFixed(2)}%／减动效 ${((row.report.motion?.reduced ?? 0) * 100).toFixed(2)}%）`)
  for (const row of preview) console.log(`${row.name}: 选中 ${row.report.selected} 字 · 渐变 ${row.report.gradient ? '在' : '丢失'} · 选中时被标注与未标注文字色差 ${(row.report.contrast ?? 0).toFixed(1)} · 折行 ${row.report.fragments ?? 0} 段接缝色差 ${(row.report.seam?.seamDelta ?? 0).toFixed(1)} · 行内色散 ${(row.report.seam?.spread ?? 0).toFixed(0)} · 字形对比 ${(row.report.seam?.contrast ?? 0).toFixed(2)}:1 · 流动像素 ${((row.report.motion?.moving ?? 0) * 100).toFixed(2)}%（关 ${((row.report.motion?.still ?? 0) * 100).toFixed(2)}%／减动效 ${((row.report.motion?.reduced ?? 0) * 100).toFixed(2)}%）`)
  if (problems.length) {
    console.error(`\n${problems.length} check(s) failed:`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  console.log(`\n${results.length} 张截图写入 ${outDir}（同实现的 CSS 与结构，未接宿主）`)
  console.log('行为验收由 pnpm acceptance:ui 驱动真实客户端完成；这里只覆盖渲染本身与源码区换行的量化断言。')
}
