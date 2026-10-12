// SF-172–174: native selection, quiet first draft, formatting and export in the installed Host.
// Fresh TEST_ONLY profile and manuscript; normal UI, real saved choices and layout; no model calls.
import assert from 'node:assert/strict'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import {creationSpec,writingTaskSchema} from '../../src/shared/writing-task.ts'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/v17-layout', String(Date.now()))
const nativeDesktop = process.argv.includes('--desktop')
const profile = join(root, nativeDesktop ? 'profiles/desktop' : 'profiles/mark-test')
const workspacePath = join(root, 'Mark TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
if (nativeDesktop) await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 19401\n')
const host = nativeDesktop ? undefined : spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'mark-test', '--no-open', '--port', '0'], {
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
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`) }
let page
try {
  if (nativeDesktop) {
    const env = { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write' }; delete env.ELECTRON_RUN_AS_NODE
    desktopApp = await electron.launch({ executablePath: join(install, 'DeepSeek Harness.exe'), args: [`--user-data-dir=${join(root, 'electron')}`], env })
    page = await desktopApp.firstWindow()
    await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor({ timeout: 45000 })
    await desktopApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) { window.setSize(1440, 960); window.showInactive() }
    })
  } else page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  if (!nativeDesktop) await page.goto(await url)
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
  const requirementFiles=['作业要求/1.txt','作业要求/2.txt','作业要求/3.txt']
  const materialFiles=['报告笔记.md','Graph_Convolution_Based_Decoupling_and_Consistency_Driven_Fusion_for_Multimodal_Emotion_Recognition_2025_完整文献阅读报告与比较笔记.md']
  await mkdir(join(workspacePath,'作业要求'),{recursive:true})
  for(const file of [...requirementFiles,...materialFiles])await writeFile(join(workspacePath,file),'TEST_ONLY layout fixture. No academic claims.')
  const workspaceId = (await rpc('workspace/create', { request: { path: workspacePath } })).workspace.workspaceId
  await page.reload(); await dismissOnboarding()
  await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover()
  const [created] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.method === 'session/create'),
    page.locator('button[aria-label*="Mark TEST_ONLY"][aria-label*="中新建会话"]').click()
  ])
  const sessionId = (await created.json()).result.value.sessionId
  await page.locator(`[data-row-key="session:${sessionId}"][aria-selected="true"]`).waitFor()
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.locator('[class*="_item_"]').filter({ hasText: /^ScholarFlow/ }).click()
  await page.locator('.sf-wizard').waitFor()
  const context = { requestId: 'req_mark_TEST_ONLY', workspaceId, sessionId }
  const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'Mark TEST_ONLY', type: 'course-paper' } } })
  await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
  const project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  const sf=async(method,data={})=>{const live=await rpc('scholarflow.v1/project.inspect',{request:{context}});return rpc('scholarflow.v1/'+method,{request:{context:{...context,projectId:live.binding.projectId,expectedLedgerRevision:live.ledger.revision},...data}})}
  let saved=await rpc('scholarflow.v1/project.inspect',{request:{context}})
  const spec=creationSpec.parse({title:'TEST_ONLY 布局示例',type:'course-paper',language:'zh-CN',format:'docx',requirements:'TEST_ONLY 要求页布局，包含多个文件、长文件名和封面。',targetLength:1500,materials:materialFiles,sections:[{id:'sec_TEST_ONLY',title:'正文',targetLength:1500}],online:false,manuscriptDir:saved.config.paths.manuscriptDir,
    requirementSources:[{resourceId:'req_TEST_ONLY',origin:'workspace',kind:'folder',path:'作业要求',role:'assignment',state:'selected',members:requirementFiles.map(name=>({name,size:45}))}],
    cover:{enabled:true,title:'TEST_ONLY 布局示例',fields:[{label:'姓名',value:'TEST_ONLY 作者'},{label:'学号',value:'TEST_ONLY 001'}]}})
  const writing=join(workspacePath,'.scholarflow/writing');await mkdir(writing,{recursive:true})
  await writeFile(join(writing,'requirements.json'),JSON.stringify({schemaVersion:1,projectId:saved.binding.projectId,spec}))
  const currentRequirements=await sf('writingTask.requirements')
  await sf('writingTask.inputs',{baseSpecHash:currentRequirements.baseSpecHash,baseMaterials:saved.config.materials.include,materials:materialFiles,requirementSources:spec.requirementSources,online:false})
  await page.reload();await dismissOnboarding();await page.locator('.sf-paper-toolbar').waitFor()
  if(process.argv.includes('--choices-only')){
    await page.locator('summary[aria-label="更多论文选项"]').click();await page.getByRole('button',{name:'写作要求',exact:true}).click()
    const panel=page.locator('.sf-requirements-panel'),inputs=page.locator('details[aria-label="写作来源与联网"]')
    await inputs.locator('summary').click();await panel.getByText('文风与写作模板',{exact:true}).click()
    const options=page.getByRole('region',{name:'文风与写作模板'});await expect(options.getByText('研究结果核验',{exact:true})).toBeVisible()
    const positions=await options.locator('.sf-check input').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().left))
    assert(Math.max(...positions)-Math.min(...positions)<1)
    record('template checkboxes share one left alignment instead of individually centering',true,{positions})
    await page.setViewportSize({width:1440,height:1000})
    await inputs.scrollIntoViewIfNeeded();await page.screenshot({path:join(root,'sources-wide.png')})
    await options.scrollIntoViewIfNeeded();await page.screenshot({path:join(root,'templates-wide.png')})
    // Exercise the component's real available width, independently of the Host shell minimum.
    await page.setViewportSize({width:1000,height:1000});await panel.evaluate(node=>{node.style.width='440px'})
    assert.equal(await panel.evaluate(node=>Math.round(node.getBoundingClientRect().width)),440)
    assert(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1))
    const form=await panel.locator(':scope>.sf-form').evaluate(node=>getComputedStyle(node).gridTemplateColumns)
    assert(!form.includes(' '),'The component switches to a single field column at its own width')
    const choices=await panel.locator('.sf-check').evaluateAll(nodes=>nodes.map(node=>{const input=node.querySelector('input').getBoundingClientRect(),text=node.querySelector('span').getBoundingClientRect();return {direction:getComputedStyle(node).flexDirection,delta:Math.abs(input.top-text.top),width:node.scrollWidth,available:node.clientWidth}}))
    assert(choices.every(row=>row.direction==='row'&&row.delta<=4&&row.width<=row.available+1))
    await inputs.scrollIntoViewIfNeeded();await page.screenshot({path:join(root,'sources-narrow.png')})
    await options.scrollIntoViewIfNeeded();await page.screenshot({path:join(root,'templates-narrow.png')})
    await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''));await page.screenshot({path:join(root,'dark.png')})
    record('440px content uses one field column while preserving horizontal choices and long-name wrapping',true,{form,choices:choices.length})
  }else{
  if(!process.argv.includes('--remaining-only')){
  // v1.19 moved the redundant right-hand entries into the more menu; v1.20 turned the progress report
  // into a pill beside it. What still matters here is that the trailing controls hug the right edge
  // on one line and that the five nodes sit between the view switcher and that group. The pill
  // collapses to a zero-width grid column when no task is running, so it is only asserted when it
  // actually has a box — asserting against a 0,0,0 rect would fail on a healthy layout.
  const navigation=await page.locator('.sf-paper-toolbar').evaluate(node=>{const box=element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,width:rect.width,center:rect.y+rect.height/2}};const pill=node.querySelector('.sf-toolbar-progress');return {toolbar:box(node),views:box(node.querySelector('.sf-paper-views')),flow:box(node.querySelector('.sf-flow-nav')),more:box(node.querySelector('.sf-paper-menu>summary')),pillHasBox:!!pill&&pill.getBoundingClientRect().width>0,pillRight:pill?pill.getBoundingClientRect().right:0}})
  assert(navigation.more.left>navigation.toolbar.left+(navigation.toolbar.right-navigation.toolbar.left)*.7)
  assert(navigation.flow.left>navigation.views.right)
  assert(!navigation.pillHasBox||navigation.flow.right<=navigation.pillRight+1)
  assert(Math.abs(navigation.more.center-navigation.toolbar.center)<=1)
  record('manuscript tools are contiguous at the right edge',true,navigation)
  await page.screenshot({path:join(root,'navigation.png'),fullPage:true})
  // v1.20 (SF-186/SF-187): formatting, typography, the directory and the reading ratio share the one
  // editor bar, and a single view no longer pays for a pane caption band.
  const editorBar=page.locator('.sf-format-toolbar')
  const editorRow=await editorBar.evaluate(node=>{const rects=[...node.children].map(child=>child.getBoundingClientRect())
    const centers=rects.map(rect=>rect.top+rect.height/2)
    return {wrap:getComputedStyle(node).flexWrap,centerSpread:centers.length?Math.round(Math.max(...centers)-Math.min(...centers)):0,
    overflow:node.scrollWidth-node.clientWidth,
    controls:{bold:!!node.querySelector('[aria-label="加粗"]'),typography:!!node.querySelector('.sf-format-settings'),directory:!!node.querySelector('.sf-chapter-nav>summary'),zoom:!!node.querySelector('.sf-pane-zoom')}}})
  // align-items:center makes equal tops the wrong test for "one row" — a shorter control sits lower.
  // The vertical centre of every control is what has to line up.
  assert.equal(editorRow.wrap,'nowrap');assert(editorRow.centerSpread<=2);assert(editorRow.overflow<=1)
  assert(Object.values(editorRow.controls).every(Boolean))
  for(const view of ['编辑','预览']){
    await page.locator('.sf-paper-views').getByRole('button',{name:view,exact:true}).click()
    assert.equal(await page.locator('.sf-pane-caption').evaluateAll(nodes=>Math.max(...nodes.map(node=>Math.round(node.getBoundingClientRect().height)))),0)
  }
  await page.locator('.sf-paper-views').getByRole('button',{name:'编辑',exact:true}).click()
  await editorBar.locator('.sf-chapter-nav>summary').click()
  const chapters=await editorBar.locator('.sf-chapter-nav button').allTextContents()
  assert(chapters.some(text=>text.trim()==='调整章节结构'),'the directory entry must stay in the editor bar')
  await editorBar.getByRole('button',{name:'调整章节结构',exact:true}).click()
  await expect(page.locator('.sf-outline-panel')).toBeVisible()
  await page.locator('.sf-outline-panel').getByRole('button',{name:'返回正文',exact:true}).click()
  record('one editor bar keeps formatting, typography, directory, reading ratio on a single row',true,{editorRow,chapters:chapters.length})
  }
  await page.locator('summary[aria-label="更多论文选项"]').click();await page.getByRole('button',{name:'写作要求',exact:true}).click()
  const panel=page.locator('.sf-requirements-panel')
  if(!process.argv.includes('--remaining-only')){
  const collapsed=await panel.evaluate(node=>{const sections=node.querySelector('.sf-requirements-sections'),form=node.querySelector(':scope>.sf-form'),headers=[...node.querySelectorAll('.sf-settings-section>summary')];return {gap:sections.getBoundingClientRect().top-form.getBoundingClientRect().bottom,heights:headers.map(element=>element.getBoundingClientRect().height),open:headers.map(element=>element.parentElement.open)}})
  assert(collapsed.gap>=23);assert(collapsed.heights.every(height=>height>=40));assert(collapsed.open.every(value=>value===false))
  const columns=await panel.locator('.sf-form .sf-field-control>input').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().left))
  assert(Math.max(...columns)-Math.min(...columns)<1)
  record('collapsed sections have breathing room and cover fields share the form grid',true,{collapsed,columns})
  await panel.screenshot({path:join(root,'collapsed.png')})
  }

  await panel.getByText('要求来源、参考资料与联网',{exact:true}).click()
  await panel.getByText('文风与写作模板',{exact:true}).click()
  const options=page.getByRole('region',{name:'文风与写作模板'});await expect(options.getByText('基于证据写作',{exact:true})).toBeVisible()
  const inspectChoices=()=>panel.locator('.sf-check').evaluateAll(nodes=>nodes.map(node=>{const input=node.querySelector('input').getBoundingClientRect(),text=node.querySelector('span').getBoundingClientRect();return {label:node.textContent,direction:getComputedStyle(node).flexDirection,delta:Math.abs(input.top-text.top),width:node.scrollWidth,available:node.clientWidth,textHeight:text.height}}))
  if(!process.argv.includes('--remaining-only')){
  const expanded=await inspectChoices();assert(expanded.length>=10);assert(expanded.every(row=>row.direction==='row'&&row.delta<=4&&row.width<=row.available+1))
  const spacing=await panel.locator('.sf-settings-section').first().evaluate(node=>({gap:node.querySelector('.sf-settings-section-body').getBoundingClientRect().top-node.querySelector('summary').getBoundingClientRect().bottom,footerMargin:getComputedStyle(node.querySelector('footer')).marginTop}))
  assert(spacing.gap>=15);assert(parseFloat(spacing.footerMargin)>=24)
  assert.deepEqual(await options.locator('.sf-choice-list .sf-check span').allTextContents(),['基于证据写作','选区改写','文献综合','研究结果核验'])
  record('expanded files and templates keep checkboxes beside their text',true,{choices:expanded.length,spacing})
  await panel.screenshot({path:join(root,'expanded.png')})
  }

  await page.getByRole('region',{name:'参考资料',exact:true}).getByLabel('报告笔记.md',{exact:true}).uncheck()
  await page.getByRole('button',{name:'保存来源与联网选项',exact:true}).click()
  await expect(page.getByRole('group',{name:'写作来源与联网'}).or(page.locator('details[aria-label="写作来源与联网"]'))).toContainText('已保存写作来源')
  saved=await rpc('scholarflow.v1/project.inspect',{request:{context}});assert.deepEqual(saved.config.materials.include,[materialFiles[1]])
  await options.getByLabel('基于证据写作',{exact:true}).check();await options.getByRole('button',{name:'应用写作模板',exact:true}).click()
  await expect(options).toContainText('写作模板已应用')
  assert((await sf('skills.project')).resources.some(row=>row.binding.qualifiedId==='builtin:evidence-grounded-writing'))
  await page.getByLabel('姓名',{exact:true}).fill('TEST_ONLY 更新作者')
  await page.getByRole('button',{name:'保存要求',exact:true}).click();await expect(panel).toContainText('已保存写作要求')
  await page.reload();await dismissOnboarding();await page.locator('.sf-paper-toolbar').waitFor()
  await page.locator('summary[aria-label="更多论文选项"]').click();await page.getByRole('button',{name:'写作要求',exact:true}).click()
  await expect(page.getByLabel('姓名',{exact:true})).toHaveValue('TEST_ONLY 更新作者')
  await panel.getByText('要求来源、参考资料与联网',{exact:true}).click();await panel.getByText('文风与写作模板',{exact:true}).click()
  await expect(options.getByLabel('基于证据写作',{exact:true})).toBeChecked()
  await page.getByRole('button',{name:'刷新文件列表',exact:true}).click()
  await expect(page.getByRole('region',{name:'参考资料',exact:true}).getByLabel('报告笔记.md',{exact:true})).not.toBeChecked()
  record('material selection, original template identity and cover edits save and reopen',true,{})

  await page.setViewportSize({width:800,height:1000})
  const narrow=await inspectChoices();assert(narrow.every(row=>row.direction==='row'&&row.delta<=4&&row.width<=row.available+1))
  assert(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1))
  const longPath=await page.getByRole('region',{name:'参考资料',exact:true}).getByLabel(materialFiles[1],{exact:true}).locator('..').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth,height:node.querySelector('span').getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(node.querySelector('span')).lineHeight)}))
  assert(longPath.scroll<=longPath.width+1);assert(longPath.height>longPath.lineHeight*1.5)
  await panel.screenshot({path:join(root,'narrow.png')})
  await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''))
  await panel.screenshot({path:join(root,'dark.png')})
  assert(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1))
  record('narrow layout wraps long names and keeps horizontal checkbox rows in both themes',true,{longPath})
  }
  assert.equal(errors.length,0)
  await writeFile(join(root,'report.json'),JSON.stringify({checks:rows,pageErrors:errors,paidModelCalls:0,root},null,2))
}catch(error){await writeFile(join(root,'failure.txt'),String(error.stack));if(page){await page.screenshot({path:join(root,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(root,'failure-page.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}finally{if(desktopApp)await desktopApp.close();if(browser)await browser.close();if(host)host.kill()}
console.log(JSON.stringify({passed:rows.filter(row=>row.ok).length,total:rows.length,root}))
