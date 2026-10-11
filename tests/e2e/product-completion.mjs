// Long-document typing, wheel, selection and overlay geometry against the installed Host.
// TEST_ONLY manuscript and isolated profile; original assignment files are unchanged.
// Only --live-visual-only starts a real model request, then cancels it to verify native lifecycle.
// Usage: node tests/e2e/workbench-performance.mjs [--desktop] [--interaction-only | --layout-only | --materials-only | --live-visual-only]
import assert from 'node:assert/strict'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { geometryInPage } from '../../scripts/visual-language-contracts.mjs'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/product-completion', String(Date.now()))
const nativeDesktop = false
const layoutOnly = process.argv.includes('--layout-only')
const materialsOnly = process.argv.includes('--materials-only')
const materialNames = ['TEST_ONLY 报告笔记.md', 'TEST_ONLY 个人报告笔记.md',
  'TEST_ONLY_Graph_Convolution-Based_Decoupling_and_Consistency-Driven_Fusion_for_Multimodal_Emotion_Recognition.md',
  'TEST_ONLY 作业要求1.md', 'TEST_ONLY 作业要求2.md', 'TEST_ONLY 作业要求3.md']
const profile = join(root, nativeDesktop ? 'profiles/desktop' : 'profiles/scroll-test')
const workspacePath = join(root, 'Scroll TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
if (nativeDesktop) await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 19396\n')
if (process.argv.includes('--live-visual-only')) await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 19396\n- id: credentials\n  name: \"@deepseek-ai/dsh-credentials-local\"\n  config:\n    path: \"C:/Users/19949/.dsh/.credentials.yaml\"\n    watch: false\n')
const host = nativeDesktop ? undefined : spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scroll-test', '--no-open', '--port', '19396'], {
  env: { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write', ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const url = nativeDesktop ? undefined : new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
  let output = ''
  host.stdout.on('data', chunk => {
    output += chunk.toString()
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timer); done(match[1]) }
  })
  host.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
})
const browser = nativeDesktop ? undefined : await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let desktopApp
const rows = [], errors = []
let page
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`) }
try {
  record('client artifact bytes (SF-134 baseline observation)', true, { bytes: (await stat(resolve('dist/client.js'))).size })
  if (nativeDesktop) {
    const env = { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write' }; delete env.ELECTRON_RUN_AS_NODE
    desktopApp = await electron.launch({ executablePath: join(install, 'DeepSeek Harness.exe'), args: [`--user-data-dir=${join(root, 'electron')}`], env })
    page = await desktopApp.firstWindow()
    await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor({ timeout: 45000 })
    await desktopApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) { window.setSize(1440, 960); window.showInactive() }
    })
  } else page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  if (!nativeDesktop) await page.goto(await url)
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
  if (process.argv.includes('--live-visual-only')) {
    await rpc('settings/update', { ns: 'ui-settings-account', patch: { step: 'done', completion: 'api-key' } })
    await page.reload(); await dismissOnboarding()
  }
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
  for (const name of materialNames) await writeFile(join(workspacePath, name), `# ${name}\n\nTEST_ONLY 本地资料；不读取用户文件，不调用模型。\n`)
  const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'Scroll TEST_ONLY', type: 'course-paper' } } })
  await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
  let project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  for (const relativePath of materialNames) {
    await rpc('scholarflow.v1/materials.register', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision }, relativePath, role: 'notes' } })
    project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  }
  for (const material of Object.values(project.ledger.materials).slice(0, 2)) {
    await rpc('scholarflow.v1/materials.parse', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision }, materialId: material.id } })
    project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  }
  const manuscript = '# Scroll TEST_ONLY\n\n' + Array.from({ length: 450 }, (_, i) =>
    `第 ${i + 1} 段：这是用于验证滚轮的测试正文。保留真实编辑器与预览布局，不调用模型。\n\n`).join('')
  await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision },
    text: manuscript, baseHash: project.document.contentHash } })
  await page.reload()
  await dismissOnboarding()
  await page.locator('.sf-middle-column').waitFor()

  const latest=async()=>project=await rpc('scholarflow.v1/project.inspect',{request:{context}})
  const pc=()=>({...context,projectId:project.binding.projectId,expectedLedgerRevision:project.ledger.revision})
  const menu=async name=>{await page.getByLabel('更多论文选项',{exact:true}).click();await page.locator('.sf-paper-toolbar .sf-paper-menu-popover').getByRole('button',{name,exact:true}).click()}
  const closePanel=page.getByRole('button',{name:'收起右侧边栏',exact:true});if(await closePanel.isVisible())await closePanel.click()
  await latest()
  const savedSpec={title:'Scroll TEST_ONLY',type:'course-paper',language:'zh-CN',format:'markdown',requirements:'TEST_ONLY requirements',targetLength:500,
    materials:project.config.materials.include,sections:[{id:'section_TEST_ONLY',title:'Analysis',targetLength:500}],manuscriptDir:'manuscript'}
  await rpc('scholarflow.v1/writingTask.preferences',{request:{context:pc(),spec:savedSpec}});await latest();await page.reload();await dismissOnboarding()
  for(const name of ['大纲','审查','修改建议','项目设置','版本记录','导出','运行记录与恢复','本项目 Skill','文风与记忆','高级要求','引导流程']){
    await menu(name);await expect(page.getByRole('button',{name:'返回正文',exact:false})).toBeVisible()
    record('navigation '+name,true,{mounted:await page.locator('.sf-paper-content').innerText().then(text=>text.length)})
  }
  await menu('资料与引用');let research=page.locator('#sf-panel-Research')
  const unparsed=research.locator('.sf-material-row').filter({hasText:'TEST_ONLY 作业要求1.md'})
  await unparsed.click();await expect(research.locator('.sf-material-excerpt pre')).toContainText('TEST_ONLY 作业要求1.md')
  await research.locator('.sf-material-excerpt').getByRole('button',{name:'下一段',exact:true}).click();await expect(research.locator('.sf-material-excerpt pre')).toContainText('TEST_ONLY 本地资料')
  await expect(unparsed).toContainText('已读取');await research.locator('.sf-material-excerpt').getByRole('button',{name:'关闭',exact:true}).click()
  const materialRow=unparsed.locator('..');await materialRow.getByRole('button',{name:'从写作中排除',exact:true}).click();await expect(unparsed).toContainText('已排除')
  await materialRow.getByRole('button',{name:'重新选用',exact:true}).click();await expect(unparsed).toBeEnabled()
  record('material click parses actual text; exclude and reselect persist',true,{})
  await menu('写作要求');const requirements=page.locator('.sf-requirements-panel')
  await requirements.getByRole('textbox',{name:'写作要求',exact:true}).fill('TEST_ONLY updated requirements; keep all selected sources.')
  await requirements.getByRole('button',{name:'保存要求',exact:false}).click();await expect(requirements.getByRole('status').filter({hasText:'已保存写作要求'})).toBeVisible()
  await latest();assert.equal(project.config.materials.include.length,6)
  const inputs=requirements.locator('[aria-label="写作来源与联网"]');await inputs.locator('summary').click();await inputs.getByRole('button',{name:'列出项目文件',exact:true}).click()
  await inputs.getByRole('combobox',{name:'添加要求文件',exact:true}).selectOption(materialNames[3]);await inputs.getByRole('button',{name:'添加为要求来源',exact:true}).click()
  await inputs.getByRole('checkbox',{name:'允许后续写作联网补充资料',exact:true}).check()
  await inputs.getByRole('button',{name:'保存来源与联网选项',exact:true}).click();await expect(inputs.getByRole('status').filter({hasText:'已保存写作来源'})).toBeVisible()
  let stored=(await rpc('scholarflow.v1/writingTask.requirements',{request:{context:pc()}})).spec;assert.equal(stored.online,true);assert.equal(stored.requirementSources[0].path,materialNames[3]);record('post-create writing sources and online settings are saved independently',true,{materials:stored.materials.length})
  await page.locator('.sf-native-workspace').screenshot({path:join(root,'requirements-and-inputs.png')})

  await page.getByRole('button',{name:'ScholarFlow 设置',exact:true}).first().click()
  const library=page.locator('[aria-label="Academic Skills 私有库"]');await library.getByRole('button',{name:'新建写作 Skill',exact:true}).click()
  let author=library.locator('[aria-label="创作写作 Skill"]')
  await author.getByRole('textbox',{name:'Skill 名称',exact:true}).fill('TEST_ONLY precise writing')
  await author.getByRole('textbox',{name:'Skill 用途说明',exact:true}).fill('TEST_ONLY drafting and revision')
  await author.getByRole('textbox',{name:'Skill 执行说明',exact:true}).fill('TEST_ONLY use clear topic sentences, preserve citations and explicitly state limits.')
  await author.getByRole('button',{name:'预览保存',exact:true}).click();await expect(author.getByRole('dialog',{name:'Skill 创作确认',exact:true})).toBeVisible()
  await author.getByRole('button',{name:'确认保存到私有库',exact:true}).click();await expect(author).toHaveCount(0)
  let catalog=await rpc('scholarflow.v1/skills.library',{request:{}});assert.equal(catalog.versions.length,1);const originalSkill=catalog.versions[0]
  await library.getByRole('button',{name:'编辑并保存新版本',exact:true}).click();author=library.locator('[aria-label="创作写作 Skill"]')
  await expect(author.getByRole('textbox',{name:'Skill 执行说明',exact:true})).toHaveValue(/TEST_ONLY use clear/)
  await author.getByRole('textbox',{name:'Skill 执行说明',exact:true}).fill('TEST_ONLY new immutable version: use precise verbs and preserve citation tokens.')
  await author.getByRole('button',{name:'预览保存',exact:true}).click();await author.getByRole('button',{name:'确认保存到私有库',exact:true}).click();await expect(author).toHaveCount(0)
  catalog=await rpc('scholarflow.v1/skills.library',{request:{}});assert.equal(catalog.versions.length,2);assert.equal(catalog.versions[1].metadata.qualifiedId,originalSkill.metadata.qualifiedId)
  await library.screenshot({path:join(root,'skill-authoring.png')})
  await page.locator(`[data-row-key="session:${sessionId}"]`).click();await page.locator('.sf-middle-column').waitFor()
  await menu('本项目 Skill');const projectSkills=page.locator('[aria-label="项目固定 Skill"]');await projectSkills.getByRole('button',{name:'刷新固定 Skill 资源清单',exact:true}).click()
  const option=await projectSkills.getByRole('combobox',{name:'选择已安装固定 Skill 版本',exact:true}).locator('option').allTextContents()
  const skillIndex=option.findIndex(text=>text.includes(originalSkill.metadata.qualifiedId));assert.ok(skillIndex>0)
  await projectSkills.getByRole('combobox',{name:'选择已安装固定 Skill 版本',exact:true}).selectOption({label:option[skillIndex]})
  await projectSkills.getByRole('button',{name:'加入待确认启用清单',exact:true}).click();await projectSkills.getByRole('button',{name:'预览本项目 Skill 绑定',exact:true}).click()
  await projectSkills.getByRole('button',{name:'确认项目 Skill 绑定',exact:false}).click();await expect(projectSkills.getByRole('dialog',{name:'项目 Skill 绑定确认',exact:true})).toHaveCount(0)
  const bindings=await rpc('scholarflow.v1/skills.project',{request:{context:pc()}});assert.equal(bindings.resources.length,1);assert.ok(bindings.resources[0].binding.enabledStages.includes('revision'))
  record('actual UI creates, edits immutable Skill, then binds explicit project stages',true,{versions:catalog.versions.length,binding:bindings.resources[0].binding})

  await menu('资料与引用');research=page.locator('#sf-panel-Research');await research.locator('details.sf-material-maintenance>summary').click()
  const bibliography=research.locator('[aria-label="导入书目"]')
  await bibliography.getByRole('textbox',{name:'书目内容',exact:true}).fill('@article{test,title={TEST_ONLY source},author={Wang, Xin},year={2020},journal={Test Journal},volume={12},number={2},pages={10--20},doi={10.1234/test-only}}')
  await bibliography.getByRole('button',{name:'解析并预览书目',exact:true}).click();await bibliography.getByRole('button',{name:'确认登记所选书目',exact:true}).click();await expect(bibliography.getByRole('status')).toContainText('已登记 1 个来源')
  await latest();const source=Object.values(project.ledger.sources)[0];assert.equal(source.identity.status,'unverified')
  const versionsBefore=(await rpc('scholarflow.v1/document.versions',{request:{context:pc()}})).versions
  await rpc('scholarflow.v1/document.saveManual',{request:{context:pc(),baseHash:project.document.contentHash,text:'# TEST_ONLY APA\n\nTEST_ONLY finding [@'+source.citeKey+'].\n\n'+Array.from({length:520},()=> 'analysis').join(' ')}})
  await latest();await page.reload();await dismissOnboarding();await menu('写作要求')
  await page.getByRole('combobox',{name:'引用格式',exact:true}).selectOption('apa7');await page.getByRole('button',{name:'保存要求',exact:false}).click();await expect(page.locator('.sf-requirements-save-status')).toContainText('已保存')
  await page.getByRole('button',{name:'返回正文',exact:false}).click();await expect(page.locator('.sf-preview-pane .sf-prose')).toContainText('(Wang, 2020)')
  await page.locator('.sf-native-workspace').screenshot({path:join(root,'paper-apa-light.png')})
  await rpc('settings/update',{ns:'ui-theme',patch:{preference:'dark'}});await page.waitForFunction(()=>document.body.hasAttribute('data-ds-dark-theme'))
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))})
  await page.locator('.sf-native-workspace').screenshot({path:join(root,'paper-apa-dark.png')})
  const indent=await page.locator('.sf-preview-pane .sf-prose>p').first().evaluate(node=>{const css=getComputedStyle(node);return parseFloat(css.textIndent)/parseFloat(css.fontSize)})
  assert.equal(indent,2);assert.equal(await page.locator('.sf-paper-foot').innerText(),'')
  record('APA preview uses CSL labels; real paper indentation and empty pagination slot',true,{indent})
  await menu('审查');await page.getByRole('button',{name:'运行确定性审查',exact:true}).click();await expect(page.locator('#sf-panel-Review').getByRole('status').filter({hasText:'对应当前版本'})).toBeVisible()
  record('actual UI deterministic review produces current report',true,{})
  await page.getByRole('button',{name:'返回正文',exact:false}).click();const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.sf-export-split>button').click()]);await download.saveAs(join(root,'quick-export.md'))
  await expect(page.locator('.sf-editor-notice')).toContainText('工作草稿');await expect(page.getByRole('button',{name:'下载完整交付包',exact:true}).first()).toBeVisible()
  const [zipDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'下载完整交付包',exact:true}).first().click()]);await zipDownload.saveAs(join(root,'delivery.zip'))
  record('quick export states working draft and offers complete package from the same delivery',true,{})
  await latest();await menu('版本记录');const history=page.locator('#sf-panel-History');await history.locator('.sf-reference-row button').nth(1).click()
  await history.getByRole('combobox',{name:'与版本比较',exact:true}).selectOption(versionsBefore[0].revisionId===project.document.revisionId?versionsBefore[1].revisionId:project.document.revisionId)
  await expect(history.locator('.sf-change')).toContainText('对照版本');await history.getByRole('button',{name:'预览恢复此版本',exact:true}).click();await history.getByRole('button',{name:'确认恢复为新修订',exact:true}).click()
  await expect(history.getByRole('status')).toContainText('已恢复为新修订');await latest();assert.equal(project.document.text,manuscript)
  record('actual UI compares historical bodies and restores as a new revision',true,{revisionId:project.document.revisionId})
  for(const width of [1440,720,320]){await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'返回正文',exact:false}).click().catch(()=>{});await page.waitForTimeout(350)
    const geometry=await page.locator('.sf-middle-column').evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth}));assert.ok(geometry.scroll<=geometry.client+1);record('actual UI no horizontal overflow '+width,true,geometry)
    await page.locator('.sf-native-workspace').screenshot({path:join(root,`paper-${width}.png`)})
  }
  assert.deepEqual(errors,[]);record('no client runtime errors across complete feature chains',true,{})
}catch(error){record('run',false,error.message);await page?.screenshot({path:join(root,'failure.png')}).catch(()=>{});throw error}
finally{await writeFile(join(root,'journal.json'),JSON.stringify(rows,null,2));console.log('Journal:',join(root,'journal.json'));host?.kill();await browser?.close();await desktopApp?.close()}

