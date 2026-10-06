// Render the creation wizard's surfaces to static pages and screenshot them, so the visual
// review in dsh-scholarflow-ai/docs/entry-wizard-presets/05 can be re-run instead of trusted.
//
// The CSS is read out of the client components and the markup mirrors their JSX, so a capture
// shows the implemented look rather than a hand-drawn mockup. No host and no model call is
// involved: this is a rendering check, not a substitute for the interface acceptance items.
//
// Each capture is measured before it is accepted. A collapsed stage, a blank image or a
// single-colour image fails the run, because a screenshot that silently renders nothing is
// exactly the failure this script exists to catch.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

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
  presetDetail: { title: '结构预设弹窗（窄屏详情栏）', body: modal('detail'), width: '100%' }
}

export function pageHtml(wizard, picker) {
  const stages = Object.entries(surfaces)
    .map(([id, surface], index) => stage(`s${index + 1}`, surface.title, surface.body, surface.width))
    .join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ScholarFlow 界面静态渲染</title><style>
:root{--dsw-alias-bg-layer-1:#fafbfc;--dsw-alias-bg-base:#fff;--dsw-alias-label-secondary:#727780;--dsw-alias-interactive-bg-hover:#f0f1f3}
body{margin:0;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1f2329;background:#e9ecef}
.stage{padding:18px 20px 28px}
.stage>h1{font-size:13px;font-weight:600;margin:0 0 10px;color:#4b5157}
.frame{margin:0 auto}
@media(max-width:900px){.frame{width:auto!important}}
${wizard}
${picker}
/* Same specificity as the plugin rule, so this must come after it. The real dialog is a fixed
   overlay, which would sit out of flow and collapse its stage in a static page. */
.sf-preset-backdrop{position:static;padding:0;background:transparent}
</style></head><body>
${stages}
</body></html>`
}

/** Wide captures both columns; narrow captures the single column the component switches to. */
const passes = [
  { viewport: { width: 1100, height: 900 }, suffix: '', ids: ['step1', 'step2', 'step3', 'preset'] },
  { viewport: { width: 420, height: 900 }, suffix: '-narrow', ids: ['step1', 'step2', 'step3', 'presetDetail'] }
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
  const wizard = extractCss('src/client/creation-wizard.tsx', 'WIZARD_CSS')
  const picker = extractCss('src/client/preset-picker.tsx', 'PRESET_CSS')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'wizard.html'), pageHtml(wizard, picker))

  const browser = await chromium.launch({ executablePath: chromePath(), headless: true })
  const results = []
  try {
    for (const pass of passes) {
      const page = await (await browser.newContext({ viewport: pass.viewport })).newPage()
      await page.goto(pathToFileURL(join(outDir, 'wizard.html')).href)
      await page.waitForTimeout(500)
      for (const id of pass.ids) {
        const name = `wizard-${id}${pass.suffix}.png`
        const file = join(outDir, name)
        const shot = await page.locator(`#s${indexPath(id)}>.frame`).screenshot()
        writeFileSync(file, shot)
        results.push({ name, ...(await measure(page, shot.toString('base64'))) })
      }
      await page.close()
    }
  } finally { await browser.close() }
  return { outDir, results }
}

function chromePath() {
  return process.env.SCHOLARFLOW_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir, results } = await renderSurfaces()
  for (const shot of results) {
    console.log(`${shot.name.padEnd(28)} ${String(shot.width).padStart(4)}x${String(shot.height).padStart(4)}  ink ${(shot.ink * 100).toFixed(2)}%`)
  }
  const problems = audit(results)
  if (problems.length) {
    console.error(`\n${problems.length} capture(s) failed the render check:`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  console.log(`\n${results.length} 张截图写入 ${outDir}（同实现的 CSS 与结构，未接宿主）`)
  console.log('行为验收由 pnpm acceptance:ui 驱动真实客户端完成；这里只覆盖渲染本身。')
}
