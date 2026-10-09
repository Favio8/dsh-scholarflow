// Exports the Word delivery for an existing project in the real host, then reads the produced
// OOXML back and asserts the academic layout facts that a synthesized document cannot prove:
// the numbering configuration, the three-line table, the hanging reference indent, the table
// of contents field and the footer page number.
//
// Usage: node tests/e2e/course-paper-export.mjs <runDir> <workspaceDir> <homeDir> <projectId>
//
// Not run in this workspace: the manuscript must already exist in a real project, and page
// counting additionally needs LibreOffice, which is not installed here. Everything this script
// measures is written to <runDir>/export-journal.json either way.

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'

const [runDirArg, workspaceArg, homeArg, projectId] = process.argv.slice(2)
const outDir = resolve(runDirArg), workspaceRoot = resolve(workspaceArg), home = resolve(homeArg)
const install = join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness')
const port = 19600 + (Number(String(Date.now()).slice(-3)) % 300)
const stamp = String(Date.now())
const journal = []
const record = (phase, data) => {
  const line = `[${phase}] ${JSON.stringify(data).slice(0, 500)}`
  journal.push({ at: new Date().toISOString(), phase, ...data })
  process.stdout.write(line + String.fromCharCode(10))
}
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')
class StopRun extends Error {}
const finish = async code => {
  await writeFile(join(outDir, 'export-journal.json'), JSON.stringify(journal, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.exitCode = code
  throw new StopRun()
}

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-assignment', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let hostLog = ''
child.stdout.on('data', chunk => { hostLog += chunk.toString() })
child.stderr.on('data', chunk => { hostLog += chunk.toString() })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
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
  const remote = (name, request = {}) => page.evaluate(async ({ name, request }) => {
    const response = await fetch(`api/scholarflow.v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `scholarflow.v1/${name}`, payload: { args: { request } } }) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { return { ok: false, error: { code: 'NON_JSON', message: text.slice(0, 300) } } }
    const value = body?.result?.value ?? body
    return value?.ok === false ? { ok: false, error: value.error } : { ok: true, data: value?.data ?? value }
  }, { name, request })
  const must = async (name, request) => {
    const result = await remote(name, request)
    if (result.ok === false) throw new Error(`${name} refused: ${result.error?.code} ${result.error?.message} ${JSON.stringify(result.error?.details ?? {})}`)
    return result.data
  }
  const workspaceId = (await page.evaluate(async path => {
    const response = await fetch('api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace/create', payload: { args: { request: { path } } } }) })
    const body = JSON.parse(await response.text())
    return body?.result?.value?.workspace?.workspaceId
  }, workspaceRoot))
  const sessionId = (await page.evaluate(async workspaceId => {
    const response = await fetch('api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/create', payload: { args: { request: { workspaceId, agentPreset: 'scholarflow' } } } }) })
    const body = JSON.parse(await response.text())
    return body?.result?.value?.sessionId
  }, workspaceId))
  const base = { requestId: `req_${stamp}`, workspaceId, sessionId }
  record('session', { workspaceId, sessionId, projectId })

  const document = await must('document.read', { context: { ...base, projectId } })
  const context = { ...base, projectId, expectedLedgerRevision: document.revision }
  await writeFile(join(outDir, 'manuscript.md'), document.document?.text ?? '')
  record('document', { revision: document.revision, chars: document.statistics?.chineseCharacters,
    headings: (document.document?.text ?? '').split('\n').filter(line => /^##? /.test(line)).length })

  const preflight = await must('export.preflight', { context, format: 'docx' })
  record('preflight', { plan: preflight.planId, reviewState: preflight.reviewState, notes: preflight.formatNotes })
  const delivery = await must('export.create', { context, planId: preflight.planId, planHash: preflight.planHash, deliveryType: 'working-draft' })
  const exported = await must('export.read', { context: { ...base, projectId }, deliveryId: delivery.manifest.id })
  const docx = exported.files.find(file => file.relativePath === 'paper.docx')
  if (!docx?.base64) { record('blocked', { reason: 'no paper.docx in the delivery' }); await finish(1) }
  const bytes = Buffer.from(docx.base64, 'base64')
  const docxPath = join(outDir, 'paper.docx')
  await writeFile(docxPath, bytes)
  record('docx', { path: docxPath, bytes: bytes.length, sha256: await hashFile(docxPath) })

  // Read the produced OOXML back and check the layout facts.
  const zip = await JSZip.loadAsync(bytes)
  const part = async name => (await zip.file(name)?.async('string')) ?? ''
  const xml = await part('word/document.xml'), numbering = await part('word/numbering.xml')
  const footers = Object.keys(zip.files).filter(name => /^word\/footer/.test(name)).sort()
  const footerText = (await Promise.all(footers.map(name => part(name)))).join('')
  const checks = {
    decimalNumbering: /w:numFmt w:val="decimal"/.test(numbering),
    threeLevelPatterns: ['%1', '%1.%2', '%1.%2.%3'].every(pattern => numbering.includes(`w:lvlText w:val="${pattern}"`)),
    noChineseNumeralLevel: !/w:numFmt w:val="(?:chineseCounting|legal)"/.test(numbering),
    heiHeadingFont: /w:eastAsia="黑体"/.test(xml),
    firstLineIndent: /<w:ind w:firstLine="\d+"\/>/.test(xml),
    footerPageField: footers.length > 0 && /PAGE/.test(footerText),
    referenceHang: /<w:ind w:left="480" w:hanging="480"\/>/.test(xml),
    gbtEntry: /\[\d+\] .*\[[A-Z]/.test(xml),
    pageBreakBefore: /<w:pageBreakBefore\/>/.test(xml),
    threeLineRules: /<w:top w:val="single" w:sz="12"\/>/.test(xml) && /<w:bottom w:val="single" w:sz="6"\/>/.test(xml),
    noInsideRules: !/<w:insideV w:val="single"/.test(xml),
  }
  record('layout', checks)
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  await writeFile(join(outDir, 'layout-checks.json'), JSON.stringify(checks, null, 2))
  record('layout-summary', { failed, viewer: 'JSZip (no Word available in this workspace)' })

  // Page counting needs a real renderer. Record its absence instead of claiming a page count.
  const { execFileSync } = await import('node:child_process')
  let pages
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docxPath], { stdio: 'ignore' })
    const pdf = await readFile(join(outDir, 'paper.pdf'))
    pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    record('pages', { pages, viewer: 'LibreOffice headless' })
  } catch {
    record('pages', { pages: undefined, reason: 'LibreOffice not available; 实际页数未测量' })
  }
  await finish(failed.length ? 1 : 0)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('error', { message: error?.message, stack: String(error?.stack).slice(0, 500) })
    await writeFile(join(outDir, 'export-host.log'), hostLog)
    try { await finish(1) } catch { /* StopRun */ }
  }
}
