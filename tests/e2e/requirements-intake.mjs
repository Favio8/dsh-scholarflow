// Real React wizard + controlled service responses. No model calls or user workspace access.
// Exercises the source-only error, failed-start cleanup, adoption, cancellation and layouts.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const out = resolve('.dsh-tmp/requirements-intake', String(Date.now()))
await mkdir(out, { recursive: true })
// Include the actual parent fallback styles: a standalone wizard misses their specificity.
const workspaceCss = (await readFile('src/client/plugin.tsx', 'utf8')).match(/const CSS = `([^`]+)`/)[1]
await build({ stdin: { resolveDir: resolve('.'), loader: 'tsx', contents: `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CreationWizard, WIZARD_CSS } from './src/client/creation-wizard.tsx'
import { THEME_CSS } from './src/client/theme/tokens.ts'
import { PAPER_CSS } from './src/client/paper-workspace.tsx'
import { requirementDraftSpec, requirementBrief } from './src/shared/writing-task.ts'
import { adoptBrief, adoptionSummary, ADOPTABLE_PATHS } from './src/core/requirements/candidates.ts'
const files = ['1.jpg', '2.jpg', '3.jpg'].map(name => ({ relativePath: '作业要求/' + name, size: 2048, supported: false }))
const base = { title: '', requirements: '', type: 'course-paper', language: 'zh-CN', format: 'docx',
  materials: [], online: false, targetLength: 4000, sections: [{ id: 'section_1', title: '引言', purpose: '', targetLength: 4000 }], manuscriptDir: 'manuscript' }
const brief = requirementBrief.parse({ schemaVersion: 2, task: { nature: 'TEST_ONLY 阅读报告' },
  coverage: [], length: {}, format: {}, submission: {}, decisions: [], origins: {}, readIds: ['read_TEST_ONLY'] })
