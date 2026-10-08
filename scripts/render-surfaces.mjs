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

const row = (index, title, purpose, length, mode) => `<div class="sf-structure-section"><span class="sf-section-index">${index}</span>
  <div class="sf-section-text"><input class="sf-section-title" value="${title}" readonly /><input class="sf-section-purpose" value="${purpose}" readonly /></div>
  <div class="sf-section-length"><input value="${length}" readonly /><span>字 · ${mode}</span></div>
  <div class="sf-section-actions"><button>↑</button><button>↓</button><button>×</button></div></div>`

const sourceRow = (badge, kind, name, dir, actions) => `<li class="sf-source-row"><span class="sf-source-badge"${kind ? ` data-kind="${kind}"` : ''}>${badge}</span>
  <span class="sf-source-name">${name}<small>${dir}</small></span>${actions}</li>`

const material = (checked, name, note, disabled) => `<label${disabled ? ' class="sf-material-disabled"' : ''}><input type="checkbox"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} />
  <span>${name}</span><small>${note}</small></label>`

const head = (step) => `<header><span class="sf-wizard-eyebrow">科技论文写作</span><h2>开始一篇论文</h2><p>确定要求与资料，我们一起完成初稿。</p>${step === 0 ? '<button class="sf-wizard-clear">清除草稿</button>' : ''}</header>
<nav class="sf-wizard-steps">${['写作要求', '资料范围', '行文结构'].map((title, index) => `<button${index === step ? ' aria-current="step"' : ''}${index > step ? ' disabled' : ''}><span>${index + 1}</span>${title}</button>`).join('')}</nav>
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

const step3 = `<section class="sf-wizard">${head(2)}
<div class="sf-wizard-page">
<div class="sf-structure-caption"><label>目标篇幅<span class="sf-length-input"><input value="4000" readonly /><span>汉字</span></span></label>
<label class="sf-online-choice"><input type="checkbox" /><span><strong>摘要计入</strong><small>默认不计入正文目标</small></span></label>
<div class="sf-structure-actions"><button>更换预设</button><button>重新分配</button><button>AI 完善结构</button></div></div>
<p class="sf-field-hint">当前预设：论述/分析型（内置 · 已修改），计划合计 4000 / 4000。手工章节保持原值，其余按建议比例分配；比例只是起点，任何一项都可以改。</p>
<div class="sf-structure-list">
${row(1, '引言', '交代议题背景，给出可被辩护的中心观点', 480, '自动')}
${row(2, '主题论证', '按分论点组织段落，每段先给主题句再给证据', 2600, '手工')}
${row(3, '反方观点与回应', '选择有代表性的反对意见，公平陈述后回应', 520, '自动')}
${row(4, '结论', '回到最初的问题，说明证据支持到什么程度', 400, '自动')}
</div>
<div class="sf-structure-actions" style="margin-top:14px"><button>+ 添加章节</button><button>撤销结构编辑</button><button>保存为我的预设</button></div>
<section class="sf-confirm"><h4>创建前确认</h4><dl>
<div><dt>论文与结构</dt><dd>科技论文大作业 · 课程论文 · 中文 · 4000 汉字（正文不含摘要） · 4 章 · 计划合计 4000 · 预设 论述/分析型（已修改）</dd></div>
<div><dt>资料</dt><dd>要求来源 3 · 参考材料 3</dd></div>
<div><dt>输出</dt><dd>将新增 manuscript/ 与 .scholarflow/；已有同名文件时会在提交前提示，不会覆盖。</dd></div>
<div><dt>外部处理</dt><dd>模型：当前会话在输入框中选择的模型 · 联网：关闭。本地保存不等于本地模型。</dd></div>
<div><dt>预算</dt><dd>模型调用上限 40（来自插件设置）</dd></div>
<div><dt>能力缺口</dt><dd>引用样式只支持顺序编号，作者—年份尚未实现；排版要求暂未支持。这些会作为要求保留，不会被当作已满足。</dd></div>
</dl></section></div>
<footer class="sf-wizard-footer"><button>← 上一步</button><span></span><button class="sf-primary">创建论文并开始撰写</button></footer></section>`

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

/** The same pane with the marking layer the component renders, so the bands can be measured. */
const draftMarkBody = () => `<div class="sf-app sf-paper-project" style="height:420px;display:flex;flex-direction:column">
<div class="sf-editor-grid" data-view="split">
<div class="sf-source-pane" style="--sf-editor-font:13px;--sf-editor-line:24px">
${draftSource('sf-mark-gutter', '<div class="sf-source-marks" aria-hidden="true"><div id="sf-mark-bands"></div></div>')}
</div></div></div></div>`

/** The preview's half of the mark: the range is coloured on the glyphs themselves. */
const draftPreviewBody = () => `<div class="sf-app sf-paper-project" style="height:340px;display:flex;flex-direction:column">
<div class="sf-preview-pane" style="display:flex;flex-direction:column;min-height:0;flex:1">
<div class="sf-paper-scroll" style="flex:1;min-height:0;overflow:auto"><div class="sf-paper-page">
<p data-sf-block="p_TEST_ONLY" style="white-space:pre-wrap"><span data-sf-leaf="leaf_TEST_ONLY_plain">同样长度的未标注文字</span><span class="sf-mark-inline" data-sf-marked="true" data-flow="off">同样长度的被标注文字</span></p>
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
  draftMark: { title: '正文源码区 · 改写范围标注', body: draftMarkBody(), width: '100%' },
  draftPreview: { title: '正文预览 · 改写范围标注', body: draftPreviewBody(), width: '520px' }
}

