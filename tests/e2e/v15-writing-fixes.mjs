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
  const first=await sf('sources.register',{source:{title:'TEST_ONLY Alpha Study',authors:[{literal:'TEST_ONLY Author'}],kind:'paper',year:2025,identifiers:{}}})
  // Registering a second source with the same DOI or a similar title is refused by design
  // (SOURCE_ALREADY_REGISTERED), so these two stay genuinely distinct: the check below is that they keep
  // two entries instead of being merged.
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
  // v1.20 (SF-185): the report is a pill in the work bar now, so the checklist lives one
  // disclosure deeper and has to be opened before it can be read or toggled. The pill's panel hangs
  // over the editor bar, so it is closed again before the next toolbar click.
  const pillDetails=page.locator('.sf-progress-details')
  const setPill=async open=>{if(await pillDetails.evaluate(node=>node.open)!==open)await pillDetails.locator(':scope>summary').click()}
  await setPill(true)
  await page.locator('.sf-review-checklist>summary').click()
  const progressText=await page.locator('.sf-writing-progress').innerText()
  assert(!/66|本次执行未完成|技术详情|src_/.test(progressText));record('completed first draft shows current checks without old logs',true,{text:progressText})
  await page.locator('.sf-review-checklist>summary').click()
  await setPill(false)
  const prose=page.locator('.sf-paper-page .sf-prose>p').first()
  // Picking a value from the toolbar's own <select> collapses the DOM selection, and the
  // selectionchange handler then drops the edit range — so each field needs its own selection, the
  // same as a reader choosing a font and then a size by hand.
  const selectAcrossEmphasis=async()=>{await prose.scrollIntoViewIfNeeded()
    const points=await prose.evaluate(node=>{const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),texts=[];for(let t=walker.nextNode();t;t=walker.nextNode())texts.push(t)
      // Applying a style rewrites the paragraph, so a later call sees shorter text nodes; clamp or the
      // second selection throws IndexSizeError instead of selecting.
      const rect=(t,i)=>{const at=Math.min(Math.max(0,i),Math.max(0,t.length-1));const r=new Range();r.setStart(t,at);r.setEnd(t,at+1);const box=r.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}}
      return {from:rect(texts[0],0),to:rect(texts[Math.min(2,texts.length-1)],8)}})
    await page.mouse.move(points.from.x,points.from.y);await page.mouse.down();await page.mouse.move(points.to.x,points.to.y,{steps:12});await page.mouse.up();await page.waitForTimeout(150)}
  await selectAcrossEmphasis()
  assert.equal(await prose.evaluate(node=>getComputedStyle(node).userSelect),'text');
  let selection=await page.evaluate(()=>window.getSelection()?.toString())
  assert(selection&&selection.includes('强调文字'));assert(!await page.locator('.sf-draft-status').innerText().then(text=>text.includes('映射')))
  assert.equal(await page.locator('.sf-mark-inline').count(),0)
  record('continuous mouse selection crosses emphasis without mixed colours or mapping errors',true,{selection})
  // v1.16 moved the per-selection typography fields behind the 排版 entry; v1.20 kept them there and
  // only lifted the entry onto the editor bar, so the panel still has to be opened first. The drag
  // above proves the marking behaviour; formatting is driven from the source editor instead, because a
  // drag's offsets come from the rendered prose and shift whenever it re-renders, while a textarea
  // selection is plain offsets and survives a style application.
  await page.getByRole('button',{name:'编辑',exact:true}).click()
  const area=page.locator('.sf-source-input')
  await area.click();await area.press('Control+Home')
  await area.press('ArrowDown');await area.press('ArrowDown');await area.press('Home')
  for(let index=0;index<8;index++)await area.press('Shift+ArrowRight')
  await page.locator('.sf-format-toolbar').getByRole('button',{name:'排版',exact:true}).click()
  await page.getByLabel('选中文字中文字体',{exact:true}).selectOption('楷体')
  // Applying the style re-renders the prose. The armed range has to survive that, otherwise the
  // reader must select the same text again before every field — the defect this asserts against.
  await expect(page.locator('select[aria-label="选中文字字号"]')).toBeEnabled()
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
  // v1.16 (and v1.20) put the full-document typography section inside the same 排版 popover; 全文排版
  // is that section's header now, not a button of its own.
  await page.locator('.sf-format-toolbar').getByRole('button',{name:'排版',exact:true}).click()
  const panel=page.locator('.sf-formatting-panel[aria-label="全文排版设置"]');await panel.getByLabel('页边距（毫米）').fill('30');await panel.getByLabel('行距',{exact:true}).selectOption('1.5');await panel.getByLabel('页眉',{exact:true}).fill('TEST_ONLY 页眉');await panel.getByLabel('页脚',{exact:true}).fill('TEST_ONLY 页脚')
  await panel.getByRole('button',{name:'应用全文排版'}).click();await expect(panel).toHaveCount(0)
  await page.locator('.sf-flow-nav [data-node="materials"]').click()
  // v1.16 replaced the manual association (checkboxes + a chosen primary) with identity grouping: two
  // different works stay two entries, and no confirmation is asked for a pair that is not a duplicate.
  await expect(page.locator('.sf-reference-row[data-sf-source-id]')).toHaveCount(2)
  await expect(page.locator('.sf-duplicate-notice')).toHaveCount(0)
  const linked=await rpc('scholarflow.v1/project.inspect',{request:{context}});assert.equal(Object.keys(linked.ledger.sources).length,2)
  await page.locator('.sf-tool-back').getByRole('button',{name:'返回正文',exact:true}).click();await expect(page.locator('.sf-paper-references>p')).toHaveCount(2)
  state=await rpc('scholarflow.v1/project.inspect',{request:{context}});assert.equal(Object.keys(state.ledger.sources).length,2)
  record('two distinct sources keep two bibliography entries without a false merge',true,{sourceCount:2,referenceCount:2})
  await page.getByLabel('排版与导出格式',{exact:true}).selectOption('docx')
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Word',exact:true}).click();const download=await downloaded;const path=join(root,'verified-paper.docx');await download.saveAs(path)
  const zip=await JSZip.loadAsync(await readFile(path)),xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string')
  assert(xml.includes('TEST_ONLY 文稿'));assert(/w:top="1701"/.test(xml));assert(/w:line="360"/.test(xml));assert(xml.includes('楷体'));assert(!styles.includes('2E74B5'));assert(xml.includes('w:ilvl w:val="0"'))
  assert.equal((xml.match(/TEST_ONLY Alpha Study/g)||[]).length,1);assert.equal((xml.match(/TEST_ONLY Beta Study/g)||[]).length,1)
  record('normal Word export includes title, black styles, selected formatting, margin and both references',true,{path})
  await page.screenshot({path:join(root,'workbench.png'),fullPage:true})
  assert.equal(errors.length,0)
  await writeFile(join(root,'report.json'),JSON.stringify({checks:rows,pageErrors:errors,paidModelCalls:0,root},null,2))
}catch(error){await writeFile(join(root,'failure.txt'),String(error.stack));if(page){await page.screenshot({path:join(root,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(root,'failure-page.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}finally{if(desktopApp)await desktopApp.close();if(browser)await browser.close();if(host)host.kill()}
console.log(JSON.stringify({passed:rows.filter(row=>row.ok).length,total:rows.length,root}))
