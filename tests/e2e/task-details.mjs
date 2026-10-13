// Actionable reading issues and successive host writes in an isolated installed Host.
// TEST_ONLY failures are explicit fixtures; no original assignment or user profile writes.
// Usage: node tests/e2e/task-details.mjs
import {creationSpec,writingTaskSchema} from '../../src/shared/writing-task.ts'
import {classifyNote} from '../../src/core/pipeline/task-issues.ts'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/task-details', String(Date.now()))
const profile = join(root, 'profiles/scroll-test')
const workspacePath = join(root, 'Scroll TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
await writeFile(join(workspacePath,'TEST_ONLY.txt'),'TEST_ONLY readable assignment text')
await writeFile(join(workspacePath,'TEST_ONLY_remove.txt'),'TEST_ONLY preserve this file after deselection')
const host = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scroll-test', '--no-open', '--port', '19395'], {
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
    // Both onboarding dialogs are optional, and a dismissal is asynchronous: the host keeps the node
    // mounted with its button disabled until it finishes taking it away. So wait for a dialog to
    // appear, click only while the button is enabled, then wait for the node to actually go.
    // Checking once and clicking blind raced the mount (the dialog arrived after the shell painted
    // and covered the sidebar); re-clicking the closing node only burned the click timeout.
    for (let attempt = 0; attempt < 6; attempt++) {
      const dialog = page.getByRole('dialog').first()
      const appeared = await dialog.waitFor({ state: 'visible', timeout: attempt === 0 ? 5000 : 3000 }).then(() => true).catch(() => false)
      if (!appeared) return
      const text = (await dialog.innerText().catch(() => '')).trimStart()
      const name = text.startsWith('预览版说明') ? '继续' : text.startsWith('添加一个 API Key') ? '稍后配置' : undefined
      if (!name) throw new Error('unexpected dialog: ' + text.slice(0, 80))
      const button = dialog.getByRole('button', { name, exact: true })
      if (await button.isEnabled()) await button.click({ timeout: 15000 })
      await button.waitFor({ state: 'hidden', timeout: 45000 }).catch(() => {})
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
  await page.locator('#sf-field-requirements').fill('TEST_ONLY 资料选择与问题处理验收')
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await expect(page.locator('.sf-material-count')).toContainText('已选 0')
  const materialChoices = page.locator('.sf-material-checklist input[type=checkbox]')
  await expect(materialChoices).toHaveCount(2)
  record('new tasks discover files without selecting reference materials', await page.locator('.sf-material-checklist input:checked').count()===0,{discovered:2})
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

  const ctx={...context,projectId:project.binding.projectId}
  for(const relativePath of ['TEST_ONLY.txt','TEST_ONLY_remove.txt']) {
    const current = await rpc('scholarflow.v1/project.inspect', { request: { context: ctx } })
    await rpc('scholarflow.v1/materials.register',{request:{context:{...ctx,expectedLedgerRevision:current.ledger.revision},relativePath,role:'assignment'}})
  }
  const spec=creationSpec.parse({title:'TEST_ONLY',type:'course-paper',language:'zh-CN',format:'docx',requirements:'TEST_ONLY',materials:['TEST_ONLY.txt','TEST_ONLY_remove.txt'],online:false,targetLength:1500,sections:[{id:'sec_TEST_ONLY',title:'TEST_ONLY',targetLength:1500}],manuscriptDir:'manuscript'})
  const at=new Date().toISOString(), notes=['TEST_ONLY.txt：扫描页没有文字层','TEST_ONLY_remove.txt：扫描页没有文字层','TEST_ONLY metadata：仅找到文献信息，未获得可读全文','待检查：TEST_ONLY 引用尚未确认','TEST_ONLY conflict：人工编辑冲突']
  const task=writingTaskSchema.parse({schemaVersion:1,id:'writing_TEST_ONLY_details',projectId:project.binding.projectId,sessionId,spec,status:'paused',stage:'materials',revision:0,materialIndex:0,sectionIndex:0,usedModelCalls:0,usedSearchQueries:0,elapsedMs:0,owner:'TEST_ONLY',expectedDocumentHash:(await rpc('scholarflow.v1/document.read',{request:{context:ctx}})).document.contentHash,questions:[],notes,issues:notes.map(note=>classifyNote(note,at)),onlineSources:[],createdAt:at,updatedAt:at})
  await mkdir(join(workspacePath,'.scholarflow/writing/tasks'),{recursive:true})
  await writeFile(join(workspacePath,'.scholarflow/writing/tasks',task.id+'.json'),JSON.stringify(task))
  await writeFile(join(workspacePath,'.scholarflow/writing/current.json'),JSON.stringify({taskId:task.id,projectId:task.projectId}))
  await writeFile(join(workspacePath,'.scholarflow/writing/requirements.json'),JSON.stringify({schemaVersion:1,projectId:task.projectId,spec}))
  await page.reload();await dismissOnboarding();await page.locator('.sf-middle-column').waitFor()
  // v1.20 (SF-185): the report is a pill in the work bar; pause/stop/continue, the checklist and
  // every issue action moved one disclosure deeper, so the pill is opened before the row is.
  // This is deliberately a legacy guided task, not a first-draft checklist (SF-162).
  const pill=page.locator('.sf-progress-details')
  const needs= pill.locator('.sf-issue-group[data-tone="needs"]')
  const issueRow=object=>needs.locator('.sf-issue-row').filter({hasText:object})
  const inspectTask=async()=>(await rpc('scholarflow.v1/writingTask.inspect',{request:{context:ctx}})).task
  const returnToDraft=()=>page.locator('.sf-tool-back').getByRole('button',{name:'返回正文',exact:true}).click()
  const openDetails=async()=>{await pill.waitFor();if(!await pill.evaluate(node=>node.open))await pill.locator(':scope>summary').click()
    const summary=pill.locator('.sf-writing-controls>details>summary');if(!await summary.evaluate(el=>el.parentElement.open))await summary.click()}
  await openDetails()
  await expect(needs.locator('.sf-issue-row')).toHaveCount(5)
  await issueRow('TEST_ONLY.txt').getByRole('button',{name:'补充要求文字',exact:true}).click()
  await expect(page.locator('#sf-panel-Overview')).toBeVisible()
  await expect(page.locator('.sf-requirements-panel textarea').first()).toBeEditable()
  record('paste requirement action opens editable requirements',true,{})
  await returnToDraft();await openDetails()
  const beforeRetry=await inspectTask()
  await issueRow('TEST_ONLY.txt').getByRole('button',{name:'重新读取',exact:true}).click()
  await expect(issueRow('TEST_ONLY.txt')).toHaveCount(0)
  await expect(needs.locator('.sf-issue-row')).toHaveCount(4)
  await expect.poll(async()=>{const state=(await rpc('scholarflow.v1/writingTask.inspect',{request:{context:ctx}})).task;return state.issues.find(row=>row.object==='TEST_ONLY.txt').group}).toBe('handled')
  const projectAfter=await rpc('scholarflow.v1/project.inspect',{request:{context:ctx}})
  assert.equal(Object.values(projectAfter.ledger.materials).find(row=>row.projectRelativePath==='TEST_ONLY.txt').parseStatus,'ready')
  assert.deepEqual((await inspectTask()).issues.filter(row=>row.object!=='TEST_ONLY.txt'),beforeRetry.issues.filter(row=>row.object!=='TEST_ONLY.txt'))
  record('retry action really parses a member and moves only that issue to handled',true,{})
  await openDetails();await page.getByRole('button',{name:'重试获取全文',exact:true}).click()
  await expect(pill.locator('[role=alert]')).toBeVisible()
  await expect(pill.locator('[role=alert]')).toContainText('开启联网补充')
  await pill.locator(':scope>summary').click()
  await expect(pill.locator(':scope>summary')).toHaveText('需处理')
  await expect(page.locator('.sf-progress-pill')).toHaveAttribute('data-alert','true')
  const still=(await rpc('scholarflow.v1/writingTask.inspect',{request:{context:ctx}})).task
  assert.equal(still.issues.find(row=>row.object==='TEST_ONLY metadata').group,'needs-action')
  record('fulltext retry respects offline selection and preserves unresolved status',true,{})
  await openDetails();const remove=page.locator('.sf-issue-row').filter({hasText:'TEST_ONLY_remove.txt'}).getByRole('button',{name:'移除',exact:true});await remove.click()
  await expect.poll(async()=>{const state=(await rpc('scholarflow.v1/writingTask.inspect',{request:{context:ctx}})).task;return state.spec.materials.includes('TEST_ONLY_remove.txt')}).toBe(false)
  assert.equal(await readFile(join(workspacePath,'TEST_ONLY_remove.txt'),'utf8'),'TEST_ONLY preserve this file after deselection')
  record('remove action deselects the member without deleting the original',true,{})
  await openDetails();await page.getByRole('button',{name:'稍后处理',exact:true}).click()
  await expect.poll(async()=>{const state=(await rpc('scholarflow.v1/writingTask.inspect',{request:{context:ctx}})).task;return state.issues.find(row=>row.object==='TEST_ONLY conflict').group}).toBe('handled')
  assert.match((await inspectTask()).issues.find(row=>row.object==='TEST_ONLY conflict').impact,/不视为通过/)
  assert.equal((await rpc('scholarflow.v1/document.read',{request:{context:ctx}})).document.text,manuscript)
  record('defer action preserves draft and records the unresolved quality impact',true,{})
  await openDetails();await page.getByRole('button',{name:'查看检查结果',exact:true}).click()
  await expect(page.locator('#sf-panel-Review')).toBeVisible()
  await expect(page.locator('#sf-panel-Review').getByRole('heading',{name:'AI检查',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'一键检查并完善',exact:true})).toBeEnabled()
  record('review action opens the actual review workspace',true,{})
  await returnToDraft()
  await page.getByRole('button',{name:'编辑',exact:true}).click()
  for (const marker of ['TEST_ONLY host revision one', 'TEST_ONLY host revision two']) {
    const current = await rpc('scholarflow.v1/project.inspect', { request: { context: ctx } })
    const next = current.document.text + '\n\n' + marker + '\n'
    await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...ctx, expectedLedgerRevision: current.ledger.revision }, text: next, baseHash: current.document.contentHash } })
    await expect.poll(() => page.locator('.sf-source-input').inputValue()).toBe(next)
    await page.waitForTimeout(1000)
    const buffer = await rpc('scholarflow.v1/editor.bufferRead', { request: { context: ctx } })
    assert.ok(buffer.buffer === undefined || buffer.buffer.state === 'cleared', 'Host writes must not create a dirty editor buffer')
    await expect(page.locator('.sf-draft-status')).toContainText('已保存')
    await expect(page.locator('.sf-format-toolbar').getByRole('button',{name:'保存',exact:true})).toHaveCount(0)
  }
  record('consecutive host writes are adopted without creating a false human edit buffer',true,{})
  record('detail actions cause no client exception',errors.length===0,errors)
  await page.screenshot({path:join(root,'task-details.png')})
  assert.ok(rows.every(row=>row.ok))

} catch (error) {
  record('run', false, error.message)
  await page?.screenshot({ path: join(root, 'failure.png') }).catch(() => undefined)
  await writeFile(join(root,'failure-page.txt'),await page?.locator('body').innerText().catch(()=> '') ?? '')
  throw error
} finally {
  await writeFile(join(root, 'journal.json'), JSON.stringify(rows, null, 2))
  console.log('Journal:', join(root, 'journal.json'))
  host.kill()
  await browser.close()
}
