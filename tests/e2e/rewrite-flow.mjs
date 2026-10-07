// Real wheel input against the installed DSH Host, with an isolated profile and a long
// TEST_ONLY manuscript. No model calls and no changes to the user's assignment or profile.
// Usage: node tests/e2e/rewrite-flow.mjs
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/rewrite-flow', String(Date.now()))
const profile = join(root, 'profiles/rewrite-test')
const workspacePath = join(root, 'Scroll TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
const host = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'rewrite-test', '--no-open', '--port', '19394'], {
  env: { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write', ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const url = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
  let output = ''
  host.stdout.on('data', chunk => {
    output += chunk.toString()
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timer); done(match[1]) }
  })
  host.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
})
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const rows = [], errors = []
let page
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`) }
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(await url)
  await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor({ timeout: 45000 })
  const dismissOnboarding = async () => {
    await page.waitForTimeout(800)
    for (let attempt = 0; attempt < 3; attempt++) {
      const dialog = page.getByRole('dialog').first()
      if (!await dialog.count()) break
      const text = await dialog.innerText()
      if (text.startsWith('预览版说明')) await dialog.getByRole('button', { name: '继续', exact: true }).click()
      else if (text.startsWith('添加一个 API Key')) await dialog.getByRole('button', { name: '稍后配置', exact: true }).click()
      else break
      await page.waitForTimeout(700)
    }
  }
  await dismissOnboarding()
  const rpc = (method, args) => page.evaluate(async ({ method, args }) => {
    const response = await fetch('api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const result = (await response.json()).result
    if (!result.ok || result.value?.ok === false) throw new Error(JSON.stringify(result.error ?? result.value.error))
    return result.value?.data ?? result.value
  }, { method, args })
  const workspaceId = (await rpc('workspace/create', { request: { path: workspacePath } })).workspace.workspaceId
  // A blank session created only through RPC is hidden from the native sidebar. Use the
  // visible native entry so the host retains it and restores it on reload.
  await page.reload()
  await dismissOnboarding()
  await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover()
  const [created] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.method === 'session/create'),
    page.locator('button[aria-label*="Scroll TEST_ONLY"][aria-label*="中新建会话"]').click()
  ])
  const sessionId = (await created.json()).result.value.sessionId
  await page.locator(`[data-row-key="session:${sessionId}"][aria-selected="true"]`).waitFor()
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.locator('[class*="_item_"]').filter({ hasText: /^ScholarFlow/ }).click()
  await page.locator('.sf-wizard').waitFor()
  assert.equal(await page.locator('.sf-project').getAttribute('data-sf-session-id'), sessionId)
  console.log('Setup: ScholarFlow fixture session is open')
  const context = { requestId: 'req_scroll_TEST_ONLY', workspaceId, sessionId }
  const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'Scroll TEST_ONLY', type: 'course-paper' } } })
  await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
  const project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  const manuscript = '# Scroll TEST_ONLY\n\n' + Array.from({ length: 120 }, (_, i) =>
    `第 ${i + 1} 段：这是用于验证滚轮的测试正文。保留真实编辑器与预览布局，不调用模型。\n\n`).join('')
  await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision },
    text: manuscript, baseHash: project.document.contentHash } })
  await page.reload()
  await dismissOnboarding()
  await page.locator('.sf-middle-column').waitFor()

  const input = page.locator('.sf-source-input')
  const requests = []
  let delay = false, delayMs = 2000
  await page.route('**/api/scholarflow.v1/cowrite.propose', async route => {
    const body = route.request().postDataJSON(), request = body.payload.args.request
    requests.push(request)
    if (delay) { await new Promise(resolve => setTimeout(resolve, delayMs)) }
    try { await route.fulfill({ json: { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { ok: true, data: { suggestion: {
      id: 'cowrite_TEST_ONLY_' + requests.length, after: 'TEST_ONLY 更简洁的表达。', protectedFactChanges: [], citationChanges: { added: [], removed: [] }
    } } } } } }) } catch { /* A cancelled browser request cannot receive the candidate. */ }
  })
  const select = async (start, end) => {
    await expect(input).toBeEnabled()
    await input.evaluate((el, range) => { el.focus({ preventScroll: true }); el.setSelectionRange(...range); el.scrollTop = 0 }, [start, end])
    // Real focus/selection may schedule scrolling; open the menu after those events settle.
    await page.waitForTimeout(200)
    await input.dispatchEvent('mouseup')
    await page.locator('.sf-selection-menu').waitFor()
    await page.locator('.sf-selection-menu').getByRole('button', { name: '润色', exact: true }).click()
  }
  if (!process.argv.includes('--switch-only')) {
  const first = manuscript.indexOf('第 1 段'), last = manuscript.indexOf('\n\n', first)
  await input.fill(manuscript + 'TEST_ONLY 未保存人工补充。')
  await select(first, last)
  record('unsaved selection opens rewrite menu', await page.locator('#sf-rewrite-input').isVisible(), {})
  await page.locator('.sf-overlay').getByRole('button', { name: '提交', exact: true }).click()
  await page.locator('.sf-rewrite[data-state="ready"]').waitFor()
  const adjacent = await page.locator('.sf-source-candidate').evaluate(el => ({ parent: el.parentElement.className, top: el.getBoundingClientRect().top, insideGrid: Boolean(el.closest('.sf-editor-grid')) }))
  record('source candidate anchored inside editor', adjacent.insideGrid && adjacent.top > 200, adjacent)
  await page.locator('.sf-rewrite').getByRole('button', { name: /接受/ }).click()
  await expect(input).toHaveValue(manuscript.slice(0, first) + 'TEST_ONLY 更简洁的表达。' + manuscript.slice(last) + 'TEST_ONLY 未保存人工补充。')
  const accepted = await input.inputValue()
  await input.fill('TEST_ONLY 新前言。\n\n' + accepted)
  await input.fill((await input.inputValue()) + 'TEST_ONLY 另外的后记。')
  await page.locator('.sf-paper-views').getByRole('button', { name: '预览', exact: true }).click()
  await page.locator('.sf-rewrite').getByRole('button', { name: /撤销/ }).click()
  const undone = await input.inputValue()
  record('targeted undo preserves edits before and after', undone === 'TEST_ONLY 新前言。\n\n' + manuscript + 'TEST_ONLY 未保存人工补充。TEST_ONLY 另外的后记。', { length: undone.length })
  const attached = await page.locator('.sf-rewrite').evaluate(el => ({ previous: el.previousElementSibling?.tagName, text: el.previousElementSibling?.textContent?.slice(0, 40) }))
  record('preview candidate follows target paragraph', attached.previous === 'P' && attached.text?.includes('第 1 段'), attached)
  await page.locator('#sf-rewrite-input').fill('TEST_ONLY 请保留数字')
  await page.reload(); await dismissOnboarding(); await page.locator('.sf-rewrite').waitFor()
  record('reload preserves candidate and instruction without another model call', requests.length === 1 && await page.locator('#sf-rewrite-input').inputValue() === 'TEST_ONLY 请保留数字', { requests: requests.length })
  await page.locator('.sf-paper-views').getByRole('button', { name: '编辑', exact: true }).click()
  await input.fill((await input.inputValue()).replace('第 1 段', 'TEST_ONLY 已人工修改'))
  await expect(page.locator('.sf-rewrite')).toHaveAttribute('data-state', 'failed')
  record('editing target invalidates candidate', await page.locator('.sf-rewrite[data-state="failed"]').count() === 1, {})
  await page.locator('.sf-overlay').getByRole('button', { name: '查看候选', exact: true }).click()
  await page.locator('.sf-rewrite').getByRole('button', { name: /放弃/ }).click()
  const current = await input.inputValue(), start = current.indexOf('第 2 段'), end = current.indexOf('\n\n', start)
  await select(start, end); delay = true
  let cancelled = false
  page.on('requestfailed', request => { if (request.url().endsWith('/api/scholarflow.v1/cowrite.propose')) cancelled = true })
  await page.locator('.sf-overlay').getByRole('button', { name: '提交', exact: true }).click()
  await page.locator('.sf-rewrite[data-state="generating"]').waitFor()
  await expect.poll(() => requests.length).toBe(2)
  await page.locator('.sf-overlay').getByRole('button', { name: '停止生成', exact: true }).click()
  await page.waitForTimeout(2300)
  record('stop aborts the HTTP request and discards late response', cancelled && await page.locator('.sf-rewrite[data-state="stopped"]').count() === 1 && await input.inputValue() === current, { cancelled })
  }
  const current = await input.inputValue(), start = current.indexOf('第 2 段'), end = current.indexOf('\n\n', start)
  await select(start, end)
  let cancelled = false; delay = true; delayMs = 5000
  page.on('requestfailed', request => { if (request.url().endsWith('/api/scholarflow.v1/cowrite.propose')) cancelled = true })
  const initialRequests = requests.length
  await page.locator('.sf-overlay').getByRole('button', { name: '提交', exact: true }).click()
  await expect.poll(() => requests.length).toBe(initialRequests + 1)
  const anotherWorkspace = page.locator('[data-row-key^="workspace:"]').filter({ visible: true })
  const differentKey = (await anotherWorkspace.evaluateAll((rows, currentId) => rows.map(row => row.getAttribute('data-row-key')).filter(key => key !== 'workspace:' + currentId), workspaceId))[0]
  assert.ok(differentKey, 'An ordinary workspace must exist for cross-project navigation')
  const differentRow = page.locator(`[data-row-key="${differentKey}"]`)
  await differentRow.hover()
  await differentRow.locator('button[aria-label*="中新建会话"]').click()
  await page.waitForTimeout(5300)
  record('switching workspace aborts local generation and cannot expose its late candidate', cancelled && await page.locator('.sf-middle-column').count() === 0,
    { cancelled, anotherWorkspace: differentKey, requests: requests.length })
  record('no client exceptions', errors.length === 0, errors)
  await page.screenshot({ path: join(root, 'rewrite.png') })
  assert.equal(rows.filter(row => !row.ok).length, 0)
} catch (error) {
  record('run', false, error.message); process.exitCode = 1
  if (page) await writeFile(join(root, 'failure.txt'), await page.locator('.sf-project').innerText()).catch(() => {})
  if (page) await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
} finally {
  await writeFile(join(root, 'journal.json'), JSON.stringify(rows, null, 2))
  host.kill(); await browser.close(); console.log('journal: ' + join(root, 'journal.json'))
}
