// W3: the real installed host, end to end. Creates an isolated profile that links this working
// copy, creates a project, registers two sources, writes a manuscript that exercises every
// layout decision, exports the Word delivery and reads the produced OOXML back to check it.
//
// Usage: node tests/e2e/course-paper-export.mjs <runDir> <workspaceDir> <homeDir>
//
// No model call is made and nothing is published. What this proves that a unit test cannot:
// the plugin's own delivery path, in the host it ships in, produces the bytes.
//
// Run 2026-10-09: 16/16 layout checks passed against the installed DeepSeek Harness. Page
// counting needs LibreOffice, which was not installed; that step is recorded, not claimed.

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'

const [runDirArg, workspaceArg, homeArg] = process.argv.slice(2)
const outDir = resolve(runDirArg), workspaceRoot = resolve(workspaceArg), dshHome = resolve(homeArg)
const install = join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness')
const repo = resolve('.')
const port = 19700 + (Number(String(Date.now()).slice(-3)) % 200)
const stamp = String(Date.now())
const journal = []
const say = line => { journal.push({ at: new Date().toISOString(), ...(typeof line === 'string' ? { note: line } : line) })
  process.stdout.write((typeof line === 'string' ? line : JSON.stringify(line)) + String.fromCharCode(10)) }
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')
class Stop extends Error {}
let child, browser
const finish = async code => {
  await writeFile(join(outDir, 'w3-journal.json'), JSON.stringify(journal, null, 2))
  child?.kill()
  try { await browser?.close() } catch { /* closed */ }
  process.exitCode = code
  throw new Stop()
}

