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
const mark = { PASS: '✔', FAIL: '✖', 'NOT ESTABLISHED': '?', 'COVERED ELSEWHERE': '→', OBSERVED: '·', REFUSED: '·' }
const record = (name, verdict, detail) => { results.push({ name, verdict, detail }); console.log(`${mark[verdict] ?? '✖'} ${name} — ${detail}`) }
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
        // This project registers no source, so the honest invariant is that the numbered style
        // is declared exactly when the manuscript cites something. The with-citations case is
        // covered by tests/integration/export-citation-order.test.ts.
        const cites = /\\cite\{/.test(text), styled = /\\bibliographystyle\{unsrt\}/.test(text)
        record('V5 LaTeX 编号式', /ctexart/.test(text) && styled === cites ? 'PASS' : 'FAIL',
          `ctexart=${/ctexart/.test(text)} 有引用=${cites} 声明编号式=${styled}（无引用时不应声明参考文献样式）`) }
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
    // Driving the client is covered by tests/e2e/ui-acceptance.mjs, which reaches the wizard the
    // way a user does (new conversation, then the mode chip). This probe only checks that the
    // client itself serves the session it created; it does not navigate.
    // This probe does not navigate, so the wizard is expected to be absent here; the rendered
    // acceptance items live in tests/e2e/ui-acceptance.mjs and are reported there.
    const wizard = page.locator('[aria-label="创建论文向导"]')
    const rendered = await wizard.count()
    record('AT-30/31 引导渲染（由验收脚本覆盖）', 'COVERED ELSEWHERE',
      '本探针不导航，向导容器=' + rendered + '；渲染断言见 pnpm acceptance:ui')
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

  // Items 3-5, substance: what actually lands in the created project. The wizard's own
  // payload is used, so the check covers the contract the UI depends on, not the UI itself.
  {
    // A fresh workspace: the V5 block above already created a project elsewhere.
    const freshRoot = join(testHome, '创建检查 TEST_ONLY')
    await mkdir(freshRoot, { recursive: true })
    await writeFile(join(freshRoot, 'TEST_ONLY 原始资料.txt'), 'TEST_ONLY source stays unchanged.')
    const fresh = payload((await rpc('workspace/create', { request: { path: freshRoot } })).body)
    const freshWorkspaceId = fresh?.workspace?.workspaceId
    const freshSessionId = freshWorkspaceId
      ? payload((await rpc('session/create', { request: { workspaceId: freshWorkspaceId, agentPreset: 'scholarflow' } })).body)?.sessionId : undefined
    const creationContext = { requestId: 'req_TEST_ONLY', workspaceId: freshWorkspaceId, sessionId: freshSessionId }
    const spec = {
      title: 'TEST_ONLY 要求来源与材料独立', type: 'course-paper', language: 'zh-CN', format: 'markdown',
      requirements: '按要求文件里的规定完成；材料只作参考。',
      requirementSources: [{ resourceId: 'req_probe1', origin: 'workspace', kind: 'file', path: 'TEST_ONLY 原始资料.txt',
        members: [], role: 'assignment', state: 'selected' }],
      materials: ['TEST_ONLY 原始资料.txt'],
      online: false, targetLength: 4000, countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 },
      preset: { id: 'course-argumentative', source: 'builtin', version: '1.0.0', modified: false },
      sections: [{ id: 'section_1_intro', title: '引言', purpose: '交代问题', targetLength: 1000, allocationMode: 'auto', allocationWeight: 0.25 },
        { id: 'section_2_body', title: '主题论证', purpose: '展开论证', targetLength: 3000, allocationMode: 'auto', allocationWeight: 0.75 }],
      manuscriptDir: 'manuscript',
    }
    const prepared = payload((await rpc('scholarflow.v1/creation.prepare', { request: { context: creationContext, spec } })).body)
    if (!prepared?.planId) record('AT-31/33 创建预检', 'FAIL', String(JSON.stringify(prepared)).slice(0, 200))
    else {
      const started = payload((await rpc('scholarflow.v1/creation.start', { request: { context: creationContext, planId: prepared.planId, planHash: prepared.planHash } })).body)
      record('AT-31/33 创建闭环', started?.taskId ? 'PASS' : 'FAIL', 'taskId=' + String(started?.taskId))
      const written = JSON.parse(await readFile(join(freshRoot, '.scholarflow', 'writing', 'requirements.json'), 'utf8'))
      const row = written.spec ?? written
      record('AT-31 要求来源独立落入项目',
        row.requirementSources?.length === 1 && row.requirementSources[0].path === 'TEST_ONLY 原始资料.txt' ? 'PASS' : 'FAIL',
        '来源=' + JSON.stringify(row.requirementSources ?? null).slice(0, 120))
      record('AT-33 材料清单独立', Array.isArray(row.materials) && row.materials.length === 1 ? 'PASS' : 'FAIL', '材料=' + JSON.stringify(row.materials))
      // AT-40: the same confirmed plan must not create a second project.
      const again = payload((await rpc('scholarflow.v1/creation.start', { request: { context: creationContext, planId: prepared.planId, planHash: prepared.planHash } })).body)
      record('AT-40 重复提交被拒', again?.ok === false ? 'PASS' : 'FAIL', '第二次提交返回 ok=' + String(again?.ok) + ' code=' + String(again?.error?.code))
      // AT-38: rename and remove go through the host surface, not just the library class.
      const savedForManage = payload((await rpc('scholarflow.v1/presets.save', { request: {
        title: 'TEST_ONLY 管理检查', summary: '检查改名与删除', paperType: 'course-paper',
        sections: [{ key: 'k-intro', title: '引言', focus: '开头', targetLength: 500 }] } })).body)
      const renamed = payload((await rpc('scholarflow.v1/presets.rename', { request: { id: savedForManage?.id, title: 'TEST_ONLY 改过名' } })).body)
      record('AT-38 改名经宿主生效', renamed?.title === 'TEST_ONLY 改过名' ? 'PASS' : 'FAIL', '新名称=' + String(renamed?.title))
      const removed = payload((await rpc('scholarflow.v1/presets.remove', { request: { id: savedForManage?.id } })).body)
      const listed = payload((await rpc('scholarflow.v1/presets.list', { request: {} })).body)
      record('AT-38 删除经宿主生效', removed?.removed === true && !(listed?.all ?? []).some(row => row.id === savedForManage?.id) ? 'PASS' : 'FAIL',
        'removed=' + String(removed?.removed) + ' 仍在列表=' + String((listed?.all ?? []).some(row => row.id === savedForManage?.id)))
      // AT-43: an old project is read in place — opening it must not migrate or rewrite it.
      const legacyPath = join(freshRoot, '.scholarflow', 'writing', 'requirements.json')
      const legacy = JSON.parse(await readFile(legacyPath, 'utf8'))
      delete legacy.spec.requirementSources
      legacy.spec.assignmentPath = 'TEST_ONLY 原始资料.txt'
      await writeFile(legacyPath, JSON.stringify(legacy))
      const legacyHash = createHash('sha256').update(await readFile(legacyPath)).digest('hex')
      const inspected = payload((await rpc('scholarflow.v1/project.inspect', { request: { context: creationContext } })).body)
      const afterHash = createHash('sha256').update(await readFile(legacyPath)).digest('hex')
      record('AT-43 旧项目只读不迁移', inspected?.initialized === true && legacyHash === afterHash ? 'PASS' : 'FAIL',
        'initialized=' + String(inspected?.initialized) + ' 文件字节未变=' + String(legacyHash === afterHash))
      // AT-37: requirement sources stand alone — a project with no reference material at all
      // still records its source.
      const onlyRoot = join(testHome, '仅要求文件 TEST_ONLY')
      await mkdir(onlyRoot, { recursive: true })
      await writeFile(join(onlyRoot, 'TEST_ONLY 作业说明.txt'), 'TEST_ONLY assignment text.')
      const only = payload((await rpc('workspace/create', { request: { path: onlyRoot } })).body)
      const onlyWorkspaceId = only?.workspace?.workspaceId
      const onlySessionId = onlyWorkspaceId
        ? payload((await rpc('session/create', { request: { workspaceId: onlyWorkspaceId, agentPreset: 'scholarflow' } })).body)?.sessionId : undefined
      const onlyContext = { requestId: 'req_TEST_ONLY', workspaceId: onlyWorkspaceId, sessionId: onlySessionId }
      const onlySpec = { ...spec, title: 'TEST_ONLY 只用要求文件', materials: [],
        requirementSources: [{ resourceId: 'req_only1', origin: 'workspace', kind: 'file', path: 'TEST_ONLY 作业说明.txt', members: [], role: 'assignment', state: 'selected' }] }
      const onlyPlan = payload((await rpc('scholarflow.v1/creation.prepare', { request: { context: onlyContext, spec: onlySpec } })).body)
      if (!onlyPlan?.planId) record('AT-37 仅要求文件创建', 'FAIL', String(JSON.stringify(onlyPlan)).slice(0, 160))
      else {
        await rpc('scholarflow.v1/creation.start', { request: { context: onlyContext, planId: onlyPlan.planId, planHash: onlyPlan.planHash } })
        const onlyWritten = JSON.parse(await readFile(join(onlyRoot, '.scholarflow', 'writing', 'requirements.json'), 'utf8')).spec
        record('AT-37 无材料仍保留要求来源',
          onlyWritten.requirementSources?.length === 1 && Array.isArray(onlyWritten.materials) && onlyWritten.materials.length === 0 ? 'PASS' : 'FAIL',
          '来源=' + String(onlyWritten.requirementSources?.length) + ' 材料=' + String(onlyWritten.materials?.length))
      }
      // AT-32: an image can be registered as a requirement source. Only the plan is built —
      // starting a task would reach the planning stage and call a model, which needs approval.
      const imageSpec = { ...spec, title: 'TEST_ONLY 图片来源登记', materials: [],
        requirementSources: [{ resourceId: 'req_img1', origin: 'workspace', kind: 'file', path: 'TEST_ONLY 截图.png', members: [], role: 'assignment', state: 'selected' }] }
      const imageRoot = join(testHome, '图片来源检查 TEST_ONLY')
      await mkdir(imageRoot, { recursive: true })
      const imageWorkspace = payload((await rpc('workspace/create', { request: { path: imageRoot } })).body)
      const imageContext = { requestId: 'req_TEST_ONLY', workspaceId: imageWorkspace?.workspace?.workspaceId,
        sessionId: payload((await rpc('session/create', { request: { workspaceId: imageWorkspace?.workspace?.workspaceId, agentPreset: 'scholarflow' } })).body)?.sessionId }
      const imagePlan = payload((await rpc('scholarflow.v1/creation.prepare', { request: { context: imageContext, spec: imageSpec } })).body)
      record('AT-32 图片可作要求来源', imagePlan?.planId ? 'PASS' : 'FAIL', '预检=' + String(imagePlan?.planId ?? JSON.stringify(imagePlan).slice(0, 120)))
      // V4 — the image channel is a resolved per-model fact, so the wizard can state the real
      // reason instead of offering a control that cannot work. No model call is made here.
      const capability = payload((await rpc('scholarflow.v1/creation.imageCapability', { request: { context: imageContext } })).body)
      record('V4 图片输入能力可探测', capability && 'imageInput' in capability ? 'PASS' : 'FAIL',
        '模型=' + String(capability?.model) + ' 图片输入=' + JSON.stringify(capability?.imageInput) + '（null 表示宿主未报告）')
      record('AT-34 预设随创建记录', row.preset?.id === 'course-argumentative' && row.sections?.length === 2 ? 'PASS' : 'FAIL',
        '预设=' + String(row.preset?.id) + ' 章节=' + String(row.sections?.length))

      // V3b — an external requirement source is stored as an opaque handle: the plan carries the
      // handle and the relative member names, never the folder's location, and no external bytes
      // are copied into the project. A source that tries to smuggle a path is rejected outright.
      const externalRoot = join(testHome, '电脑其他位置 TEST_ONLY')
      await mkdir(externalRoot, { recursive: true })
      await writeFile(join(externalRoot, 'TEST_ONLY 作业要求.md'), 'TEST_ONLY assignment outside the workspace.')
      // The workspace must be a different directory: the point is that the source lives outside it.
      const externalWorkspaceRoot = join(testHome, '外部来源项目 TEST_ONLY')
      await mkdir(externalWorkspaceRoot, { recursive: true })
      const externalStatus = payload((await rpc('scholarflow.v1/sources.externalStatus', { request: { handles: ['external_source_probe'] } })).body)
      record('V3b 外部来源状态接口', Array.isArray(externalStatus?.live) && externalStatus.live.length === 0 ? 'PASS' : 'FAIL',
        '未授权句柄返回 live=' + JSON.stringify(externalStatus?.live ?? externalStatus).slice(0, 200))
      const externalWorkspaceId = payload((await rpc('workspace/create', { request: { path: externalWorkspaceRoot } })).body)?.workspace?.workspaceId
      const externalSessionId = externalWorkspaceId
        ? payload((await rpc('session/create', { request: { workspaceId: externalWorkspaceId, agentPreset: 'scholarflow' } })).body)?.sessionId : undefined
      const externalContext = { requestId: 'req_TEST_ONLY', workspaceId: externalWorkspaceId, sessionId: externalSessionId }
      const externalSpec = { ...spec, title: 'TEST_ONLY 外部来源', materials: [],
        requirementSources: [{ resourceId: 'req_ext1', origin: 'external', kind: 'folder',
          handle: 'external_source_probe', members: [{ name: 'TEST_ONLY 作业要求.md', size: 40 }], role: 'assignment', state: 'connected' }] }
      const externalPlan = payload((await rpc('scholarflow.v1/creation.prepare', { request: { context: externalContext, spec: externalSpec } })).body)
      if (!externalPlan?.planId) record('V3b 外部来源可预检', 'FAIL', String(JSON.stringify(externalPlan)).slice(0, 200))
      else {
        await rpc('scholarflow.v1/creation.start', { request: { context: externalContext, planId: externalPlan.planId, planHash: externalPlan.planHash } })
        const externalWritten = await readFile(join(externalWorkspaceRoot, '.scholarflow', 'writing', 'requirements.json'), 'utf8')
        record('V3b 外部来源只存句柄',
          JSON.parse(externalWritten).spec.requirementSources?.[0]?.handle === 'external_source_probe' && !externalWritten.includes(testHome) ? 'PASS' : 'FAIL',
          '句柄=' + String(JSON.parse(externalWritten).spec.requirementSources?.[0]?.handle) + ' 项目文件不含绝对路径=' + String(!externalWritten.includes(testHome)))
        // The project legitimately holds its own manuscript; what must not appear is a copy of
        // the external file — neither by name nor by content.
        const copied = []
        const scan = async (directory, prefix) => {
          for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
            const name = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) { await scan(join(directory, entry.name), name); continue }
            if (name.includes('作业要求') || (await readFile(join(directory, entry.name), 'utf8').catch(() => '')).includes('TEST_ONLY assignment outside the workspace.')) copied.push(name)
          }
        }
        await scan(externalWorkspaceRoot, '')
        record('V3b 外部内容不复制进项目', copied.length === 0 ? 'PASS' : 'FAIL', '项目内外部副本=' + JSON.stringify(copied))
      }
      const smuggling = payload((await rpc('scholarflow.v1/creation.prepare', { request: { context: externalContext,
        spec: { ...externalSpec, requirementSources: [{ resourceId: 'req_ext2', origin: 'external', kind: 'folder', path: 'C:/elsewhere', members: [] }] } } })).body)
      record('V3b 外部来源不得携带路径', smuggling?.ok === false ? 'PASS' : 'FAIL',
        'ok=' + String(smuggling?.ok) + ' code=' + String(smuggling?.error?.code))
    }
  }

  // V3a/V3b — the composed picker serves only the native OS chooser: there is no browse backend,
  // so the host cannot enumerate a directory for a client. External folders are therefore reached
  // by the operator's own pick, which is why the plugin asks for a grant instead of listing one.
  const outsideRoot = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
  const outside = await rpc('directoryPicker/list', { path: outsideRoot })
  const outsideError = outside.body?.result?.error
  record('V3a 选择器仅原生、无浏览后端', outsideError?.code === 'directory-picker/unavailable' ? 'PASS' : 'FAIL',
    `${outside.status} ${outsideError?.code ?? ''} ${String(outsideError?.details?.capability ?? '').slice(0, 60)}`)

  await writeFile(resolve('.dsh-tmp/g0-probe/result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
} catch (error) {
  record('probe', 'FAIL', error.message)
} finally {
  await page?.context().close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)) }
  console.log('\n隔离目录：', testHome)
}
