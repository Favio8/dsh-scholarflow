// G0 prototype (SPEC v1.1 §2): isolated installed Host, no model calls, no paid usage.
// Probes only what can be observed without a browser session or provider request.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/g0-probe', String(Date.now()))
const profile = join(testHome, 'profiles/scholarflow-probe')
const workspaceRoot = join(testHome, '工作区 TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspaceRoot, { recursive: true })
await writeFile(join(workspaceRoot, 'TEST_ONLY 原始资料.txt'), 'TEST_ONLY original source stays unchanged.\n')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-probe-TEST_ONLY', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-probe', '--no-open', '--port', '19361'], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const results = []
const payload = body => body?.result?.value?.data ?? body?.result?.value ?? body
const record = (name, verdict, detail) => { results.push({ name, verdict, detail }); console.log(`${verdict === 'PASS' ? '✔' : '✖'} ${name} — ${detail}`) }
let page
try {
  const url = await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timeout); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Host exited ${code}`)) })
  })
  page = await (await browser.newContext()).newPage()
  page.setDefaultTimeout(10000)
  await page.goto(url)
  await page.waitForTimeout(800)
  const dialogs = page.getByRole('dialog')
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('预览版说明'))
    await dialogs.first().getByRole('button', { name: '继续', exact: true }).click()
  await page.waitForTimeout(600)
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('添加一个 API Key'))
    await dialogs.first().getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.waitForTimeout(600)
  const rpc = (method, args = {}) => page.evaluate(async ({ method, args }) => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 200) } }
    return { status: response.status, body }
  }, { method, args })

  // V3a — the real wire verbs are pick/list/createDirectory on the directoryPicker
  // namespace (found in dsh-api-workspace-controller). `list` is safe to call: it either
  // lists through the browse backend or refuses with the composed capability kind, which
  // is itself the answer to "which chooser does this host actually serve?".
  const listed = await rpc('directoryPicker/list', { path: workspaceRoot })
  const listing = payload(listed.body)
  record('V3a directoryPicker/list', listed.status === 200 ? 'PASS' : 'OBSERVED',
    `${listed.status} ${JSON.stringify(listing).slice(0, 260)}`)

  // V6a — selecting the mode creates a conversation but no project files.
  const workspace = await rpc('workspace/create', { request: { path: workspaceRoot } })
  const workspaceId = workspace.body?.result?.value?.workspace?.workspaceId
  let sessionId, context, projectId
  if (!workspaceId) record('V6a 工作区注册', 'FAIL', JSON.stringify(workspace.body).slice(0, 200))
  else {
    const before = (await readdir(workspaceRoot)).sort()
    const created = await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } })
    sessionId = created.body?.result?.value?.sessionId
    const after = (await readdir(workspaceRoot)).sort()
    record('V6a 选模式不创建目录', created.status === 200 && JSON.stringify(before) === JSON.stringify(after) ? 'PASS' : 'FAIL',
      `会话 ${sessionId ?? '未创建'}；工作区前后一致=${JSON.stringify(before) === JSON.stringify(after)}`)

    // V6b — opening a session inspects the project and writes nothing.
    if (sessionId) {
      const inspect = await rpc('scholarflow.v1/project.inspect', { request: { context: { requestId: 'req_TEST_ONLY', workspaceId, sessionId } } })
      const value = payload(inspect.body)
      const stillClean = JSON.stringify(before) === JSON.stringify((await readdir(workspaceRoot)).sort())
      record('V6b 打开不重新初始化', inspect.status === 200 && value?.initialized === false && stillClean ? 'PASS' : 'FAIL',
        `initialized=${value?.initialized}；工作区仍为空=${stillClean}`)
    }
  }

  // V5 — build a real project through the public RPCs, then produce all three exports and
  // inspect what the installed host actually wrote.
  if (workspaceId) {
    context = { requestId: 'req_TEST_ONLY', workspaceId, sessionId }
    const prepared = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'TEST_ONLY 导出检查', type: 'course-paper' } } })
    const plan = payload(prepared.body)
    if (!plan?.planId) record('V5 项目预检', 'FAIL', JSON.stringify(prepared.body).slice(0, 200))
    else {
      const initialized = await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
      const created = payload(initialized.body)
      record('V5 项目创建', initialized.status === 200 && created?.initialized !== false ? 'PASS' : 'FAIL',
        `initialized=${created?.initialized} projectId=${created?.binding?.projectId ?? created?.ledger?.projectId ?? '?'}`)
      projectId = created?.binding?.projectId ?? created?.ledger?.projectId
      const inspected = payload((await rpc('scholarflow.v1/project.inspect', { request: { context: { ...context, projectId } } })).body)
      const projectContext = { ...context, projectId, expectedLedgerRevision: inspected?.ledger?.revision }
      for (const format of ['markdown', 'latex', 'docx']) {
        // Each delivery advances the ledger, so the plan must be built on a fresh revision.
        const fresh = payload((await rpc('scholarflow.v1/project.inspect', { request: { context: { ...context, projectId } } })).body)
        const attempt = { ...projectContext, expectedLedgerRevision: fresh?.ledger?.revision }
        const preflight = await rpc('scholarflow.v1/export.preflight', { request: { context: attempt, format } })
        const exportPlan = payload(preflight.body)
        if (!exportPlan?.planId) { record(`V5 ${format} 预检`, 'FAIL', JSON.stringify(preflight.body).slice(0, 220)); continue }
        const made = await rpc('scholarflow.v1/export.create', { request: { context: attempt, planId: exportPlan.planId, planHash: exportPlan.planHash, deliveryType: 'working-draft' } })
        const delivery = payload(made.body)
        const files = delivery?.files ?? delivery?.artifacts ?? []
        const named = JSON.stringify(files).slice(0, 200)
        record(`V5 ${format} 交付`, delivery?.ok === false ? 'FAIL' : made.status === 200 ? 'PASS' : 'FAIL', `plan=${exportPlan.planId} ok=${delivery?.ok} err=${delivery?.error?.code ?? ''} ${delivery?.error?.message ?? ''} files=${named}`)
      }
      // Inspect the delivered bytes on disk: the numbered style must actually be there.
      const drafts = join(workspaceRoot, '.scholarflow')
      const found = []
      const walk = async directory => { for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path); else if (/\.(tex|docx|md)$/i.test(entry.name)) found.push(path) } }
      try { await walk(workspaceRoot) } catch { /* nothing written */ }
      const tex = found.find(path => path.endsWith('.tex'))
      const docx = found.find(path => path.endsWith('.docx'))
      if (tex) { const text = await readFile(tex, 'utf8')
        record('V5 LaTeX 编号式', /\\bibliographystyle\{unsrt\}/.test(text) && /ctexart/.test(text) ? 'PASS' : 'FAIL',
          `bibliographystyle(unsrt)=${/\\bibliographystyle\{unsrt\}/.test(text)} ctexart=${/ctexart/.test(text)}`) }
      else record('V5 LaTeX 编号式', 'FAIL', '未找到交付的 .tex')
      if (docx) { const bytes = await readFile(docx)
        record('V5 Word 真实字节', bytes.subarray(0, 2).toString('latin1') === 'PK' ? 'PASS' : 'FAIL', `前两字节=${bytes.subarray(0, 2).toString('latin1')} 大小=${bytes.length}`) }
      else record('V5 Word 真实字节', 'FAIL', '未找到交付的 .docx')
      record('V5 交付文件清单', found.length ? 'PASS' : 'FAIL', found.map(path => path.replace(workspaceRoot, '')).join(' | ').slice(0, 300))
    }
  }

  // Items 2-5, rendered: open the ScholarFlow session in the real client and assert that
  // each surface actually appears. Presence, not aesthetics — the review matrix still needs
  // a person.
  if (sessionId) {
    await page.locator('[data-row-key="session:' + sessionId + '"]').click().catch(() => undefined)
    await page.waitForTimeout(1500)
    const wizard = page.locator('[aria-label="创建论文向导"]')
    const rendered = await wizard.count()
    record('AT-30/31 引导已渲染', rendered === 1 ? 'PASS' : 'FAIL', '向导容器数量=' + rendered)
    if (rendered) {
      const steps = await wizard.locator('.sf-wizard-steps button').count()
      record('AT-31 三步导航', steps === 3 ? 'PASS' : 'FAIL', '步骤按钮=' + steps)
      const sources = await wizard.locator('.sf-source-list, .sf-field-hint').count()
      record('AT-31 要求来源区', sources > 0 ? 'PASS' : 'FAIL', '来源相关元素=' + sources)
      const compact = await wizard.locator('.sf-wizard-step-compact').count()
      record('AT-31 窄屏步骤行存在（宽屏隐藏）', compact === 1 ? 'PASS' : 'FAIL', '紧凑步骤元素=' + compact)
    }
  }

  // AT-36 (user acceptance 7 and 8) — a user preset outlives project work and is
  // reachable from another project. No model call, no paid usage.
  if (sessionId) {
    const structure = { title: 'TEST_ONLY 我的结构', summary: '按当前论文结构保存', paperType: 'course-paper',
      sections: [{ key: 'k-intro', title: '引言', focus: '开头', targetLength: 800 },
        { key: 'k-body', title: '正文', focus: '主体', targetLength: 3200 }] }
    const saved = payload((await rpc('scholarflow.v1/presets.save', { request: structure })).body)
    const presetFile = saved?.id ? join(testHome, 'scholarflow', 'presets', 'user', saved.id + '.json') : undefined
    const digestOf = async () => createHash('sha256').update(await readFile(presetFile)).digest('hex')
    const before = presetFile && existsSync(presetFile) ? await digestOf() : undefined
    record('AT-36a 用户预设落盘', before ? 'PASS' : 'FAIL', (saved?.id ?? '未保存') + ' → ' + String(presetFile).replace(testHome, '<DSH_HOME>'))
    if (before) {
      // A project write is the closest thing to "editing the paper" this probe can do.
      await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...context, projectId }, text: 'TEST_ONLY 改写后的正文。' } })
      const after = await digestOf()
      record('AT-36b 项目改动不改全局库', before === after ? 'PASS' : 'FAIL', '预设文件哈希前后一致=' + (before === after))
      const otherRoot = join(testHome, '另一个工作区 TEST_ONLY')
      await mkdir(otherRoot, { recursive: true })
      const other = payload((await rpc('workspace/create', { request: { path: otherRoot } })).body)
      const otherId = other?.workspace?.workspaceId
      if (otherId) await rpc('session/create', { request: { workspaceId: otherId, agentPreset: 'scholarflow' } })
      const list = payload((await rpc('scholarflow.v1/presets.list', { request: {} })).body)
      const all = list?.all ?? []
      record('AT-36c 另一个项目可见', all.some(row => row.id === saved.id) ? 'PASS' : 'FAIL', '库中共 ' + all.length + ' 条，含内置与用户预设')
    }
  }

  // AT-29 (user acceptance 1), substance: one settings document serves both surfaces.
  // The diagnostics Remote takes no arguments and answers without the applicationResult
  // wrapper, so the row sits at result.value.settings[0] with ns, revision and value.
  const readSettings = async () => ((await rpc('scholarflow.v1/diagnostics', {})).body?.result?.value?.settings ?? [])[0]
  const row = await readSettings()
  if (typeof row?.revision !== 'number') record('AT-29 设置同源', 'NOT ESTABLISHED', '未读到设置行：' + String(JSON.stringify(row)).slice(0, 120))
  else {
    const wanted = row.value?.defaultProjectType === 'research-paper' ? 'course-paper' : 'research-paper'
    const written = payload((await rpc('settings/update', { ns: 'scholarflow', patch: { defaultProjectType: wanted }, expectedRevision: row.revision })).body)
    const after = await readSettings()
    record('AT-29 设置同源', after?.value?.defaultProjectType === wanted ? 'PASS' : 'FAIL',
      '经 settings/update 写入 ' + wanted + '，诊断读回 ' + String(after?.value?.defaultProjectType) + '；写入 ok=' + String(written?.ok))
  }

  // V3b — can the picker's browse backend reach a directory outside the workspace?
  const outsideRoot = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
  const outside = await rpc('directoryPicker/list', { path: outsideRoot })
  record('V3b 选择器列工作区外目录', outside.status === 200 ? 'OBSERVED' : 'REFUSED',
    `${outside.status} ${JSON.stringify(outside.body?.result?.value ?? outside.body).slice(0, 200)}`)

  await writeFile(resolve('.dsh-tmp/g0-probe/result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
} catch (error) {
  record('probe', 'FAIL', error.message)
} finally {
  await page?.context().close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)) }
  console.log('\n隔离目录：', testHome)
}
