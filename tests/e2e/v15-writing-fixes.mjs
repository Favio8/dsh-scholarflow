// SF-161–166: native selection, quiet first draft, formatting and export in the installed Host.
// Fresh TEST_ONLY profile and manuscript; normal UI and export, zero model calls.
import assert from 'node:assert/strict'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import {creationSpec,writingTaskSchema} from '../../src/shared/writing-task.ts'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/v15-writing-fixes', String(Date.now()))
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
  const first=await sf('sources.register',{source:{title:'TEST_ONLY Alpha Study',authors:[{literal:'TEST_ONLY Author'}],kind:'paper',year:2025,identifiers:{}}})
  const second=await sf('sources.register',{source:{title:'TEST_ONLY Beta Study',authors:[{literal:'TEST_ONLY Author'}],kind:'paper',year:2025,identifiers:{}}})
  const paragraph='普通文字开始，**强调文字**和正常文字连在一起，中文阅读需要清晰而稳定的选择。'
  const manuscript=`# TEST_ONLY 文稿\n\n## 第一章\n\n${paragraph}引用[@${first.source.citeKey}]。\n\n另一段正文引用[@${second.source.citeKey}]。\n\n### 小节\n\n最后一段。\n`
  await sf('document.saveManual',{text:manuscript,baseHash:(await rpc('scholarflow.v1/project.inspect',{request:{context}})).document.contentHash})
  const saved=await rpc('scholarflow.v1/project.inspect',{request:{context}})
  const spec=creationSpec.parse({title:'TEST_ONLY 文稿',type:'course-paper',language:'zh-CN',format:'docx',requirements:'TEST_ONLY 按资料组织初稿',targetLength:1500,materials:[],sections:[{id:'section_first',title:'第一章',targetLength:1500}],online:false,manuscriptDir:saved.config.paths.manuscriptDir})
  const task=writingTaskSchema.parse({schemaVersion:1,id:'writing_v15_test',projectId:saved.binding.projectId,sessionId,mode:'first-draft',status:'completed',stage:'completed',revision:1,spec,materialIndex:0,sectionIndex:1,usedModelCalls:0,usedSearchQueries:0,elapsedMs:0,owner:'TEST_ONLY',expectedDocumentHash:saved.document.contentHash,questions:[],notes:['本次执行未完成：旧问题（出现 66 次）'],issues:[],onlineSources:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deferredIssues:[{kind:'generation',message:'TEST_ONLY 历史生成提示'}]})
  const writing=join(workspacePath,'.scholarflow/writing');await mkdir(join(writing,'tasks'),{recursive:true})
  await writeFile(join(writing,'requirements.json'),JSON.stringify({schemaVersion:1,projectId:saved.binding.projectId,spec}))
  await writeFile(join(writing,'tasks',task.id+'.json'),JSON.stringify(task));await writeFile(join(writing,'current.json'),JSON.stringify({taskId:task.id,projectId:saved.binding.projectId}))
  await page.reload();await dismissOnboarding();await page.locator('.sf-format-toolbar').waitFor()
  if(!process.argv.includes('--delivery-only')){
  await expect(page.locator('.sf-preview-pane')).toBeVisible()
  record('preview is default and split is absent from the primary toolbar',await page.locator('.sf-paper-views').getByRole('button').count()===2,{views:await page.locator('.sf-paper-views').innerText()})
  await page.locator('.sf-review-checklist>summary').click()
  const progressText=await page.locator('.sf-writing-progress').innerText()
  assert(!/66|本次执行未完成|技术详情|src_/.test(progressText));record('completed first draft shows current checks without old logs',true,{text:progressText})
  await page.locator('.sf-review-checklist>summary').click()
  const prose=page.locator('.sf-paper-page .sf-prose>p').first()
  await prose.scrollIntoViewIfNeeded()
  const points=await prose.evaluate(node=>{const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),texts=[];for(let t=walker.nextNode();t;t=walker.nextNode())texts.push(t)
    const rect=(t,i)=>{const r=new Range();r.setStart(t,i);r.setEnd(t,i+1);const box=r.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}}
    return {from:rect(texts[0],0),to:rect(texts[2],8)}
  })
  assert.equal(await prose.evaluate(node=>getComputedStyle(node).userSelect),'text');
  await page.mouse.move(points.from.x,points.from.y);await page.mouse.down();await page.mouse.move(points.to.x,points.to.y,{steps:12});await page.mouse.up()
  await page.waitForTimeout(150)
  let selection=await page.evaluate(()=>window.getSelection()?.toString())
  assert(selection&&selection.includes('强调文字'));assert(!await page.locator('.sf-draft-status').innerText().then(text=>text.includes('映射')))
  assert.equal(await page.locator('.sf-mark-inline').count(),0)
  record('continuous mouse selection crosses emphasis without mixed colours or mapping errors',true,{selection})
  await page.getByLabel('选中文字中文字体',{exact:true}).selectOption('楷体')
  await page.getByLabel('选中文字字号',{exact:true}).selectOption('14')
  await page.locator('.sf-format-toolbar').getByRole('button',{name:'保存',exact:true}).click()
  await expect(page.locator('.sf-draft-status')).toContainText('已保存')
  let state=await rpc('scholarflow.v1/project.inspect',{request:{context}})
  assert(state.document.formatting.characters.some(row=>row.fontZh==='楷体'&&row.sizePt===14))
  await page.reload();await dismissOnboarding();await page.locator('.sf-format-toolbar').waitFor()
  const styled=await page.locator('.sf-prose [data-sf-leaf]>span').evaluateAll(nodes=>nodes.map(node=>({font:getComputedStyle(node).fontFamily,size:getComputedStyle(node).fontSize})))
  assert(styled.some(row=>row.font.includes('楷体')&&parseFloat(row.size)>18))
  record('selected font and size survive saving and reopening',true,{styled})
  await page.getByRole('button',{name:'编辑',exact:true}).click();const input=page.locator('.sf-source-input');await input.evaluate((el,start)=>{el.focus();el.setSelectionRange(start,start+8)},manuscript.indexOf('普通'))
  await page.getByRole('button',{name:'预览',exact:true}).click();assert.equal(await page.locator('.sf-mark-inline').count(),0);assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'')
  record('switching from editor to preview clears the ordinary selection',true,{rainbowMarks:0})
  }else{await sf('document.saveManual',{text:manuscript,baseHash:saved.document.contentHash,formatting:{characters:[{start:manuscript.indexOf('普通'),end:manuscript.indexOf('普通')+4,fontZh:'楷体',sizePt:14}],paragraphs:[]}});await page.reload();await dismissOnboarding();await page.locator('.sf-format-toolbar').waitFor()}
  let state
  await page.getByRole('button',{name:'全文排版',exact:true}).click();const panel=page.locator('.sf-formatting-panel');await panel.getByLabel('页边距（毫米）').fill('30');await panel.getByLabel('行距',{exact:true}).selectOption('1.5');await panel.getByLabel('页眉',{exact:true}).fill('TEST_ONLY 页眉');await panel.getByLabel('页脚',{exact:true}).fill('TEST_ONLY 页脚')
  await panel.getByRole('button',{name:'应用全文排版'}).click();await expect(panel).toHaveCount(0)
  await page.locator('summary[aria-label="更多论文选项"]').click();await page.getByRole('button',{name:'资料与引用',exact:true}).click()
  await page.locator('.sf-materials-panel [data-sf-source-id] input').nth(0).check();await page.locator('.sf-materials-panel [data-sf-source-id] input').nth(1).check();await page.getByLabel('关联后的主书目').selectOption(first.source.id);const linkedResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.request().postDataJSON()?.method==='scholarflow.v1/sources.linkBibliography');await page.getByRole('button',{name:'确认同一文献',exact:true}).click();await linkedResponse
  const linked=await rpc('scholarflow.v1/project.inspect',{request:{context}});assert.equal(Object.keys(linked.ledger.sources).length,2);assert(linked.ledger.sources[second.source.id].bibliographySourceId===first.source.id)
  await page.getByRole('button',{name:'返回正文',exact:true}).click();await expect(page.locator('.sf-paper-references>p')).toHaveCount(1)
  state=await rpc('scholarflow.v1/project.inspect',{request:{context}});assert.equal(Object.keys(state.ledger.sources).length,2)
  record('confirmed bibliography association preserves original sources and shows one entry',true,{sourceCount:2,referenceCount:1})
  await page.getByLabel('排版与导出格式',{exact:true}).selectOption('docx')
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Word',exact:true}).click();const download=await downloaded;const path=join(root,'verified-paper.docx');await download.saveAs(path)
  const zip=await JSZip.loadAsync(await readFile(path)),xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string')
  assert(xml.includes('TEST_ONLY 文稿'));assert(/w:top="1701"/.test(xml));assert(/w:line="360"/.test(xml));assert(xml.includes('楷体'));assert(!styles.includes('2E74B5'));assert(xml.includes('w:ilvl w:val="0"'))
  assert.equal((xml.match(/TEST_ONLY Alpha Study/g)||[]).length,1);assert(!xml.includes('TEST_ONLY Beta Study'))
  record('normal Word export includes title, black styles, selected formatting, margin and shared references',true,{path})
  await page.screenshot({path:join(root,'workbench.png'),fullPage:true})
  assert.equal(errors.length,0)
  await writeFile(join(root,'report.json'),JSON.stringify({checks:rows,pageErrors:errors,paidModelCalls:0,root},null,2))
}catch(error){await writeFile(join(root,'failure.txt'),String(error.stack));if(page){await page.screenshot({path:join(root,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(root,'failure-page.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}finally{if(desktopApp)await desktopApp.close();if(browser)await browser.close();if(host)host.kill()}
console.log(JSON.stringify({passed:rows.filter(row=>row.ok).length,total:rows.length,root}))
