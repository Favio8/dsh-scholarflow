// SF-167–171: native selection, quiet first draft, formatting and export in the installed Host.
// Fresh TEST_ONLY profile and manuscript; normal UI and export; the model RPC seam is explicitly TEST_ONLY.
import assert from 'node:assert/strict'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import {creationSpec,writingTaskSchema} from '../../src/shared/writing-task.ts'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/v16-writing-fixes', String(Date.now()))
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
  const source={title:'TEST_ONLY Alpha Study',authors:[{literal:'TEST_ONLY Author'}],kind:'paper',year:2025,identifiers:{}}
  const first=await sf('sources.register',{source}),sources=[first.source]
  for(let index=0;index<2;index++){const preview=await sf('sources.prepareRegistration',{source});const result=await sf('sources.confirmRegistration',{planId:preview.planId,planHash:preview.planHash,reason:'TEST_ONLY independent text record'});sources.push(result.source)}
  const manuscript='# TEST_ONLY 文稿\n\n## 第一章\n\n普通文字开始，**强调文字**和正常文字连在一起。引用[@'+sources[0].citeKey+']。\n\n另一段正文引用[@'+sources[1].citeKey+']。\n\n最后一段引用[@'+sources[2].citeKey+']。\n'
  await sf('document.saveManual',{text:manuscript,baseHash:(await rpc('scholarflow.v1/project.inspect',{request:{context}})).document.contentHash})
  let saved=await rpc('scholarflow.v1/project.inspect',{request:{context}})
  await sf('outline.confirm',{expectedOutlineVersion:saved.ledger.outline.version,outline:{...saved.ledger.outline,researchQuestion:'TEST_ONLY question',thesis:'TEST_ONLY thesis',sections:[{id:'section_first',title:'第一章',purpose:'TEST_ONLY purpose',claimIds:[],missingEvidence:['TEST_ONLY unprovided evidence']}]}})
  saved=await rpc('scholarflow.v1/project.inspect',{request:{context}})
  const spec=creationSpec.parse({title:'TEST_ONLY 文稿',type:'course-paper',language:'zh-CN',format:'docx',requirements:'TEST_ONLY 按资料组织初稿',targetLength:1500,materials:[],sections:[{id:'section_first',title:'第一章',targetLength:1500}],online:false,manuscriptDir:saved.config.paths.manuscriptDir})
  const task=writingTaskSchema.parse({schemaVersion:1,id:'writing_v16_test',projectId:saved.binding.projectId,sessionId,mode:'first-draft',status:'completed',stage:'completed',revision:1,spec,materialIndex:0,sectionIndex:1,usedModelCalls:0,usedSearchQueries:0,elapsedMs:0,owner:'TEST_ONLY',expectedDocumentHash:saved.document.contentHash,questions:[],notes:['TEST_ONLY old interruption'],issues:[],onlineSources:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
  const writing=join(workspacePath,'.scholarflow/writing');await mkdir(join(writing,'tasks'),{recursive:true})
  await writeFile(join(writing,'requirements.json'),JSON.stringify({schemaVersion:1,projectId:saved.binding.projectId,spec}))
  await writeFile(join(writing,'tasks',task.id+'.json'),JSON.stringify(task));await writeFile(join(writing,'current.json'),JSON.stringify({taskId:task.id,projectId:saved.binding.projectId}))
  await page.reload();await dismissOnboarding();await page.locator('.sf-format-toolbar').waitFor()

  if(process.argv.includes('--presentation-only')){
    await sf('sources.linkBibliography',{primaryId:sources[0].id,sourceIds:sources.map(row=>row.id)})
    await page.reload();await dismissOnboarding();await page.locator('.sf-format-toolbar').waitFor()
    if(!process.argv.includes('--checks-layout-only')){
    await page.locator('summary[aria-label="更多论文选项"]').click();await page.getByRole('button',{name:'写作要求',exact:true}).click()
    const fields=await page.locator('.sf-requirements-panel>.sf-form .sf-field-control').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().left))
    assert(Math.max(...fields)-Math.min(...fields)<1)
    await page.locator('.sf-requirements-panel').screenshot({path:join(root,'requirements.png')})
    await page.getByText('文风与写作模板',{exact:true}).click()
    await expect(page.getByLabel('文风模板',{exact:true})).toContainText('中文')
    await page.getByLabel('文风模板',{exact:true}).selectOption('0')
    await page.getByRole('button',{name:'应用文风',exact:true}).click();await expect(page.getByRole('region',{name:'文风与写作模板'})).toContainText('文风已应用')
    const template=page.getByRole('region',{name:'文风与写作模板'}).locator('input[type=checkbox]').first()
    await template.click();await page.getByRole('button',{name:'应用写作模板',exact:true}).click()
    await expect(page.getByRole('region',{name:'文风与写作模板'})).toContainText('写作模板已应用')
    record('aligned writing fields and real project style/template adoption',true,{fields})
    }
    await sf('review.run');await page.reload();await dismissOnboarding();await page.getByRole('button',{name:'检查',exact:true}).click()
    await expect(page.locator('.sf-review-item')).toHaveCount(3)
    await expect(page.locator('.sf-review-item').filter({hasText:'AI 内容检查尚未完成'})).toHaveCount(1)
    const presentation=await page.locator('.sf-review-action').evaluate(node=>({border:getComputedStyle(node).borderTopWidth,font:getComputedStyle(node.closest('.sf-review-panel')).fontFamily}))
    assert.equal(presentation.border,'0px');assert(presentation.font.includes('sans-serif'))
    await page.screenshot({path:join(root,'checks.png'),fullPage:true});record('compact check results aggregate five unrun assessments without a framed action form',true,presentation)
    await page.setViewportSize({width:920,height:900})
    assert(await page.locator('.sf-review-panel').evaluate(node=>node.scrollWidth<=node.clientWidth))
    await page.screenshot({path:join(root,'checks-narrow.png'),fullPage:true});record('narrow check page fits without horizontal overflow',true,{width:920})
  }else{
  if(!process.argv.includes('--remaining-only')){
  await page.locator('summary[aria-label="更多论文选项"]').click()
  assert.deepEqual(await page.locator('.sf-paper-toolbar .sf-paper-menu-popover button').allTextContents(),['写作要求','项目设置','版本历史'])
  await page.locator('summary[aria-label="更多论文选项"]').click()
  assert.equal(await page.locator('.sf-format-toolbar select').count(),2)
  record('three menu entries and compact format toolbar',true,{})

  const prose=page.locator('.sf-paper-page .sf-prose>p').first();await prose.scrollIntoViewIfNeeded()
  const points=await prose.evaluate(node=>{const text=node.querySelector('[data-sf-leaf]').firstChild;const point=index=>{const range=new Range();range.setStart(text,index);range.setEnd(text,index+1);const rect=range.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}};return {from:point(0),to:point(5)}})
  await page.mouse.move(points.from.x,points.from.y);await page.mouse.down();await page.mouse.move(points.to.x,points.to.y,{steps:10});await page.mouse.up()
  await expect(page.getByRole('button',{name:'加粗',exact:true})).toBeEnabled()
  const selected=await page.evaluate(()=>window.getSelection().toString());assert(selected.startsWith('普通'))
  await page.getByRole('button',{name:'加粗',exact:true}).click()
  await expect(prose.locator('strong').first()).toContainText('普通')
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),selected)
  await page.getByRole('button',{name:'加粗',exact:true}).click()
  assert(!(await prose.locator('strong').allTextContents()).some(text=>text.includes('普通')))
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),selected)
  record('real pointer selection becomes bold and toggles off while preserving its range',true,{selected})

  const input=page.locator('.sf-source-input')
  await page.getByRole('button',{name:'编辑',exact:true}).click()
  const currentText=await input.inputValue(),start=currentText.indexOf('普通'),end=currentText.indexOf('另一段正文')+'另一段正文'.length
  await input.evaluate((area,range)=>{area.focus();area.setSelectionRange(range.start,range.end);area.dispatchEvent(new Event('select',{bubbles:true}))},{start,end})
  await page.getByRole('button',{name:'加粗',exact:true}).click()
  await page.getByRole('button',{name:'预览',exact:true}).click()
  const paragraphs=page.locator('.sf-paper-page .sf-prose>p')
  await expect(paragraphs.nth(1).locator('strong').first()).toContainText('另一段正文')
  assert(!(await page.locator('.sf-prose').innerText()).includes('**'))
  await page.locator('.sf-format-toolbar').getByRole('button',{name:'保存',exact:true}).click()
  await expect(page.locator('.sf-draft-status')).toContainText('已保存')
  saved=await rpc('scholarflow.v1/project.inspect',{request:{context}})
  const keys=saved.document.text.match(/\[@sf_[^\]]+\]/g);assert.equal(keys.length,3)
  await page.reload();await dismissOnboarding();await expect(page.locator('.sf-paper-page .sf-prose>p').nth(1).locator('strong').first()).toContainText('另一段正文')
  record('cross-paragraph formatting saves and reopens without literal stars or changed citations',true,{})

  // v1.16 moved 资料 out of the 更多论文选项 menu; it is a flow-nav target now.
  await page.locator('.sf-flow-nav [data-node="materials"]').click()
  await expect(page.locator('#sf-panel-Research')).toBeVisible()
  await expect(page.locator('.sf-reference-row[data-sf-source-id]')).toHaveCount(3)
  await page.getByRole('button',{name:'确认是同一篇论文',exact:true}).click()
  await expect(page.locator('.sf-reference-row[data-sf-source-id]')).toHaveCount(1)
  let state=await rpc('scholarflow.v1/project.inspect',{request:{context}});assert.equal(Object.keys(state.ledger.sources).length,3)
  await expect(page.locator('.sf-writing-progress')).toBeHidden()
  await page.getByRole('button',{name:'返回正文',exact:true}).click()
  await expect(page.locator('.sf-paper-references>p')).toHaveCount(1)
  record('one confirmation groups three references without deleting source records',true,{records:3,bibliography:1})

  }else{
    await sf('sources.linkBibliography',{primaryId:sources[0].id,sourceIds:sources.map(row=>row.id)})
    await sf('document.saveManual',{text:manuscript.replace('另一段正文','**另一段正文**'),baseHash:(await rpc('scholarflow.v1/project.inspect',{request:{context}})).document.contentHash})
    await page.reload();await dismissOnboarding();await page.locator('.sf-format-toolbar').waitFor()
  }
  await page.locator('.sf-chapter-nav>summary').click()
  await page.getByRole('button',{name:'调整章节结构',exact:true}).click()
  await expect(page.locator('.sf-outline-panel')).toBeVisible()
  await expect(page.locator('.sf-outline-panel')).toContainText('第一章')
  await page.locator('.sf-outline-panel').getByRole('button',{name:'编辑',exact:true}).first().click()
  await page.getByLabel('章节目的',{exact:true}).fill('TEST_ONLY updated purpose')
  await page.getByRole('button',{name:'保留章节修改',exact:true}).click()
  await page.getByRole('button',{name:'保存结构',exact:true}).click()
  await expect(page.locator('.sf-outline-panel')).toContainText('已保存')
  assert.equal((await rpc('scholarflow.v1/project.inspect',{request:{context}})).ledger.outline.sections[0].purpose,'TEST_ONLY updated purpose')
  await page.locator('.sf-outline-panel').getByRole('button',{name:'返回正文',exact:true}).click()
  record('chapter structure is available from the manuscript directory',true,{})

  // The model half cannot run in this profile (no provider credential), and letting the Host try makes
  // the wait depend on the provider timeout — one run sat in 正在检查 for over a minute. So the seam
  // controls exactly two things: a plan id and an interrupted run. Everything asserted below is the real
  // Host's: the rules check it ran (SF-167) and the readable result with no internal fields or selects
  // (SF-171). The successful model path is covered by v19-ai-review with the in-process seam.
  const reviewCalls=[]
  page.on('request',request=>{try{const method=request.postDataJSON?.()?.method;if(typeof method==='string'&&method.startsWith('scholarflow.v1/review.'))reviewCalls.push(method.replace('scholarflow.v1/review.',''))}catch{/* not a JSON body */}})
  // The two stubs have to answer without touching the model path, and the connection layer validates the
  // whole envelope, not just `result` — so the skeleton (status, headers, the envelope's own fields) comes
  // from one cheap real call and only `result` is replaced.
  const skeleton=await page.evaluate(async request=>{const response=await fetch('api/scholarflow.v1/project.inspect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'scholarflow.v1/project.inspect',payload:{args:{request}}})})
    const headers=Object.fromEntries([...response.headers.entries()].filter(([name])=>!/^(content-length|transfer-encoding|content-encoding)$/i.test(name)))
    return {status:response.status,headers,body:await response.json()}},{context})
  const answer=(route,data)=>{const sent=route.request().postDataJSON()??{};return route.fulfill({status:skeleton.status,headers:skeleton.headers,body:JSON.stringify({...skeleton.body,rpcId:sent.rpcId,method:sent.method,result:{ok:true,value:{ok:true,data}}})})}
  await page.route('**/api/scholarflow.v1/review.prepareModel',route=>answer(route,{planId:'plan_TEST_ONLY',planHash:'sha256:'+'1'.repeat(64),runId:'run_TEST_ONLY'}))
  await page.route('**/api/scholarflow.v1/review.startModel',async route=>{const current=await rpc('scholarflow.v1/review.inspect',{request:{context}});await answer(route,{run:{status:'failed'},report:current.report})})
  await page.locator('.sf-flow-nav [data-node="review"]').click()
  await page.getByRole('button',{name:'一键检查并完善',exact:true}).click()
  await expect(page.locator('.sf-review-assistant')).toContainText('检查中断，已有结果已保留',{timeout:30000})
  for(const method of ['run','prepareModel','startModel'])assert(reviewCalls.includes(method),`${method} was never requested`)
  assert(reviewCalls.indexOf('run')<reviewCalls.indexOf('prepareModel')&&reviewCalls.indexOf('prepareModel')<reviewCalls.indexOf('startModel'),'the rules check has to precede the model review')
  await page.locator('.sf-review-details>summary').click()
  const checkText=await page.locator('#sf-panel-Review').innerText();assert(!/src_|review_|deterministic|人工复核|人工判断项|pass ·/.test(checkText))
  const issues=await page.locator('.sf-review-item').allTextContents()
  assert(issues.some(text=>text.includes('参考文献')),'the bibliography issue has to be listed once the rules ran')
  assert.equal(issues.filter(text=>text.includes('参考文献')).length,1)
  assert.equal(await page.locator('#sf-panel-Review select').count(),0)
  await expect(page.locator('.sf-writing-progress')).toBeHidden()
  await page.screenshot({path:join(root,'checks.png'),fullPage:true})
  record('one check action runs the rules in the Host and keeps a single readable bibliography issue',true,{reviewCalls})
  await page.unroute('**/api/scholarflow.v1/review.prepareModel'); await page.unroute('**/api/scholarflow.v1/review.startModel')

  await page.getByRole('button',{name:'返回正文',exact:true}).click()
  await page.getByLabel('排版与导出格式',{exact:true}).selectOption('docx')
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Word',exact:true}).click()
  const download=await downloading,path=join(root,'verified-paper.docx');await download.saveAs(path)
  const zip=await JSZip.loadAsync(await readFile(path)),xml=await zip.file('word/document.xml').async('string')
  assert.equal((xml.match(/TEST_ONLY Alpha Study/g)||[]).length,1)
  const run=xml.split('</w:r>').find(value=>value.includes('>另一段正文<'));assert(run&&run.includes('<w:b/>'))
  await page.screenshot({path:join(root,'workbench.png'),fullPage:true})
  record('normal Word export keeps selected bold text and one bibliography entry',true,{path})
  }
  assert.equal(errors.length,0)
  await writeFile(join(root,'report.json'),JSON.stringify({checks:rows,pageErrors:errors,paidModelCalls:0,modelSeam:process.argv.includes('--presentation-only')?'not called':'TEST_ONLY RPC responses',root},null,2))
}catch(error){await writeFile(join(root,'failure.txt'),String(error.stack));if(page){await page.screenshot({path:join(root,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(root,'failure-page.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}finally{if(desktopApp)await desktopApp.close();if(browser)await browser.close();if(host)host.kill()}
console.log(JSON.stringify({passed:rows.filter(row=>row.ok).length,total:rows.length,root}))
