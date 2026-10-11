// TEST_ONLY: resumes an isolated completed UI fixture. Real Host/IO and UI;
// the writing candidate is produced by Core using explicitly labelled fixture text.
// No model request and no credentials. One decision request is aborted to verify retry.
import {chromium,expect} from '@playwright/test'
import {spawn} from 'node:child_process'
import {join,resolve,relative} from 'node:path'
import {readFile,writeFile,mkdir,stat,readdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {proposeCowrite} from '../../src/core/editing/cowrite.ts'
import {projectMarkdown} from '../../src/core/editing/markdown.ts'
const root=resolve(process.argv[2]??'.dsh-tmp/product-completion/1791710443290')
assert.ok(root.startsWith(resolve('.dsh-tmp/product-completion')+'\\'))
const install=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness')
const host=spawn(join(install,'DeepSeek Harness.exe'),['--expose-internals',join(install,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'scroll-test','--no-open','--port','19396'],{env:{...process.env,DSH_HOME:root,ELECTRON_RUN_AS_NODE:'1',DSH_PERMISSION_MODE:'workspace-write'},windowsHide:true,stdio:['ignore','pipe','pipe']})
const url=new Promise((done,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Host boot timed out')),30000);host.stdout.on('data',chunk=>{output+=chunk.toString();const match=output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);if(match){clearTimeout(timer);done(match[1])}});host.on('exit',code=>{clearTimeout(timer);reject(Error('Host exited '+code))})})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const rows=[],errors=[];let page
const record=(name,detail)=>{rows.push({name,ok:true,detail});console.log('PASS '+name+': '+JSON.stringify(detail))}
try{
  page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
  await page.goto(await url);await page.getByRole('button',{name:'新建会话',exact:true}).first().waitFor({timeout:45000});await page.waitForTimeout(800)
  for(const name of ['继续','稍后配置']){const button=page.getByRole('dialog').getByRole('button',{name,exact:true});if(await button.count())await button.click({timeout:45000});await page.waitForTimeout(700)}
  const sessionRow=page.locator('[data-row-key^="session:"]').first();await sessionRow.click();await page.locator('.sf-middle-column').waitFor()
  const rpc=(method,args)=>page.evaluate(async({method,args})=>{const response=await fetch('api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})});const result=(await response.json()).result;if(!result.ok||result.value?.ok===false)throw Error(JSON.stringify(result.error??result.value.error));return result.value?.data??result.value},{method,args})
  const sessionId=await page.locator('.sf-project').getAttribute('data-sf-session-id'),workspaceId=(await page.locator('[role=treeitem][data-row-key^="workspace:"]').first().getAttribute('data-row-key')).slice('workspace:'.length)
  const context={requestId:'req_TEST_ONLY_continuation',sessionId,workspaceId};let project
  const latest=async()=>project=await rpc('scholarflow.v1/project.inspect',{request:{context}}),pc=()=>({...context,projectId:project.binding.projectId,expectedLedgerRevision:project.ledger.revision})
  await latest();const close=page.getByRole('button',{name:'收起右侧边栏',exact:true});if(await close.isVisible())await close.click()
  const menu=async name=>{await page.getByLabel('更多论文选项',{exact:true}).click();await page.locator('.sf-paper-toolbar .sf-paper-menu-popover').getByRole('button',{name,exact:true}).click()}
  if(process.argv.includes('--review-loop')){
    await menu('审查');await page.getByRole('button',{name:'运行确定性审查',exact:true}).click();await expect(page.locator('#sf-panel-Review').getByRole('status').filter({hasText:'对应当前版本'})).toBeVisible()
    const before=await rpc('scholarflow.v1/review.inspect',{request:{context:pc()}});assert.ok(before.report.checks.some(check=>check.id==='requirement_writing_length_max'&&check.status==='fail'))
    await page.getByRole('button',{name:'返回正文',exact:false}).click();const editor=page.getByRole('textbox',{name:'Markdown 手工编辑',exact:true})
    await editor.fill('# TEST_ONLY 复查\n\n## Analysis\n\n'+'这是测试正文。'.repeat(83));await editor.press('Control+s')
    await expect(page.locator('.sf-draft-status>[role="status"]')).toHaveText(/^\s*●?\s*已保存/u,{timeout:15000});await latest()
    await menu('审查');await page.getByRole('button',{name:'运行确定性审查',exact:true}).click();await expect(page.locator('#sf-panel-Review').getByRole('status').filter({hasText:'对应当前版本'})).toBeVisible()
    const after=await rpc('scholarflow.v1/review.inspect',{request:{context:pc()}});assert.ok(after.report.checks.some(check=>check.id==='requirement_writing_length_max'&&check.status==='pass'));assert.equal(after.stale,false)
    await page.getByRole('button',{name:'返回正文',exact:false}).click();const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.sf-export-split>button').click()]);await download.saveAs(join(root,'after-recheck.docx'))
    record('actual UI review, manual issue correction, recheck and export form a complete loop',{beforeReviewId:before.report.id,afterReviewId:after.report.id})
  }else if(process.argv.includes('--layout-only')){
    await menu('资料与引用');await page.locator('.sf-native-workspace').screenshot({path:join(root,'final-materials.png')})
    await page.getByRole('button',{name:'返回正文',exact:false}).click();await page.getByRole('button',{name:'预览',exact:true}).click()
    await page.locator('.sf-paper-scroll').evaluate(node=>node.scrollTop=0)
    await page.locator('.sf-native-workspace').screenshot({path:join(root,'final-paper-preview.png')})
    await page.getByRole('button',{name:'分屏',exact:true}).click()
  }else if(process.argv.includes('--finish-existing')){
    if(!process.argv.includes('--images-only')){
    const buffer=await rpc('scholarflow.v1/editor.bufferRead',{request:{context:pc()}})
    assert.ok(buffer.buffer.text.includes('用于验证完整链路'));assert.equal(buffer.buffer.text.split('用于验证完整链路').length-1,1)
    await page.getByRole('button',{name:'查看与处理',exact:true}).click()
    await page.getByRole('button',{name:'恢复宿主未提交缓冲',exact:true}).click()
    await page.getByRole('button',{name:'返回正文',exact:false}).click()
    await expect(page.getByRole('textbox',{name:'Markdown 手工编辑',exact:true})).toHaveValue(/用于验证完整链路/)
    await page.getByRole('textbox',{name:'Markdown 手工编辑',exact:true}).press('Control+s')
    await expect(page.locator('.sf-draft-status>[role="status"]')).toHaveText(/^\s*●?\s*已保存/u,{timeout:15000});await latest();assert.ok(project.document.text.includes('用于验证完整链路'))
    await expect(page.locator('.sf-preview-pane .sf-origin-ai')).toHaveCount(1)
    record('persisted accepted candidate survives browser restart, saves exactly once and has exact provenance',{})
    }else{assert.ok(project.document.text.includes('用于验证完整链路'));await expect(page.locator('.sf-preview-pane .sf-origin-ai')).toHaveCount(1);record('accepted decision and exact provenance remain intact after the committed save',{})}
    const original=project.document.text,png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kZkAAAAASUVORK5CYII=','base64')
    await writeFile(join(root,'Scroll TEST_ONLY','TEST_ONLY-figure.png'),png)
    const editor=page.getByRole('textbox',{name:'Markdown 手工编辑',exact:true});await editor.fill(original+'\n\n![TEST_ONLY figure](../TEST_ONLY-figure.png)\n');await editor.press('Control+s')
    await expect(page.locator('.sf-draft-status>[role="status"]')).toHaveText(/^\s*●?\s*已保存/u,{timeout:15000});await latest();assert.ok(project.document.text.includes('TEST_ONLY-figure.png'))
    await page.getByRole('combobox',{name:'排版与导出格式',exact:true}).selectOption('docx')
    await expect(page.locator('.sf-export-format-label')).toContainText('Word')
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.sf-export-split>button').click()]);await download.saveAs(join(root,'images-word.zip'))
    const imageZip=await JSZip.loadAsync(await readFile(join(root,'images-word.zip'))),asset=Object.keys(imageZip.files).find(path=>path.startsWith('assets/')&&path.endsWith('.png'))
    assert.ok(asset);assert.deepEqual(await imageZip.file(asset).async('nodebuffer'),png)
    const word=await JSZip.loadAsync(await imageZip.file('paper.docx').async('nodebuffer'));assert.equal(Object.keys(word.files).filter(path=>path.startsWith('word/media/')&&!word.files[path].dir).length,1)
    record('actual Host packages PNG bytes and embeds the same image in Word',{asset})
  }else{
  await menu('审查');await page.getByRole('button',{name:'运行确定性审查',exact:true}).click();await expect(page.locator('#sf-panel-Review').getByRole('status').filter({hasText:'对应当前版本'})).toBeVisible()
  record('real UI review corresponds to current manuscript',{})
  await page.getByRole('button',{name:'返回正文',exact:false}).click()
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.sf-export-split>button').click()]);await download.saveAs(join(root,'quick-export.md'))
  await expect(page.locator('.sf-editor-notice')).toContainText('工作草稿');await expect(page.getByRole('button',{name:'下载完整交付包',exact:true}).first()).toBeVisible()
  const [bundle]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'下载完整交付包',exact:true}).first().click()]);await bundle.saveAs(join(root,'delivery.zip'))
  const zip=await JSZip.loadAsync(await readFile(join(root,'delivery.zip')))
  assert.ok(zip.file('paper.md'));assert.ok(zip.file('references.bib'));assert.ok(zip.file('quality-report.md'));assert.ok(zip.file('manifest.json'))
  assert.equal(await zip.file('paper.md').async('string'),await readFile(join(root,'quick-export.md'),'utf8'))
  record('working-draft status and complete bundle are from one immutable delivery',{files:Object.keys(zip.files)})
  await latest();await menu('版本记录');const history=page.locator('#sf-panel-History'),versions=(await rpc('scholarflow.v1/document.versions',{request:{context:pc()}})).versions
  const selected=await rpc('scholarflow.v1/document.versions',{request:{context:pc(),revisionId:versions[1].revisionId}})
  await history.locator('.sf-reference-row button').nth(1).click();await history.getByRole('combobox',{name:'与版本比较',exact:true}).selectOption(project.document.revisionId)
  await expect(history.locator('.sf-change')).toContainText('对照版本');await history.getByRole('button',{name:'预览恢复此版本',exact:true}).click();await history.getByRole('button',{name:'确认恢复为新修订',exact:true}).click()
  await expect(history.getByRole('status')).toContainText('已恢复为新修订');await latest();assert.equal(project.document.text,selected.text);assert.ok(!versions.some(row=>row.revisionId===project.document.revisionId))
  record('real UI compares versions and restores into a new revision',{revisionId:project.document.revisionId})
  await page.getByRole('button',{name:'返回正文',exact:false}).click()
  class TestOnlyDiskStore{
    async read(path){try{const text=await readFile(join(root,'Scroll TEST_ONLY',path),'utf8');return {text,version:text}}catch(error){if(error.code==='ENOENT')return undefined;throw error}}
    async readBytes(path,max){const bytes=await readFile(join(root,'Scroll TEST_ONLY',path));assert.ok(bytes.length<=max);return bytes}
    async stat(path){try{const info=await stat(join(root,'Scroll TEST_ONLY',path));return {path,type:info.isDirectory()?'directory':'file',size:info.size}}catch(error){if(error.code==='ENOENT')return undefined;throw error}}
    async list(path){return Promise.all((await readdir(join(root,'Scroll TEST_ONLY',path))).map(async name=>this.stat(path+'/'+name)))}
    async lock(work){return work()}
    async write(path,text,expected){assert.ok(path.startsWith('.scholarflow/writing/suggestions/'));assert.equal((await this.read(path))?.text,expected?.text);await mkdir(join(root,'Scroll TEST_ONLY',path,'..'),{recursive:true});await writeFile(join(root,'Scroll TEST_ONLY',path),text);return {text,version:text}}
  }
  const io=new TestOnlyDiskStore(),block=projectMarkdown(project.document.text).blocks[0],before=project.document.text.slice(block.start,block.end),after=before.replace('用于验证滚轮','用于验证完整链路')
  assert.notEqual(before,after)
  const suggestion=await proposeCowrite(io,sessionId,{text:project.document.text,baseDocumentHash:project.document.contentHash,start:block.start,end:block.end,replacementText:after,instruction:'TEST_ONLY explicit fixture candidate; no model request',action:'polish'})
  await expect(page.locator('.sf-preview-pane .sf-cowrite-inline').filter({hasText:'TEST_ONLY explicit fixture'})).toBeVisible({timeout:15000})
  const card=page.locator('.sf-preview-pane .sf-cowrite-inline').filter({hasText:'TEST_ONLY explicit fixture'})
  const failed='**/api/scholarflow.v1/cowrite.decide';await page.route(failed,route=>route.abort('connectionrefused'))
  await card.getByRole('button',{name:'接受',exact:true}).click();await expect(card.getByRole('button',{name:'重试保存采用决定',exact:true})).toBeEnabled({timeout:15000})
  await page.unroute(failed);await card.getByRole('button',{name:'重试保存采用决定',exact:true}).click();await expect(card).toHaveCount(0)
  const buffer=await rpc('scholarflow.v1/editor.bufferRead',{request:{context:pc()}})
  assert.ok(buffer.buffer.text.includes('用于验证完整链路'));assert.equal(buffer.buffer.text.split('用于验证完整链路').length-1,1)
  await page.getByRole('textbox',{name:'Markdown 手工编辑',exact:true}).press('Control+s');await expect.poll(async()=>{await latest();return project.document.text.includes('用于验证完整链路')},{timeout:15000}).toBe(true)
  await expect(page.locator('.sf-preview-pane .sf-origin-ai')).toHaveCount(1)
  record('Core fixture candidate: acceptance, failed decision transport, retry without duplicate merge, save and exact provenance',{suggestionId:suggestion.id})
  }
  for(const width of [1440,720,320]){await page.setViewportSize({width,height:900});await page.waitForTimeout(400);const geometry=await page.locator('.sf-middle-column').evaluate(node=>{const preview=node.querySelector('.sf-preview-pane'),source=node.querySelector('.sf-source-pane');return {client:node.clientWidth,scroll:node.scrollWidth,previewWidth:preview.getBoundingClientRect().width,sourceWidth:source.getBoundingClientRect().width,stacked:preview.getBoundingClientRect().top>=source.getBoundingClientRect().bottom-1}});assert.ok(geometry.scroll<=geometry.client+1);if(width===320){assert.ok(geometry.stacked);assert.ok(geometry.previewWidth>=geometry.client-1)}record('actual UI responsive reading '+width,geometry);await page.locator('.sf-native-workspace').screenshot({path:join(root,`final-paper-${width}.png`)})}
  assert.deepEqual(errors,[]);record('no client runtime errors in remaining feature chains',{})
}catch(error){rows.push({name:'run',ok:false,detail:error.message});await page?.screenshot({path:join(root,'continuation-failure.png')}).catch(()=>{});throw error}
finally{await writeFile(join(root,'continuation-journal.json'),JSON.stringify(rows,null,2));console.log('Journal:',join(root,'continuation-journal.json'));await browser.close();host.kill()}