window.fixture = { calls: [], mode: 'ready', release: null }
const api = async (name, request) => {
  window.fixture.calls.push({ name, request })
  if (name === 'creation.materials') return { files }
  if (name === 'outline.stop') return { stopped: true }
  if (name === 'presets.list') return { all: [], byType: {} }
  if (request?.spec) requirementDraftSpec.parse(request.spec)
  if (name === 'creation.readRequirements') {
    if (window.fixture.mode === 'fail-start') throw new Error('TEST_ONLY 读取连接失败，请重试。')
    if (window.fixture.mode === 'schema-failure') throw new Error(JSON.stringify([{ code: 'too_small', path: ['requirements'], minimum: 1 }]))
    if (window.fixture.mode === 'late-start') await new Promise(done => window.fixture.release = done)
    return { readId: 'read_TEST_ONLY' }
  }
  if (name === 'creation.readStatus') return { state: 'ready', done: 3, total: 3, phase: '整理已读要求',
    members: files.map(file => ({ name: file.relativePath, state: 'ready', chars: 28 })) }
  if (name === 'creation.stopRead') return { state: 'stopped', done: 0, total: 3, members: [] }
  if (name === 'creation.structure') {
    if (window.fixture.mode === 'fail-structure') throw new Error('TEST_ONLY 整理暂时失败，请重试。')
    return { candidate: { candidateId: 'cand_TEST_ONLY', brief, diff: [], conflicts: [] } }
  }
  if (name === 'candidates.adopt') return { spec: adoptBrief(request.spec, brief,
    { adopt: [...ADOPTABLE_PATHS], summary: adoptionSummary(brief, [...ADOPTABLE_PATHS]) }) }
  if (name === 'candidates.discard') return { state: 'discarded' }
  throw new Error('Unexpected fixture call: ' + name)
}
const root = createRoot(document.getElementById('app'))
window.resetWizard = (spec = {}, step = 0) => {
  const scope = crypto.randomUUID()
  window.fixture.calls = []; window.fixture.mode = 'ready'
  localStorage.setItem('scholarflow:creation:' + scope, JSON.stringify({ spec: { ...base, ...spec }, step }))
  root.render(<div className="sf-app" style={{width:'100%'}}><style>{THEME_CSS + ${JSON.stringify(workspaceCss)} + PAPER_CSS + WIZARD_CSS}</style><div className="sf-body sf-paper-project"><CreationWizard key={scope} scope={scope} api={api}
    context={() => ({ workspaceId: 'TEST_ONLY', sessionId: 'TEST_ONLY' })} workspaceTitle="TEST_ONLY" onCreated={() => {}} /></div></div>)
}
window.resetWizard()
` }, bundle: true, platform: 'browser', format: 'iife', outfile: join(out, 'app.js'),
  define: { __SF_KATEX_CSS__: '""' } })
const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}#app{display:flex;min-height:100vh}*{box-sizing:border-box}</style><div id="app"></div><script src="/app.js"></script>'
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/app.js' ? await readFile(join(out, 'app.js')) : html)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
const errors = [], results = []
page.on('pageerror', error => errors.push(error.message))
const pass = name => { results.push(name); console.log('PASS ' + name) }
const button = name => page.getByRole('button', { name, exact: true })
const reset = async (spec = {}, step = 0) => {
  await page.evaluate(({ spec, step }) => window.resetWizard(spec, step), { spec, step })
  await expect(page.locator('.sf-wizard-page')).toBeVisible()
}
const folder = { resourceId: 'req_TEST_ONLY', origin: 'workspace', kind: 'folder', path: '作业要求',
  members: ['1.jpg', '2.jpg', '3.jpg'].map(name => ({ name: '作业要求/' + name })) }
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  await button('添加要求文件或文件夹').click()
  await button('文件夹').click()
  await page.locator('.sf-picker-row').filter({ hasText: '作业要求' }).click()
  await expect(page.locator('.sf-source-members>li')).toHaveCount(3)
  await button('下一步').click()
  await expect(page.getByRole('alert')).toContainText('先点击「整理要求」')
  pass('folder-only input is retained and explains confirmation before continuing')

  await page.evaluate(() => window.fixture.mode = 'fail-start')
  await button('整理要求').click()
  await expect(page.getByRole('alert').filter({ hasText: '连接失败' })).toBeVisible()
  await expect(button('停止')).toHaveCount(0)
  await expect(page.locator('.sf-long-op')).toHaveCount(0)
  await expect(button('整理要求')).toBeEnabled()
  pass('failed read startup clears progress and restores the retry action')

  await page.evaluate(() => window.fixture.mode = 'ready')
  await button('整理要求').click()
  await expect(page.getByRole('region', { name: '要求候选' })).toBeVisible()
  assert.equal(await page.locator('#sf-field-requirements').inputValue(), '')
  assert.equal(await page.locator('#sf-field-title').inputValue(), '')
  const calls = await page.evaluate(() => window.fixture.calls)
  assert(calls.some(call => call.name === 'creation.structure' && call.request.spec.requirements === '' && call.request.spec.title === ''))
  await button('全部采用').click()
  await expect(page.locator('#sf-field-requirements')).toHaveValue(/TEST_ONLY 阅读报告/)
  assert.equal(await page.locator('#sf-field-title').inputValue(), '')
  await button('下一步').click()
  await expect(button('上一步')).toBeVisible()
  const sizes = await page.locator('.sf-wizard-nav').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); const css = getComputedStyle(button)
    return { height: rect.height, font: css.fontSize, radius: css.borderRadius }
  }))
  assert.deepEqual(sizes[0], sizes[1])
  assert.equal(sizes[0].font, '13px', 'parent fallback styles must not override the wizard')
  assert.equal(await page.locator('.sf-wizard-back').evaluate(el => getComputedStyle(el).borderTopColor), 'rgba(0, 0, 0, 0)')
  await page.locator('.sf-wizard-footer').screenshot({ path: join(out, 'navigation.png') })
  pass('source-only candidate can be adopted without inventing a title; navigation controls match')

  await reset({ requirementSources: [folder] })
  await page.evaluate(() => window.fixture.mode = 'fail-structure')
  await button('整理要求').click()
  await expect(page.getByRole('alert').filter({ hasText: '整理暂时失败' })).toBeVisible()
  await expect(button('停止')).toHaveCount(0)
  await expect(page.locator('.sf-source-members>li[data-state=ready]')).toHaveCount(3)
  pass('structuring failure keeps file results without a stuck progress state')

  await reset({ requirementSources: [folder] })
  await page.evaluate(() => window.fixture.mode = 'late-start')
  await button('整理要求').click()
  await expect(button('停止')).toBeVisible()
  await button('停止').click()
  await page.evaluate(() => window.fixture.release())
  await expect(button('整理要求')).toBeEnabled()
  assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.name === 'creation.structure')), false)
  await expect(page.getByRole('region', { name: '要求候选' })).toHaveCount(0)
  pass('stopping a delayed read prevents late structuring and adoption')

  await reset({ requirements: 'TEST_ONLY 手工输入的要求' })
  await button('整理要求').click()
  await expect(page.getByRole('region', { name: '要求候选' })).toBeVisible()
  pass('text-only input can still be organized before a title is entered')

  await reset({ requirementSources: [folder] })
  await page.evaluate(() => window.fixture.mode = 'schema-failure')
  await button('整理要求').click()
  await expect(page.getByRole('alert')).toContainText('请检查写作要求')
  assert(!await page.getByText('too_small', { exact: false }).count())
  pass('serialized validation errors never expose raw schema JSON')

  for (const dark of [false, true]) {
    await reset({ requirementSources: [folder] })
    await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.locator('.sf-source-list').screenshot({ path: join(out, 'sources-' + (dark ? 'dark' : 'light') + '-' + width + '.png') })
      if (!dark && width === 1100) await page.locator('.sf-field').filter({ has: page.locator('.sf-source-list') })
        .screenshot({ path: join(out, 'requirements-panel.png') })
      const readable = await page.locator('.sf-source-name').evaluate(el => getComputedStyle(el).color)
      assert.equal(readable, dark ? 'rgb(249, 250, 251)' : 'rgb(15, 17, 21)')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      const overlaps = await page.locator('.sf-source-members>li').evaluateAll(rows => rows.some(row => {
        const children = [...row.children].map(child => child.getBoundingClientRect()).filter(rect => rect.width && rect.height)
        return children.some((a, i) => children.slice(i + 1).some(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom))
      }))
      assert.equal(overlaps, false)
      await button('添加要求文件或文件夹').click()
      await expect(page.locator('.sf-picker-panel')).toBeVisible()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await button('完成').click()
    }
  }
  pass('file rows fit narrow and wide layouts in both themes without overlapping controls')
  assert.deepEqual(errors, [])
  console.log(results.length + ' checks passed; evidence: ' + out)
} finally {
  await writeFile(join(out, 'report.json'), JSON.stringify({ results, errors }, null, 2))
  await browser.close()
  await new Promise(done => server.close(done))
}