export function pageHtml(theme, wizard, picker, paper) {
  const stages = Object.entries(surfaces)
    .map(([id, surface], index) => stage(`s${index + 1}`, surface.title, surface.body, surface.width))
    .join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ScholarFlow 界面静态渲染</title><style>
${theme}
:root{--dsw-alias-bg-layer-1:#fafbfc;--dsw-alias-bg-base:#fff;--dsw-alias-label-secondary:#727780;--dsw-alias-interactive-bg-hover:#f0f1f3}
body{margin:0;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1f2329;background:#e9ecef}
.stage{padding:18px 20px 28px}
.stage>h1{font-size:13px;font-weight:600;margin:0 0 10px;color:#4b5157}
.frame{margin:0 auto}
@media(max-width:900px){.frame{width:auto!important}}
${wizard}
${picker}
${paper}
/* Same specificity as the plugin rule, so this must come after it. The real dialog is a fixed
   overlay, which would sit out of flow and collapse its stage in a static page. */
.sf-preset-backdrop{position:static;padding:0;background:transparent}
</style></head><body>
${stages}
</body></html>`
}

/** Wide captures both columns; narrow captures the single column the component switches to. */
const passes = [
  { viewport: { width: 1100, height: 900 }, suffix: '', ids: ['step1', 'step2', 'step3', 'preset', 'draftWrap', 'draftMark', 'draftPreview'] },
  { viewport: { width: 420, height: 900 }, suffix: '-narrow', ids: ['step1', 'step2', 'step3', 'presetDetail', 'draftWrap', 'draftMark', 'draftPreview'] }
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
    let ink = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 < 235) ink++
    }
    return { width: image.width, height: image.height, ink: ink / (canvas.width * canvas.height) }
  }, base64)
}

export async function renderSurfaces(outDir = join(root, '.dsh-tmp/ui-review')) {
  const theme = extractCss('src/client/theme/tokens.ts', 'THEME_CSS')
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
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'wizard.html'), pageHtml(theme, wizard, picker, paper + marks))

  const browser = await chromium.launch({ executablePath: chromePath(), headless: true })
  const results = [], wrap = [], mark = [], preview = []
  try {
    for (const pass of passes) {
      const page = await (await browser.newContext({ viewport: pass.viewport })).newPage()
      await page.goto(pathToFileURL(join(outDir, 'wizard.html')).href)
      await page.addScriptTag({ content: gutterModule.outputFiles[0].text })
      await page.addScriptTag({ content: measureModule.outputFiles[0].text })
      await page.addScriptTag({ content: rangeModule.outputFiles[0].text })
      await page.waitForTimeout(500)
      for (const id of pass.ids) {
        const name = `surface-${id}${pass.suffix}.png`
        const file = join(outDir, name)
        // The wrap and mark surfaces are measured before they are captured, so the capture shows the
        // state the check just accepted instead of an unmeasured column or an unpainted pane.
        if (id === 'draftWrap') { const report = await checkDraftWrap(page, `#s${indexPath(id)}>.frame`); wrap.push({ name, report, problems: auditWrap(name, report) }) }
        const markReport = id === 'draftMark' ? await checkDraftMark(page, `#s${indexPath(id)}>.frame`) : undefined
        const previewReport = id === 'draftPreview' ? await checkDraftPreview(page, `#s${indexPath(id)}>.frame`) : undefined
        const shot = await page.locator(`#s${indexPath(id)}>.frame`).screenshot()
        writeFileSync(file, shot)
        results.push({ name, ...(await measure(page, shot.toString('base64'))) })
        if (markReport) {
          // Read the two sampled strips back out of the capture: this is what decides whether the
          // platform selection colour is hiding the mark.
          const samples = await sampleColors(page, shot.toString('base64'), markReport.sample)
          const probes = samples.slice(0, -1), plain = samples.at(-1)
          const band = probes.reduce((sum, row) => ({ r: sum.r + row.r / probes.length, g: sum.g + row.g / probes.length, b: sum.b + row.b / probes.length }), { r: 0, g: 0, b: 0 })
          // The band sits behind the text, so its own lightness decides whether the text is readable;
          // the lightest point of the spectrum is the one that matters.
          const text = { r: markReport.colour[0], g: markReport.colour[1], b: markReport.colour[2] }
          markReport.band = band
          markReport.textContrast = Math.min(...probes.map(row => contrastRatio(row, text)))
          markReport.spread = Math.max(...probes.flatMap((one, index) => probes.slice(index + 1)
            .map(other => Math.hypot(one.r - other.r, one.g - other.g, one.b - other.b))), 0)
          markReport.contrast = Math.hypot(band.r - plain.r, band.g - plain.g, band.b - plain.b)
          // After the capture, so the drag cannot disturb what was measured above.
          markReport.live = await dragRangeProbe(page, `#s${indexPath(id)}>.frame`)
          mark.push({ name, report: markReport, problems: auditMark(name, markReport, wrap.at(-1)?.report.longRows) })
        }
        if (previewReport) {
          const [marked, plain] = await sampleColors(page, shot.toString('base64'), previewReport.sample)
          previewReport.contrast = Math.hypot(marked.r - plain.r, marked.g - plain.g, marked.b - plain.b)
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
 * AT-87 (1) in a real browser page: the shipped range measurement is applied to a marked range and
 * the bands are painted the way the component paints them, then measured. A mark that silently
 * collapsed to one band would still screenshot fine, so these numbers are the point.
 */
async function checkDraftMark(page, selector) {
  return page.evaluate(({ selector, start, end, markEnd, selectionEnd }) => {
    const root = document.querySelector(selector)
    const area = root.querySelector('textarea.sf-source-input')
    const layer = root.querySelector('.sf-source-marks'), bands = root.querySelector('#sf-mark-bands')
    const style = getComputedStyle(area), row = parseFloat(style.lineHeight)
    const box = area.getBoundingClientRect(), layerBox = layer.getBoundingClientRect()
    const contentWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const paint = (from, to) => {
      const rects = window.ScholarFlowMeasure.lineBoxes(window.ScholarFlowMeasure.sourceRangeRects(area, from, to), row)
      bands.replaceChildren()
      for (const rect of rects) {
        const band = document.createElement('div')
        band.className = 'sf-range-band'
        Object.assign(band.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
        bands.append(band)
      }
      bands.style.transform = `translate(${box.left - layerBox.left}px, ${box.top - layerBox.top - area.scrollTop}px)`
      // The component marks the pane while bands are up, which is what switches the selection to a
      // tint. Reproducing the defect means reproducing that too.
      const pane = area.closest('.sf-source-editor')
      if (pane) pane.dataset.marked = ''
      return rects
    }
    bands.dataset.state = 'generating'
    const whole = paint(start, end)
    const painted = [...bands.children].map(band => band.getBoundingClientRect())
    // The same band with the candidate ready must stop, and a plain selection must never flow: the
    // settled states are part of the contract, not a side effect.
    const flow = getComputedStyle(bands.children[0]).animationName
    bands.dataset.state = 'ready'
    const settled = getComputedStyle(bands.children[0]).animationName
    bands.dataset.state = 'selected'
    const held = getComputedStyle(bands.children[0]).animationName
    // Now reproduce the defect: select the text for real. The selection runs past the marked range,
    // so the last rows it covers carry a band and a row further down carries only the selection.
    const marked = paint(start, markEnd)
    area.focus(); area.setSelectionRange(start, selectionEnd); area.scrollTop = 0
    bands.style.transform = `translate(${box.left - layerBox.left}px, ${box.top - layerBox.top}px)`
    const first = bands.children[0].getBoundingClientRect()
    // The reference row is two rows below the last band, in the pane's content coordinates: it is
    // inside the selection but carries no band, and measuring from the bands keeps it in view at any
    // column width instead of relying on a character offset that only fits one of them.
    const last = marked[marked.length - 1]
    const plainTop = box.top + last.top + row * 2, frame = root.getBoundingClientRect()
    const strip = (left, top, width) => ({ x: left - frame.left + 2, y: top - frame.top + 1, width: Math.max(4, width - 4), height: 5 })
    // Sampled across one band, because "is it a rainbow" is a question about the spread of colours
    // within a row, not about its average: the average of any spectrum is a muted mid-tone.
    const probeWidth = Math.max(6, first.width / 10)
    const across = [0.04, 0.28, 0.5, 0.72, 0.96].map(share => strip(first.left + first.width * share - probeWidth / 2, first.top, probeWidth))
    const lefts = painted.map(rect => rect.left - (box.left + parseFloat(style.paddingLeft)))
    const colour = style.color.match(/[\d.]+/g).slice(0, 3).map(Number)
    return { row, count: whole.length, marked: marked.length, contentWidth, heights: painted.map(rect => rect.height), colour,
      minLeft: Math.min(...lefts), maxRight: Math.max(...painted.map((rect, index) => lefts[index] + rect.width)),
      gaps: painted.slice(1).map((rect, index) => rect.top - painted[index].bottom), flow, settled, held,
      inView: box.top <= plainTop && plainTop + row <= box.bottom, view: { probe: plainTop, top: box.top, bottom: box.bottom, last: last.top },
      sample: [...across, strip(box.left + parseFloat(style.paddingLeft), plainTop, contentWidth)] }
  }, { selector, start: MARK_START, end: FULL_END, markEnd: MARK_END, selectionEnd: SELECT_END })
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
      colour: style.color, sample: [strip(marked), strip(plain)] }
  }, selector)
}

export function auditPreview(name, report) {
  const problems = []
  if (!report.selected) problems.push(`${name}: no text was selected, so nothing was compared`)
  if (!report.gradient) problems.push(`${name}: the marked text lost its gradient`)
  if (report.contrast !== undefined && report.contrast < 20) problems.push(`${name}: the selection hides the marked colour (marked and unmarked text differ by ${report.contrast.toFixed(1)})`)
  return problems
}

export function auditMark(name, report, expectedRows) {  const problems = []
  if (report.count <= 1) problems.push(`${name}: the marked range produced ${report.count} band(s)`)
  if (expectedRows !== undefined && Math.abs(report.count - expectedRows) > 1) problems.push(`${name}: ${report.count} bands for a range the pane wraps over ${expectedRows.toFixed(0)} rows`)
  if (report.gaps.some(gap => Math.abs(gap) > 1)) problems.push(`${name}: the bands are not on consecutive lines (largest gap ${Math.max(...report.gaps.map(Math.abs)).toFixed(2)}px)`)
  const short = report.heights.find(height => Math.abs(height - report.row) > 1)
  if (short !== undefined) problems.push(`${name}: a band is ${short.toFixed(1)}px tall instead of one line (${report.row}px)`)
  if (report.minLeft < -1 || report.maxRight > report.contentWidth + 1) problems.push(`${name}: a band leaves the pane's content box (${report.minLeft.toFixed(1)} to ${report.maxRight.toFixed(1)} of ${report.contentWidth.toFixed(1)}px)`)
  if (!report.flow.includes('sf-range-flow')) problems.push(`${name}: the band is not flowing while the candidate is generating (${report.flow})`)
  if (report.settled !== 'none') problems.push(`${name}: the band keeps flowing after the candidate is ready (${report.settled})`)
  if (report.spread !== undefined && report.spread < 140) problems.push(`${name}: the band reads as one colour rather than a rainbow (spread ${report.spread.toFixed(0)} across the row)`)
  if (report.textContrast !== undefined && report.textContrast < 4.5) problems.push(`${name}: the text on the band is only ${report.textContrast.toFixed(1)}:1 (rgb(${report.band.r.toFixed(0)},${report.band.g.toFixed(0)},${report.band.b.toFixed(0)}))`)
  if (report.held !== 'none') problems.push(`${name}: a plain selection flows instead of holding still (${report.held})`)
  if (!report.inView) problems.push(`${name}: the unmarked row used as the colour reference is outside the pane (probe ${report.view.probe.toFixed(1)} vs pane ${report.view.top.toFixed(1)}–${report.view.bottom.toFixed(1)}, last band ${report.view.last.toFixed(1)})`)
  if (report.live && report.live.during < 2) problems.push(`${name}: the range cannot be read while the pointer is still down (${report.live.during} updates during the drag)`)
  if (report.live && report.live.grown <= report.live.during) problems.push(`${name}: the live range stopped keeping up with the drag`)
  // If the platform selection colour covered the mark, a selected row with a band and a selected row
  // without one would look the same.
  if (report.contrast !== undefined && report.contrast < 20) problems.push(`${name}: the selection hides the mark (marked and unmarked selected rows differ by ${report.contrast.toFixed(1)})`)
  return problems
}

/** A capture that renders nothing is the failure this check exists for. */
export function audit(results) {
  const problems = []
  for (const shot of results) {
    if (shot.width < 300 || shot.height < 300) problems.push(`${shot.name}: collapsed to ${shot.width}x${shot.height}`)
    else if (shot.ink < 0.01) problems.push(`${shot.name}: blank (${(shot.ink * 100).toFixed(2)}% ink)`)
    else if (shot.ink > 0.95) problems.push(`${shot.name}: single-colour (${(shot.ink * 100).toFixed(2)}% ink)`)
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
    console.log(`${shot.name.padEnd(30)} ${String(shot.width).padStart(4)}x${String(shot.height).padStart(4)}  ink ${(shot.ink * 100).toFixed(2)}%`)
  }
  // The measured numbers are printed, not just asserted: a wrapping check that reports "the long
  // paragraph occupies one row" is the difference between a real gate and a vacuous one, and the
  // mark count has to match the rows the same range actually wraps over.
  for (const row of wrap) console.log(`${row.name}: 横向溢出 ${row.report.overflow}px · 长段落 ${row.report.longRows.toFixed(1)} 行 · 行号列 ${row.report.gutterTotal.toFixed(0)}px / 编辑区内容 ${row.report.content.toFixed(0)}px`)
  for (const row of mark) console.log(`${row.name}: 标注 ${row.report.count} 条 · 行内色散 ${(row.report.spread ?? 0).toFixed(0)} · 文字对比度 ${(row.report.textContrast ?? 0).toFixed(1)}:1 · 与未标注行色差 ${(row.report.contrast ?? 0).toFixed(1)} · 拖选中可读 ${row.report.live?.during ?? 0}→${row.report.live?.grown ?? 0} 次`)
  for (const row of preview) console.log(`${row.name}: 选中 ${row.report.selected} 字 · 渐变 ${row.report.gradient ? '在' : '丢失'} · 选中时被标注与未标注文字色差 ${(row.report.contrast ?? 0).toFixed(1)}`)
  if (problems.length) {
    console.error(`\n${problems.length} check(s) failed:`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  console.log(`\n${results.length} 张截图写入 ${outDir}（同实现的 CSS 与结构，未接宿主）`)
  console.log('行为验收由 pnpm acceptance:ui 驱动真实客户端完成；这里只覆盖渲染本身与源码区换行的量化断言。')
}