// An isolated profile that links this working copy, so the run exercises the code under test
// rather than whatever the installed copy happens to be.
const profile = join(dshHome, 'profiles', 'w3-test')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspaceRoot, { recursive: true })
await mkdir(outDir, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${repo.replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(repo, join(profile, 'node_modules/dsh-scholarflow'), 'junction')
say({ phase: 'profile', profile, workspace: workspaceRoot })

child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'w3-test', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: dshHome, DSH_PERMISSION_MODE: 'workspace-write', ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let hostLog = ''
child.stdout.on('data', chunk => { hostLog += chunk.toString() })
child.stderr.on('data', chunk => { hostLog += chunk.toString() })
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Host boot timed out')), 60000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timer); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  const page = await (await browser.newContext()).newPage()
  page.setDefaultTimeout(30000)
  await page.goto(url)
  await page.waitForTimeout(1500)
  const rpc = (method, args) => page.evaluate(async ({ method, args }) => {
    const response = await fetch('api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const result = (await response.json()).result
    if (!result.ok || result.value?.ok === false) throw new Error(JSON.stringify(result.error ?? result.value.error))
    return result.value?.data ?? result.value
  }, { method, args })
  const must = async (method, args, label) => {
    try { return await rpc(method, args) } catch (error) { say({ blocked: label, error: String(error?.message ?? error).slice(0, 400) }); await finish(1) }
  }

  const workspaceId = (await must('workspace/create', { request: { path: workspaceRoot } }, 'workspace')).workspace.workspaceId
  const sessionId = (await must('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } }, 'session')).sessionId
  say({ phase: 'session', workspaceId, sessionId })
  const base = { requestId: `req_${stamp}`, workspaceId, sessionId }

  // 1. A course-paper project.
  const plan = await must('scholarflow.v1/project.prepareInit', { request: { context: base, input: { title: 'TEST_ONLY 课程论文', type: 'course-paper' } } }, 'prepareInit')
  const created = await must('scholarflow.v1/project.initialize', { request: { context: base, planId: plan.planId, planHash: plan.planHash } }, 'initialize')
  const project = await must('scholarflow.v1/project.inspect', { request: { context: base } }, 'inspect')
  const projectId = project.binding.projectId
  say({ phase: 'project', projectId, revision: project.ledger.revision })

  // 2. Two sources, cited in the reverse of their registration order.
  const register = async (source, label) => {
    const context = { ...base, projectId, expectedLedgerRevision: (await rpc('scholarflow.v1/project.inspect', { request: { context: base } })).ledger.revision }
    const preview = await must('scholarflow.v1/sources.prepareRegistration', { request: { context, source } }, label)
    return must('scholarflow.v1/sources.confirmRegistration', { request: { context: preview.context ?? context, planId: preview.planId, planHash: preview.planHash, reason: 'TEST_ONLY 手工登记' } }, label)
  }
  const alpha = await register({ title: 'TEST_ONLY 来源甲', authors: [{ literal: 'Doe, Jane' }], year: 2024, venue: '测试学报', kind: 'paper', identifiers: { doi: '10.1000/test' } }, 'source-alpha')
  const beta = await register({ title: 'TEST_ONLY 来源乙', authors: [{ literal: '王五' }], year: 2021, venue: '另一种学报', kind: 'paper', identifiers: {} }, 'source-beta')
  say({ phase: 'sources', alpha: alpha.source?.citeKey ?? '?', beta: beta.source?.citeKey ?? '?' })
  const keyBeta = beta.source?.citeKey, keyAlpha = alpha.source?.citeKey

  // 3. A manuscript that exercises every decision: front matter, a subsection, a captioned
  //    three-line table, a block formula, citations and back matter.
  const manuscript = [
    '# TEST_ONLY 课程论文', '',
    '## 摘要', '', '本文说明结构预设与学术排版导出的实现范围，给出可复核的结论。', '',
    '## 关键词', '', '课程论文；结构预设；学术排版', '',
    '## 引言', '', `引言先引 [@${keyBeta}]，再引 [@${keyAlpha}]，说明问题与路线。`, '',
    '### 研究背景', '', '背景正文，说明这个问题从何而来。', '',
    '### 研究现状', '', '现状正文，概述已有的几种做法。', '',
    '## 材料与方法', '', '方法正文。', '',
    '表 2-1 符号说明', '', '| 符号 | 说明 |', '| --- | --- |', '| α | 学习率 |', '| γ | 折扣因子 |', '',
    '$$', 'E = mc^2', '$$', '',
    '## 结论', '', '结论正文，回到最初的问题。', '',
    '## 致谢', '', '谢谢。', '',
  ].join('\n')
  const live = await rpc('scholarflow.v1/project.inspect', { request: { context: base } })
  await must('scholarflow.v1/document.saveManual', { request: { context: { ...base, projectId, expectedLedgerRevision: live.ledger.revision },
    text: manuscript, baseHash: live.document.contentHash } }, 'saveManual')
  const saved = await rpc('scholarflow.v1/project.inspect', { request: { context: base } })
  await writeFile(join(outDir, 'manuscript.md'), manuscript)
  say({ phase: 'manuscript', chars: saved.document.statistics?.chineseCharacters, headings: manuscript.split('\n').filter(l => /^#/.test(l)).length })

  // 4. Export and read the delivery back.
  const context = { ...base, projectId, expectedLedgerRevision: saved.ledger.revision }
  const preflight = await must('scholarflow.v1/export.preflight', { request: { context, format: 'docx' } }, 'preflight')
  say({ phase: 'preflight', plan: preflight.planId, reviewState: preflight.reviewState, notes: preflight.formatNotes })
  const delivery = await must('scholarflow.v1/export.create', { request: { context, planId: preflight.planId, planHash: preflight.planHash, deliveryType: 'working-draft' } }, 'create')
  const exported = await must('scholarflow.v1/export.read', { request: { context: { ...base, projectId }, deliveryId: delivery.manifest.id } }, 'read')
  const docx = exported.files.find(file => file.relativePath === 'paper.docx')
  if (!docx?.base64) { say({ blocked: 'no paper.docx', files: exported.files.map(f => f.relativePath) }); await finish(1) }
  const bytes = Buffer.from(docx.base64, 'base64')
  const docxPath = join(outDir, 'paper.docx')
  await writeFile(docxPath, bytes)
  say({ phase: 'docx', bytes: bytes.length, sha256: await hashFile(docxPath) })

  // 5. Read the OOXML back.
  const zip = await JSZip.loadAsync(bytes)
  const part = async name => (await zip.file(name)?.async('string')) ?? ''
  const xml = await part('word/document.xml'), numbering = await part('word/numbering.xml'), settings = await part('word/settings.xml')
  const footerNames = Object.keys(zip.files).filter(name => /^word\/footer/.test(name)).sort()
  const footerText = (await Promise.all(footerNames.map(part))).join('')
  const checks = {
    decimalNumbering: /w:numFmt w:val="decimal"/.test(numbering),
    threeLevelPatterns: ['%1', '%1.%2', '%1.%2.%3'].every(p => numbering.includes(`w:lvlText w:val="${p}"`)),
    noChineseNumeralLevel: !/w:numFmt w:val="(?:chineseCounting|legal)"/.test(numbering),
    heiHeadingFont: /w:eastAsia="黑体"/.test(xml),
    headingSizes: ['32', '28', '24'].every(size => xml.includes(`w:sz w:val="${size}"`)),
    firstLineIndent: /<w:ind w:firstLine="480"\/>/.test(xml),
    threeLineRules: /<w:top w:val="single" w:sz="12"\/>/.test(xml) && /<w:bottom w:val="single" w:sz="6"\/>/.test(xml),
    noInsideRules: !/<w:insideV w:val="single"/.test(xml),
    tableCaptionOnce: xml.split('表 2-1 符号说明').length - 1 === 1,
    equationNumbered: /\(1\)/.test(xml) && /\$\$E = mc\^2\$\$/.test(xml),
    footerPageField: footerNames.length > 0 && /PAGE/.test(footerText),
    pageBreakBefore: /<w:pageBreakBefore\/>/.test(xml),
    coverSection: /<w:pgNumType w:start="1"\/>/.test(xml),
    referenceHang: /<w:ind w:left="480" w:hanging="480"\/>/.test(xml),
    gbtEntry: /\[\d+\] .*\[J\]/.test(xml),
    citationOrder: xml.indexOf('来源乙') < xml.indexOf('来源甲'),
  }
  await writeFile(join(outDir, 'layout-checks.json'), JSON.stringify(checks, null, 2))
  say({ phase: 'layout', checks })

  // 6. Page counting needs a renderer; record its absence rather than claim a number.
  try {
    const { execFileSync } = await import('node:child_process')
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docxPath], { stdio: 'ignore' })
    const pdf = await readFile(join(outDir, 'paper.pdf'))
    say({ phase: 'pages', pages: (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length, viewer: 'LibreOffice headless' })
  } catch { say({ phase: 'pages', pages: undefined, reason: 'LibreOffice not available; 实际页数未测量' }) }

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  say({ phase: 'summary', passed: Object.keys(checks).length - failed.length, failed, viewer: 'installed DeepSeek Harness' })
  await finish(failed.length ? 1 : 0)
} catch (error) {
  if (!(error instanceof Stop)) {
    say({ error: String(error?.message ?? error), stack: String(error?.stack ?? '').slice(0, 600) })
    await writeFile(join(outDir, 'w3-host.log'), hostLog)
    try { await finish(1) } catch { /* Stop */ }
  }
}
